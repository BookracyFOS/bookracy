// The KV record describing where a book's bytes live across the backup providers.
// Keyed by `backup:{md5}` in the BACKUPS namespace. Stores provider message/file
// ids only — NEVER download URLs, which expire and must be re-resolved per read.

import type { BackupEnv } from "./env";

export type Provider = "tg" | "dc";

export interface TgChunk {
  i: number;
  messageId: number;
  /** Stable, reusable across getFile calls — the handle we re-resolve to download. */
  fileId: string;
  size: number;
}

export interface DcChunk {
  i: number;
  messageId: string;
  attachmentId: string;
  size: number;
}

export interface TgBackup {
  chatId: string;
  chunks: TgChunk[];
  done: boolean;
}

export interface DcBackup {
  channelId: string;
  chunks: DcChunk[];
  done: boolean;
}

export interface BackupManifest {
  md5: string;
  ext: string;
  mime: string;
  size: number;
  chunkBytes: number;
  tg?: TgBackup;
  dc?: DcBackup;
  updatedAt: string;
}

const keyFor = (md5: string) => `backup:${md5}`;

export async function getManifest(env: BackupEnv, md5: string): Promise<BackupManifest | null> {
  if (!env.BACKUPS) return null;
  return await env.BACKUPS.get<BackupManifest>(keyFor(md5), "json");
}

export async function putManifest(env: BackupEnv, manifest: BackupManifest): Promise<void> {
  if (!env.BACKUPS) return;
  manifest.updatedAt = new Date().toISOString();
  await env.BACKUPS.put(keyFor(manifest.md5), JSON.stringify(manifest));
}

/** A provider is usable as a read source only once it has finished uploading all chunks. */
export function isDone(manifest: BackupManifest | null, provider: Provider): boolean {
  if (!manifest) return false;
  const p = manifest[provider];
  return Boolean(p?.done && p.chunks.length > 0);
}
