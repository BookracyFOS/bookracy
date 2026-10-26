import { test } from "node:test";
import assert from "node:assert/strict";
import * as searchIndex from "../src/searchindex.ts";
import type { RawBook } from "../src/parse.ts";

// A minimal D1 stand-in. It records the SQL and bindings it was handed so the tests can
// assert on the shape of the query rather than on a live database.
function fakeDb(rows: Record<string, unknown>[] = [], opts: { throwOn?: RegExp } = {}) {
  const calls: { sql: string; binds: unknown[] }[] = [];
  const db = {
    calls,
    prepare(sql: string) {
      if (opts.throwOn?.test(sql)) throw new Error("D1 exploded");
      const stmt = {
        binds: [] as unknown[],
        bind(...b: unknown[]) {
          stmt.binds = b;
          calls.push({ sql, binds: b });
          return stmt;
        },
        all: async () => ({ results: rows }),
        first: async () => rows[0] ?? null,
        run: async () => ({}),
      };
      return stmt;
    },
    batch: async (stmts: unknown[]) => stmts.map(() => ({})),
  };
  return db as unknown as D1Database & { calls: typeof calls };
}

/**
 * INSERTs only. `remember()` also runs prune() on 2% of writes, so asserting on raw
 * `db.calls` makes any count flaky — observed failing roughly 1 run in 5.
 */
const inserts = (db: { calls: { sql: string; binds: unknown[] }[] }) =>
  db.calls.filter((c) => c.sql.includes("INSERT INTO search_index"));

const book = (over: Partial<RawBook> = {}): RawBook => ({
  md5: "a".repeat(32),
  title: "Dune",
  author: "Frank Herbert",
  description: "",
  book_lang: "English",
  book_filetype: "EPUB",
  book_size: "1 MB",
  book_year: "1965",
  book_content: "Unknown Content",
  book_source: "Library Genesis",
  ...over,
});

test("remember stores only real upstream md5s", async () => {
  const db = fakeDb();
  await searchIndex.remember({ DB: db }, [
    book(),
    book({ md5: "not-a-real-md5", title: "Moby Dick" }),
    book({ md5: "b".repeat(32), title: "" }), // no title = nothing worth showing
  ]);
  assert.equal(inserts(db).length, 1);
  assert.equal(inserts(db)[0].binds[0], "a".repeat(32));
});

test("remember rejects synthetic ids by source, not by shape", async () => {
  const db = fakeDb();
  // Regression: syntheticMd5() returns a real md5 hash, so these pass /^[a-f0-9]{32}$/
  // and the shape check alone let them through — production filled with 320 IA rows.
  await searchIndex.remember({ DB: db }, [
    book({ md5: "c".repeat(32), title: "Moby Dick", book_source: "Internet Archive" }),
    book({ md5: "d".repeat(32), title: "Frankenstein", book_source: "Project Gutenberg" }),
  ]);
  assert.equal(inserts(db).length, 0);

  // A real libgen row alongside them still gets stored.
  await searchIndex.remember({ DB: db }, [
    book({ md5: "e".repeat(32), book_source: "Internet Archive" }),
    book({ md5: "f".repeat(32), book_source: "Library Genesis" }),
  ]);
  assert.equal(inserts(db).length, 1);
  assert.equal(inserts(db)[0].binds[0], "f".repeat(32));
});

test("remember lowercases the md5 and drops placeholder metadata", async () => {
  const db = fakeDb();
  await searchIndex.remember({ DB: db }, [
    book({ md5: "A".repeat(32), author: "Unknown Author", book_size: "Unknown Size", book_lang: "Unknown Language" }),
  ]);
  const [md5, , author, , size, lang] = inserts(db)[0].binds;
  assert.equal(md5, "a".repeat(32));
  // Stored as empty, not as the literal word — toRawBook re-applies the placeholder on
  // read, so a round-trip is stable without persisting noise.
  assert.equal(author, "");
  assert.equal(size, "");
  assert.equal(lang, "");
});

test("remember is a no-op without a DB binding or rows", async () => {
  await searchIndex.remember({}, [book()]); // must not throw
  const db = fakeDb();
  await searchIndex.remember({ DB: db }, []);
  assert.equal(db.calls.length, 0);
});

test("remember swallows D1 failures", async () => {
  const db = fakeDb([], { throwOn: /INSERT/ });
  // Indexing is best-effort: a write failure must never fail the search that triggered it.
  await searchIndex.remember({ DB: db }, [book()]);
});

