/**
 * The local title→md5 index (D1 table `search_index`).
 *
 * Everything upstream of us is someone else's server. On 2026-08-24 both of ours were
 * down at once — Anna's Archive behind DDoS-Guard since 08-13, libgen's search daemon
 * answering "Could not connect to the database 9306" — and /api/books had nothing left
 * to ask, so it returned "No results found" for every query, site-wide.
 *
 * This module is the one index we own. It is written passively from results we already
 * fetched (no extra upstream requests, ever) and read only when the live sources come
 * up empty. It is explicitly NOT a catalogue: it can only ever know books someone has
 * already searched for. That's the point — the long tail stays broken during an outage,
 * but the books people actually use keep working.
 *
 * Every function here fails soft. The index is an optimisation and a safety net; a D1
 * error must never be the reason a search fails, so callers get [] / null instead of a
 * throw and carry on to the next source.
 */
import type { RawBook } from "./parse";

export interface SearchIndexEnv {
  DB?: D1Database;
}

/** Hard ceiling on stored rows. Since 0004 the FTS5 index answers queries, so this no
 *  longer sets per-query cost — it bounds storage and keeps the table from growing
 *  without limit as the site runs. At ~200 bytes/row plus its index terms this is well
 *  inside D1's 10 GB.
 *
 *  Raised from 100k after that value turned out to be far below the fill rate: the table
 *  hit the cap in about FOUR HOURS of normal traffic, so it spent the day evicting rows
 *  it had just written and remembered nothing older than one afternoon — an expensive
 *  LRU with no memory. At ~550 bytes/row including FTS terms this is ~275 MB. */
const MAX_ROWS = 500_000;

/** Fraction of writes that also run the pruning sweep. Pruning every write would double
 *  the cost of the common path to enforce a bound that moves by a few rows at a time. */
const PRUNE_PROBABILITY = 0.02;

/**
 * Age cutoff for the cheap eviction pass — the number that actually bounds the table.
 *
 * At the fill rate measured on 2026-09-01 the 500k cap held **6.2 days** of sightings,
 * so evicting at 6 days lands just under the row cap and does essentially all of the
 * work, while costing what the rows themselves cost to delete and nothing more. If
 * traffic grows the window still holds 6 days and the hard trim below is what puts the
 * ceiling back.
 */
const MAX_AGE_DAYS = 6;

/**
 * Fraction of *prunes* (not writes) that also run the exact row-count trim. 0.02 of 0.02
 * is one write in 2,500, which is often enough to keep MAX_ROWS a real ceiling and rare
 * enough that its cost stops mattering.
 */
const HARD_TRIM_PROBABILITY = 0.02;

/**
 * How many books to record per search.
 *
 * Recording all of them meant up to 100 rows on every uncached search, which measured
 * **2.59M rows written/day** — roughly 78M/month against the plan's 50M allowance, so the
 * index was on track to cost more per month than the rest of Bookracy combined. The tail
 * of a results page is also the least valuable part to remember: nobody scrolls to result
 * 87, and rankBooks re-orders whatever comes back anyway.
 */
const REMEMBER_LIMIT = 25;

/**
 * Don't rewrite a row that was already seen this recently (in days — SQLite julianday).
 *
 * The same popular books appear in result after result, and without this every sighting
 * rewrote the row AND fired the FTS delete+insert triggers behind it. Skipping the update
 * costs nothing (the conflicting INSERT is simply a no-op) and removes the bulk of the
 * write volume, since repeat sightings dominate. `seen_at` only drives eviction order, so
 * letting it lag a few hours changes nothing that matters.
 */
const RESEEN_AFTER_DAYS = 0.25; // 6 hours

interface IndexRow {
  md5: string;
  title: string;
  author: string;
  ext: string;
  size: string;
  lang: string;
  year: string;
  source: string;
}

const COLS = "md5, title, author, ext, size, lang, year, source";

/**
 * Sources whose results are keyed by a *synthetic* md5 (see syntheticMd5 in index.ts)
 * rather than a real upstream file id.
 *
 * These are excluded deliberately, and the hex-shape check alone does NOT catch them —
 * a synthetic id is a genuine md5 hash, so it matches /^[a-f0-9]{32}$/ perfectly. Caught
 * in production: three searches during the libgen outage filled the table with 320
 * Internet Archive rows.
 *
 * Indexing them is pointless at best and harmful at worst. Pointless because they
 * resolve by title+author, so the index adds nothing a live Gutenberg/IA call wouldn't
 * return anyway. Harmful because the whole purpose of this table is to preserve results
 * we CAN'T get any other way — and during a long libgen outage, the very time the index
 * matters most, public-domain hits would otherwise evict every real libgen row it holds.
 */
const SYNTHETIC_ID_SOURCES = new Set(["Project Gutenberg", "Internet Archive"]);

