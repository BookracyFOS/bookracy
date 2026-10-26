import { test } from "node:test";
import assert from "node:assert/strict";
import { AA_UNFETCHABLE_HOSTS, fetchableAaMirrors, extractAaHostsFromHtml } from "../src/reliability.ts";

// `annas-archive.mx` redirects to `annas-archive.is`; both are Worker-routed Cloudflare
// hosts, and a Worker that fetches one is terminated by the platform with error 1042
// (probe-verified 2026-09-15). These tests pin the deny-list at every entry point.

test("the seed hosts that still answer are kept, the 1042 hosts are dropped", () => {
  const pool = ["https://annas-archive.gl", "https://annas-archive.mx", "https://annas-archive.pk", "https://annas-archive.is", "https://annas-archive.gd"];
  assert.deepEqual(fetchableAaMirrors(pool), ["https://annas-archive.gl", "https://annas-archive.pk", "https://annas-archive.gd"]);
});

test("a pool of nothing but unfetchable hosts filters to empty rather than throwing", () => {
  assert.deepEqual(fetchableAaMirrors(["https://annas-archive.mx", "https://annas-archive.is"]), []);
});

test("junk entries don't crash the filter", () => {
  assert.deepEqual(fetchableAaMirrors(["not a url", "https://annas-archive.gl"]), ["not a url", "https://annas-archive.gl"]);
});

test("the /mirrors scrape never re-introduces an unfetchable host", () => {
  const html = `<a href="https://annas-archive.is/">.is</a> <a href="https://annas-archive.mx/">.mx</a> <a href="https://annas-archive.gl/">.gl</a>`;
  assert.deepEqual(extractAaHostsFromHtml(html), ["https://annas-archive.gl"]);
});

test("the deny-list names exactly the hosts the probe proved unfetchable", () => {
  assert.deepEqual([...AA_UNFETCHABLE_HOSTS].sort(), ["annas-archive.is", "annas-archive.mx"]);
});
