// Apple Books as a live discovery source: bestseller charts, per-genre charts,
// search-as-you-type suggestions and per-book metadata (rating/description/cover).
//
// There are three upstream surfaces, deliberately layered by how much we trust them:
//
//   1. rss.marketingtools.apple.com  — Apple's official public marketing feed. No auth,
//      no token, extremely stable. Only does overall top-free/top-paid. This is the
//      BASELINE: if everything else breaks, charts still work.
//   2. amp-api.books.apple.com       — the private API books.apple.com itself calls.
//      Needs a bearer JWT and gives us everything the feed can't: per-genre charts,
//      ISBN, description, star ratings, and a resizable artwork URL. Used as
//      ENRICHMENT — every call site degrades to (1) or to nothing.
//   3. MZSearchHints                 — the store's autocomplete endpoint, reachable with
//      no headers at all. Powers search suggestions.
//
// The JWT is embedded in the HTML of any books.apple.com page and rotates roughly
// quarterly. We scrape it once and cache it; a 401 busts the cache and re-scrapes once.
// (The legacy MZStore/MZStorePlatform book endpoints in Apple's client "bag" are dead —
// they answer Search_NoResults / 404 for ebooks now — so amp-api is the only rich path.)

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const AMP_BASE = "https://amp-api.books.apple.com/v1/catalog";
const RSS_BASE = "https://rss.marketingtools.apple.com/api/v2";
const HINTS_URL = "https://search.itunes.apple.com/WebObjects/MZSearchHints.woa/wa/hints";
const TOKEN_PAGE = "https://books.apple.com/us/charts";

const STOREFRONT = "us";

// Token cache. KV is the shared store (one scrape serves every POP); the Cache API
// entry in front of it saves a KV read per request within a POP. 7 days is well
// inside the ~84-day token lifetime, so we re-scrape long before natural expiry.
const TOKEN_KV_KEY = "apple:media-token";
const TOKEN_TTL = 7 * 24 * 3600;
const TOKEN_EDGE_TTL = 3600;
const TOKEN_CACHE_URL = "https://bookracy.internal/apple-token";

const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;

/** Only these are offered as genre chips; ids are Apple's own iTunes genre ids. */
export const APPLE_GENRES: { id: string; name: string }[] = [
  { id: "", name: "All books" },
  { id: "9031", name: "Fiction" },
  { id: "9032", name: "Mystery & Thriller" },
  { id: "9020", name: "Sci-Fi & Fantasy" },
  { id: "9003", name: "Romance" },
  { id: "10047", name: "Historical Fiction" },
  { id: "9008", name: "Biography" },
  { id: "9007", name: "History" },
  { id: "9026", name: "Science & Nature" },
  { id: "9009", name: "Business" },
  { id: "10042", name: "Classics" },
  { id: "9028", name: "Young Adult" },
];

const GENRE_IDS = new Set(APPLE_GENRES.map((g) => g.id));
export const isAppleGenre = (id: string): boolean => GENRE_IDS.has(id);
export const appleGenreName = (id: string): string => APPLE_GENRES.find((g) => g.id === id)?.name ?? "";

export interface AppleBook {
  /** Apple's catalog id — stable, used as a React key and for metadata lookups. */
  id: string;
  title: string;
  author: string;
  /** Already sized; Apple serves a `{w}x{h}bb.{f}` template we fill in. */
  cover: string;
  genres: string[];
  releaseDate: string;
}

export interface AppleMeta {
  title: string;
  author: string;
  cover: string;
  description: string;
  /** 0 when Apple has no ratings yet — callers should hide the stars in that case. */
  rating: number;
  ratingCount: number;
  pageCount: number;
  publisher: string;
  isbn: string;
  releaseDate: string;
  genres: string[];
  /** Public books.apple.com page, so we can credit the source. */
  url: string;
  /** Edition subtitle ("The Final Empire") — libgen records rarely carry one. */
  subtitle: string;
  /** Series name + position, e.g. "Mistborn" / "Book 1". Empty when standalone. */
  seriesName: string;
  seriesPosition: string;
  /** BCP-47 locale of the edition ("en-US"). libgen gives us no language at all. */
  locale: string;
}

// ---- plumbing ----------------------------------------------------------------