const ROW = { md5: "a".repeat(32), title: "Dune", author: "Frank Herbert", ext: "EPUB", size: "1 MB", lang: "English", year: "1965", source: "Library Genesis" };

test("findByQuery goes through the FTS index, not a scan", async () => {
  const db = fakeDb([ROW]);
  const out = await searchIndex.findByQuery({ DB: db }, "  DUNE ", 10);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Dune");
  assert.equal(out[0].book_filetype, "EPUB");

  const { sql, binds } = db.calls[0];
  assert.ok(sql.includes("search_index_fts MATCH"));
  assert.ok(sql.includes("ORDER BY f.rank")); // bm25: decides what survives the LIMIT
  assert.ok(!sql.includes("instr("));
  assert.equal(binds[0], '"dune"*'); // trailing * so "berserk" still finds "Berserker"
  assert.equal(binds[1], 10);
});

test("findByQuery neutralises FTS5 operator syntax", async () => {
  const db = fakeDb([ROW]);
  // None of these may reach FTS5 as operators — every token is quoted as a phrase, and
  // splitting on non-alphanumerics means the syntax characters never survive tokenising.
  await searchIndex.findByQuery({ DB: db }, 'dune OR "x" AND (y) NOT z^2 * -foo:bar', 10);
  const match = String(db.calls[0].binds[0]);
  assert.ok(!match.includes("^") && !match.includes("(") && !match.includes(":"));
  assert.ok(/^("[a-z0-9]+" )*"[a-z0-9]+"\*$/.test(match), `unexpected match expr: ${match}`);
});

test("findByQuery multi-word: only the last token is a prefix", async () => {
  const db = fakeDb([ROW]);
  await searchIndex.findByQuery({ DB: db }, "dune messiah", 10);
  assert.equal(db.calls[0].binds[0], '"dune" "messiah"*');
});

test("findByQuery falls back to the substring scan when FTS is unavailable", async () => {
  // Keeps working if migration 0004 hasn't been applied yet.
  const db = fakeDb([ROW], { throwOn: /MATCH/ });
  const out = await searchIndex.findByQuery({ DB: db }, "dune", 10);
  assert.equal(out.length, 1);
  const { sql, binds } = db.calls[db.calls.length - 1];
  // instr rather than LIKE: D1 intermittently rejects book-title-length LIKE patterns
  // ("pattern too complex"), which silently drops results.
  assert.ok(sql.includes("instr("));
  assert.ok(!/\bLIKE\b/i.test(sql));
  assert.equal(binds[0], "dune");
});

test("findByQuery returns nothing for an empty term or missing DB", async () => {
  const db = fakeDb([{ md5: "a".repeat(32), title: "Dune" }]);
  assert.deepEqual(await searchIndex.findByQuery({ DB: db }, "   ", 10), []);
  // Punctuation-only input tokenises to nothing and must not build an empty MATCH.
  assert.deepEqual(await searchIndex.findByQuery({ DB: db }, " *^:() ", 10), []);
  assert.deepEqual(await searchIndex.findByQuery({}, "dune", 10), []);
});

test("findByMd5 reads the primary key and restores placeholders", async () => {
  const db = fakeDb([{ md5: "a".repeat(32), title: "Dune", author: "", ext: "", size: "", lang: "", year: "", source: "" }]);
  const out = await searchIndex.findByMd5({ DB: db }, "A".repeat(32));
  assert.ok(out);
  assert.equal(out.md5, "a".repeat(32));
  assert.equal(out.author, "Unknown Author");
  assert.equal(out.book_lang, "Unknown Language");
  assert.equal(out.book_source, "Library Genesis");
  assert.equal(db.calls[0].binds[0], "a".repeat(32)); // lowercased before lookup
});

test("findByMd5 returns null when absent or on a D1 error", async () => {
  assert.equal(await searchIndex.findByMd5({ DB: fakeDb([]) }, "a".repeat(32)), null);
  assert.equal(await searchIndex.findByMd5({ DB: fakeDb([], { throwOn: /SELECT/ }) }, "a".repeat(32)), null);
  assert.equal(await searchIndex.findByMd5({}, "a".repeat(32)), null);
});

test("remember caps how many books one search can record", () => {
  const db = fakeDb();
  // Recording a whole 100-result page measured 2.59M rows written/day, ~78M/month
  // against a 50M allowance. The tail of a results page is also the least useful part
  // to remember — nobody scrolls to result 87.
  const many = Array.from({ length: 100 }, (_, i) =>
    book({ md5: i.toString(16).padStart(32, "0"), title: `Book ${i}` }),
  );
  return searchIndex.remember({ DB: db }, many).then(() => {
    assert.equal(inserts(db).length, 25);
    assert.equal(inserts(db)[0].binds[1], "Book 0"); // keeps the head, drops the tail
  });
});

