import { test } from "node:test";
import assert from "node:assert/strict";
import { inCompletionOrder } from "../src/concurrency.ts";

const after = <T>(ms: number, value: T) => new Promise<T>((r) => setTimeout(() => r(value), ms));

test("inCompletionOrder: yields fastest-first regardless of input order", async () => {
  const out: string[] = [];
  for await (const v of inCompletionOrder([after(60, "slow"), after(10, "fast"), after(35, "mid")])) out.push(v);
  assert.deepEqual(out, ["fast", "mid", "slow"]);
});

test("inCompletionOrder: yields every result exactly once", async () => {
  const out: number[] = [];
  for await (const v of inCompletionOrder([after(20, 1), after(5, 2), after(15, 3), after(1, 4)])) out.push(v);
  assert.deepEqual(new Set(out), new Set([1, 2, 3, 4]));
  assert.equal(out.length, 4);
});

test("inCompletionOrder: can stop early without awaiting the slow ones", async () => {
  let firstSettledMs = 0;
  const start = Date.now();
  for await (const v of inCompletionOrder([after(1000, "never-needed"), after(5, "winner")])) {
    if (v === "winner") {
      firstSettledMs = Date.now() - start;
      break; // a real caller breaks as soon as it has a usable result
    }
  }
  assert.ok(firstSettledMs < 500, `broke early (${firstSettledMs}ms), not after the 1000ms straggler`);
});

test("inCompletionOrder: empty input yields nothing", async () => {
  const out: unknown[] = [];
  for await (const v of inCompletionOrder<number>([])) out.push(v);
  assert.equal(out.length, 0);
});