async function timedFetch(url: string, ms: number, headers: Record<string, string>): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { headers, signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getJson<T>(url: string, ms: number, headers: Record<string, string>): Promise<T | null> {
  const resp = await timedFetch(url, ms, headers);
  if (!resp) return null;
  if (!resp.ok) {
    // Drain what we won't read so the connection slot is released now rather than
    // when the runtime cancels it as "stalled" (see fetchTextTimed in index.ts).
    await resp.body?.cancel();
    return null;
  }
  try {
    return (await resp.json()) as T;
  } catch {
    return null;
  }
}

/** Apple hands back a `.../{w}x{h}bb.{f}` template; fill it in at a card-friendly size. */
function artwork(url: string | undefined, size = 400): string {
  if (!url) return "";
  return url.replace("{w}", String(size)).replace("{h}", String(Math.round(size * 1.6))).replace("{f}", "jpg");
}

// ---- bearer token ------------------------------------------------------------

async function writeEdgeToken(token: string): Promise<void> {
  await caches.default.put(
    new Request(TOKEN_CACHE_URL),
    new Response(token, { headers: { "Cache-Control": `max-age=${TOKEN_EDGE_TTL}`, "Content-Type": "text/plain" } }),
  );
}

async function readCachedToken(env: AppleEnv): Promise<string | null> {
  const edge = await caches.default.match(new Request(TOKEN_CACHE_URL));
  if (edge) {
    const t = await edge.text();
    if (t) return t;
  }
  if (!env.SYNC) return null;
  const fromKv = await env.SYNC.get(TOKEN_KV_KEY);
  // Backfill the edge on a KV hit. Without this the edge copy is only ever written by
  // a *scrape* — which happens roughly weekly — so every request in between paid a KV
  // read: measured 2026-08-20 at ~112k SYNC reads/day, essentially one per
  // /api/suggest call, the busiest endpoint in the app. The edge entry is per-POP and
  // costs nothing to rewrite, and a stale-by-an-hour token is harmless (the real
  // lifetime is ~84 days, and `ampGet` force-refreshes on the one 401 that matters).
  if (fromKv) await writeEdgeToken(fromKv).catch(() => {});
  return fromKv;
}

async function writeCachedToken(env: AppleEnv, token: string): Promise<void> {
  await writeEdgeToken(token);
  if (env.SYNC) await env.SYNC.put(TOKEN_KV_KEY, token, { expirationTtl: TOKEN_TTL });
}

async function scrapeToken(): Promise<string | null> {
  const resp = await timedFetch(TOKEN_PAGE, 8000, { "User-Agent": UA, Accept: "text/html" });
  if (!resp || !resp.ok) return null;
  const html = await resp.text();
  // The token lives in a URL-encoded shoebox blob, so it survives a raw regex scan.
  return html.match(JWT_RE)?.[0] ?? null;
}

export interface AppleEnv {
  SYNC?: KVNamespace;
}

async function getToken(env: AppleEnv, forceRefresh = false): Promise<string | null> {
  if (!forceRefresh) {
    const cached = await readCachedToken(env);
    if (cached) return cached;
  }
  const fresh = await scrapeToken();
  if (fresh) await writeCachedToken(env, fresh).catch(() => {});
  return fresh;
}

/**
 * amp-api GET with a single token refresh on 401. Returns null on any failure —
 * every caller has a non-amp fallback, so an Apple outage degrades rather than 502s.
 */
async function ampGet<T>(env: AppleEnv, path: string): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken(env, attempt > 0);
    if (!token) return null;
    const resp = await timedFetch(`${AMP_BASE}/${path}`, 8000, {
      Authorization: `Bearer ${token}`,
      Origin: "https://books.apple.com",
      "User-Agent": UA,
      Accept: "application/json",
    });
    if (!resp) return null;
    if (!resp.ok) {
      await resp.body?.cancel(); // release the slot; we never read an error body
      // A rotated token is the one failure worth retrying; anything else is terminal.
      if (resp.status === 401 && attempt === 0) continue;
      return null;
    }
    try {
      return (await resp.json()) as T;
    } catch {
      return null;
    }
  }
  return null;
}

// ---- charts ------------------------------------------------------------------

