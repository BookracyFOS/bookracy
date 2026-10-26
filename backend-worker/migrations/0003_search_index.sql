-- A local title→md5 index, built passively from libgen search results we already fetch.
--
-- Motivation (2026-08-24): AA has been unreachable since 08-13 and libgen's search
-- daemon went down the same week, which left /api/books with no source at all and
-- returned "No results found" site-wide. Every upstream in the chain is someone else's
-- server; this table is the one index we own. It doesn't replace libgen — it remembers
-- what libgen already told us, so an outage degrades to "the books you've searched
-- before still work" instead of a blank page.
--
-- It also cuts upstream load on the hot path: a bookmarked md5 is, by definition, one
-- the user found through a search, so shelf lookups hit this table instead of paying a
-- real libgen fetch each (the amplification MD5_LIMITER exists to bound).
--
-- Rows are denormalised copies of RawBook — deliberately the same shape the parsers
-- emit, so a cache hit and a live hit are indistinguishable downstream.
CREATE TABLE IF NOT EXISTS search_index (
  md5     TEXT PRIMARY KEY,
  title   TEXT NOT NULL,
  author  TEXT NOT NULL DEFAULT '',
  ext     TEXT NOT NULL DEFAULT '',
  size    TEXT NOT NULL DEFAULT '',
  lang    TEXT NOT NULL DEFAULT '',
  year    TEXT NOT NULL DEFAULT '',
  source  TEXT NOT NULL DEFAULT 'Library Genesis',
  seen_at TEXT NOT NULL
);

-- Drives both the recency ordering of query hits and the pruning sweep that bounds the
-- table. Lookups by md5 ride the primary key; title/author matching is a scan by design
-- (`instr`, not LIKE — see the note in community.ts about D1 rejecting long LIKE
-- patterns), which is why the row count is capped rather than left to grow forever.
CREATE INDEX IF NOT EXISTS idx_search_index_seen ON search_index (seen_at DESC);
