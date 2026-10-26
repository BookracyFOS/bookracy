import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import type { BackupManifest } from "../src/storage/manifest.ts";

// backup.ts imports its siblings without extensions ("./chunk"), which the bundler
// resolves and Node's loader does not. Retry those as `.ts` — for this file only, and
// before the dynamic import below, so production code keeps its import style.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (e) {
      if (!/^\.\.?\//.test(specifier) || /\.[a-z]+$/i.test(specifier)) throw e;
      return next(`${specifier}.ts`, context);
    }
  },
});
const { serve } = await import("../src/storage/backup.ts");

// workerd's rule, which Node doesn't have: R2 only accepts a stream whose length is
// known, and a JS-built stream (like streamConcat's) isn't one. FixedLengthStream's
// readable is. Modelling that is the point of this file — serve() shipped with a re-warm
// that R2 rejected on every call, and nothing noticed for four months.
const knownLength = new WeakSet<ReadableStream>();

class FakeFixedLengthStream {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  constructor(size: number) {
    let seen = 0;
    const t = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, c) {
        seen += chunk.byteLength;
        c.enqueue(chunk);
      },
      flush() {
        if (seen !== size) throw new Error(`FixedLengthStream: expected ${size} bytes, got ${seen}`);
      },
    });
    this.readable = t.readable;
    this.writable = t.writable;
    knownLength.add(t.readable);
  }
}
(globalThis as Record<string, unknown>).FixedLengthStream = FakeFixedLengthStream;

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7) % 251);

async function collect(s: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const reader = s.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

/** A book split into Telegram chunks, a fetch that serves them, and an R2 that enforces known length. */
function setup(data: Uint8Array, chunkBytes: number, manifestSize = data.length) {
  const chunks: Uint8Array[] = [];
  for (let o = 0; o < data.length; o += chunkBytes) chunks.push(data.slice(o, o + chunkBytes));

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const getFile = url.match(/\/getFile\?file_id=f(\d+)$/);
    if (getFile) return Response.json({ ok: true, result: { file_path: `docs/${getFile[1]}` } });
    const file = url.match(/\/file\/bot[^/]+\/docs\/(\d+)$/);
    if (file) return new Response(chunks[Number(file[1])]);
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;

  const stored = new Map<string, Uint8Array>();
  const env = {
    TELEGRAM_BOT_TOKEN: "t",
    TELEGRAM_CHAT_ID: "c",
    BOOKS: {
      async put(key: string, body: ReadableStream<Uint8Array>) {
        if (!knownLength.has(body)) throw new TypeError("Provided readable stream must have a known length");
        stored.set(key, await collect(body));
      },
    },
  };
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} };
  const manifest: BackupManifest = {
    md5: "a".repeat(32),
    ext: ".epub",
    mime: "application/epub+zip",
    size: manifestSize,
    chunkBytes,
    updatedAt: "",
    tg: { chatId: "c", chunks: chunks.map((c, i) => ({ i, messageId: i, fileId: `f${i}`, size: c.byteLength })), done: true },
  };
  return { env, ctx, manifest, stored, pending, restore: () => (globalThis.fetch = realFetch) };
}

test("serve re-warms R2 with the full book and reports its length", async () => {
  const data = bytes(25_000);
  const s = setup(data, 10_000);
  try {
    let rewarmed = 0;
    const resp = await serve(s.env as never, s.manifest, "tg", "book.epub", s.ctx as never, async () => void rewarmed++);
    assert.equal(resp.headers.get("Content-Length"), "25000");
    assert.deepEqual(await collect(resp.body!), data);
    await Promise.all(s.pending);
    assert.deepEqual(s.stored.get(`files/${"a".repeat(32)}.epub`), data);
    assert.equal(rewarmed, 1, "convergence hangs off the completed put");
  } finally {
    s.restore();
  }
});

test("a reassembly that comes up short is neither cached nor delivered as complete", async () => {
  const data = bytes(25_000);
  const s = setup(data, 10_000, 30_000); // manifest claims more bytes than the chunks hold
  try {
    let rewarmed = 0;
    const resp = await serve(s.env as never, s.manifest, "tg", "book.epub", s.ctx as never, async () => void rewarmed++);
    await assert.rejects(collect(resp.body!));
    await Promise.all(s.pending);
    assert.equal(s.stored.size, 0);
    assert.equal(rewarmed, 0);
  } finally {
    s.restore();
  }
});