interface AmpChartResponse {
  results?: Record<string, { chart: string; data: { id: string; attributes: Record<string, unknown> }[] }[]>;
}

interface RssResponse {
  feed?: { results?: { id: string; name: string; artistName: string; artworkUrl100?: string; releaseDate?: string; genres?: { name: string }[] }[] };
}

function fromAmp(entry: { id: string; attributes: Record<string, unknown> }): AppleBook | null {
  const a = entry.attributes || {};
  const title = typeof a.name === "string" ? a.name : "";
  if (!title) return null;
  const art = a.artwork as { url?: string } | undefined;
  return {
    id: entry.id,
    title,
    author: typeof a.artistName === "string" ? a.artistName : "",
    cover: artwork(art?.url),
    genres: Array.isArray(a.genreNames) ? (a.genreNames as string[]).filter((g) => g !== "Books") : [],
    releaseDate: typeof a.releaseDate === "string" ? a.releaseDate : "",
  };
}

/**
 * Top books for a genre ("" = overall). amp-api first (it's the only source that can
 * do genres); the official RSS feed backfills the overall chart if amp-api is down.
 * Audiobooks are deliberately not requested — Bookracy doesn't serve them.
 */
export async function fetchChart(env: AppleEnv, genreId: string, limit: number): Promise<AppleBook[]> {
  const capped = Math.min(Math.max(limit, 1), 50);
  const params = new URLSearchParams({ types: "books", chart: "top-paid", limit: String(capped) });
  if (genreId) params.set("genre", genreId);

  const amp = await ampGet<AmpChartResponse>(env, `${STOREFRONT}/charts?${params.toString()}`);
  const charts = amp?.results?.books ?? [];
  const paid = charts.find((c) => c.chart === "top-paid") ?? charts[0];
  const items = (paid?.data ?? []).map(fromAmp).filter((b): b is AppleBook => b !== null);
  if (items.length) return items;

  // amp-api unavailable. The public feed can only do the overall chart, so a genre
  // request degrades to nothing rather than silently showing the wrong chart.
  if (genreId) return [];

  const rss = await getJson<RssResponse>(`${RSS_BASE}/${STOREFRONT}/books/top-paid/${capped}/books.json`, 8000, {
    "User-Agent": UA,
    Accept: "application/json",
  });
  return (rss?.feed?.results ?? [])
    .filter((r) => r?.name)
    .map((r) => ({
      id: r.id,
      title: r.name,
      author: r.artistName || "",
      // The feed only offers a fixed 100px asset; widen it via the same path convention.
      cover: (r.artworkUrl100 || "").replace(/\/100x100bb\.(png|jpg)$/, "/400x640bb.jpg"),
      genres: (r.genres ?? []).map((g) => g.name).filter((g) => g !== "Books"),
      releaseDate: r.releaseDate || "",
    }));
}

// ---- search + metadata -------------------------------------------------------

interface AmpSuggestResponse {
  results?: { suggestions?: { displayTerm?: string; searchTerm?: string; kind?: string }[] };
}