function toRawBook(r: IndexRow): RawBook {
  return {
    md5: r.md5,
    title: r.title,
    author: r.author || "Unknown Author",
    description: "",
    book_lang: r.lang || "Unknown Language",
    book_filetype: r.ext || "Unknown Filetype",
    book_size: r.size || "Unknown Size",
    book_year: r.year || "",
    book_content: "Unknown Content",
    book_source: r.source || "Library Genesis",
  };
}

/**
 * Record books we just fetched from a live source.
 *
 * A repeat sighting refreshes both the metadata (upstream corrects titles) and
 * `seen_at`, which is what keeps actively-used books ahead of stale ones when the table
 * is pruned.
 *
 * This is an UPSERT, not `INSERT OR REPLACE`, and the difference is load-bearing:
 * SQLite's REPLACE does **not** fire delete triggers unless `recursive_triggers` is on,
 * so re-seeing a book left the old title's terms behind in the FTS index forever.
 * Verified against production before switching: after replacing "Zzytrigger Testbook"
 * with "Zzytrigger Renamed", a MATCH on "testbook" still returned a hit. `ON CONFLICT DO
 * UPDATE` fires the AFTER UPDATE trigger, which tombstones the old terms and indexes the
 * new ones.
 *
 * The `WHERE` on the conflict clause is what keeps this affordable — see
 * RESEEN_AFTER_DAYS. When it evaluates false the statement is a no-op, so no row is
 * rewritten and, crucially, the FTS delete+insert triggers behind it never fire.
 *
 * Call under `ctx.waitUntil` — this must never add latency to the search that produced
 * the rows.
 */
export async function remember(env: SearchIndexEnv, books: RawBook[]): Promise<void> {
  if (!env.DB || !books.length) return;
  const now = new Date().toISOString();
  try {
    const stmt = env.DB.prepare(
      `INSERT INTO search_index (${COLS}, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(md5) DO UPDATE SET
         title = excluded.title, author = excluded.author, ext = excluded.ext,
         size = excluded.size, lang = excluded.lang, year = excluded.year,
         source = excluded.source, seen_at = excluded.seen_at
       WHERE julianday(excluded.seen_at) - julianday(search_index.seen_at) > ${RESEEN_AFTER_DAYS}`,
    );
    // One batch, one round-trip. Only books with a real upstream md5 are worth storing —
    // the shape check rejects malformed ids, and the source check rejects the
    // well-formed-but-synthetic ones (see SYNTHETIC_ID_SOURCES).
    const rows = books
      .filter((b) => /^[a-f0-9]{32}$/i.test(b.md5) && b.title && !SYNTHETIC_ID_SOURCES.has(b.book_source))
      .slice(0, REMEMBER_LIMIT)
      .map((b) =>
        stmt.bind(
          b.md5.toLowerCase(),
          b.title,
          b.author === "Unknown Author" ? "" : b.author,
          b.book_filetype === "Unknown Filetype" ? "" : b.book_filetype,
          b.book_size === "Unknown Size" ? "" : b.book_size,
          b.book_lang === "Unknown Language" ? "" : b.book_lang,
          b.book_year || "",
          b.book_source || "Library Genesis",
          now,
        ),
      );
    if (!rows.length) return;
    await env.DB.batch(rows);
    if (Math.random() < PRUNE_PROBABILITY) await prune(env);
  } catch {
    // Indexing is best-effort by design — never surface a write failure to the caller.
  }
}

/**
 * Evict the tail of the index.
 *
 * This used to be the row-count trim alone — `DELETE ... WHERE md5 IN (SELECT md5 ORDER
 * BY seen_at DESC LIMIT -1 OFFSET 500000)`. `LIMIT -1 OFFSET n` is the right *shape* for
 * "skip the newest n, take the rest", but SQLite can only reach row 500,001 by walking
 * the 500,000 in front of it. Measured against production on 2026-09-01: **500,336 rows
 * read to identify 336 to delete**, 43ms a call, `SCAN search_index USING INDEX
 * idx_search_index_seen`. That one statement was essentially the whole of Bookracy's D1
 * read volume, and it grew with the table: rows read/day went 32.5M -> 183.9M over the
 * week the index filled to its cap.
 *
 * An age cutoff answers the same question through the same index as a *range* — `SEARCH
 * search_index USING COVERING INDEX idx_search_index_seen (seen_at<?)` — so it reads the
 * rows it deletes and not one more. Measured on the same table: **1 row read, 0.22ms**
 * when nothing is due, and rows_read == rows_matched exactly when something is.
 *
 * The cutoff is built in JS rather than with `datetime('now', '-6 days')`, and that is
 * load-bearing: `seen_at` is stored as `2026-08-26T03:18:47.600Z` while SQLite's
 * datetime() renders `2026-08-26 07:21:34`, and these are compared as TEXT. `'T'` (0x54)
 * sorts after `' '` (0x20), so a row genuinely older than the cutoff compares as newer
 * and is never deleted — verified on production, the predicate returned false for a row
 * four hours past it. Same format on both sides or the sweep silently does nothing.
 */
