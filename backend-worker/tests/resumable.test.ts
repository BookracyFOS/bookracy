import { test } from "node:test";
import assert from "node:assert/strict";
import { resumableBody, parseContentRange } from "../src/resumable.ts";

const bytes = (n: number, seed = 0) => Uint8Array.from({ length: n }, (_, i) => (i + seed) % 251);

/** A stream of `data` in chunks, that either ends cleanly after `cutAt` bytes or errors there. */
function streamOf(data: Uint8Array, cutAt = data.length, mode: "end" | "error" = "end", chunk = 7): ReadableStream<Uint8Array> {
  let pos = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (pos >= cutAt) {
        if (mode === "error" && cutAt < data.length) c.error(new Error("connection reset"));
        else c.close();
        return;
      }
      const end = Math.min(cutAt, pos + chunk);
      c.enqueue(data.slice(pos, end));
      pos = end;
    },
  });
}

const partial = (data: Uint8Array, offset: number, cutAt?: number, mode: "end" | "error" = "end") =>
  new Response(streamOf(data.slice(offset), cutAt === undefined ? undefined : cutAt - offset, mode), {
    status: 206,
    headers: { "Content-Range": `bytes ${offset}-${data.length - 1}/${data.length}` },
  });

async function collect(s: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(s).arrayBuffer());
}

test("parseContentRange reads start, end and total", () => {
  assert.deepEqual(parseContentRange("bytes 1000000-1000999/27363621"), { start: 1000000, end: 1000999, total: 27363621 });
  assert.deepEqual(parseContentRange("bytes 5-9/*"), { start: 5, end: 9, total: undefined });
  assert.equal(parseContentRange("garbage"), null);
  assert.equal(parseContentRange(null), null);
});

test("a stream that completes normally passes through untouched", async () => {
  const data = bytes(1000);
  let refetches = 0;
  const out = await collect(resumableBody(streamOf(data), { total: 1000, refetch: async () => { refetches++; return null; }, retryDelayMs: 0 }));
  assert.deepEqual(out, data);
  assert.equal(refetches, 0);
});

test("an upstream that ends CLEANLY short of Content-Length is resumed from the exact offset", async () => {
  // The production failure: a clean end of stream at 16% of the file.
  const data = bytes(1000, 3);
  const offsets: number[] = [];
  const out = await collect(
    resumableBody(streamOf(data, 160), {
      total: 1000,
      refetch: async (offset) => { offsets.push(offset); return partial(data, offset); },
      retryDelayMs: 0,
    }),
  );
  assert.deepEqual(out, data);
  assert.deepEqual(offsets, [160]);
});

test("an upstream connection error mid-stream is resumed too, across several drops", async () => {
  const data = bytes(900, 9);
  const offsets: number[] = [];
  const out = await collect(
    resumableBody(streamOf(data, 100, "error"), {
      total: 900,
      // each resumed leg also drops, 250 bytes further on, until the end
      refetch: async (offset) => { offsets.push(offset); return partial(data, offset, Math.min(900, offset + 250), "error"); },
      retryDelayMs: 0,
    }),
  );
  assert.deepEqual(out, data);
  assert.deepEqual(offsets, [100, 350, 600, 850]);
});

test("failed resume attempts are retried before giving up", async () => {
  const data = bytes(500);
  let calls = 0;
  const out = await collect(
    resumableBody(streamOf(data, 200), {
      total: 500,
      refetch: async (offset) => { calls++; return calls < 3 ? new Response("busy", { status: 503 }) : partial(data, offset); },
      retryDelayMs: 0,
    }),
  );
  assert.deepEqual(out, data);
  assert.equal(calls, 3);
});

test("a 206 that starts at the wrong byte is rejected, never spliced in", async () => {
  const data = bytes(400);
  let calls = 0;
  const s = resumableBody(streamOf(data, 100), {
    total: 400,
    refetch: async () => { calls++; return partial(data, 50); }, // wrong offset every time
    maxResumes: 3,
    retryDelayMs: 0,
  });
  await assert.rejects(collect(s), /ended at 100 of 400/);
  assert.equal(calls, 3);
});

test("when every resume fails the stream ERRORS — a short body must never look finished", async () => {
  const data = bytes(300);
  const s = resumableBody(streamOf(data, 120), { total: 300, refetch: async () => null, maxResumes: 2, retryDelayMs: 0 });
  await assert.rejects(collect(s), /ended at 120 of 300/);
});

test("a 200 full-body reply to a Range request is not accepted as a resume", async () => {
  const data = bytes(300);
  const s = resumableBody(streamOf(data, 120), {
    total: 300,
    refetch: async () => new Response(streamOf(data), { status: 200 }),
    maxResumes: 2,
    retryDelayMs: 0,
  });
  await assert.rejects(collect(s), /ended at 120 of 300/);
});

test("more bytes than declared is an error, not silently accepted", async () => {
  const data = bytes(300);
  const s = resumableBody(streamOf(data), { total: 200, refetch: async () => null, retryDelayMs: 0 });
  await assert.rejects(collect(s), /more than its declared 200 bytes/);
});