interface AmpSearchResponse {
  results?: { books?: { data?: { id: string; attributes: Record<string, unknown> }[] } };
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Unofficial companions ("Summary of…", "Conversation Starters on…", study guides)
// are rampant on the store and match a bare title search perfectly. They're never
// what the caller meant.
const COMPANION_RE = /\b(summary|analysis|study guide|conversation starters|workbook|companion|key takeaways|abstract|sidekick|instaread|blinkist)\b/i;

/**
 * Strip the cataloguing debris libgen/AA bake into record titles, so what we send the
 * store is something the store can actually match.
 *
 * Real examples from `/api/trending`:
 *   "yi 127011 9780063458819 The Secrets We Hide - Karin Slaughter"
 *   "g1 127014 9781668065945 Choke Point - Brad Thor"
 * The leading shelf-code/id/ISBN run is pure noise to a search engine, and it is enough
 * to sink the query outright — "Choke Point" found nothing with the prefix attached and
 * matched immediately without it. The trailing " - Author" is a duplicate of the author
 * we already pass separately.
 *
 * Deliberately conservative: each rule only fires on a shape that is unambiguously
 * catalogue noise, and we keep the original if stripping would leave nothing.
 */
export function cleanBookTitle(title: string, author = ""): string {
  let t = title.trim();
  // "<shelf> <id> <isbn> " — shelf codes are alphanumeric ("yi", "fn", but also "g1"),
  // and the ISBN is optional. The `\d{2,}` run is what keeps this from eating the first
  // word of a real title; a title starting with a digit ("1984") can't match at all.
  t = t.replace(/^[a-z][a-z0-9]{0,2}\s+\d{2,}\s+(?:\d{9,12}[\dxX]\s+)?/i, "");
  // Trailing " - Author" / " by Author" repeating the author we already have.
  if (author) {
    const a = author.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`\\s*[-—–]\\s*${a}\\s*$`, "i"), "");
    t = t.replace(new RegExp(`\\s*\\bby\\s+${a}\\s*$`, "i"), "");
  }
  // Trailing edition/format parenthetical: "(2010, Thomas Nelson)", "(retail)", "(epub)".
  t = t.replace(/\s*\((?:\d{4}[^)]*|retail|epub|pdf|azw3|mobi)\)\s*$/i, "");
  const cleaned = t.trim();
  return cleaned.length >= 2 ? cleaned : title.trim();
}

/**
 * Does an Apple catalogue title match what we asked for?
 *
 * `name.includes(key)` — the store's title is ours plus a subtitle — is always safe.
 * The reverse (`key.includes(name)`) accepts an entry whose title is a *truncation* of
 * our query, and that only stays honest because the caller's author check rejects the
 * near-misses it lets through. With no author there is no such check, and a short
 * generic store title swallows a specific query.
 *
 * Measured 2026-08-20: "Watchmen 09" resolved to a third-party study guide named
 * "Watchmen", and a run of distinct Avengers issues all resolved to one Marvel
 * collection — five different comics sharing one cover, which is the §9.2 poisoning
 * shape again. Comics are where this bites: libgen leaves their author blank and
 * `coverQuery` drops "Unknown Author", so every comic reaches Apple authorless. No
 * cover beats a confidently wrong one.
 *
 * Both arguments must already be `normalize`d.
 */
export function appleTitleMatches(key: string, name: string, hasAuthor: boolean): boolean {
  if (name.includes(key)) return true;
  return hasAuthor && key.includes(name);
}

/**
 * Best Apple match for a title+author, used to give covers and ratings to books from
 * sources with no artwork of their own (the prize index) and to enrich search results.
 *
 * Title matching is deliberately loose on the leading clause — subtitles diverge
 * constantly between editions — so the author is what keeps it honest: without that
 * check, "Evicted" happily resolves to a third-party study guide about Evicted.
 */
export async function findBook(env: AppleEnv, rawTitle: string, author: string): Promise<AppleMeta | null> {
  // Clean once, then use it for BOTH the query and the match key — a term the store
  // can't parse and a key full of catalogue digits fail in different ways, and fixing
  // only one of them still misses.
  const title = cleanBookTitle(rawTitle, author);
  const term = `${title} ${author}`.trim().slice(0, 180);
  if (!term) return null;
  // `extend` is the difference between a thin record and the full one. By default
  // amp-api's search response omits `description` entirely — every result came back
  // `desc=0ch`, which is why every card read "No summary available".
  //
  // Measured against `/books/{id}` (the per-book endpoint, 27 attributes): extending
  // the *search* call returns 14 of the 15 fields we'd want, so the rich record costs
  // one query parameter rather than a second round trip per book. `pageCount` is the
  // one that has to be named explicitly; the rest ride along with `description`.
  const params = new URLSearchParams({
    term,
    types: "books",
    limit: "8",
    extend: "description,seriesInfo,pageCount,subtitle,primaryLocale,editorialNotes",
  });
  const data = await ampGet<AmpSearchResponse>(env, `${STOREFRONT}/search?${params.toString()}`);
  const rows = data?.results?.books?.data ?? [];
  if (!rows.length) return null;

  const key = normalize(title.split(":")[0]);
  if (key.length <= 3) return null;
  // Tokens long enough to be distinctive; initials and particles ("de", "van") aren't.
  const authorTokens = normalize(author)
    .split(" ")
    .filter((t) => t.length >= 3);

  const titleMatches = rows.filter((r) => {
    const raw = String((r.attributes || {}).name ?? "");
    if (COMPANION_RE.test(raw)) return false;
    return appleTitleMatches(key, normalize(raw), authorTokens.length > 0);
  });
  if (!titleMatches.length) return null;

  // With an author to check, insist on it. Without one, the filter above has already
  // been tightened to full containment, so the store's top-ranked match is trustworthy.
  if (!authorTokens.length) return toMeta(titleMatches[0]);
  const byAuthor = titleMatches.find((r) => {
    const blob = normalize(String((r.attributes || {}).artistName ?? ""));
    return authorTokens.some((t) => blob.includes(t));
  });
  return byAuthor ? toMeta(byAuthor) : null;
}

