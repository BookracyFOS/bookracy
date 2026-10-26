import { parse, HTMLElement } from "node-html-parser";

const MD5_RE = /\/md5\/([a-f0-9]{32})/i;
const LANG_RE = /\[[a-z]{2,3}(?:-[a-z]+)?\]/i;
const SIZE_RE = /\d+(?:\.\d+)?\s*[KMGT]B/i;
const SIZE_EXACT_RE = /^[\d.,]+\s*(kb|mb|gb|tb|bytes?)$/i;
const YEAR_RE = /^\d{4}$/;
const KNOWN_FILETYPES = new Set([
  "pdf", "epub", "mobi", "azw3", "azw", "djvu", "cbz", "cbr", "fb2",
  "txt", "rtf", "doc", "docx", "lit", "zip", "html", "chm", "lrf",
]);

export interface RawBook {
  md5: string;
  title: string;
  author: string;
  description: string;
  book_lang: string;
  book_filetype: string;
  book_size: string;
  book_year: string;
  book_content: string;
  book_source: string;
}

interface Metadata {
  book_lang: string;
  book_filetype: string;
  book_size: string;
  book_year: string;
  book_content: string;
  book_source: string;
}

/** Parse the ' · '-separated metadata line, classifying segments by pattern. */
export function parseMetadataLine(text: string): Metadata {
  const info: Metadata = {
    book_lang: "Unknown Language",
    book_filetype: "Unknown Filetype",
    book_size: "Unknown Size",
    book_year: "",
    book_content: "Unknown Content",
    book_source: "Unknown Source",
  };
  if (!text) return info;

  for (const raw of text.split("\u00b7")) {
    const seg = raw.replace(/^[\s\u00b7\u2022|]+|[\s\u00b7\u2022|]+$/g, "");
    const clean = seg.replace(/^[^\w[/]+/u, "").trim();
    if (!clean) continue;
    const low = clean.toLowerCase();
    const ext = clean.replace(/^\.+|\.+$/g, "").toLowerCase();

    if (LANG_RE.test(clean) && clean.length < 40) info.book_lang = clean;
    else if (SIZE_EXACT_RE.test(clean)) info.book_size = clean;
    else if (YEAR_RE.test(clean)) info.book_year = clean;
    else if (KNOWN_FILETYPES.has(ext)) info.book_filetype = ext.toUpperCase();
    else if (["book", "comic", "magazine", "journal", "article", "standard", "fiction", "audiobook"].some((k) => low.includes(k)))
      info.book_content = clean;
    else if (clean.includes("/")) info.book_source = clean;
  }
  return info;
}

function findCard(anchor: HTMLElement): HTMLElement {
  let node: HTMLElement | null = anchor.parentNode as HTMLElement | null;
  for (let i = 0; i < 5 && node; i++) {
    const cls = node.getAttribute?.("class") || "";
    if (cls.includes("border-b") && cls.includes("flex")) return node;
    node = node.parentNode as HTMLElement | null;
  }
  return anchor;
}

/** Extract book results from an Anna's Archive /search results page. */
export function parseSearchHtml(html: string): RawBook[] {
  const root = parse(html);
  const out: RawBook[] = [];
  const seen = new Set<string>();

  for (const anchor of root.querySelectorAll("a")) {
    const href = anchor.getAttribute("href") || "";
    const match = href.match(MD5_RE);
    if (!match) continue;

    const title = anchor.text.trim();
    if (!title) continue; // text-bearing /md5/ link == title link (cover link has none)

    const md5 = match[1].toLowerCase();
    if (seen.has(md5)) continue;
    seen.add(md5);

    const card = findCard(anchor);
    const divs = card.querySelectorAll("div");

    // Author lives in the fallback cover's data-content (title, author).
    const dataContents = divs
      .map((d) => d.getAttribute("data-content"))
      .filter((v): v is string => Boolean(v));
    const author = dataContents.length >= 2 ? dataContents[1] : "Unknown Author";

    // Metadata line: the shortest div whose text has ' · ' plus a language/size.
    let meta = "";
    let best = Infinity;
    let description = "";
    for (const div of divs) {
      const t = div.text.trim();
      if (t.includes("\u00b7") && (LANG_RE.test(t) || SIZE_RE.test(t)) && t.length < best) {
        best = t.length;
        meta = t;
      }
      if (!description && (div.getAttribute("class") || "").includes("text-gray-600")) {
        description = t;
      }
    }

    out.push({ md5, title, author, description, ...parseMetadataLine(meta) });
  }

  return out;
}

/**
 * Resolve a single book from a libgen `file.php?md5=…` page.
 *
 * This exists because a bare-md5 query — the thing that powers bookmarks,
 * continue-reading and share links — used to resolve through Anna's Archive, and AA's
 * `/md5/` is now behind a bot wall we can't pass. libgen's *search* index is no help
 * either: `index.php?req=<md5>&column=md5` answers 200 with the bare search form (the
 * md5 you see in it is only echoed into nav links), which is indistinguishable from
 * "no such book" unless you look closely. `file.php?md5=` is the one endpoint that
 * resolves an md5 directly, and it's the same data source the download path already
 * relies on — so if a book is downloadable, it is resolvable.
 *
 * Nearly everything we need is in the `<title>`, which follows a stable grammar:
 *
 *   LG+: [series] Title{Author}(year, Publisher){libgenId} libgen.li.ext
 *
 * Observed variants (all handled): no series; a trailing comma inside the author
 * braces; `(year)` with no publisher; no parenthetical at all; and — the reason the
 * series match is greedy — brackets *nested inside* the series clause, e.g.
 * `[Dune Universe _ Вселенная Дюны _ Дюна [АСТ] … Dune Universe] The Dune Encyclopedia`.
 *
 * Parsing runs right-to-left because every field on the right is delimited, while the
 * title is just "whatever is left" — which is exactly the field we least want to
 * damage. Returns null rather than a half-parsed book if the shape doesn't hold.
 */
export function parseLibgenFilePage(html: string, md5: string): RawBook | null {
  const rawTitle = html.match(/<title>([^<]*)<\/title>/i)?.[1];
  if (!rawTitle) return null;

  let s = rawTitle.trim();
  if (!s.startsWith("LG+:")) return null; // not a file page (error/interstitial/404)
  s = s.slice(4).trim();

  // ` libgen.<tld>.<ext>` tail → the file extension.
  //
  // An md5 libgen has never heard of still answers 200, with the template rendered
  // empty: `LG+: {} libgen.li.` — note the trailing dot with no extension after it.
  // That's the tell, and it's the only reliable one, so a missing extension is treated
  // as "no such record". Without this the empty template parsed into a real-looking
  // book titled "{} libgen.li." and a stale bookmark rendered as garbage on the shelf
  // instead of being dropped.
  let ext = "";
  s = s.replace(/\s+libgen\.[a-z]{2,6}\.([a-z0-9]{1,6})$/i, (_m, e) => {
    ext = String(e).toLowerCase();
    return "";
  });
  if (!ext) return null;

  // `{numeric libgen id}` tail — always last once the filename tail is gone.
  s = s.replace(/\s*\{\d+\}$/, "");

  // Optional `(year)` / `(year, Publisher)` tail.
  let year = "";
  s = s.replace(/\s*\(([^()]*)\)$/, (_m, inner) => {
    year = String(inner).match(/\b(1[5-9]\d{2}|20\d{2})\b/)?.[1] ?? "";
    return "";
  });

  // `{Author}` tail. Trailing separators inside the braces are common ("King,").
  let author = "";
  s = s.replace(/\s*\{([^{}]*)\}$/, (_m, a) => {
    author = String(a).replace(/[,;_\s]+$/, "").replace(/_/g, ", ").trim();
    return "";
  });

  // Leading `[series] `. Greedy to the last `]` so a nested bracket inside the series
  // clause doesn't leave half of it glued to the front of the title.
  s = s.replace(/^\[.*\]\s*/, "");

  // Leftover braces mean the template didn't match the grammar we think it did, so we
  // don't actually know which parts we stripped. Better no book than a wrong one.
  const title = s.trim();
  if (!title || /[{}]/.test(title)) return null;

  // Size isn't in the title, but the page states it plainly ("31 MB").
  const size = html.match(/\b(\d+(?:\.\d+)?\s?(?:KB|MB|GB))\b/i)?.[1] ?? "";

  return {
    md5: md5.toLowerCase(),
    title,
    author: author || "Unknown Author",
    description: "",
    book_lang: "Unknown Language", // not exposed on this page
    book_filetype: ext ? ext.toUpperCase() : "Unknown Filetype",
    book_size: size || "Unknown Size",
    book_year: year,
    book_content: "Unknown Content",
    book_source: "Library Genesis",
  };
}

/**
 * Find the image URL on a book's detail page (for covers).
 *
 * `md5` is the book we *asked* for, and passing it is what makes this safe. An AA
 * mirror under duress does not reliably 404: it may redirect `/md5/<x>` to a generic
 * page (homepage, interstitial, "recently downloaded" carousel) that still answers
 * 200 and still has images on it. The old unanchored "first <img> on the page" rule
 * then happily returned that page's first thumbnail — the *same* image for every md5
 * asked for — and handleCover wrote it to R2 under each book's key. That poisoned
 * covers for unrelated books durably (R2 has a 90-day lifecycle, so it does not
 * self-heal), which is exactly what happened during the 2026-08-13 DDoS-Guard outage.
 *
 * A real `/md5/<md5>` page always carries its own md5 in the markup (the download
 * links are built from it); no generic AA page carries a *specific* md5 we asked for.
 * So: if we can't see the md5, we are not on the right page and we have no cover —
 * never a guess. Callers treat null as "no cover", which is the safe outcome.
 */
export function parseCoverUrl(html: string, md5?: string): string | null {
  // Wrong-page guard. Cheap substring test on the raw HTML, before any parsing.
  if (md5 && !html.toLowerCase().includes(md5.toLowerCase())) return null;

  const root = parse(html);
  const og = root.querySelector('meta[property="og:image"]')?.getAttribute("content");
  if (og && og.startsWith("http")) return og;
  for (const img of root.querySelectorAll("img")) {
    const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
    if (src.startsWith("http") && !src.includes("favicon") && !src.includes("logo")) return src;
  }
  return null;
}

export interface GreatestBook {
  rank: number;
  title: string;
  author: string;
  cover: string;
  /** thegreatestbooks.org book id (stable across pages; used for de-duping). */
  sourceId: string;
}

/**
 * Parse a thegreatestbooks.org ranked-list page (the homepage and /page/N share the
 * same markup). Each book is a `<li class="book-list-item" data-book="ID">` whose
 * `<h4>` holds "RANK. <a /books/>Title</a> by <a /authors/>Author</a>", plus a cover
 * `<img>`. We classify the two links by href prefix rather than relying on attribute
 * selectors, so this stays robust to minor markup shuffles.
 */
export function parseGreatestBooks(html: string): GreatestBook[] {
  const root = parse(html);
  const out: GreatestBook[] = [];

  for (const li of root.querySelectorAll("li.book-list-item")) {
    const h4 = li.querySelector("h4");
    if (!h4) continue;

    const links = h4.querySelectorAll("a");
    const titleLink = links.find((a) => (a.getAttribute("href") || "").startsWith("/books/"));
    const authorLink = links.find((a) => (a.getAttribute("href") || "").startsWith("/authors/"));
    const cover = li.querySelector("img")?.getAttribute("src") || "";
    const sourceId = li.getAttribute("data-book") || "";

    const title = titleLink?.text.trim() || "";
    if (!title || !sourceId) continue;

    // Author: prefer the /authors/ link; otherwise parse "… by AUTHOR" from the heading
    // (user-curated lists drop the link and sometimes the rank number entirely).
    let author = authorLink?.text.trim() || "";
    if (!author) {
      author = h4.text
        .replace(/^\s*\d+\.\s*/, "")
        .replace(title, "")
        .replace(/^\s*by\s+/i, "")
        .trim();
    }

    // Rank: numbered lists prefix "N."; un-numbered user lists fall back to DOM order.
    const rankMatch = h4.text.trim().match(/^(\d+)\./);
    const rank = rankMatch ? parseInt(rankMatch[1], 10) : out.length + 1;

    out.push({ rank, title, author, cover, sourceId });
  }

  return out;
}

/**
 * The `<link rel="next">` href on a thegreatestbooks.org list page, used to walk
 * pagination. Returns null for single-page lists (e.g. /global-canon), which inline
 * the whole list and omit the link.
 */
export function parseTgbNext(html: string): string | null {
  const root = parse(html);
  const href = root.querySelector('link[rel="next"]')?.getAttribute("href");
  return href || null;
}

/**
 * Find the direct libgen download URL from an `ads.php` page. Relative `get.php`
 * links are absolutised against the mirror they came from (`base`) so this works
 * across the whole libgen.li "Format 2" family (libgen.li/.la/.gl/.vg/.bz), not
 * just libgen.li.
 */
export function parseLibgenUrl(html: string, base = "https://libgen.li"): string | null {
  const root = parse(html);
  const origin = base.replace(/\/+$/, "");
  for (const a of root.querySelectorAll("a")) {
    const href = a.getAttribute("href") || "";
    if (href.includes("get.php")) {
      return href.startsWith("http") ? href : `${origin}/${href.replace(/^\/+/, "")}`;
    }
  }
  return null;
}

/**
 * Find the direct "GET" download URL on a libgen.rs-fork download page
 * (library.lol / books.ms `/main/<md5>` or `/fiction/<md5>`). This is a DIFFERENT
 * database from the libgen.li family, so it covers books the primary source misses.
 * The page's `<div id="download">` holds a big GET link (a direct file URL on
 * `download.library.lol` / a booksdl CDN / a keyed `get.php`) followed by IPFS mirror
 * links; we take the first real file link and skip the IPFS mirrors (handled separately).
 */
export function parseLibraryLolUrl(html: string, base = "https://library.lol"): string | null {
  const root = parse(html);
  const origin = base.replace(/\/+$/, "");
  const container = root.querySelector("#download") || root;
  const anchors = container.querySelectorAll("a");

  const absolutise = (href: string): string => (href.startsWith("http") ? href : `${origin}/${href.replace(/^\/+/, "")}`);

  // Prefer an unambiguous direct-file link (download host / get.php / CDN).
  for (const a of anchors) {
    const href = a.getAttribute("href") || "";
    if (!href || /ipfs/i.test(href)) continue;
    if (/get\.php/i.test(href) || /download\./i.test(href) || /booksdl|cdn\d*\./i.test(href) || /\/(main|fiction)\//i.test(href)) {
      return absolutise(href);
    }
  }
  // Fallback: the first non-IPFS http(s) anchor in the download box.
  for (const a of anchors) {
    const href = a.getAttribute("href") || "";
    if (/^https?:\/\//i.test(href) && !/ipfs/i.test(href)) return absolutise(href);
  }
  return null;
}

// CIDv1 (bafy…/bafk…, base32) or CIDv0 (Qm…, base58). Case-sensitive (CIDs are).
const IPFS_CID = "(baf[yk][a-z2-7]{20,}|Qm[1-9A-HJ-NP-Za-km-z]{44})";

/**
 * Extract ALL IPFS CIDs from an Anna's Archive `/md5/<md5>` page (the same page we
 * scrape for covers) — a file often has several (a CIDv0 + a CIDv1 from different
 * providers), so trying each across gateways materially improves the hit rate. AA tags
 * each one as `ipfs_cid:<cid>` / `ipfs://<cid>`; we prefer those, then fall back to any
 * CID-shaped token near an "IPFS CID" label. We deliberately use the `/md5/` HTML page,
 * not the `/db/aarecord/*.json` API, because only the full mirrors serve the JSON —
 * the live search mirrors we can reach 404 it. Many (not all) files carry a CID.
 */
export function parseIpfsCids(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (cid?: string) => {
    if (cid && !seen.has(cid)) {
      seen.add(cid);
      out.push(cid);
    }
  };
  // Explicitly tagged CIDs (one per IPFS provider AA knows about).
  for (const m of html.matchAll(new RegExp(`(?:ipfs_cid:|ipfs://)${IPFS_CID}`, "g"))) add(m[1]);
  // Fallback for layouts without the tag: the CID after an "IPFS CID" label, then any.
  if (!out.length) {
    const labelled = html.match(new RegExp(`IPFS\\s*CID[\\s\\S]{0,300}?${IPFS_CID}`, "i"));
    if (labelled) add(labelled[1]);
    for (const m of html.matchAll(new RegExp(IPFS_CID, "g"))) {
      add(m[1]);
      if (out.length >= 6) break;
    }
  }
  return out.slice(0, 6);
}

// ---- Search relevance re-ranking --------------------------------------------
// Anna's Archive (and the libgen search fallback) return loose full-text matches, so
// a specific query — especially a comic issue like "Thor: Son of Asgard #1" — can
// surface tangential editions above the exact one. rankBooks re-orders results by a
// cheap similarity score, with special handling for issue numbers, as a STABLE sort
// (ties keep upstream order) so ordinary prose searches change little.

const RANK_STOPWORDS = new Set(["the", "a", "an", "of", "and", "or", "to", "in", "vol", "volume", "no", "issue", "part"]);

function rankNormalize(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function rankTokens(s: string): string[] {
  return rankNormalize(s)
    .split(" ")
    .filter((t) => t && !RANK_STOPWORDS.has(t));
}

/** The salient issue number in a string: prefer a raw "#N", else the last small integer. */
function issueNumber(s: string): number | null {
  const hash = (s || "").match(/#\s*(\d{1,4})/);
  if (hash) return parseInt(hash[1], 10);
  const nums = [...rankNormalize(s).matchAll(/\b(\d{1,3})\b/g)].map((m) => parseInt(m[1], 10));
  return nums.length ? nums[nums.length - 1] : null;
}

/** Small integers (< 1000, i.e. not 4-digit years) in a title — candidate issue numbers. */
function titleNumbers(s: string): Set<number> {
  return new Set([...rankNormalize(s).matchAll(/\b(\d{1,3})\b/g)].map((m) => parseInt(m[1], 10)));
}

export function rankBooks<T extends { title: string; book_filetype?: string; book_year?: string }>(query: string, books: T[]): T[] {
  const qNorm = rankNormalize(query);
  const qTokens = rankTokens(query);
  if (!qTokens.length || books.length < 2) return books;

  const qIssue = issueNumber(query);

  const scored = books.map((book, index) => {
    const titleNorm = rankNormalize(book.title);
    const titleTokenList = rankTokens(book.title);
    const tTokens = new Set(titleTokenList);

    let score = 0;
    const matched = qTokens.filter((t) => tTokens.has(t)).length;
    // Recall: share of query words present in the title (the result is "about" the query).
    score += (matched / qTokens.length) * 10;
    // Precision: share of the TITLE that is query words — demotes tangential / over-specific
    // editions (e.g. one collected "part" of a series) below the base match for the query.
    if (titleTokenList.length) score += (matched / titleTokenList.length) * 4;
    // Whole-query bonuses: exact title beats a superstring ("Dune" > "Dune Messiah"),
    // which beats a mere substring/phrase, which beats a bare prefix.
    if (qNorm && titleNorm === qNorm) score += 10;
    else if (qNorm && titleNorm.includes(qNorm)) score += 6;
    else if (titleNorm.startsWith(qTokens[0])) score += 1;

    // Issue-number awareness (the "#1 vs part five / vol 2" problem).
    if (qIssue !== null) {
      const tNums = titleNumbers(book.title);
      if (tNums.has(qIssue)) score += 5;
      else if (tNums.size) score -= 4; // title carries a DIFFERENT issue number
    }

    // Tiny tiebreakers: prefer reflowable epubs, then pdfs; nudge dated editions up.
    const ext = (book.book_filetype || "").toLowerCase();
    if (ext === "epub") score += 0.5;
    else if (ext === "pdf") score += 0.3;
    if (book.book_year) score += 0.1;

    return { book, index, score };
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((s) => s.book);
}

// --- Library Genesis search (fallback source) --------------------------------
// Anna's Archive is the primary search source; libgen is a resilience fallback for
// when every AA mirror is down. The libgen "Format 2" results table is genuinely
// messy HTML — the title cell carries a stray extra quote in a badge
// (`class="badge badge-secondary""`) that defeats whole-table DOM parsing (rows get
// mis-nested). So we split the results into per-row fragments and parse each one,
// mapping the stable trailing columns from the RIGHT (Mirrors is always last), and
// pulling the title out of the row's tooltip / edition link, which survive the
// malformed markup. md5s from libgen are guaranteed to resolve on the download path.

// Column offsets counted from the end of the row (…, author, publisher, year, lang,
// pages, size, ext, mirrors). Counting from the right is robust to the title cell
// being dropped by the malformed markup (which would shift left-based indices).
const LG_FROM_RIGHT = { author: 8, year: 6, lang: 5, size: 3, ext: 2 } as const;

/** Decode entities / strip tags from a raw HTML snippet via a throwaway parse. */
function htmlText(raw: string): string {
  return parse(`<x>${raw}</x>`).text.replace(/\s+/g, " ").trim();
}

/** Best-effort clean title for a libgen row (the title cell itself is malformed). */
function libgenRowTitle(rowHtml: string): string {
  // 1) The tooltip attribute carries a clean "…ID: <n><br><title>" — take the tail.
  const tip = rowHtml.match(/title="[^"]*ID:\s*\d+<br>([^"]+)"/i);
  if (tip && htmlText(tip[1])) return htmlText(tip[1]);
  // 2) Otherwise the last edition.php link text (usually the specific edition title).
  const links = [...rowHtml.matchAll(/<a[^>]*edition\.php[^>]*>([\s\S]*?)<\/a>/gi)];
  for (let i = links.length - 1; i >= 0; i--) {
    const t = htmlText(links[i][1]);
    if (t) return t;
  }
  // 3) Last resort: the bold title lead-in.
  const b = rowHtml.match(/<b>([\s\S]*?)<\/b>/i);
  return b ? htmlText(b[1]) : "";
}

/** Parse a libgen.li "Format 2" search results page into RawBooks (md5-compatible). */
// libgen's search form submits an explicit column/object/topic set, and as of
// 2026-08-24 a bare `index.php?req=<q>` no longer implies "search everything": it
// answers **200 with the page it renders when no search ran**. The tell is structural
// rather than textual — both pages carry an `id="tablelibgen"` element, but on the
// unsearched one the column headers are inert text, while a real results page renders
// them as sort links carrying the query back. So parseLibgenSearch anchored happily,
// found zero rows, and `search()` read it as a clean miss.
//
// That is why every query returned "No results found": AA has been behind DDoS-Guard
// since 2026-08-13 (§9), leaving libgen as the ONLY search source, and this silently
// zeroed it. Measured on libgen.la, back-to-back: bare `req=dune` -> 50,100 B / 0 rows;
// same query with these params -> 110,311 B / 25 rows.
//
// Sent as a prebuilt string because it is a fixed set — the same one every checked box
// in the form contributes (verified against the form markup, not guessed):
//   columns[] t,a,s,y,p,i  title / author / series / year / publisher / isbn
//   objects[] f,e,s,a,p,w  files / editions / series / authors / publishers / works
//   topics[]  l,c,f,a,m,r,s  libgen / comics / fiction / articles / magazines / ru / standards
// `res=100` matches the frontend's FETCH_PAGE_SIZE (it fetches a whole upstream page
// and paginates client-side) and gives rankBooks a fuller pool to re-rank.
export const LIBGEN_SEARCH_PARAMS = (() => {
  const p = new URLSearchParams();
  for (const c of ["t", "a", "s", "y", "p", "i"]) p.append("columns[]", c);
  for (const o of ["f", "e", "s", "a", "p", "w"]) p.append("objects[]", o);
  for (const t of ["l", "c", "f", "a", "m", "r", "s"]) p.append("topics[]", t);
  p.set("res", "100");
  return p.toString();
})();

/** The URL libgen's own search form would submit for `query`. */
export function libgenSearchUrl(base: string, query: string): string {
  return `${base}/index.php?req=${encodeURIComponent(query)}&${LIBGEN_SEARCH_PARAMS}`;
}

/**
 * libgen fronts a Manticore/Sphinx daemon on port 9306, and when that daemon is out of
 * connections the PHP layer still answers **200** with the normal shell plus an
 * `alert-danger` div ("Could not connect to the database 9306. Too many connections").
 * The results table is empty, so without this it is indistinguishable from "this mirror
 * has no matches" — and `search()` would count it toward the two-agreeing-misses budget
 * and give up, turning a transient upstream wobble into a hard "No results found".
 * Observed repeatedly on .la/.li while diagnosing this on 2026-08-24.
 */
export function isLibgenErrorPage(html: string): boolean {
  return /Could not connect to the database|Too many connections/i.test(html) || isNginxPlaceholder(html);
}

/**
 * The stock "Welcome to nginx!" page. Since 2026-09-14 every libgen mirror answers it —
 * 200, 641 bytes — to any request whose User-Agent isn't browser-shaped (curl's default
 * gets it; the Worker's Chrome UA gets the real page). It carries no results table, so
 * `parseLibgenSearch` reads it as zero rows and `search()` would spend a clean miss on
 * it. If the gate ever widens to whatever we send, that turns into two agreeing misses
 * and a site-wide "No results found" — the same silent failure mode the daemon-error
 * page above produced on 2026-08-24. Classify it as the host not answering instead.
 */
function isNginxPlaceholder(html: string): boolean {
  return html.length < 4096 && /<title>\s*Welcome to nginx!\s*<\/title>/i.test(html);
}

/**
 * Turn a libgen `locator` (the archive path a file is stored under) into a display
 * title. Used only when the edition row carries no title of its own — comics, in
 * practice, where libgen keeps the name in the path and nowhere else:
 *
 *   V:\\comics\\_MANGA\\!JAP\\!artbooks\\[Berserk][Artbook]Berserk.Illustration.Book.2.[x].rar
 *   -> "[Berserk][Artbook]Berserk.Illustration.Book.2.[x]"
 *
 * Windows and POSIX separators both appear in the data, so split on either. The stored
 * container extension (.rar) is not the extension we serve (.cbr), and it is noise in a
 * title either way, so it comes off.
 */
export function locatorTitle(locator: string | undefined): string {
  if (!locator) return "";
  const base = String(locator).split(/[\\/]/).pop() || "";
  return base.replace(/\.[a-z0-9]{1,6}$/i, "").trim();
}

/** The fields of a libgen `json.php?object=f` file record that locate its cover. */
export interface LibgenCoverFields {
  cover_exists?: string;
  libgen_topic?: string;
  libgen_id?: string;
  comics_id?: string;
}

/**
 * Where libgen keeps the cover for a file record, or null if it keeps none.
 *
 * libgen buckets cover images by a thousand-wide slice of the row's own catalogue id,
 * which is why this can't be derived from the md5 alone — the id has to come off the
 * file record. Two directories, chosen by topic:
 *
 *   topic "c"  ->  /comicscovers/{comics_id / 1000 * 1000}/{md5}.jpg
 *   otherwise  ->  /covers/{libgen_id / 1000 * 1000}/{md5}.jpg
 *
 * "otherwise" really is everything else, and that is the part worth not re-deriving:
 * fiction ("f") and Russian fiction ("r") sit under `/covers/` keyed on `libgen_id`,
 * NOT under a fiction-specific directory keyed on `fiction_id`/`fiction_rus_id`, even
 * though both of those ids exist on the record and look like the obvious choice.
 * Verified against production 2026-09-01: this rule reproduced the path libgen's own
 * results page advertises for **117 of 117** md5s across topics l/c/f/r, zero
 * mismatches, and 115 of them served a real JPEG.
 *
 * `cover_exists` is libgen's own flag and is trusted as the gate — it is the difference
 * between "this book has no cover" and "we failed to fetch one", which decides how long
 * a cover miss is remembered.
 */
export function libgenCoverPath(rec: LibgenCoverFields | null | undefined, md5: string): string | null {
  if (!rec || typeof rec !== "object" || rec.cover_exists !== "1") return null;
  if (!/^[a-f0-9]{32}$/i.test(md5)) return null;
  const comic = rec.libgen_topic === "c";
  const id = parseInt((comic ? rec.comics_id : rec.libgen_id) || "", 10);
  if (!Number.isFinite(id) || id <= 0) return null;
  const dir = comic ? "comicscovers" : "covers";
  return `/${dir}/${Math.floor(id / 1000) * 1000}/${md5.toLowerCase()}.jpg`;
}

export function parseLibgenSearch(html: string): RawBook[] {
  const out: RawBook[] = [];
  const seen = new Set<string>();

  // Anchor on the results table (`id="tablelibgen"` — the trailing quote avoids the
  // `tablelibgen1` CSS id) and split into <tr> fragments.
  const anchor = html.indexOf('id="tablelibgen"');
  const region = anchor >= 0 ? html.slice(anchor) : html;

  for (const frag of region.split(/<tr[\s>]/i).slice(1)) {
    const rowHtml = frag.split(/<\/tr>/i)[0];
    // libgen renders the Mirrors cell differently per topic. Book/fiction rows carry a
    // full set of mirror links led by `ads.php?md5=`; **comic rows carry only
    // `get.php?md5=`** (plus an AA link we can't use). Gating on `ads.php` alone
    // therefore discarded every comic on the page — measured 2026-08-20 on libgen.li:
    // "berserk" returns 28 rows, 25 of them get.php-only, and this loop kept 0 of them.
    // That empty array reads to `search()` as a clean miss, so /api/books answered 404
    // for every comic query. (It also produced HANDOFF §9.15's wrong conclusion that
    // libgen has no manga — the rows were always there; we binned them before counting.)
    // `ads.php?md5=` still resolves a comic md5 on the download path, so accepting the
    // get.php form here costs nothing downstream.
    const m = rowHtml.match(/(?:ads|get)\.php\?md5=([a-f0-9]{32})/i);
    if (!m) continue;
    const md5 = m[1].toLowerCase();
    if (seen.has(md5)) continue;

    // Repair the stray extra attribute quote, then DOM-parse this single row.
    const row = parse(`<table><tr>${rowHtml.replace(/(="[^"]*")"/g, "$1")}</tr></table>`);
    const tds = row.querySelectorAll("td");
    const n = tds.length;
    if (n < 8) continue; // not a real result row
    const col = (fromRight: number) => (n - fromRight >= 0 ? tds[n - fromRight].text.trim().replace(/\s+/g, " ") : "");

    const title = libgenRowTitle(rowHtml);
    if (!title) continue;

    const ext = col(LG_FROM_RIGHT.ext).toLowerCase();
    const year = col(LG_FROM_RIGHT.year);
    seen.add(md5);
    out.push({
      md5,
      title,
      author: col(LG_FROM_RIGHT.author) || "Unknown Author",
      description: "",
      book_lang: col(LG_FROM_RIGHT.lang) || "Unknown Language",
      book_filetype: KNOWN_FILETYPES.has(ext) ? ext.toUpperCase() : ext ? ext.toUpperCase() : "Unknown Filetype",
      book_size: col(LG_FROM_RIGHT.size) || "Unknown Size",
      book_year: YEAR_RE.test(year) ? year : "",
      book_content: "Unknown Content",
      book_source: "Library Genesis",
    });
  }

  return out;
}

// ---- Comic reading orders (comicbookreadingorders.com) --------------------------
// The master page lists eras in reading order — each an <h2> linking to that era's
// page plus `<p><strong>Issues/Years/Events/First Appearances:</strong> …</p>`
// metadata and a description. Each era page carries the full issue list inside a
// "Single Issues" tab, where the colour on an issue's <span> encodes the series type
// (green = limited series, red = one-shot, none = ongoing) and a blue <span> is an
// inline annotation. A few "event" landing pages (e.g. Marvel NOW!) carry no issue
// list — just a summary + links to sub-event orders — which we surface as `subEvents`.

export interface ReadingOrderIssue {
  title: string;
  year?: string;
  /** Series type from the source's colour legend; omitted for the default (ongoing). */
  type?: "limited" | "oneshot";
  /** Inline annotation, e.g. "First appearance of Valkyrie". */
  note?: string;
}

export interface ReadingOrderEra {
  /** Slug from the era page URL (stable id / React key). */
  id: string;
  name: string;
  url: string;
  issuesLabel?: string;
  years?: string;
  events?: string;
  firstAppearances?: string;
  description?: string;
  issues: ReadingOrderIssue[];
  /** Populated only for summary/event landing pages that have no issue list. */
  subEvents?: { name: string; url: string }[];
}

const RO_LINK_RE = /reading-order/i;

const cleanText = (s: string): string => s.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
/** Strip tags + decode entities from an HTML fragment. */
const htmlToText = (html: string): string => cleanText(parse(html).text);
const roSlug = (url: string): string => url.replace(/[/?#]+$/, "").split("/").filter(Boolean).pop() || url;
/** Canonicalise a source link: force https, repair `/dc//events/…` double slashes, add a trailing slash (the source 301s the slash-less form, dropping the body). */
const roNormalizeUrl = (url: string): string => {
  const u = url
    .trim()
    .replace(/^http:\/\//i, "https://")
    .replace(/([^:])\/\/+/g, "$1/");
  return /\/$/.test(u) ? u : `${u}/`;
};

/**
 * Parse the master reading-order index into ordered era metadata (no issues yet).
 * Each era is delimited by an <h2> whose anchor links to the era page; the labelled
 * `<p>` blocks that follow (until the next <h2>) hold its metadata + description.
 * Operates on the raw HTML (the source hand-authors uppercase `<A HREF>` tags).
 */
export function parseReadingOrderMaster(html: string): Omit<ReadingOrderEra, "issues">[] {
  const cm = html.match(/class="[^"]*entry-content[^"]*"([\s\S]*?)<\/article/i);
  const content = cm ? cm[1] : html;

  const eras: Omit<ReadingOrderEra, "issues">[] = [];
  const seen = new Set<string>();

  for (const block of content.split(/<h2\b/i).slice(1)) {
    // Match the era link inside the <h2> heading only — a block's body can contain a
    // "Part 1 | Part 2 | …" nav whose links would otherwise hijack the wrong block.
    const headEnd = block.search(/<\/h2>/i);
    const heading = headEnd >= 0 ? block.slice(0, headEnd) : block;
    const body = headEnd >= 0 ? block.slice(headEnd) : block;

    const anchor = heading.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!anchor) continue;
    const url = roNormalizeUrl(anchor[1]);
    if (!RO_LINK_RE.test(url)) continue;
    const name = htmlToText(anchor[2]);
    if (!name) continue;
    const id = roSlug(url);
    if (seen.has(id)) continue;
    seen.add(id);

    const field = (label: string): string | undefined => {
      const m = body.match(new RegExp(`${label}\\s*:?\\s*</strong>\\s*([\\s\\S]*?)</p>`, "i"));
      const v = m ? htmlToText(m[1]) : "";
      return v || undefined;
    };

    const description =
      [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
        .map((m) => m[1])
        .filter((p) => !/<strong>\s*(Issues|Years|Events|First Appearances)/i.test(p))
        .map((p) => htmlToText(p))
        .filter(Boolean)
        .join("\n\n") || undefined;

    eras.push({
      id,
      name,
      url,
      issuesLabel: field("Issues"),
      years: field("Years"),
      events: field("Events"),
      firstAppearances: field("First Appearances"),
      description,
    });
  }

  return eras;
}

/** Parse one <br>-separated entry from a "Single Issues" panel into an issue/annotation. */
function parseReadingOrderFragment(fragHtml: string): ReadingOrderIssue | null {
  let frag = fragHtml;

  // Blue span = inline annotation ("Comments" in the source legend).
  let note: string | undefined;
  const blue = frag.match(/<span[^>]*color:\s*#?0000ff[^>]*>([\s\S]*?)<\/span>/i);
  if (blue) {
    note = htmlToText(blue[1]) || undefined;
    frag = frag.replace(blue[0], "");
  }

  // Title colour encodes the series type (green = limited series, red = one-shot).
  let type: ReadingOrderIssue["type"];
  if (/color:\s*#?008000/i.test(frag)) type = "limited";
  else if (/color:\s*#?ff0000/i.test(frag)) type = "oneshot";

  let text = htmlToText(frag).replace(/[\s\u00b7|,–-]+$/g, "").trim();

  // Publication year in parens (anywhere; some lines put a note after it).
  let year: string | undefined;
  const ym = text.match(/\(\s*(\d{4})\s*\)/);
  if (ym) {
    year = ym[1];
    text = cleanText(text.slice(0, ym.index) + text.slice(ym.index! + ym[0].length));
  }

  // A plain " - note" tail (annotations not wrapped in a blue span). Requires spaces
  // around the dash so hyphenated titles (Spider-Man, Giant-Size) are left intact.
  if (!note) {
    const dash = text.match(/\s[-–]\s+(.+)$/);
    if (dash && /[a-z]/i.test(dash[1])) {
      note = cleanText(dash[1]);
      text = text.slice(0, dash.index).trim();
    }
  }
  text = text.replace(/[\s\u00b7|,–-]+$/g, "").trim();

  if (!text) return note ? { title: "", note } : null;
  return { title: text, ...(year ? { year } : {}), ...(type ? { type } : {}), ...(note ? { note } : {}) };
}

/**
 * Parse an era page's issue list from its "Single Issues" tab (always the first/active
 * panel). Pages without tabs are summary/event landing pages: they yield no issues, so
 * we return their sub-event links instead (the caller surfaces those when `issues` is
 * empty). Deliberately string-based: some larger era pages have malformed markup that
 * mis-nests under a DOM parser, so the tab panels vanish — raw-HTML slicing is immune.
 */
export function parseReadingOrderIssues(html: string): { issues: ReadingOrderIssue[]; subEvents: { name: string; url: string }[] } {
  const cm = html.match(/class="[^"]*entry-content[^"]*"([\s\S]*?)<\/article/i);
  const content = cm ? cm[1] : html;

  // Split at each tab-panel opening <div>; \b keeps the plural "x-tabs-panels" wrapper
  // out. The first panel is the "Single Issues" list; the rest (TPBs) we ignore.
  const panel = content.split(/<div[^>]*\bx-tabs-panel\b[^>]*>/i)[1] || "";

  const issues: ReadingOrderIssue[] = [];
  if (panel) {
    const inner = panel.replace(/<\/p\s*>/gi, "<br>").replace(/<p\b[^>]*>/gi, "");
    for (const rawFrag of inner.split(/<br\s*\/?>/i)) {
      const parsed = parseReadingOrderFragment(rawFrag);
      if (!parsed) continue;
      if (parsed.title) {
        issues.push(parsed);
      } else if (parsed.note && issues.length) {
        const prev = issues[issues.length - 1];
        prev.note = prev.note ? `${prev.note}; ${parsed.note}` : parsed.note;
      }
    }
  }

  const subEvents: { name: string; url: string }[] = [];
  if (!issues.length) {
    const seen = new Set<string>();
    for (const m of content.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const url = roNormalizeUrl(m[1]);
      const name = htmlToText(m[2]);
      if (!name || !RO_LINK_RE.test(url) || !/\/events\//i.test(url)) continue;
      const slug = roSlug(url);
      if (seen.has(slug)) continue;
      seen.add(slug);
      subEvents.push({ name, url });
    }
  }

  return { issues, subEvents };
}

// ---- Five Books (fivebooks.com) -------------------------------------------------
// Expert-curated recommendations: each "interview" is an expert recommending ~5 books
// on a subject. Category and "best of the year" pages render a stack of interviews,
// each with a preview of its books; an individual interview page renders the full set.
// Shared markup across all three page types:
//   <h2 class="book-title -listbook"><span class="title">TITLE</span><br> by AUTHOR</h2>
//   <img class="cover ... wp-post-image" data-src|src="…jpg">   (book cover)
// List/archive pages additionally delimit interviews with:
//   <h3 class="interview-title -archive"><a href="…/best-books/<slug>/">
//       The best books on <span class="subject">SUBJECT</span>, recommended by EXPERT</a>
// Interview pages carry <h1 class="interview-title"> + <h4 class="interview-name">.
// Selectors are brittle by nature (see the rest of this file) — fix here if Five Books
// changes its theme.

export interface FiveBooksBook {
  title: string;
  author: string;
  cover: string;
}

export interface FiveBooksInterview {
  /** …/best-books/<slug>/ id (stable key + how the client re-fetches the full interview). */
  slug: string;
  /** Full heading, e.g. "The best books on Inequality" or "The Best Economics Books of 2024". */
  title: string;
  /** The topic, e.g. "Inequality" (falls back to the title when the page has no subject span). */
  subject: string;
  /** The recommender, e.g. "Daron Acemoglu" (empty when a page omits it). */
  expert: string;
  books: FiveBooksBook[];
}

const FB_BASE = "https://fivebooks.com";

/** …/best-books/<slug>/ → <slug>. */
function fiveBooksSlug(href: string): string {
  const m = href.match(/\/best-books\/([^/"?#]+)/i);
  return m ? m[1] : "";
}

/** First absolute URL in a srcset ("url 144w, url2 288w" → url). */
function firstSrcsetUrl(val: string): string {
  const first = (val.split(",")[0] || "").trim().split(/\s+/)[0] || "";
  return /^https?:\/\//i.test(first) ? first : "";
}

/** One cover URL from a `.cover-wrap`: a plain <img src> (interview pages render it) or,
 *  when lazy-loaded (category/best pages), the first real URL in a <source data-srcset>. */
function coverFromWrap(wrap: HTMLElement): string {
  const img = wrap.querySelector("img.cover") || wrap.querySelector("img");
  const direct = (img?.getAttribute("data-src") || img?.getAttribute("src") || "").trim();
  if (/^https?:\/\//i.test(direct)) return direct;
  for (const source of wrap.querySelectorAll("source")) {
    const url = firstSrcsetUrl(source.getAttribute("data-srcset") || source.getAttribute("srcset") || "");
    if (url) return url;
  }
  return "";
}

/** Pull the books (title + author + cover, in shelf order) out of a page/fragment. */
function fiveBooksBooksFrom(root: HTMLElement): FiveBooksBook[] {
  const coverUrls = root.querySelectorAll(".cover-wrap").map(coverFromWrap);

  const books: FiveBooksBook[] = [];
  const seen = new Set<string>();
  const titleNodes = root.querySelectorAll("h2.book-title");
  titleNodes.forEach((h2, i) => {
    const title = (h2.querySelector(".title")?.text || "").replace(/\s+/g, " ").trim();
    if (!title) return;
    const key = title.toLowerCase();
    if (seen.has(key)) return; // a page can render the shelf twice (desktop + mobile)
    seen.add(key);
    // Author is the h2 remainder after the title span ("<title> <br> by <author>").
    const author = h2.text
      .replace(title, "")
      .replace(/\s+/g, " ")
      .replace(/^\s*by\s+/i, "")
      .trim();
    books.push({ title, author, cover: coverUrls[i] || "" });
  });
  return books;
}

/**
 * Parse a Five Books LISTING page (a /category/… page or a /books/best-books-of-<year>/
 * page) into its interviews, each with a preview of its books. Interviews are delimited
 * by `<h3 class="interview-title -archive">`, so we string-split on that marker and DOM-parse
 * each interview's own slice — robust to the surrounding page chrome.
 */
export function parseFiveBooksList(html: string): FiveBooksInterview[] {
  const out: FiveBooksInterview[] = [];
  const seen = new Set<string>();
  const parts = html.split(/<h3[^>]*class="[^"]*interview-title -archive[^"]*"[^>]*>/i);

  for (const part of parts.slice(1)) {
    // The <a> that opened this interview heading is at the very start of the slice.
    const head = parse(part.slice(0, part.indexOf("</h3>") >= 0 ? part.indexOf("</h3>") : 400));
    const anchor = head.querySelector("a");
    const href = anchor?.getAttribute("href") || "";
    const slug = fiveBooksSlug(href);
    if (!slug || seen.has(slug)) continue;

    const headingText = (anchor?.text || head.text).replace(/\s+/g, " ").trim();
    const subject = (head.querySelector(".subject")?.text || "").replace(/\s+/g, " ").trim();
    const expertMatch = headingText.match(/recommended by\s+(.+)$/i);
    const expert = expertMatch ? expertMatch[1].trim() : "";
    const title = subject ? `The best books on ${subject}` : headingText.replace(/,?\s*recommended by.*$/i, "").trim();

    // Books live between this heading and the next (i.e. in the rest of this slice).
    const books = fiveBooksBooksFrom(parse(part));
    if (!books.length) continue;

    seen.add(slug);
    out.push({ slug, title, subject: subject || title, expert, books });
  }
  return out;
}

/**
 * Parse an individual Five Books interview page (…/best-books/<slug>/) into the expert +
 * their full set of books.
 */
export function parseFiveBooksInterview(html: string, slug = ""): FiveBooksInterview {
  const root = parse(html);
  const h1 = root.querySelector("h1.interview-title");
  const title = (h1?.text || "").replace(/\s+/g, " ").trim();
  const subject = (h1?.querySelector(".subject")?.text || "").replace(/\s+/g, " ").trim();
  const expert = (root.querySelector("h4.interview-name")?.text || "")
    .replace(/\s+/g, " ")
    .replace(/^\s*recommended by\s+/i, "")
    .trim();
  // Scope to the primary shelf: the page also renders a mobile duplicate + a "more books
  // by this author" section, all as h2.book-title, which we must not include.
  const shelf = root.querySelector(".book-covers") || root;
  return { slug, title, subject: subject || title, expert, books: fiveBooksBooksFrom(shelf) };
}

export { FB_BASE };

// ---- Project Gutenberg (public-domain classics, via the Gutendex API) -----------
// A genuinely more-reliable, legal source for the ~70k public-domain titles it covers
// (stable API, no captchas/takedowns). Keyed by title/author, not md5, so it's used as
// a fallback for a search result's book: we confirm a confident title+author match and
// only serve public-domain records, then pick the format matching the requested ext.

const GUTENBERG_EXT_MIME: Record<string, string> = {
  epub: "application/epub+zip",
  txt: "text/plain",
  mobi: "application/x-mobipocket-ebook",
  html: "text/html",
};

/** True if Gutenberg can serve this ext at all (it has no PDF, etc.). */
export function gutenbergSupportsExt(ext: string): boolean {
  return ext.replace(/^\./, "").toLowerCase() in GUTENBERG_EXT_MIME;
}

/** Pick the Gutendex `formats` URL matching the requested ext (skips cover/rdf/zip). */
export function pickGutenbergFormat(formats: Record<string, string>, ext: string): string | null {
  const mime = GUTENBERG_EXT_MIME[ext.replace(/^\./, "").toLowerCase()];
  if (!mime) return null; // don't serve a mismatched type (e.g. epub bytes for a .pdf request)
  for (const [k, url] of Object.entries(formats || {})) {
    if (k.startsWith(mime) && /^https?:\/\//.test(url) && !url.endsWith(".zip")) return url;
  }
  return null;
}

/**
 * Confident title+author match, so we never serve the wrong public-domain book. Most of
 * the query's title words must appear in the candidate, and (when we have an author) a
 * distinctive author token must match. Single-word titles require an author to qualify.
 * Shared by the metadata-keyed sources (Gutenberg, Internet Archive, libgen search).
 */
export function titleAuthorMatch(queryTitle: string, queryAuthor: string, candTitle: string, candAuthorBlob: string): boolean {
  const q = rankTokens(queryTitle);
  if (!q.length) return false;
  const t = new Set(rankTokens(candTitle));
  const covered = q.filter((w) => t.has(w)).length / q.length;
  if (covered < 0.8) return false;
  const author = rankNormalize(queryAuthor);
  if (!author) return q.length >= 2; // one-word title with no author is too ambiguous
  const blob = rankNormalize(candAuthorBlob);
  return rankTokens(queryAuthor).some((w) => w.length >= 3 && blob.includes(w));
}

export function gutenbergMatches(queryTitle: string, queryAuthor: string, candTitle: string, candAuthors: string[]): boolean {
  return titleAuthorMatch(queryTitle, queryAuthor, candTitle, candAuthors.join(" "));
}

// ---- Internet Archive (public-domain books/comics/mags via archive.org) ---------
// A huge, legal, unauthenticated source for the slice of items marked NOT_IN_COPYRIGHT
// with no access restriction. Two-step download: advancedsearch → title/author match →
// /metadata/<id> file list → /download/<id>/<name>. Uses the same fuzzy title+author
// matcher as Gutenberg so we never serve the wrong work.

// Requested file extension → the `format` strings archive.org labels files with.
// Ordered by preference within an ext (e.g. "Text PDF" before "Additional Text PDF").
const IA_EXT_FORMAT: Record<string, string[]> = {
  epub: ["EPUB"],
  pdf: ["Text PDF", "PDF", "Additional Text PDF"],
  txt: ["DjVuTXT", "Plain Text"],
  cbz: ["Comic Book ZIP"],
  cbr: ["Comic Book RAR"],
  djvu: ["DjVu"],
};

/** True if IA can serve this ext at all (it has no MOBI/AZW3 for scanned texts). */
export function internetArchiveSupportsExt(ext: string): boolean {
  return ext.replace(/^\./, "").toLowerCase() in IA_EXT_FORMAT;
}

interface IaFile {
  name?: string;
  format?: string;
  source?: string; // "original" or "derivative"
}

/**
 * Pick a file matching the requested ext from an IA `/metadata/<id>` files list.
 * Prefers `source: "original"` over derivatives (derivatives are re-encoded / can be
 * DRM-wrapped LCP/ACS copies for borrowable items, which we skip by name pattern).
 */
export function pickInternetArchiveFile(files: IaFile[], ext: string): string | null {
  const wanted = IA_EXT_FORMAT[ext.replace(/^\./, "").toLowerCase()];
  if (!wanted) return null;
  const isEncrypted = (name: string) => /_encrypted|_acs|_lcp/i.test(name);
  const original = files.filter((f) => f.source === "original" && f.name && !isEncrypted(f.name));
  const derivative = files.filter((f) => f.source !== "original" && f.name && !isEncrypted(f.name));
  for (const bucket of [original, derivative]) {
    for (const fmt of wanted) {
      const hit = bucket.find((f) => f.format === fmt);
      if (hit?.name) return hit.name;
    }
  }
  return null;
}

/** Same fuzzy match as Gutenberg; IA's `creator` can be a string or a list. */
export function internetArchiveMatches(queryTitle: string, queryAuthor: string, candTitle: string, candCreator: string | string[] | undefined): boolean {
  const blob = Array.isArray(candCreator) ? candCreator.join(" ") : candCreator || "";
  return titleAuthorMatch(queryTitle, queryAuthor, candTitle, blob);
}

// ---- Standard Ebooks (curated PD EPUBs via Atom + OpenSearch) --------------------
// Small (~800 titles) but rock-solid: same authors and titles Gutenberg has, but the
// EPUBs are professionally re-typeset — better than anything else for the slice they
// cover. Keyed by title/author like Gutenberg/IA. The atom feed's OpenSearch endpoint
// is /feeds/atom/all?query=…, each <entry> has enclosure <link>s for each format.

export interface StandardEbook {
  title: string;
  author: string;
  formats: Record<string, string>; // mime -> url
}

const SE_MIME_BY_EXT: Record<string, string> = {
  epub: "application/epub+zip",
  kepub: "application/kepub+zip",
  azw3: "application/x-mobipocket-ebook",
};

/** True if Standard Ebooks can serve this ext (only its curated ebook formats). */
export function standardEbooksSupportsExt(ext: string): boolean {
  return ext.replace(/^\./, "").toLowerCase() in SE_MIME_BY_EXT;
}

/** Pick the download URL matching the requested ext from an entry's `formats` map. */
export function pickStandardEbooksFormat(formats: Record<string, string>, ext: string): string | null {
  const key = ext.replace(/^\./, "").toLowerCase();
  const mime = SE_MIME_BY_EXT[key];
  if (!mime) return null;
  // Standard Ebooks publishes two .epub variants — a `_advanced.epub` (uses non-standard
  // features some readers choke on) and the plain one. Prefer the plain form to keep
  // compatibility with basic readers; fall back to advanced if plain isn't listed.
  const candidates = Object.entries(formats).filter(([m]) => m.startsWith(mime));
  if (!candidates.length) return null;
  const plain = candidates.find(([, url]) => !/_advanced\.epub/i.test(url));
  return (plain ?? candidates[0])[1];
}

/** Reuse the shared fuzzy title/author matcher — same rule as Gutenberg/IA. */
export function standardEbooksMatches(queryTitle: string, queryAuthor: string, book: StandardEbook): boolean {
  return titleAuthorMatch(queryTitle, queryAuthor, book.title, book.author);
}

/**
 * Parse a Standard Ebooks Atom feed response into flat `StandardEbook` records.
 * The XML is small and well-formed enough that a lightweight regex walk beats the
 * ceremony of pulling in a full XML parser. Each `<entry>` yields (title, author,
 * {mime → href}).
 */
export function parseStandardEbooksFeed(xml: string): StandardEbook[] {
  const out: StandardEbook[] = [];
  const decode = (s: string): string =>
    s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  for (const entryMatch of xml.matchAll(/<entry\b[\s\S]*?<\/entry>/g)) {
    const entry = entryMatch[0];
    const titleM = entry.match(/<title[^>]*>([\s\S]*?)<\/title>/);
    if (!titleM) continue;
    const title = decode(titleM[1]).trim();
    const authors: string[] = [];
    for (const a of entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)) {
      authors.push(decode(a[1]).trim());
    }
    const formats: Record<string, string> = {};
    for (const l of entry.matchAll(/<link\b([^>]*?)\/?>/g)) {
      const attrs = l[1];
      const rel = attrs.match(/\brel="([^"]+)"/)?.[1];
      const type = attrs.match(/\btype="([^"]+)"/)?.[1];
      const href = attrs.match(/\bhref="([^"]+)"/)?.[1];
      if (rel !== "enclosure" || !type || !href) continue;
      // First href wins per mime — later entries would clobber the "plain" epub with
      // "_advanced.epub", which pickStandardEbooksFormat's downgrade logic then can't
      // recover from. Insertion-first keeps the plain variant.
      if (!(type in formats)) formats[type] = decode(href);
    }
    if (!title || !Object.keys(formats).length) continue;
    out.push({ title, author: authors.join(", "), formats });
  }
  return out;
}

// ---- Anna's Archive slow_download (the last-resort but ~always-works source) ------
// AA offers free ("slow") downloads on virtually every md5 they list, gated by a
// ~30s countdown on a queue page. We hit /slow_download/<md5>/0/<partner>, either
// get the direct URL immediately (some partners release it right away) or a countdown
// value; sleep the countdown, refetch, extract. The direct URL lives in a
// `<span class="bg-gray-200 break-all">…</span>` element on the "ready" page.

export interface AaSlowResult {
  /** Direct download URL, ready to hit. */
  url?: string;
  /** Seconds we must wait before refetching this exact endpoint to get the URL. */
  waitSeconds?: number;
  /** Fatal state — captcha or partner unavailable, don't retry this partner. */
  fatal?: boolean;
}

const AA_SLOW_URL_RE = /<span[^>]*class="[^"]*\bbg-gray-200\b[^"]*\bbreak-all\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i;
const AA_SLOW_COUNTDOWN_RE = /<span[^>]*class="[^"]*js-partner-countdown[^"]*"[^>]*>(\d+)<\/span>/i;

export function parseAaSlowDownloadPage(html: string): AaSlowResult {
  const urlHit = html.match(AA_SLOW_URL_RE);
  if (urlHit) {
    const url = urlHit[1].trim();
    if (/^https?:\/\//i.test(url)) return { url };
  }
  const cdHit = html.match(AA_SLOW_COUNTDOWN_RE);
  if (cdHit) {
    const n = parseInt(cdHit[1], 10);
    if (Number.isFinite(n) && n >= 0 && n <= 120) return { waitSeconds: n };
  }
  // No URL, no countdown — captcha / "please log in" / partner offline. Signal fatal
  // so the caller moves on to the next partner index without wasting a retry.
  return { fatal: true };
}
