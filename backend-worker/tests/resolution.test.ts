import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldRetryResolution } from "../src/resolution.ts";

test("every mirror failing transiently earns a second pass", () => {
  // The 2026-09-15 edge shape: ads.php 500/503 on some, get.php 500 or a timeout on the rest.
  assert.equal(shouldRetryResolution(["transient", "transient", "transient", "transient", "transient"]), true);
});

test("any mirror saying the md5 doesn't exist ends it — the mirrors share one database", () => {
  assert.equal(shouldRetryResolution(["transient", "miss", "transient", "transient", "transient"]), false);
  assert.equal(shouldRetryResolution(["miss", "miss", "miss", "miss", "miss"]), false);
});

test("a served file never retries", () => {
  assert.equal(shouldRetryResolution(["transient", "file"]), false);
});

test("no outcomes at all is not a reason to retry", () => {
  assert.equal(shouldRetryResolution([]), false);
});