/**
 * Apple's `description.standard` is a publisher-supplied **HTML fragment**, not text —
 * `<b>`, `<i>`, `<br />` and character references all arrive as-is. Flatten it once,
 * here at the source, so every consumer (the web cards, `/api/metadata`, the Kindle
 * client) gets the same clean string instead of each re-deriving one.
 *
 * Entities are decoded in a **single pass** over `&…;`. Decoding named entities in
 * sequence is the classic way to get this wrong: replacing `&amp;` first rewrites a
 * literal `&amp;lt;` into `&lt;`, which the next replacement then turns into `<`.
 * One pass can't double-decode.
 *
 * Numeric references are the ones that actually bit us. Apple separates its blurb
 * clauses with `&#xa0;*&#xa0;`, and a decoder that only knows the six common *named*
 * entities renders that literally — "BESTSELLER&#xa0;*&#xa0;The multimillion-copy…"
 * was on the live cards. NBSP is folded to a normal space so the text still wraps.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "\u2014", ndash: "\u2013", hellip: "\u2026", middot: "\u00b7", bull: "\u2022",
  lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201c", rdquo: "\u201d", trade: "\u2122",
  copy: "\u00a9", reg: "\u00ae", deg: "\u00b0", eacute: "\u00e9", laquo: "\u00ab", raquo: "\u00bb",
};

export function htmlToPlainText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, ref: string) => {
      if (ref[0] === "#") {
        const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
        // Reject NUL, lone surrogates and anything past the Unicode ceiling — a bad
        // reference should survive as the text it already was, not throw.
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return match;
        // NBSP and its friends are indistinguishable from a space on screen but stop
        // the browser wrapping the line, so normalise them.
        if (code === 0xa0 || code === 0x2007 || code === 0x202f) return " ";
        return String.fromCodePoint(code);
      }
      return NAMED_ENTITIES[ref.toLowerCase()] ?? match;
    })
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toMeta(entry: { id: string; attributes: Record<string, unknown> }): AppleMeta {
  const a = entry.attributes || {};
  const art = a.artwork as { url?: string } | undefined;
  const rating = a.userRating as { value?: number; ratingCount?: number } | undefined;
  const desc = a.description as { standard?: string } | undefined;
  const editorial = a.editorialNotes as { standard?: string } | undefined;
  const series = a.seriesInfo as { seriesName?: string; sequenceDisplayLabel?: string; sequenceNumber?: number } | undefined;
  return {
    title: typeof a.name === "string" ? a.name : "",
    author: typeof a.artistName === "string" ? a.artistName : "",
    cover: artwork(art?.url, 600),
    // Publisher blurb first; Apple's own editorial note is a decent second when a
    // title has no publisher copy (common for older or self-published editions).
    description: htmlToPlainText(typeof desc?.standard === "string" && desc.standard ? desc.standard : (editorial?.standard ?? "")),
    rating: typeof rating?.value === "number" ? Math.round(rating.value * 10) / 10 : 0,
    ratingCount: typeof rating?.ratingCount === "number" ? rating.ratingCount : 0,
    pageCount: typeof a.pageCount === "number" ? a.pageCount : 0,
    publisher: typeof a.publisher === "string" ? a.publisher : "",
    isbn: typeof a.isbn === "string" ? a.isbn : "",
    releaseDate: typeof a.releaseDate === "string" ? a.releaseDate : "",
    genres: Array.isArray(a.genreNames) ? (a.genreNames as string[]).filter((g) => g !== "Books") : [],
    url: typeof a.url === "string" ? a.url : "",
    subtitle: typeof a.subtitle === "string" ? a.subtitle : "",
    seriesName: typeof series?.seriesName === "string" ? series.seriesName : "",
    seriesPosition:
      typeof series?.sequenceDisplayLabel === "string"
        ? series.sequenceDisplayLabel
        : typeof series?.sequenceNumber === "number"
          ? `Book ${series.sequenceNumber}`
          : "",
    locale: typeof a.primaryLocale === "string" ? a.primaryLocale : "",
  };
}

// ---- autocomplete ------------------------------------------------------------

// MZSearchHints answers a plist, not JSON. It's a flat, predictable document, so a
// regex over <key>term</key><string>…</string> pairs beats pulling in an XML parser.
const HINT_RE = /<key>term<\/key>\s*<string>([^<]*)<\/string>/g;

const unescapeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/**
 * Store search suggestions for a partial query.
 *
 * MZSearchHints needs no auth and is the better source when it answers — but it
 * answers by *caller*, not just by query. Measured 2026-08-14, same five prefixes,
 * same headers, same second: our Worker got **0 hints for every one**, a residential
 * connection got **10 for every one**. Apple is throttling the datacenter egress, and
 * since /api/suggest is the busiest endpoint in the app (~54k req/day) that had
 * quietly turned the whole autocomplete into a no-op.
 *
 * So hints is now best-effort and amp-api backstops it. amp-api is demonstrably
 * reachable from the Worker (it's what serves covers and metadata), and book *titles*
 * make honest autocomplete entries — arguably better ones, since every suggestion is
 * a real book rather than a raw search term.
 */
