// Orchestrates the backup layer: ingest (R2 -> providers) for the queue consumer,
// and serve (providers -> client) for the read failover path. Chunking/manifest
// details live in their own modules; this ties them together.

import { chunkRanges, streamConcat, type ChunkRange } from "./chunk";
import { getManifest, putManifest, isDone, type BackupManifest, type Provider, type TgChunk, type DcChunk } from "./manifest";
import type { BackupEnv, BackupJob } from "./env";
import { attachmentDisposition } from "../filename";
import * as tg from "./telegram";
import * as dc from "./discord";

// 18 MiB keeps every chunk under Telegram's 20 MB getFile download cap (the binding
// limit). The storage Discord guild must be boosted high enough to accept this too.
const DEFAULT_CHUNK_BYTES = 18 * 1024 * 1024;

function chunkBytesFor(env: BackupEnv): number {
  const n = parseInt(env.BACKUP_CHUNK_BYTES || "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CHUNK_BYTES;
}

const r2Key = (md5: string, ext: string) => `files/${md5}${ext}`;
const chunkName = (md5: string, r: ChunkRange) => `${md5}.part${String(r.i).padStart(3, "0")}`;

/** Whether any backup provider is configured at all. */
export function backupConfigured(env: BackupEnv): boolean {
  return tg.tgConfigured(env) || dc.dcConfigured(env);
}

async function readRange(env: BackupEnv, key: string, r: ChunkRange): Promise<ArrayBuffer> {
  const obj = await env.BOOKS.get(key, { range: { offset: r.offset, length: r.length } });
  if (!obj) throw new Error(`R2 range read failed for ${key} @${r.offset}`);
  return await obj.arrayBuffer();
}

/**
 * Push a freshly-cached book into the backup providers. Reads R2 one ranged slice
 * at a time (bounded memory), uploads each chunk, and records the manifest after
 * each provider completes so partial progress survives a retry. Idempotent: a
 * provider already marked done is skipped. Throws on failure so the queue retries.
 */
export async function ingest(env: BackupEnv, job: BackupJob): Promise<void> {
  if (!env.BACKUPS || !backupConfigured(env)) return;

  const key = r2Key(job.md5, job.ext);
  const head = await env.BOOKS.head(key);
  if (!head) throw new Error(`R2 object missing for ${job.md5} — will retry`);

  const size = head.size;
  const chunkBytes = chunkBytesFor(env);
  const ranges = chunkRanges(size, chunkBytes);

  let manifest = await getManifest(env, job.md5);
  // Rebuild from scratch if there's no manifest or the file/chunking changed
  // (a re-download with different bytes would invalidate stored chunk offsets).
  if (!manifest || manifest.size !== size || manifest.chunkBytes !== chunkBytes) {
    manifest = { md5: job.md5, ext: job.ext, mime: job.mime, size, chunkBytes, updatedAt: "" };
  }

  // Providers are independent: a failure in one must NOT prevent backing up to the
  // other (that's the whole point of redundancy). Each is attempted in isolation;
  // we persist progress as each completes, and rethrow at the end so the queue
  // retries only the provider(s) still pending (isDone skips the ones that worked).
  const errors: string[] = [];

  if (tg.tgConfigured(env) && !isDone(manifest, "tg")) {
    try {
      const chunks: TgChunk[] = [];
      for (const r of ranges) {
        const up = await tg.uploadChunk(env, await readRange(env, key, r), chunkName(job.md5, r));
        chunks.push({ i: r.i, messageId: up.messageId, fileId: up.fileId, size: up.size });
      }
      manifest.tg = { chatId: env.TELEGRAM_CHAT_ID!, chunks, done: true };
      await putManifest(env, manifest);
    } catch (e) {
      errors.push(`telegram: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (dc.dcConfigured(env) && !isDone(manifest, "dc")) {
    try {
      const chunks: DcChunk[] = [];
      for (const r of ranges) {
        const up = await dc.uploadChunk(env, await readRange(env, key, r), chunkName(job.md5, r));
        chunks.push({ i: r.i, messageId: up.messageId, attachmentId: up.attachmentId, size: up.size });
      }
      manifest.dc = { channelId: env.DISCORD_CHANNEL_ID!, chunks, done: true };
      await putManifest(env, manifest);
    } catch (e) {
      errors.push(`discord: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (errors.length) throw new Error(errors.join("; "));
}

function chunkFactories(env: BackupEnv, manifest: BackupManifest, provider: Provider): Array<() => Promise<ReadableStream<Uint8Array>>> {
  if (provider === "tg") {
    const chunks = [...manifest.tg!.chunks].sort((a, b) => a.i - b.i);
    return chunks.map((c) => () => tg.chunkStream(env, c.fileId));
  }
  const channelId = manifest.dc!.channelId;
  const chunks = [...manifest.dc!.chunks].sort((a, b) => a.i - b.i);
  return chunks.map((c) => () => dc.chunkStream(env, channelId, c.messageId));
}

/**
 * Give a reassembled stream its byte length back.
 *
 * `streamConcat` builds a JavaScript ReadableStream, and workerd treats any such stream
 * (and both halves of its tee) as length-unknown: R2 refuses it outright ("Provided
 * readable stream must have a known length") and a Response silently drops its
 * Content-Length. Both were true here from the day this path shipped. The re-warm put
 * failed into the swallowed rejection below, so a book that aged out of R2 was served
 * from a provider on every request after, with no size for the client's progress bar
 * and no Range support. Verified 2026-10-17: four full downloads of a backed-up book,
 * and R2 still answered "The specified key does not exist."
 *
 * FixedLengthStream also errors if the byte count comes out different, so a short or
 * mismatched reassembly can never become the cached copy.
 */
function withLength(stream: ReadableStream<Uint8Array>, size: number): ReadableStream<Uint8Array> {
  const fixed = new FixedLengthStream(size);
  stream.pipeTo(fixed.writable).catch(() => {
    /* the readable side errors with it; its consumer sees the failure */
  });
  return fixed.readable;
}

/**
 * Build a streamed Response that reassembles the book from a provider's chunks,
 * teeing a copy back into R2 to re-warm the cache. The first chunk is opened
 * eagerly so an unreachable provider (deleted message, bad token) throws HERE,
 * letting the caller fail over to the next provider before any bytes are sent.
 * Remaining chunks open lazily and in order, so memory stays bounded to ~one chunk.
 * Caller must have verified isDone(manifest, provider).
 */
export async function serve(
  env: BackupEnv,
  manifest: BackupManifest,
  provider: Provider,
  filename: string,
  ctx: ExecutionContext,
  onRewarmed?: () => Promise<void>,
  /**
   * Content-Type for the response, derived by the caller from the extension the client
   * actually asked for. `manifest.mime` is whatever the mime was on the day this book
   * was *backed up*, which is not the same question — a book first fetched as `.pdf`
   * and later requested as `.epub` served genuine EPUB bytes under
   * `Content-Type: application/pdf`, permanently, because nothing ever re-derives the
   * stored field. Storage still records manifest.mime; only what we tell the client
   * changes. Falls back to the manifest when the caller has nothing better.
   */
  responseMime?: string,
): Promise<Response> {
  const factories = chunkFactories(env, manifest, provider);
  const first = await factories[0](); // validate provider up front; throws -> caller fails over
  const ordered = [() => Promise.resolve(first), ...factories.slice(1)];
  const disposition = attachmentDisposition(filename);

  const [toClient, toR2] = streamConcat(ordered).tee();
  ctx.waitUntil(
    env.BOOKS.put(r2Key(manifest.md5, manifest.ext), withLength(toR2, manifest.size), {
      httpMetadata: { contentType: manifest.mime, contentDisposition: disposition },
    }).then(
      // `onRewarmed` is how the caller converges a partially-backed-up book, and it
      // MUST hang off this promise rather than run alongside it. ingest() sources its
      // bytes from R2, but this R2 copy only exists once the tee'd stream has fully
      // drained — which is exactly why the book was being served from a provider in
      // the first place. Enqueueing before the put resolves produced a job that raced
      // the write and lost every time ("R2 object missing"), burned all 5 retries plus
      // the DLQ, and wrote a ledger entry that could never clear. Chaining it here also
      // means an aborted download simply never enqueues, instead of enqueueing a job
      // whose bytes will never arrive.
      () => onRewarmed?.() ?? Promise.resolve(),
      () => {}, // best-effort re-warm; a failure here must not break the client stream
    ).catch(() => {}),
  );

  return new Response(withLength(toClient, manifest.size), {
    headers: {
      "Content-Type": responseMime || manifest.mime,
      "Content-Disposition": disposition,
      "Content-Length": String(manifest.size),
    },
  });
}

// ---- Failure ledger ----------------------------------------------------------
// A job that exhausts its retries lands in the dead-letter queue. Without a record
// there, the book is silently lost: no manifest, and once R2's 30-day cache expires
// the bytes are gone with nothing saying which book it was. These entries are the
// audit trail — written only after the very last attempt fails.
const FAILED_TTL = 90 * 24 * 3600;
const failedKey = (md5: string) => `backup-failed:${md5}`;

export interface BackupFailure {
  md5: string;
  ext: string;
  mime: string;
  error: string;
  failedAt: string;
  /** Whether the bytes were still in R2 at failure time (i.e. still re-drivable). */
  inR2: boolean;
}

export async function recordFailure(env: BackupEnv, job: BackupJob, error: unknown): Promise<void> {
  if (!env.BACKUPS) return;
  let inR2 = false;
  try {
    inR2 = Boolean(await env.BOOKS.head(r2Key(job.md5, job.ext)));
  } catch {
    /* treat an unreadable head as "unknown" — the error string still tells the story */
  }
  const record: BackupFailure = {
    md5: job.md5,
    ext: job.ext,
    mime: job.mime,
    error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
    failedAt: new Date().toISOString(),
    inR2,
  };
  await env.BACKUPS.put(failedKey(job.md5), JSON.stringify(record), { expirationTtl: FAILED_TTL });
}

/** Clear a previously-recorded failure once the book finally backs up. */
export async function clearFailure(env: BackupEnv, md5: string): Promise<void> {
  if (!env.BACKUPS) return;
  await env.BACKUPS.delete(failedKey(md5)).catch(() => {});
}

export interface DestroyReport {
  /** Whether a manifest existed at all. */
  found: boolean;
  tgDeleted: number;
  dcDeleted: number;
  /** Chunk messages still on a provider. Non-empty means the manifest was kept. */
  remaining: string[];
}

/**
 * Delete a book's chunks from every provider, then its manifest and failure ledger.
 * Partial uploads (done: false) are deleted too. The manifest is only dropped once
 * nothing remains, because it holds the only record of which messages to delete.
 */
export async function destroy(env: BackupEnv, md5: string): Promise<DestroyReport> {
  const report: DestroyReport = { found: false, tgDeleted: 0, dcDeleted: 0, remaining: [] };
  if (!env.BACKUPS) return report;
  const manifest = await getManifest(env, md5);
  if (manifest) {
    report.found = true;
    if (manifest.tg?.chunks.length) {
      const ids = manifest.tg.chunks.map((c) => c.messageId);
      const failed = tg.tgConfigured(env) ? await tg.deleteMessages(env, manifest.tg.chatId, ids) : ids;
      report.tgDeleted = ids.length - failed.length;
      report.remaining.push(...failed.map((id) => `tg:${id}`));
    }
    for (const c of manifest.dc?.chunks ?? []) {
      try {
        if (!dc.dcConfigured(env)) throw new Error("discord not configured");
        await dc.deleteMessage(env, manifest.dc!.channelId, c.messageId);
        report.dcDeleted++;
      } catch (e) {
        console.error("discord chunk delete failed", md5, c.messageId, e);
        report.remaining.push(`dc:${c.messageId}`);
      }
    }
    if (report.remaining.length) return report;
    await env.BACKUPS.delete(`backup:${md5}`);
  }
  await env.BACKUPS.delete(failedKey(md5)).catch(() => {});
  return report;
}

/** True if a configured provider still lacks a complete backup of this manifest. */
export function needsMoreBackup(env: BackupEnv, manifest: BackupManifest | null): boolean {
  if (!manifest) return backupConfigured(env);
  return (tg.tgConfigured(env) && !isDone(manifest, "tg")) || (dc.dcConfigured(env) && !isDone(manifest, "dc"));
}

/** Which providers can currently serve this md5 (in failover priority order). */
export async function readableProviders(env: BackupEnv, md5: string): Promise<{ manifest: BackupManifest | null; providers: Provider[] }> {
  const manifest = await getManifest(env, md5);
  const providers: Provider[] = [];
  // Only advertise a provider we can actually read from now: a complete manifest
  // is useless if that provider's token was since removed (we'd open a doomed
  // round-trip before failing over). Order = failover priority (Telegram first).
  if (tg.tgConfigured(env) && isDone(manifest, "tg")) providers.push("tg");
  if (dc.dcConfigured(env) && isDone(manifest, "dc")) providers.push("dc");
  return { manifest, providers };
}
