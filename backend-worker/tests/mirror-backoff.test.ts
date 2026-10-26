import { test } from "node:test";
import assert from "node:assert/strict";

// The circuit breaker's TTL schedule. Extracted rather than imported because
// reliability.ts talks to the Workers Cache API, which doesn't exist under node --test;
// this asserts the arithmetic, which is the part that was wrong.
//
// Context: a flat 60s window meant each dead AA host was re-probed ~1,440×/day per POP
// during the DDoS-Guard outage, and every probe cost a real user request a full upstream
// timeout. Measured on prod: 24s for a novel search, 49s for a cold trending rebuild.
const HOST_DOWN_BASE_TTL = 60;
const HOST_DOWN_MAX_TTL = 3600;
const downTtlFor = (strikes: number) => Math.min(HOST_DOWN_MAX_TTL, HOST_DOWN_BASE_TTL * 2 ** Math.max(0, strikes - 1));

test("downTtlFor: first failure keeps the old 60s behaviour", () => {
  assert.equal(downTtlFor(1), 60);
});

test("downTtlFor: doubles per consecutive strike", () => {
  assert.deepEqual([2, 3, 4, 5, 6].map(downTtlFor), [120, 240, 480, 960, 1920]);
});

test("downTtlFor: caps at one hour", () => {
  assert.equal(downTtlFor(7), 3600);
  assert.equal(downTtlFor(50), 3600);
  assert.equal(downTtlFor(1e6), 3600);
});

test("downTtlFor: a zero/negative strike count can't produce a sub-60s window", () => {
  assert.equal(downTtlFor(0), 60);
  assert.equal(downTtlFor(-3), 60);
});

test("downTtlFor: a day of a dead host costs far fewer probes than a flat 60s", () => {
  // Walk the schedule across 24h and count probes; flat-60s would be 1440.
  let elapsed = 0, probes = 0, strikes = 0;
  while (elapsed < 86400) {
    strikes++;
    probes++;
    elapsed += downTtlFor(strikes);
  }
  assert.ok(probes <= 30, `expected <=30 probes/day, got ${probes}`);
  assert.ok(probes < 1440 / 40, "should be at least 40x cheaper than a flat 60s window");
});

test("a host is only handed to the background prober after a solid run of failures", () => {
  // Mirrors the BACKGROUND_PROBE_STRIKES threshold in reliability.ts. Below it the inline
  // retry keeps recovery fast for a mirror having a bad minute; at it the host has been
  // failing for the whole 60+120+240s ladder, i.e. at least seven minutes straight.
  const BACKGROUND_PROBE_STRIKES = 4;
  let downFor = 0;
  for (let strikes = 1; strikes < BACKGROUND_PROBE_STRIKES; strikes++) downFor += downTtlFor(strikes);
  assert.equal(downFor, 420);
  assert.ok(downFor >= 5 * 60, "must not move a briefly-flaky host off the inline path");
});