export async function suggest(env: AppleEnv, term: string, limit = 8): Promise<string[]> {
  const q = term.trim().slice(0, 100);
  if (q.length < 2) return [];

  const dedupe = (values: string[]): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of values) {
      const hint = raw.trim();
      const key = hint.toLowerCase();
      if (!hint || seen.has(key)) continue;
      seen.add(key);
      out.push(hint);
      if (out.length >= limit) break;
    }
    return out;
  };

  const url = `${HINTS_URL}?media=ebook&term=${encodeURIComponent(q)}`;
  // Without a storefront header Apple echoes the query back as the only "suggestion";
  // 143441 is the US store and the rest of this module is US-scoped too.
  const resp = await timedFetch(url, 4000, { "User-Agent": UA, Accept: "*/*", "X-Apple-Store-Front": "143441-1,29" });
  if (resp?.ok) {
    const xml = await resp.text();
    const hints = dedupe([...xml.matchAll(HINT_RE)].map((m) => unescapeXml(m[1])));
    if (hints.length) return hints;
  }

  // Hints gave us nothing usable. amp-api has its own autocomplete — `search/suggestions`
  // with `kinds=terms` returns actual search *terms* ("mistborn: secret history", "mistborn
  // the final empire"), which is the same shape MZSearchHints produces and a better
  // suggestion than a book title. It rides the token we already hold, and amp-api is the
  // surface Apple still answers for our egress.
  const sp = new URLSearchParams({ term: q, kinds: "terms", types: "books", limit: String(Math.min(limit * 2, 20)) });
  const sug = await ampGet<AmpSuggestResponse>(env, `${STOREFRONT}/search/suggestions?${sp.toString()}`);
  const terms = (sug?.results?.suggestions ?? [])
    .map((s) => String(s.displayTerm ?? s.searchTerm ?? ""))
    .filter((t) => t && t.toLowerCase() !== q.toLowerCase() && !COMPANION_RE.test(t));
  if (terms.length) return dedupe(terms);

  // Last resort — book titles from the catalogue search.
  const params = new URLSearchParams({ term: q, types: "books", limit: String(Math.min(limit * 2, 20)) });
  const data = await ampGet<AmpSearchResponse>(env, `${STOREFRONT}/search?${params.toString()}`);
  const names = (data?.results?.books?.data ?? [])
    .map((r) => String((r.attributes || {}).name ?? ""))
    .filter((n) => n && !COMPANION_RE.test(n));
  return dedupe(names);
}
