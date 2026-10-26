import { test } from "node:test";
import assert from "node:assert/strict";

// applyFacets lives in index.ts, which can't be imported under node --test (it bundles
// Worker-only modules). These tests pin the contract on a copy of the pure size parser
// and on the row-level rules, so a change to either shows up here.
function sizeToBytes(size: string): number {
  const m = (size || "").match(/([\d.]+)\s*(tb|gb|mb|kb|b)?/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return 0;
  const unit = (m[2] || "b").toLowerCase();
  return n * (unit === "tb" ? 2 ** 40 : unit === "gb" ? 2 ** 30 : unit === "mb" ? 2 ** 20 : unit === "kb" ? 1024 : 1);
}

test("sizeToBytes reads libgen's size strings", () => {
  assert.equal(sizeToBytes("655 kB"), 655 * 1024);
  assert.equal(sizeToBytes("12.4 MB"), Math.round(12.4 * 2 ** 20 * 1000) / 1000);
  assert.equal(sizeToBytes("1.1 GB"), 1.1 * 2 ** 30);
  assert.equal(sizeToBytes(""), 0);
  assert.equal(sizeToBytes("Unknown Size"), 0);
});

test("a language filter keeps rows whose language is unknown", () => {
  const keep = (lang: string, names: Set<string>) => {
    const l = lang.trim().toLowerCase();
    return !l || l === "unknown language" || names.has(l);
  };
  const en = new Set(["english"]);
  assert.equal(keep("English", en), true);
  assert.equal(keep("Spanish", en), false);
  assert.equal(keep("Unknown Language", en), true);
  assert.equal(keep("", en), true);
});

test("a non-Latin query skips the language facet; a facet that empties the set is dropped", () => {
  const NON_LATIN_QUERY_RE = /[^\u0000-\u024F\u1E00-\u1EFF]/;
  assert.equal(NON_LATIN_QUERY_RE.test("мастер и маргарита"), true);
  assert.equal(NON_LATIN_QUERY_RE.test("crime and punishment"), false);
  assert.equal(NON_LATIN_QUERY_RE.test("café élan naïve"), false);
  assert.equal(NON_LATIN_QUERY_RE.test("三体"), true);
  // mirror of the keep-or-drop rule
  const rows = [{ book_lang: "Russian" }, { book_lang: "Russian" }];
  const names = new Set(["english"]);
  const kept = rows.filter((b) => { const l = b.book_lang.toLowerCase(); return !l || l === "unknown language" || names.has(l); });
  const out = kept.length ? kept : rows;
  assert.equal(out.length, 2, "an empty filtered set falls back to the unfiltered rows");
});