async function prune(env: SearchIndexEnv): Promise<void> {
  if (!env.DB) return;
  try {
    const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 86400_000).toISOString();
    await env.DB.prepare(`DELETE FROM search_index WHERE seen_at < ?`).bind(cutoff).run();

    // Backstop, so MAX_ROWS stays a hard ceiling rather than an estimate: if traffic
    // outruns the age window the table can still exceed the cap, and only the exact
    // trim can bring it back. Kept rare precisely because it is the expensive one.
    if (Math.random() < HARD_TRIM_PROBABILITY) {
      await env.DB.prepare(
        `DELETE FROM search_index WHERE md5 IN (
           SELECT md5 FROM search_index ORDER BY seen_at DESC LIMIT -1 OFFSET ?
         )`,
      )
        .bind(MAX_ROWS)
        .run();
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Build an FTS5 MATCH expression from raw user input.
 *
 * Splitting on everything that isn't a letter or digit is the whole escaping strategy:
 * FTS5's syntax characters (`"`, `*`, `^`, `:`, `-`, parentheses, and the bare keywords
 * AND/OR/NOT) are all punctuation or become ordinary quoted tokens, so nothing a caller
 * types can be parsed as an operator. Each token is then quoted as a phrase.
 *
 * The last token gets a `*` so the index behaves like the substring match it replaces:
 * "berserk" should still find "Berserker", which token-exact matching would miss.
 */
function ftsMatch(query: string): string {
  const tokens = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!tokens.length) return "";
  return tokens.map((t, i) => (i === tokens.length - 1 ? `"${t}"*` : `"${t}"`)).join(" ");
}

/**
 * Free-text lookup over remembered books.
 *
 * Served by the FTS5 index (migration 0004) rather than a scan. The previous
 * `instr(lower(title), ?)` form could not use an index, so every call read the whole
 * table — and this only runs when AA and libgen have both failed, meaning on every
 * search during exactly the outage the table exists for. At the 100k cap that was
 * ~3 billion rows read/day.
 *
 * Ordering is by bm25 `rank` (best match first), which matters because it decides what
 * survives the LIMIT. handleSearch still runs rankBooks over the result — that one
 * understands the query in ways bm25 doesn't (issue numbers, exact-title preference).
 *
 * Falls back to the old scan if the FTS query fails for any reason, so the module keeps
 * working if the migration hasn't been applied yet.
 */
export async function findByQuery(env: SearchIndexEnv, query: string, limit: number): Promise<RawBook[]> {
  if (!env.DB) return [];
  const match = ftsMatch(query);
  if (!match) return [];
  try {
    const rows = await env.DB.prepare(
      `SELECT ${COLS.split(", ").map((c) => `s.${c}`).join(", ")}
       FROM search_index_fts f JOIN search_index s ON s.rowid = f.rowid
       WHERE search_index_fts MATCH ? ORDER BY f.rank LIMIT ?`,
    )
      .bind(match, limit)
      .all<IndexRow>();
    return (rows.results || []).map(toRawBook);
  } catch {
    return await findByQueryScan(env, query, limit);
  }
}

/**
 * Pre-FTS substring fallback.
 *
 * `instr(lower(col), ?)` rather than `LIKE '%term%'` for the reason documented in
 * community.ts: D1 intermittently rejects ordinary book-title-length LIKE patterns with
 * "LIKE or GLOB pattern too complex", which silently drops results. instr is a plain
 * substring scan with no pattern engine, so that failure is structurally impossible —
 * and it leaves no wildcards for a caller to inject.
 */
async function findByQueryScan(env: SearchIndexEnv, query: string, limit: number): Promise<RawBook[]> {
  if (!env.DB) return [];
  const term = query.trim().toLowerCase();
  if (!term) return [];
  try {
    const rows = await env.DB.prepare(
      `SELECT ${COLS} FROM search_index
       WHERE instr(lower(title), ?) > 0 OR instr(lower(author), ?) > 0
       ORDER BY seen_at DESC LIMIT ?`,
    )
      .bind(term, term, limit)
      .all<IndexRow>();
    return (rows.results || []).map(toRawBook);
  } catch {
    return [];
  }
}

/** Resolve one md5 straight off the primary key — the bookshelf's hot path. */
/** Drop a row for good (takedowns). The FTS delete trigger keeps search_index_fts in step. */
export async function forget(env: SearchIndexEnv, md5: string): Promise<void> {
  if (!env.DB) return;
  try {
    await env.DB.prepare("DELETE FROM search_index WHERE md5 = ?").bind(md5.toLowerCase()).run();
  } catch (e) {
    console.error("search_index forget failed", md5, e);
  }
}

export async function findByMd5(env: SearchIndexEnv, md5: string): Promise<RawBook | null> {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare(`SELECT ${COLS} FROM search_index WHERE md5 = ?`)
      .bind(md5.toLowerCase())
      .first<IndexRow>();
    return row ? toRawBook(row) : null;
  } catch {
    return null;
  }
}