test("remember skips rewriting a row seen recently", async () => {
  const db = fakeDb();
  await searchIndex.remember({ DB: db }, [book()]);
  const sql = inserts(db)[0].sql;
  // Without this guard every repeat sighting rewrote the row AND fired the FTS
  // delete+insert triggers behind it, which was the bulk of the write volume.
  assert.ok(sql.includes("ON CONFLICT(md5) DO UPDATE"));
  assert.ok(/WHERE julianday\(excluded\.seen_at\) - julianday\(search_index\.seen_at\) > [\d.]+/.test(sql));
});

// ---------------------------------------------------------------------------
// prune() — the eviction sweep.
//
// The old form (`... WHERE md5 IN (SELECT md5 ORDER BY seen_at DESC LIMIT -1 OFFSET n)`)
// measured 500,336 rows read on production to identify 336 to delete, because SQLite can
// only reach row n+1 by walking the n in front of it. It was essentially the whole of
// Bookracy's D1 read volume. The age cutoff answers the same question as an index range.

/**
 * Force prune() to run (and control whether the rare hard trim runs with it).
 *
 * Must AWAIT the callback before restoring Math.random: `remember()` awaits its batch
 * write before it ever reaches the prune coin-flip, so a synchronous try/finally puts
 * the real Math.random back first and the stub is never seen.
 */
async function withRandom<T>(sequence: number[], fn: () => Promise<T>): Promise<T> {
  const real = Math.random;
  let i = 0;
  Math.random = () => sequence[Math.min(i++, sequence.length - 1)];
  try {
    return await fn();
  } finally {
    Math.random = real;
  }
}

const deletes = (db: { calls: { sql: string; binds: unknown[] }[] }) =>
  db.calls.filter((c) => c.sql.includes("DELETE FROM search_index"));

test("prune evicts by an indexed seen_at range, not by walking an OFFSET", async () => {
  const db = fakeDb();
  // 0 -> prune runs; 0.9 -> the hard trim does not.
  await withRandom([0, 0.9], () => searchIndex.remember({ DB: db }, [book()]));
  const dels = deletes(db);
  assert.equal(dels.length, 1, "only the cheap sweep should run on the common path");
  assert.match(dels[0].sql, /WHERE seen_at < \?/);
  assert.doesNotMatch(dels[0].sql, /OFFSET/);
});

test("prune's cutoff matches the format seen_at is stored in", async () => {
  const db = fakeDb();
  await withRandom([0, 0.9], () => searchIndex.remember({ DB: db }, [book()]));
  const cutoff = String(deletes(db)[0].binds[0]);

  // This is the whole reason the cutoff is built in JS. seen_at is written as
  // `new Date().toISOString()` -> "2026-08-26T03:18:47.600Z", and SQLite's own
  // datetime('now','-6 days') renders "2026-08-26 07:21:34". They are compared as TEXT,
  // and 'T' (0x54) sorts AFTER ' ' (0x20) — so a row genuinely past the cutoff compares
  // as newer and never gets deleted. Verified against production: the predicate returned
  // false for a row four hours older than the cutoff. Same format on both sides, or the
  // sweep silently does nothing at all.
  assert.match(cutoff, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const stored = new Date().toISOString();
  assert.ok(cutoff < stored, "a just-written row must sort after the cutoff");

  const ageDays = (Date.now() - Date.parse(cutoff)) / 86400_000;
  assert.ok(ageDays > 5.9 && ageDays < 6.1, `cutoff should be ~6 days back, got ${ageDays}`);
});

test("the exact row-count trim still runs, but only as a rare backstop", async () => {
  const kept = fakeDb();
  await withRandom([0, 0.9], () => searchIndex.remember({ DB: kept }, [book()]));
  assert.equal(deletes(kept).filter((c) => c.sql.includes("OFFSET")).length, 0);

  const trimmed = fakeDb();
  await withRandom([0, 0], () => searchIndex.remember({ DB: trimmed }, [book()]));
  const hard = deletes(trimmed).filter((c) => c.sql.includes("OFFSET"));
  assert.equal(hard.length, 1, "the cap must still be enforceable");
  assert.equal(hard[0].binds[0], 500_000);
});

test("prune never runs on the vast majority of writes", async () => {
  const db = fakeDb();
  await withRandom([0.9], () => searchIndex.remember({ DB: db }, [book()]));
  assert.equal(deletes(db).length, 0);
});
