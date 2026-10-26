import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkRanges, streamConcat } from "../src/storage/chunk.ts";

test("chunkRanges: exact multiple splits evenly", () => {
  const ranges = chunkRanges(40, 10);
  assert.deepEqual(ranges, [
    { i: 0, offset: 0, length: 10 },
    { i: 1, offset: 10, length: 10 },
    { i: 2, offset: 20, length: 10 },
    { i: 3, offset: 30, length: 10 },
  ]);
});

test("chunkRanges: remainder goes in a short final chunk", () => {
  const ranges = chunkRanges(25, 10);
  assert.deepEqual(ranges.map((r) => r.length), [10, 10, 5]);
  assert.equal(ranges.at(-1)!.offset, 20);
});

test("chunkRanges: file smaller than a chunk -> single chunk", () => {
  assert.deepEqual(chunkRanges(7, 10), [{ i: 0, offset: 0, length: 7 }]);
});

test("chunkRanges: zero-size file -> no chunks", () => {
  assert.deepEqual(chunkRanges(0, 10), []);
});

test("chunkRanges: covers every byte with no gaps or overlap", () => {
  const size = 12345;
  const ranges = chunkRanges(size, 1000);
  let cursor = 0;
  for (const r of ranges) {
    assert.equal(r.offset, cursor);
    cursor += r.length;
  }
  assert.equal(cursor, size);
});

test("chunkRanges: rejects non-positive chunk size", () => {
  assert.throws(() => chunkRanges(10, 0));
});

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) parts.push(value);
  }
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

function streamOf(bytes: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

test("streamConcat: joins chunks in order, lazily", async () => {
  const opened: number[] = [];
  const factories = [
    async () => {
      opened.push(0);
      return streamOf([1, 2, 3]);
    },
    async () => {
      opened.push(1);
      return streamOf([4, 5]);
    },
    async () => {
      opened.push(2);
      return streamOf([6]);
    },
  ];
  const result = await collect(streamConcat(factories));
  assert.deepEqual([...result], [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(opened, [0, 1, 2]); // each source opened exactly once, in order
});

test("streamConcat: tolerates empty chunks between data", async () => {
  const factories = [async () => streamOf([1]), async () => streamOf([]), async () => streamOf([2])];
  const result = await collect(streamConcat(factories));
  assert.deepEqual([...result], [1, 2]);
});

test("streamConcat: empty list closes immediately", async () => {
  const result = await collect(streamConcat([]));
  assert.equal(result.byteLength, 0);
});
