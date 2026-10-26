import { parseSearchHtml, parseLibgenSearch, libgenSearchUrl, isLibgenErrorPage, locatorTitle, libgenCoverPath, type LibgenCoverFields, parseLibgenFilePage, parseCoverUrl, parseLibgenUrl, parseLibraryLolUrl, parseIpfsCids, pickGutenbergFormat, gutenbergMatches, gutenbergSupportsExt, pickInternetArchiveFile, internetArchiveMatches, internetArchiveSupportsExt, titleAuthorMatch, rankBooks, parseGreatestBooks, parseTgbNext, parseReadingOrderMaster, parseReadingOrderIssues, parseFiveBooksList, parseFiveBooksInterview, parseStandardEbooksFeed, pickStandardEbooksFormat, standardEbooksSupportsExt, standardEbooksMatches, parseAaSlowDownloadPage, FB_BASE, type RawBook, type GreatestBook, type ReadingOrderEra } from "./parse";
import {
  getAlias,
  setAlias,
  isMirrorDown,
  markMirrorDown,
  markMirrorUp,
  getCachedAaMirrors,
  setCachedAaMirrors,
  extractAaHostsFromHtml,
  getCachedSearch,
  setCachedSearch,
  mirrorStrikes,
  BACKGROUND_PROBE_STRIKES,
  acquireLock,
  fetchableAaMirrors,
} from "./reliability";
import { inCompletionOrder } from "./concurrency";
import { resumableBody } from "./resumable";
import { shouldRetryResolution, type ResolveOutcome } from "./resolution";
import { safeFilename, attachmentDisposition, inlineDisposition } from "./filename";
import installScript from "./kindle/install.sh";
import clientScript from "./kindle/bookracy.sh";
import * as backup from "./storage/backup";
import type { BackupEnv, BackupJob } from "./storage/env";
import * as community from "./community";
import * as apple from "./apple";
import * as awards from "./awards";
import * as searchIndex from "./searchindex";
import * as takedown from "./takedown";
import md5Lib from "js-md5";

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

// Extends BackupEnv (BOOKS + optional BACKUPS/BACKUP_QUEUE + bot tokens), so the
// long-term backup layer degrades gracefully when its bindings/secrets are absent.
interface Env extends BackupEnv {
  RATE_LIMITER: RateLimiter;
  SYNC: KVNamespace;
  ACCOUNT_CREATE_LIMITER: RateLimiter;
  COVER_LIMITER: RateLimiter;
  SEARCH_LIMITER: RateLimiter;
  /** Bookshelf md5 resolution — generous, but bounded (see the router). */
  MD5_LIMITER?: RateLimiter;
  /** Apple metadata lookups — burst is set by cards on screen, not by intent. */
  METADATA_LIMITER?: RateLimiter;
  TURNSTILE_SECRET?: string;
  // Override for the public-facing origin in generated URLs (see fetch handler).
  PUBLIC_ORIGIN?: string;
  // Community uploads (optional → feature is inert when unbound, like the rest).
  DB?: D1Database;
  UPLOAD_LIMITER: RateLimiter;
  MAX_UPLOAD_BYTES?: string;
  MAX_COVER_BYTES?: string;
  // Moderation: set this secret to enable the /api/admin/* endpoints (X-Admin-Key).
  ADMIN_KEY?: string;
}

// Anna's Archive search/cover mirrors (failover, in order). .org/.se/.li/.pm are all
// dead in 2026 (registrar seizures + a squatter now hosts a JS-fingerprint challenge on
// .li that used to leak into cover/CID scrapes). AA rotates clearnet domains under legal
// pressure roughly every few months, so getAaMirrors() lazy-refreshes this seed list
// from a public tracker / AA's own /mirrors page (24h cache) — a fresh domain going live
// no longer needs a redeploy.
//
// State on 2026-09-15, measured from the Cloudflare edge: .gl/.pk/.gd all 302 into a
// DDoS-Guard 403 (datacenter egress; dark since 2026-08-13). They stay in the pool
// because a 403 is a cheap, well-behaved failure the circuit breaker handles, and if AA
// ever lifts the block the hourly background probe brings them back with no deploy.
// `.mx` was removed — it now redirects to `.is`, and BOTH are on the deny-list in
// reliability.ts (AA_UNFETCHABLE_HOSTS) because fetching them from a Worker terminates
// the calling request with platform error 1042. Don't re-add them.
const DEFAULT_AA_MIRRORS = [
  "https://annas-archive.gl",
  "https://annas-archive.pk",
  "https://annas-archive.gd",
];

// Currently-usable AA mirrors. Reads a 24h cache first (populated by whichever
// request first calls this after a cache miss); on cold cache, spawns a background
// refresh scraping the /mirrors page off every default host and returns the seed
// list immediately (never block a user request on the meta scrape). The refresh
// runs at most once per POP per day.
async function getAaMirrors(ctx?: ExecutionContext): Promise<string[]> {
  const cached = await getCachedAaMirrors();
  if (cached && cached.length) return cached;
  // Cold cache — schedule a refresh (fire-and-forget under waitUntil when available)
  // and serve the seed list to the current request. First-request latency is unchanged;
  // subsequent requests in the next 24h use the freshly-scraped pool.
  const refresh = refreshAaMirrors().catch(() => {});
  if (ctx) ctx.waitUntil(refresh);
  return DEFAULT_AA_MIRRORS;
}

// Refresh the AA mirror pool from the annas-archive.info status tracker — a public
// JSON API (60/min rate limit) that probes every AA mirror every 5 min. Way cleaner
// than scraping HTML: no JS challenges to dodge, no markup drift, and we get real
// uptime data so we can drop known-down mirrors from the pool immediately (skipped
// here on `status !== "up"`). Falls back to the /mirrors HTML scrape if the tracker
// is unreachable; falls back to DEFAULT_AA_MIRRORS if that fails too.
async function refreshAaMirrors(): Promise<void> {
  const pool = new Set<string>(DEFAULT_AA_MIRRORS);

  const api = (await fetchJsonTimed("https://annas-archive.info/api/mirrors", 6000)) as
    | { mirrors?: { url?: string; status?: string; project?: { slug?: string }; name?: string }[] }
    | null;
  const rows = api?.mirrors;
  if (Array.isArray(rows)) {
    for (const m of rows) {
      const url = (m.url || "").replace(/\/+$/, "");
      if (!/^https:\/\/annas-archive\.[a-z]{2,10}$/.test(url)) continue;
      if (m.status && m.status.toLowerCase() !== "up") continue;
      pool.add(url);
    }
  } else {
    // Tracker miss — fall back to scraping /mirrors off any seed host that answers.
    for (const base of DEFAULT_AA_MIRRORS) {
      const html = await fetchTextTimed(`${base}/mirrors`, 6000);
      if (!html || isAaChallengePage(html)) continue;
      for (const url of extractAaHostsFromHtml(html)) pool.add(url);
      break;
    }
  }
  const list = fetchableAaMirrors([...pool]);
  if (list.length) await setCachedAaMirrors(list);
}

// Library Genesis "Format 2" mirrors. Two jobs: (1) the download resolver — every
// one of these serves the real file via the ads.php -> get.php chain, so trying them
// in order makes downloads resilient to any single mirror being down; (2) the SEARCH
// source (parseLibgenSearch) now that every AA mirror is dark, since libgen md5s
// resolve on this same download path. (libgen.ee runs a different markup for its GET
// link, so it's queried via LIBGEN_RS_HOSTS below instead.)
//
// Order is by measured search latency FROM THE CLOUDFLARE EDGE, which is the only
// vantage point that matters and is not the one a laptop sees (from a laptop .la beat
// .li; from a Worker it's the other way round). Two novel queries per host, 2026-09-15:
// .li 1.5s/1.8s, .la 2.1s/2.6s, .gl 2.4s/6.1s, .bz 3.2s/5.2s, .vg 4.2s/5.1s. Search
// races the first two healthy hosts (see search()), so the order decides which pair
// gets asked and, for the serial chart path, who gets asked first.
const LIBGEN_MIRRORS = [
  "https://libgen.li",
  "https://libgen.la",
  "https://libgen.gl",
  "https://libgen.bz",
  "https://libgen.vg",
];

// The subset of the mirrors above that will actually serve a cover IMAGE.
//
// libgen hotlink-protects `/covers/` and `/comicscovers/`: without a `Referer` on the
// same host every mirror answers **200 with a zero-byte body**, which is not an error
// any status check would catch. Measured 2026-09-01 on one known-good cover path:
// with the Referer, .li/.vg/.bz return a real 3,317-byte JPEG; .la and .gl return 0
// bytes either way (both are Cloudflare-fronted and evidently strip it), so they are
// excluded rather than left to burn a request each.
// Ordered by json.php latency from the edge (2026-09-15): .li 0.34s, .bz 0.30s, .vg 1.2s.
const LIBGEN_COVER_MIRRORS = ["https://libgen.li", "https://libgen.bz", "https://libgen.vg"];

// Library Genesis ".rs" fork download hosts — a DIFFERENT database from the libgen.li
// family above, so it covers books the primary source is missing (and vice versa).
// Each serves an HTML `/main/<md5>` or `/fiction/<md5>` page whose "GET" link is the
// real file (parseLibraryLolUrl). This is download source #2.
const LIBGEN_RS_HOSTS = ["https://library.lol", "https://books.ms"];

// Public IPFS gateways (path style), tried in order. Anna's Archive exposes an IPFS
// CID for many files; when present we fetch it here. Best-effort by nature — public
// gateways rate-limit and unpinned CIDs 504 — so this is the last-resort source #3.
// (Cloudflare's gateway was retired in 2024 → not listed.)
const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs",
  "https://dweb.link/ipfs",
  "https://trustless-gateway.link/ipfs",
  "https://w3s.link/ipfs",
  "https://4everland.io/ipfs",
  "https://nftstorage.link/ipfs",
];

// Ordered download sources. The default ("auto") tries them in this order and streams
// the first that yields a real file; the frontend can also force one via `?source=`.
// gutenberg (public-domain classics via Gutendex) and internetarchive (archive.org
// public-domain scans — books, comics, magazines) sit before the flaky IPFS leg: for
// items that missed both libgen forks these are clean, reliable, legal copies. Both
// are keyed by the book's title/author (from the download URL), not md5. libgensearch
// is the copyrighted-work equivalent — when an exact md5 (often from a z-lib upload
// libgen never mirrored) misses, search libgen by title+author and serve a different
// md5 of the same work, so books that visibly exist on AA don't 404 just because the
// clicked md5 came from a source outside libgen's DB.
const DOWNLOAD_SOURCES = [
  "libgenli",         // exact-md5, raced with librarylol
  "librarylol",       // exact-md5, raced with libgenli
  "standardebooks",   // metadata, curated PD EPUBs (best quality)
  "gutenberg",        // metadata, PD variety
  "internetarchive",  // metadata, PD scans
  "libgensearch",     // metadata, ANY copyright (the copyrighted-work fallback)
  "ipfs",             // exact-md5 via AA CID (best-effort, ~40% hit)
  "aa_slow",          // exact-md5 via AA slow_download queue (30-60s wait but ~always works)
] as const;
type DownloadSource = (typeof DOWNLOAD_SOURCES)[number];
function isDownloadSource(s: string | null | undefined): s is DownloadSource {
  return !!s && (DOWNLOAD_SOURCES as readonly string[]).includes(s);
}

const AVAILABLE_LANGUAGES = new Set([
  "en", "ru", "de", "es", "it", "zh", "fr", "hu", "ja", "pt", "la", "hi", "nl", "lb", "bn", "ur",
  "id", "ar", "el", "he", "ko", "zxx", "bg", "pl", "fa", "ta", "af", "tr", "uk", "kn", "sv", "da",
  "ro", "vi", "fil", "sa", "ml", "mr", "cs", "hr", "grc", "sr", "ndl", "ga", "fi", "ca", "cy", "lv",
  "jv", "bo", "lt", "cu", "be", "sce", "kk", "no", "mn", "ka", "sl", "eo", "sk", "gl", "rw", "gu",
  "et", "az", "sve", "ms",
]);

// Fallback bestseller list. Trending is normally driven live off the Apple Books
// charts (see fetchTrendingTitles); this only runs if every Apple surface is
// unreachable, so the homepage is never empty.
const TRENDING_TITLES = [
  "The Hunger Games Sunrise on the Reaping",
  "Onyx Storm Rebecca Yarros",
  "Dungeon Crawler Carl",
  "Project Hail Mary Andy Weir",
  "Fourth Wing Rebecca Yarros",
  "The Way of Kings Brandon Sanderson",
  "All Systems Red Murderbot",
  "Mistborn The Final Empire",
];

// How many chart entries we ask Apple for, and how many survivors we actually show.
// Each entry costs an AA search on a cold cache, so this is the main cost knob for the
// homepage. ~90% of chart titles resolve to a real book and the confident-match filter
// in resolveChart drops a few more, so we over-fetch slightly to keep the shelf full.
const CHART_SIZE = 24;
const CHART_SHELF_SIZE = 18;
const CHART_RESOLVE_CONCURRENCY = 6;

// Bumped whenever the *meaning* of a trending response changes, so a deploy doesn't
// keep serving hours-old entries built by the previous logic. (v3 = `book_image` now
// carries title/author so covers can resolve via Apple; v2 = live Apple Books charts;
// v1 was a hardcoded title list.)
//
// Trending caches the whole *response* for 6h, so a change to the URLs inside it is
// invisible until this bumps — unlike search, which caches parsed rows and rebuilds
// every link on the way out.
const CHART_CACHE_VERSION = "v4";

// Per-host budget for the upstream *page* fetches on the read paths (search, covers,
// the recent feed). Downloads already bound every leg; these didn't, so a single
// mirror that accepted the connection and then stalled would hang the request until
// the runtime gave up — on the hottest endpoint in the app. Generous enough for a
// legitimately slow-but-working mirror (they normally answer in 1-3s), short enough
// that failing over to the next host is always faster than waiting.
const UPSTREAM_SEARCH_TIMEOUT_MS = 8000;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const HEADERS = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};
const DL_HEADERS = { ...HEADERS, Referer: "https://libgen.li/" };

const MIME_BY_EXT: Record<string, string> = {
  ".epub": "application/epub+zip",
  ".pdf": "application/pdf",
  ".mobi": "application/x-mobipocket-ebook",
  ".azw3": "application/vnd.amazon.ebook",
  ".azw": "application/vnd.amazon.ebook",
  ".cbz": "application/vnd.comicbook+zip",
  ".cbr": "application/vnd.comicbook-rar",
  ".djvu": "image/vnd.djvu",
  ".txt": "text/plain",
};

// Book-ish file types accepted for community uploads.
const UPLOAD_EXT_ALLOW = new Set(["epub", "pdf", "mobi", "azw3", "azw", "cbz", "cbr", "djvu", "txt", "fb2", "rtf", "doc", "docx"]);

// ---- Cheap content guard (NOT a virus scanner) -------------------------------
// Reject files whose leading bytes look like a program (a disguised .exe renamed
// .epub, etc.) and sanity-check the common container formats. Real malware scanning
// of valid-but-hostile ebooks needs an external AV (ClamAV/VirusTotal) — see notes.
function bytesStartWith(head: Uint8Array, sig: number[]): boolean {
  if (head.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (head[i] !== sig[i]) return false;
  return true;
}
const EXECUTABLE_SIGNATURES: number[][] = [
  [0x4d, 0x5a], // MZ — Windows PE (.exe/.dll/.scr)
  [0x7f, 0x45, 0x4c, 0x46], // \x7FELF — Linux ELF
  [0xfe, 0xed, 0xfa, 0xce], // Mach-O 32
  [0xfe, 0xed, 0xfa, 0xcf], // Mach-O 64
  [0xcf, 0xfa, 0xed, 0xfe], // Mach-O 64 LE
  [0xca, 0xfe, 0xba, 0xbe], // Mach-O universal / Java class
  [0x23, 0x21], // #! — script shebang
];
function isAllowedBookBytes(head: Uint8Array | null, ext: string): boolean {
  if (!head || head.length === 0) return false;
  if (EXECUTABLE_SIGNATURES.some((s) => bytesStartWith(head, s))) return false;
  const zip = bytesStartWith(head, [0x50, 0x4b, 0x03, 0x04]) || bytesStartWith(head, [0x50, 0x4b, 0x05, 0x06]);
  switch (ext) {
    case "epub":
    case "cbz":
    case "docx":
      return zip; // these are ZIP containers
    case "pdf":
      return bytesStartWith(head, [0x25, 0x50, 0x44, 0x46]); // %PDF
    case "cbr":
      return bytesStartWith(head, [0x52, 0x61, 0x72, 0x21]) || zip; // Rar! (or zip-as-cbr)
    default:
      return true; // mobi/azw/azw3/djvu/rtf/doc/txt/fb2 — exec check above is the guard
  }
}
// Default upload size cap (~Cloudflare's request-body ceiling); overridable via var.
const DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_COVER_BYTES = 5 * 1024 * 1024;

function maxUploadBytes(env: Env): number {
  const n = parseInt(env.MAX_UPLOAD_BYTES || "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_UPLOAD_BYTES;
}

function maxCoverBytes(env: Env): number {
  const n = parseInt(env.MAX_COVER_BYTES || "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_COVER_BYTES;
}

// Human-friendly size string (e.g. "1.4 MB") for upload listings.
function formatBytes(n: number): string {
  if (!n || n <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 || v >= 10 ? 0 : 1)} ${units[i]}`;
}

// Only reflect CORS for our own frontend (any *.bookracy.com) + local dev.
function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  try {
    const host = new URL(origin).hostname;
    if (host === "bookracy.com" || host.endsWith(".bookracy.com") || host === "localhost" || host === "127.0.0.1") {
      return origin;
    }
  } catch {
    /* malformed Origin header */
  }
  return null;
}

// Re-wrap a response with the right CORS headers. Building a fresh Response keeps
// this safe for streamed bodies and immutable (cached) responses alike.
function applyCors(resp: Response, request: Request): Response {
  const headers = new Headers(resp.headers);
  const origin = allowedOrigin(request.headers.get("Origin"));
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.append("Vary", "Origin");
  }
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "*");
  // Content-Disposition isn't CORS-safelisted, so the frontend can only read it when
  // we explicitly expose it. The download-queue relies on it to detect the effective
  // filename when libgensearch's format-mismatch redirect served a different ext than
  // the URL asked for (so a `.pdf` click that resolved to `.epub` saves as `.epub`).
  headers.set("Access-Control-Expose-Headers", "Content-Disposition, Content-Length");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

async function fetchText(url: string, headers: Record<string, string> = HEADERS): Promise<string> {
  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`${resp.status} for ${url}`);
  return await resp.text();
}

// Time-boxed fetch that never throws (null on failure/timeout). The caller owns the
// body — cancel it if you don't read it.
async function fetchWithTimeout(url: string, ms: number, headers: Record<string, string> = HEADERS): Promise<Response | null> {
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

// Like fetchText but time-boxed and non-throwing (null on any failure/timeout), so we
// can scrape flaky download-page hosts (library.lol / AA md5 page) without stalling.
// `signal` lets a caller racing several hosts abort the losers the moment one wins, so
// their connection slots are freed instead of held until the slower page finishes.
async function fetchTextTimed(url: string, ms: number, headers: Record<string, string> = HEADERS, signal?: AbortSignal): Promise<string | null> {
  if (signal?.aborted) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  signal?.addEventListener("abort", () => ctrl.abort(), { once: true });
  try {
    const resp = await fetch(url, { headers, signal: ctrl.signal });
    if (!resp.ok) {
      // A non-2xx we don't read still holds one of the isolate's six concurrent
      // connection slots until the runtime notices and cancels it — logged on prod as
      // "A stalled HTTP response was canceled to prevent deadlock", twelve times on a
      // single cold /api/trending rebuild (2026-09-14). That rebuild runs six searches
      // at once, and each search walked four Anna's Archive hosts that now answer a
      // 302 into a DDoS-Guard 403: two dozen unread error bodies fighting for six
      // slots. Draining the body ourselves frees the slot the moment we give up on it.
      await resp.body?.cancel();
      return null;
    }
    return await resp.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Time-boxed JSON fetch (null on failure/timeout/parse error), for JSON APIs like Gutendex.
async function fetchJsonTimed(url: string, ms: number): Promise<unknown> {
  const text = await fetchTextTimed(url, ms, { ...HEADERS, Accept: "application/json" });
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function fileExt(filetype: string): string {
  const ft = (filetype || "").toLowerCase();
  return ft && ft !== "unknown filetype" && /^[a-z0-9]{1,6}$/.test(ft) ? `.${ft}` : "";
}

// Title/author query for a /cover/ link. Kept short: these ride on every result in
// every search response, and Apple's own matcher truncates well before this anyway.
function coverQuery(title: string, author: string): string {
  const p = new URLSearchParams();
  if (title) p.set("title", title.slice(0, 120));
  if (author && author !== "Unknown Author") p.set("author", author.slice(0, 80));
  const q = p.toString();
  return q ? `?${q}` : "";
}

function toBookItem(raw: RawBook, origin: string) {
  const ext = fileExt(raw.book_filetype);
  // Libgen's comic and manga uploads (and some scan collections) ship with the file
  // extension baked into the record's title (e.g. "Watchmen 001.cbr", "Thor - Son of
  // Asgard (2004).cbr"). Appending .cbr again would give us "Watchmen 001.cbr.cbr"
  // in the URL and, worse, in the browser save dialog — many comic readers refuse to
  // open files with an unrecognised double extension. Strip a matching trailing ext
  // from the title before we append our own so the served filename is always clean.
  const titleWithoutExt = ext
    ? raw.title.replace(new RegExp(`\\${ext}$`, "i"), "")
    : raw.title;
  const safeTitle = titleWithoutExt.replace(/[\\/]+/g, "-");
  // Carry the author on the download link so the metadata-keyed sources (Gutenberg) can
  // find the same work when the exact-md5 sources miss. Harmless to the md5-keyed sources.
  const authorQuery = raw.author && raw.author !== "Unknown Author" ? `?author=${encodeURIComponent(raw.author)}` : "";

  return {
    id: 0,
    title: raw.title,
    author: raw.author,
    md5: raw.md5,
    link: `${origin}/download/${raw.md5}/${encodeURIComponent(safeTitle)}${ext}${authorQuery}`,
    // Carry title/author on the cover link too, for the same reason as the download
    // link: they let handleCover fall back to a metadata-keyed source (Apple) when the
    // md5-keyed one (Anna's Archive) can't be reached. Both are optional — an older
    // client that requests a bare /cover/<md5>/thumbnail.jpg still resolves via AA/R2.
    book_image: `${origin}/cover/${raw.md5}/thumbnail.jpg${coverQuery(raw.title, raw.author)}`,
    book_filetype: ext ? ext.slice(1) : "",
    book_lang: raw.book_lang,
    book_size: raw.book_size,
    book_length: "",
    description: raw.description,
    publisher: "",
    year: raw.book_year,
    series: "",
    isbn: "",
    cid: "",
    external_cover_url: "",
    other_titles: raw.title,
  };
}

// Tab-separated line for the Kindle client (format=text): md5, ext, size, lang,
// author, title. Whitespace inside fields is collapsed so the tab delimiter and
// one-line-per-book contract always hold; the shell client parses it with `cut`.
function textLine(raw: RawBook): string {
  const ext = fileExt(raw.book_filetype);
  const extToken = ext ? ext.slice(1) : "";
  const clean = (s: string) => (s || "").replace(/[\t\r\n]+/g, " ").trim();
  return [raw.md5, extToken, clean(raw.book_size), clean(raw.book_lang), clean(raw.author), clean(raw.title)].join("\t");
}

function plain(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

// Serve a bundled shell script, injecting the live origin so the installed copy
// already points at this backend (works on the custom domain and in local dev).
function serveScript(script: string, origin: string): Response {
  return new Response(script.replace(/__API_URL__/g, origin), {
    headers: { "Content-Type": "text/x-shellscript; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}

// Anna's Archive search facets we pass through (validated). Lets the frontend add
// filter UI (filetype / content type / sort) later without a backend change.
const ALLOWED_SORT = new Set(["newest", "oldest", "largest", "smallest"]);
const ALLOWED_CONTENT = new Set([
  "book_nonfiction",
  "book_fiction",
  "book_comic",
  "book_unknown",
  "magazine",
  "musical_score",
  "standards_document",
  "journal_article",
  "other",
]);
const EXT_TOKEN = /^[a-z0-9]{1,8}$/;

interface SearchFilters {
  langs: string | null;
  ext: string | null;
  content: string | null;
  sort: string | null;
}
const NO_FILTERS: SearchFilters = { langs: null, ext: null, content: null, sort: null };

/**
 * Fold trivially-different spellings of the same query ("Dune", "  dune  ",
 * "dune\tmessiah") onto one upstream path. Both AA and libgen match case-insensitively,
 * so this changes nothing about the results — but the upstream path IS the search cache
 * key, so without it every casing variant forces its own scrape, which is exactly the
 * cheap trick a scraper would use to walk straight past the cache.
 */
function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

/** A bare md5 lookup — resolves a book you already have the id for, not a search. */
const MD5_QUERY = /^[a-f0-9]{32}$/i;

function searchPath(query: string, page: number, f: SearchFilters): string {
  const params = new URLSearchParams({ q: query });
  if (page && page !== 1) params.set("page", String(page));
  for (const lang of (f.langs || "").split(",")) {
    const l = lang.trim();
    if (l && AVAILABLE_LANGUAGES.has(l)) params.append("lang", l);
  }
  for (const e of (f.ext || "").split(",")) {
    const x = e.trim().toLowerCase();
    if (x && EXT_TOKEN.test(x)) params.append("ext", x);
  }
  for (const c of (f.content || "").split(",")) {
    const x = c.trim();
    if (x && ALLOWED_CONTENT.has(x)) params.append("content", x);
  }
  if (f.sort && ALLOWED_SORT.has(f.sort)) params.set("sort", f.sort);
  return `/search?${params.toString()}`;
}

/**
 * Resolve an md5 through libgen's `json.php` instead of scraping `file.php`.
 *
 * Why it exists: `json.php` is served straight off libgen's **MySQL** row, not the
 * Manticore search daemon on :9306 that went down on 2026-08-24, and it hands back
 * fields instead of a `<title>` string that has to be decoded by hand. It answers for
 * any md5 libgen holds, in ~1 KB rather than the ~315 KB `file.php` page.
 *
 * Why it is only a fallback, and not the primary resolver: the file record carries the
 * extension and size but **no title or author** — those live on the edition row, so a
 * full answer costs two sequential requests where `file.php` costs one. Doubling
 * per-lookup request count on the bookshelf path is the upstream amplification
 * MD5_LIMITER exists to prevent, and request count (not bytes) is what gets an egress IP
 * banned. Worse, the edition's title/author come back **empty for comics** — measured on
 * a Berserk artbook whose `file.php` title tag resolved perfectly — so for part of the
 * catalogue it is strictly the worse source.
 *
 * So `file.php` stays primary and this runs only when it yields nothing, which covers
 * both the slow-mirror timeout and the unparseable-title case. Neither source dominates
 * the other: one is small enough to survive a bad link, the other is the only one that
 * knows what a comic is called.
 */
async function resolveViaLibgenJson(base: string, md5: string): Promise<RawBook | null> {
  const file = (await fetchJsonTimed(`${base}/json.php?object=f&md5=${md5}&fields=extension,filesize,locator,editions`, UPSTREAM_SEARCH_TIMEOUT_MS)) as
    | Record<string, { extension?: string; filesize?: string; locator?: string; editions?: Record<string, { e_id?: string }> }>
    | null;
  if (!file || typeof file !== "object") return null;
  const rec = Object.values(file)[0];
  if (!rec || typeof rec !== "object") return null; // also rejects the {"error": …} shape

  const eId = Object.values(rec.editions || {})[0]?.e_id;
  const ed = eId
    ? ((await fetchJsonTimed(`${base}/json.php?object=e&ids=${encodeURIComponent(eId)}&fields=title,author,year,language`, UPSTREAM_SEARCH_TIMEOUT_MS)) as
        | Record<string, { title?: string; author?: string; year?: string; language?: string }>
        | null)
    : null;
  const meta = (ed && typeof ed === "object" ? Object.values(ed)[0] : null) || {};

  // Comics have no edition title (measured: a Berserk artbook returns "" for both title
  // and author), which is what made json.php useless for them. The file row still knows
  // the real name — `locator` is the archive path libgen stores it under — so fall back
  // to its basename, which is the same string file.php builds its <title> from.
  const title = meta.title || locatorTitle(rec.locator);
  if (!title) return null; // genuinely nothing to show; an untitled shelf row is worse

  const ext = (rec.extension || "").toLowerCase();
  const bytes = parseInt(rec.filesize || "", 10);
  return {
    md5: md5.toLowerCase(),
    title,
    author: meta.author || "Unknown Author",
    description: "",
    book_lang: meta.language || "Unknown Language",
    book_filetype: ext ? ext.toUpperCase() : "Unknown Filetype",
    book_size: Number.isFinite(bytes) && bytes > 0 ? formatBytes(bytes) : "Unknown Size",
    book_year: /^\d{4}$/.test(meta.year || "") ? String(meta.year) : "",
    book_content: "Unknown Content",
    book_source: "Library Genesis",
  };
}

// ---- Last-resort search: the public-domain sources -------------------------------
//
// AA and libgen are the catalogue; these are the fire extinguisher. On 2026-08-24 both
// went down at once — AA behind DDoS-Guard since 08-13, libgen's search daemon
// answering "Could not connect to the database 9306" — and with no third source
// /api/books returned "No results found" for *every* query. Site-wide, silently.
//
// Internet Archive and Gutenberg are already trusted enough to serve BYTES on the
// download path (sources #5 and #7); this only lets them answer the search that finds
// those bytes. Neither is a catalogue replacement — both are public-domain only, so a
// 2019 bestseller still won't appear — but "the classics still work" beats an empty page.
//
// Deliberately last: it runs only after every AA mirror AND every libgen mirror has
// failed or come back empty, so a healthy day is completely unaffected by it.
const PD_SOURCE_LIMIT = 25;

/**
 * A stable synthetic md5 for a result that has no libgen/AA md5 of its own.
 *
 * Safe by construction, because the download and cover paths are already hardened
 * against invented md5s (see "Stop letting a made-up md5 write whatever it likes into
 * R2"): metadata-keyed bytes stream to the user but never earn an `files/<md5>` key,
 * and Apple covers are stored under a title+author hash rather than the md5. So the
 * worst a synthetic id can do is fail to resolve — never poison a cache.
 *
 * Namespaced by source so two different works can't collide, and deterministic so the
 * same book keeps the same id across searches (bookmarks, share links, dedupe).
 */
function syntheticMd5(source: string, id: string): string {
  return md5Lib(`${source}:${id}`);
}

/** Internet Archive free-text search, restricted to what the download path can serve. */
async function searchInternetArchive(query: string): Promise<RawBook[]> {
  // Same three filters fetchFromInternetArchive applies, so anything surfaced here is
  // something that path can actually download: text items, not in copyright, not
  // lending-restricted. Surfacing a borrowable item would be a result that 404s on click.
  // Strip the Lucene metacharacters IA's parser chokes on before interpolating.
  const term = query.replace(/["\\()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!term) return []; // an empty term would leave a leading "AND" and 400 the query
  const q = `${term} AND mediatype:texts AND possible-copyright-status:NOT_IN_COPYRIGHT AND -access-restricted-item:true`;
  const fl = ["identifier", "title", "creator", "year", "language", "format"].map((f) => `fl[]=${f}`).join("&");
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&${fl}&rows=${PD_SOURCE_LIMIT}&output=json`;
  const res = (await fetchJsonTimed(url, UPSTREAM_SEARCH_TIMEOUT_MS)) as
    | { response?: { docs?: { identifier?: string; title?: string; creator?: string | string[]; year?: string; language?: string | string[]; format?: string | string[] }[] } }
    | null;
  const docs = res?.response?.docs;
  if (!Array.isArray(docs)) return [];

  const out: RawBook[] = [];
  for (const doc of docs) {
    if (!doc.identifier || !doc.title) continue;
    // `format` comes back as the item's whole file-format list, which lets us name a
    // real extension without a second /metadata/<id> round-trip per result. EPUB first
    // (reflows on a phone), else PDF for the scans.
    //
    // Skip an item offering neither rather than defaulting to PDF: the ext we publish
    // here is what the download link asks for, and naming one the item hasn't got sends
    // the user to a link that can only miss (or bounce through an alternate-ext 302).
    // pickInternetArchiveFile also matches on IA's `format` strings, so "no epub/pdf in
    // the list" genuinely means "nothing the download path could serve".
    const formats = (Array.isArray(doc.format) ? doc.format : [doc.format || ""]).map((f) => String(f).toLowerCase());
    const ext = formats.some((f) => f === "epub") ? "EPUB" : formats.some((f) => f.includes("pdf")) ? "PDF" : "";
    if (!ext) continue;
    const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";
    out.push({
      md5: syntheticMd5("ia", doc.identifier),
      title: doc.title,
      author: (Array.isArray(doc.creator) ? doc.creator.join(", ") : doc.creator) || "Unknown Author",
      description: "",
      book_lang: first(doc.language) || "Unknown Language",
      book_filetype: ext,
      book_size: "Unknown Size",
      book_year: /^\d{4}$/.test(doc.year || "") ? String(doc.year) : "",
      book_content: "Unknown Content",
      book_source: "Internet Archive",
    });
  }
  return out;
}

/**
 * Gutendex gets a tighter budget than every other upstream, because it is measurably
 * slower than all of them and it sits on the one path where latency is most visible.
 *
 * Measured 2026-09-01 over fresh (server-uncached) queries: **3.7s to 18s**, TTFB-bound,
 * i.e. gutendex's own compute rather than the network. At the shared 8s budget it timed
 * out on most calls while still charging the full 8 seconds for the privilege — and it
 * only ever runs when AA, libgen and `search_index` have ALL missed, which is exactly
 * the request that ends in `404 No results found`. Measured end to end on prod before
 * this: a search that finds nothing took **9.4-20.0s**, against 0.8-2.7s for one that
 * finds something (~3,500 of those a day).
 *
 * 5s keeps the fast half of gutendex — the half that was actually returning anything —
 * and cuts ~3s off every no-results search. Internet Archive answers in ~0.35s and runs
 * concurrently, so it is unaffected either way.
 */
const GUTENDEX_TIMEOUT_MS = 5000;

/** Project Gutenberg (via Gutendex) — public-domain only, always has a clean EPUB. */
async function searchGutenberg(query: string): Promise<RawBook[]> {
  // The trailing slash on `/books/` matters: without it gutendex answers 301 and the
  // whole (already slow) request is paid twice.
  const res = (await fetchJsonTimed(`https://gutendex.com/books/?search=${encodeURIComponent(query)}`, GUTENDEX_TIMEOUT_MS)) as
    | { results?: { id?: number; title?: string; copyright?: boolean | null; languages?: string[]; authors?: { name?: string }[]; formats?: Record<string, string> }[] }
    | null;
  const results = res?.results;
  if (!Array.isArray(results)) return [];

  const out: RawBook[] = [];
  for (const b of results.slice(0, PD_SOURCE_LIMIT)) {
    // `copyright: false` is the only value that means public domain — `true` and `null`
    // (unknown) both stay out, matching fetchFromGutenberg's rule exactly.
    if (b.copyright !== false || !b.title || b.id == null) continue;
    if (!pickGutenbergFormat(b.formats || {}, "epub")) continue; // nothing we could serve
    out.push({
      md5: syntheticMd5("gutenberg", String(b.id)),
      title: b.title,
      author: (b.authors || []).map((a) => a.name).filter(Boolean).join(", ") || "Unknown Author",
      description: "",
      book_lang: (b.languages || [])[0] || "Unknown Language",
      book_filetype: "EPUB",
      book_size: "Unknown Size",
      book_year: "",
      book_content: "Unknown Content",
      book_source: "Project Gutenberg",
    });
  }
  return out;
}

/**
 * Both public-domain sources, concurrently. Neither can fail the search: a throw or a
 * timeout on one just means the other's results stand, and two failures mean we return
 * [] exactly as before this existed.
 */
async function searchPublicDomain(query: string): Promise<RawBook[]> {
  const [ia, gutenberg] = await Promise.all([
    searchInternetArchive(query).catch(() => [] as RawBook[]),
    searchGutenberg(query).catch(() => [] as RawBook[]),
  ]);
  // Gutenberg first: a curated, correctly-typeset EPUB is a better read than an IA scan
  // of the same public-domain work, and rankBooks re-orders by relevance afterwards.
  const merged = [...gutenberg, ...ia];
  const seen = new Set<string>();
  return merged.filter((b) => !seen.has(b.md5) && seen.add(b.md5));
}

/**
 * A host whose down-window just lapsed is about to be re-probed. If it has only just
 * started failing, let the caller try it inline — that is how a mirror having a bad
 * minute gets trusted again quickly. If it has been failing for a solid run
 * (BACKGROUND_PROBE_STRIKES, see reliability.ts), take the probe off this user's
 * request: fire it under waitUntil, re-arm or clear the breaker for everyone after
 * them, and tell the caller to move on to the next source now.
 *
 * Why it matters: with the four Anna's Archive hosts dead behind DDoS-Guard since
 * 2026-08-13, every POP re-probed all four inline once an hour, and the 302 → 403 dance
 * measured 1.2s, 1.5s, 3.3s and 6s per host (2026-09-14). One search an hour per POP
 * paid ~12s for information every other request already had. Returns true when the
 * probe was handed off and the host should be skipped for this request.
 */
async function deferProbe(base: string, probeUrl: string, ctx?: ExecutionContext): Promise<boolean> {
  if (!ctx) return false;
  if ((await mirrorStrikes(base)) < BACKGROUND_PROBE_STRIKES) return false;
  ctx.waitUntil(
    (async () => {
      // One probe per host per POP at a time; the rest of the stampede just skips.
      if (!(await acquireLock(`mirror-probe/${new URL(base).host}`, 30))) return;
      const html = await fetchTextTimed(probeUrl, UPSTREAM_SEARCH_TIMEOUT_MS);
      // Unlike the inline loop, a challenge page counts as a failure here: the inline
      // path skips it without blame so one interstitial can't blind us to a healthy
      // mirror, but a host that has been dead for hours and now serves a wall is still
      // unusable, and leaving its strikes untouched would fire this probe on every
      // request until it answered properly.
      if (!html || isAaChallengePage(html) || isLibgenErrorPage(html)) {
        await markMirrorDown(base);
        return;
      }
      await markMirrorUp(base);
    })().catch(() => {}),
  );
  return true;
}

interface SearchOptions {
  /**
   * Ask the first two healthy libgen mirrors at once and take the first real answer.
   * On for interactive search, off for chart resolution — see LIBGEN_SEARCH_RACE_WIDTH.
   */
  raceLibgen?: boolean;
}

// How many libgen hosts an interactive search asks in parallel. Every mirror fronts the
// SAME database, so the first readable page is the answer and the rest are cancelled.
// From the edge the two fastest hosts answer in 1.5-2.6s but any one of them can take
// 6s+ on a given query (measured 2026-09-15), so a pair takes the *min* of two draws
// instead of paying the tail of one and only then trying the next. Cost: up to one
// extra (cancelled) request per uncached search — ~13k/day at current volume, which is
// under one request a second spread over five hosts. Chart resolution stays serial:
// it already runs six searches at once and the isolate has ~6 connection slots, so
// doubling its fan-out would only queue.
const LIBGEN_SEARCH_RACE_WIDTH = 2;

const notTakenDown = (b: RawBook) => !takedown.isTakenDown(b.md5, b.title, b.author);

// Filtered on the way out as well as on the way in: the edge cache and search_index can
// still hold rows written before a takedown.
async function search(query: string, page: number, filters: SearchFilters, ctx?: ExecutionContext, env?: Env, opts: SearchOptions = {}): Promise<RawBook[]> {
  return (await searchSources(query, page, filters, ctx, env, opts)).filter(notTakenDown);
}

async function searchSources(query: string, page: number, filters: SearchFilters, ctx?: ExecutionContext, env?: Env, opts: SearchOptions = {}): Promise<RawBook[]> {
  query = normalizeQuery(query);
  const path = searchPath(query, page, filters);

  // Scraping + parsing an AA results page is the Worker's single most expensive
  // operation, so serve a repeat of the same query from the edge instead.
  const cached = await getCachedSearch<RawBook>(path);
  if (cached) return cached;

  const store = (fetched: RawBook[]): RawBook[] => {
    const results = fetched.filter(notTakenDown);
    // Caching is an optimisation, never a correctness requirement — a failed write
    // must not surface as an unhandled rejection or fail the search.
    const write = setCachedSearch(path, results).catch(() => {});
    // Remember what a live source just told us. The edge cache above expires in 30
    // minutes and is per-datacenter; this is the durable, global copy that keeps these
    // books findable when the upstream that produced them is down (see searchindex.ts).
    const index = env ? searchIndex.remember(env, results).catch(() => {}) : Promise.resolve();
    if (ctx) {
      ctx.waitUntil(write);
      ctx.waitUntil(index);
    }
    return results;
  };

  for (const base of await getAaMirrors(ctx)) {
    if (await isMirrorDown(base)) continue; // circuit-broken, skip this pass
    if (await deferProbe(base, base + path, ctx)) continue; // long dead — probe it off-request
    const html = await fetchTextTimed(base + path, UPSTREAM_SEARCH_TIMEOUT_MS);
    if (!html) {
      // Timed out, refused, or non-2xx — all mean "don't send the next user here".
      await markMirrorDown(base);
      continue;
    }
    // An anti-bot interstitial is a 200 full of HTML that parses to zero results, so
    // without this check it looks exactly like "this mirror has no matches" and we'd
    // stop trusting a host that's actually fine. Skip it without blaming the mirror.
    if (isAaChallengePage(html)) continue;
    await markMirrorUp(base); // answered a real page — clear any accumulated backoff

    const results = parseSearchHtml(html);
    if (results.length) return store(results);
    // Empty but readable: keep trying the other mirrors. AA's full-text search almost
    // never returns nothing for a real query, so an empty page more likely means this
    // host's index is degraded than that the book doesn't exist.
  }

  // Every AA mirror failed/returned nothing → fall back to a direct Library Genesis
  // search. Its md5s resolve on the exact same download path, so results stay usable.
  // Filters/pagination differ upstream, so this only backstops the first page — enough
  // to keep search alive during an AA outage without pretending to honour facets.
  // Circuit-broken like the AA loop above. This used to walk every mirror unconditionally,
  // which was survivable while it was a rare backstop — but with AA unreachable it runs on
  // *every* uncached search, and a query with no matches walks the whole list. At an 8s
  // timeout per host that's a ~48s worst case, and libgen.bz/.li were both measured at
  // 16-20s during this outage. Skipping hosts we already know are timing out is the
  // difference between a slow search and an abandoned one.
  // A bare md5 is a *resolution*, not a search, and libgen's search index can't answer
  // it — `index.php?req=<md5>` returns the empty search form with a 200, which looks
  // exactly like "no matches". `file.php?md5=` resolves it directly off the same data
  // the download path uses, so anything downloadable is now also resolvable. This is
  // what keeps bookmarks, continue-reading and share links working without AA.
  if (page <= 1 && MD5_QUERY.test(query)) {
    // Local index first, and deliberately so. A bookmarked md5 is by definition one the
    // user already found through a search, so this is the *likely* case, not the
    // fallback — and it turns a ~2s libgen fetch into a ~10ms primary-key read. It also
    // removes most of the upstream amplification MD5_LIMITER exists to bound: a
    // 120-book shelf stops firing 120 real libgen requests every time its cache lapses.
    // Metadata can go stale (a title corrected upstream); for resolving a bookmark to a
    // download that is a trade worth making.
    if (env) {
      const known = await searchIndex.findByMd5(env, query);
      if (known) return [known];
    }

    // Same shared-database reasoning as the search fallback below: two mirrors agreeing
    // that they've never seen this md5 is as informative as six saying it, and an
    // unknown md5 (a bookmark whose book was pulled upstream) is common enough on a big
    // shelf that walking the full list on every one is real latency for no information.
    let cleanMisses = 0;
    for (const base of LIBGEN_MIRRORS) {
      if (cleanMisses >= 2) break;
      if (await isMirrorDown(base)) continue;
      if (await deferProbe(base, `${base}/file.php?md5=${query}`, ctx)) continue;
      const html = await fetchTextTimed(`${base}/file.php?md5=${query}`, UPSTREAM_SEARCH_TIMEOUT_MS);
      const book = html ? parseLibgenFilePage(html, query) : null;
      if (book) {
        await markMirrorUp(base);
        return store([book]);
      }

      // file.php didn't yield a book. Two different reasons land here, and json.php is
      // worth asking for both:
      //
      //  - It timed out. `file.php` is a ~315 KB page and the budget is 8s, so a mirror
      //    under load blows it: measured 2.2s from a laptop and >8s from the Worker on
      //    the same md5, which is why a book libgen definitely holds was 404ing. json.php
      //    returns the same record in ~1 KB, so it still completes on a link that slow.
      //  - It parsed to nothing. Usually a genuine "no such md5", but it is also what an
      //    unparseable title looks like: parseLibgenFilePage decodes a hand-written
      //    grammar out of the <title> tag and returns null rather than guess ("better no
      //    book than a wrong one"), silently dropping the book off the shelf.
      //
      // Both cost two small requests on a path that was otherwise about to give up.
      const viaJson = await resolveViaLibgenJson(base, query);
      if (viaJson) {
        await markMirrorUp(base);
        return store([viaJson]);
      }

      if (!html) {
        await markMirrorDown(base); // never answered at all — stop sending users here
        continue;
      }
      await markMirrorUp(base);
      // Answered, but has no record for this md5.
      cleanMisses++;
    }
    return [];
  }

  if (page <= 1) {
    // The libgen mirrors are frontends onto the SAME database, so a healthy one that
    // returns no matches is answering for all of them. Measured 2026-08-14 across
    // .la/.bz/.gl/.li/.vg: identical result counts on every query tried. Walking the
    // rest after the first clean miss just re-asks the same index and cost a ~9s median
    // on queries with no matches. Two agreeing misses is enough — the second only
    // guards against a mirror serving a degraded or partial index.
    //
    // NOTE: the 2026-08-14 run read "berserk"/"watchmen"/"attack on titan" as 0 results
    // everywhere and concluded libgen has no comics (HANDOFF §9.15). That was OUR bug,
    // not libgen's index — `parseLibgenSearch` was dropping every comic row (see the
    // md5 gate in parse.ts). The mirrors-agree reasoning above survives; the "libgen
    // has no manga" claim does not. Comics return ~25 rows per query as of 2026-08-20.
    let cleanMisses = 0;
    const candidates: string[] = [];
    for (const base of LIBGEN_MIRRORS) {
      if (await isMirrorDown(base)) continue;
      if (await deferProbe(base, libgenSearchUrl(base, query), ctx)) continue;
      candidates.push(base);
    }
    // Walk the healthy hosts in waves of `width`: one at a time on the chart path,
    // two at a time for a person waiting on a search box. Within a wave the answers
    // are handled in the order they land, and the first real result set cancels the
    // rest of the wave.
    const width = opts.raceLibgen ? LIBGEN_SEARCH_RACE_WIDTH : 1;
    for (let i = 0; i < candidates.length && cleanMisses < 2; i += width) {
      const wave = candidates.slice(i, i + width);
      const losers = new AbortController();
      const attempts = wave.map(async (base) => ({
        base,
        html: await fetchTextTimed(libgenSearchUrl(base, query), UPSTREAM_SEARCH_TIMEOUT_MS, HEADERS, losers.signal),
      }));
      for await (const { base, html } of inCompletionOrder(attempts)) {
        if (!html) {
          // A host we cancelled ourselves did nothing wrong; only a genuine failure
          // (timeout, refused, non-2xx) earns a strike.
          if (!losers.signal.aborted) await markMirrorDown(base);
          continue;
        }
        // A 200 carrying the search daemon's own error is not an answer about this book.
        // Treat it like any other failed host: back it off and ask the next one, WITHOUT
        // spending a clean miss — otherwise two overloaded mirrors end the search and we
        // report "no results" for a book libgen has.
        if (isLibgenErrorPage(html)) {
          await markMirrorDown(base);
          continue;
        }
        await markMirrorUp(base);
        // A readable page with no matches means this mirror is healthy and simply doesn't
        // have the book — never a reason to mark it down, or one obscure query would
        // blind us to the whole pool.
        const results = parseLibgenSearch(html);
        if (results.length) {
          losers.abort();
          return store(results);
        }
        cleanMisses++;
        if (cleanMisses >= 2) {
          losers.abort();
          break;
        }
      }
    }

    // Nothing from AA, nothing from libgen. Ask our own index before the public-domain
    // sources: it holds real upstream md5s, so its hits download through the ordinary
    // exact-md5 path and cover copyrighted works that Gutenberg/IA never will. Not
    // stored again — these rows came from here.
    if (env) {
      const remembered = await searchIndex.findByQuery(env, query, PD_SOURCE_LIMIT * 4);
      if (remembered.length) {
        const write = setCachedSearch(path, remembered).catch(() => {});
        if (ctx) ctx.waitUntil(write);
        return remembered;
      }
    }

    // Still nothing, and nothing remembered. Before answering 404, ask the public-domain
    // sources — they're independent of both, so they still answer when both are down.
    // Only reached on a genuine dead end, so on a normal day this costs nothing.
    const pd = await searchPublicDomain(query);
    if (pd.length) return store(pd);
  }

  return [];
}

// ---- Facets, applied locally ----------------------------------------------------
// Anna's Archive honoured `lang`/`ext`/`content`/`sort` upstream. libgen's search does
// not take any of them, and with AA dark since 2026-08-13 every search has been served
// by libgen — so for a month the "EPUB only" / "English" / "Newest" controls did nothing
// at all: `?ext=epub` returned PDFs and the reader button was missing from the cards.
// Filtering the parsed rows here is exact for ext, sort and content, and best-effort for
// language (a row whose language libgen doesn't state is kept, not dropped). Idempotent
// on rows that were already filtered upstream, so it costs nothing if AA returns.
const LANGUAGE_NAMES: Record<string, string[]> = {
  en: ["english"], ru: ["russian"], de: ["german"], es: ["spanish"], it: ["italian"], zh: ["chinese"], fr: ["french"],
  hu: ["hungarian"], ja: ["japanese"], pt: ["portuguese"], la: ["latin"], hi: ["hindi"], nl: ["dutch"], bn: ["bengali"],
  ur: ["urdu"], id: ["indonesian"], ar: ["arabic"], el: ["greek"], he: ["hebrew"], ko: ["korean"], bg: ["bulgarian"],
  pl: ["polish"], fa: ["persian", "farsi"], ta: ["tamil"], af: ["afrikaans"], tr: ["turkish"], uk: ["ukrainian"],
  kn: ["kannada"], sv: ["swedish"], da: ["danish"], ro: ["romanian"], vi: ["vietnamese"], fil: ["filipino", "tagalog"],
  sa: ["sanskrit"], ml: ["malayalam"], mr: ["marathi"], cs: ["czech"], hr: ["croatian"], grc: ["ancient greek"],
  sr: ["serbian"], ga: ["irish"], fi: ["finnish"], ca: ["catalan"], cy: ["welsh"], lv: ["latvian"], jv: ["javanese"],
  bo: ["tibetan"], lt: ["lithuanian"], be: ["belarusian"], kk: ["kazakh"], no: ["norwegian"], mn: ["mongolian"],
  ka: ["georgian"], sl: ["slovenian"], eo: ["esperanto"], sk: ["slovak"], gl: ["galician"], rw: ["kinyarwanda"],
  gu: ["gujarati"], et: ["estonian"], az: ["azerbaijani"], ms: ["malay"], th: ["thai"],
};

/** "12.4 MB" / "655 kB" / "1.1 GB" -> bytes, for the size sorts. Unknown -> 0. */
function sizeToBytes(size: string): number {
  const m = (size || "").match(/([\d.]+)\s*(tb|gb|mb|kb|b)?/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return 0;
  const unit = (m[2] || "b").toLowerCase();
  return n * (unit === "tb" ? 2 ** 40 : unit === "gb" ? 2 ** 30 : unit === "mb" ? 2 ** 20 : unit === "kb" ? 1024 : 1);
}

/** True when a query is written in a non-Latin script (Cyrillic, Greek, CJK, Arabic…). */
const NON_LATIN_QUERY_RE = /[^\u0000-\u024F\u1E00-\u1EFF]/;

function applyFacets(results: RawBook[], f: SearchFilters, query = ""): RawBook[] {
  let out = results;

  const exts = new Set((f.ext || "").split(",").map((e) => e.trim().toLowerCase()).filter((e) => e && EXT_TOKEN.test(e)));
  if (exts.size) out = out.filter((b) => exts.has((b.book_filetype || "").toLowerCase()));

  // AA's content facets map onto libgen's topics as far as they go: comics are the one
  // kind libgen labels distinctly; magazines and standards it doesn't carry at all.
  const contents = new Set((f.content || "").split(",").map((c) => c.trim()).filter((c) => c && ALLOWED_CONTENT.has(c)));
  if (contents.size) {
    const wantsComic = contents.has("book_comic");
    const wantsBook = [...contents].some((c) => c !== "book_comic");
    out = out.filter((b) => {
      const isComic = /comic|manga/i.test(b.book_content || "") || /^(cbz|cbr|cb7)$/i.test(b.book_filetype || "");
      return (wantsComic && isComic) || (wantsBook && !isComic);
    });
  }

  // Language is the lenient facet. The frontend sends the user's UI language ("en") on
  // every search, so a strict filter made every non-English book unreachable unless the
  // dropdown was changed first — a Russian title went from 83 results to 2 under the
  // default. Two escape hatches: a query written in a non-Latin script is its own
  // language statement and skips the facet; and a facet that would empty a non-empty
  // result set is dropped, because "No results found" for a book libgen has is the one
  // outcome worse than a few off-language rows.
  const langs = new Set((f.langs || "").split(",").map((l) => l.trim()).filter((l) => l && AVAILABLE_LANGUAGES.has(l)));
  if (langs.size && !NON_LATIN_QUERY_RE.test(query)) {
    const names = new Set([...langs].flatMap((l) => LANGUAGE_NAMES[l] ?? []));
    // Only drop a row that names a *different* language; "Unknown Language" stays,
    // because most of libgen's fiction rows carry no language at all.
    if (names.size) {
      const kept = out.filter((b) => {
        const lang = (b.book_lang || "").trim().toLowerCase();
        return !lang || lang === "unknown language" || names.has(lang);
      });
      if (kept.length) out = kept;
    }
  }

  if (f.sort && ALLOWED_SORT.has(f.sort)) {
    const year = (b: RawBook) => parseInt(b.book_year || "", 10) || 0;
    const size = (b: RawBook) => sizeToBytes(b.book_size);
    const cmp: Record<string, (a: RawBook, b: RawBook) => number> = {
      newest: (a, b) => year(b) - year(a),
      oldest: (a, b) => (year(a) || Infinity) - (year(b) || Infinity),
      largest: (a, b) => size(b) - size(a),
      smallest: (a, b) => (size(a) || Infinity) - (size(b) || Infinity),
    };
    out = [...out].sort(cmp[f.sort]);
  }
  return out;
}

async function handleSearch(url: URL, origin: string, env: Env, ctx: ExecutionContext): Promise<Response> {
  // The Kindle client asks for `format=text`: a dead-simple, one-line-per-book
  // payload it can parse with `cut` (no JSON tooling on the device).
  const asText = url.searchParams.get("format") === "text";

  const query = url.searchParams.get("query");
  if (!query) return asText ? plain("ERR\tmissing query\n", 400) : json({ error: "Please provide a search query" }, 400);
  const page = parseInt(url.searchParams.get("page") || "1", 10) || 1;
  const filters: SearchFilters = {
    langs: url.searchParams.get("langs") || url.searchParams.get("lang"),
    ext: url.searchParams.get("ext"),
    content: url.searchParams.get("content"),
    sort: url.searchParams.get("sort"),
  };

  // The community-uploads lookup hits D1 and the scrape hits Anna's Archive — nothing
  // connects them, so start both now and let the local query overlap the network one
  // instead of queueing behind it. Only page 1 shows uploads, and the text format
  // (Kindle client) doesn't render them at all.
  const communityLookup =
    page === 1 && !asText && community.communityEnabled(env)
      ? community.searchUploads(env, query, 12).catch((e) => {
          console.error("community search failed", e);
          return [];
        })
      : null;

  let results: RawBook[];
  try {
    results = await search(query, page, filters, ctx, env, { raceLibgen: true });
  } catch (e) {
    console.error("search failed", e);
    // Don't leave the in-flight D1 promise unhandled when we bail out early.
    void communityLookup;
    return asText ? plain("ERR\tsearch failed\n", 502) : json({ error: "Search failed" }, 502);
  }

  // Relevance re-rank (default order only): AA/libgen return loose full-text matches,
  // so promote the closest title/issue-number matches (fixes e.g. a comic "#1" query
  // surfacing collected "part five" editions). Skipped when the user picked an explicit
  // sort (respect it) or the query is a bare md5 (exact bookmark/lookup resolution).
  const trimmedQuery = query.trim();
  if (!MD5_QUERY.test(trimmedQuery)) results = applyFacets(results, filters, trimmedQuery);
  if (!filters.sort && !MD5_QUERY.test(trimmedQuery)) {
    results = rankBooks(trimmedQuery, results);
  }

  const limit = parseInt(url.searchParams.get("limit") || "", 10);
  if (limit > 0) results = results.slice(0, limit);

  if (asText) {
    // 200 with an empty body == no results, so the client can just count lines.
    const body = results.map(textLine).join("\n");
    return plain(body ? body + "\n" : "");
  }

  // Surface matching community uploads at the top of page 1 (deduped by md5, badged
  // with community:true so the frontend can mark them "User upload").
  const matches = (communityLookup ? await communityLookup : []).filter((c) => !takedown.isTakenDown(c.md5, c.title, c.author));
  const communityItems = matches.map((c) => ({ ...communityToBookItem(c, origin), community: true }));
  const seen = new Set(communityItems.map((c) => c.md5));
  const merged = [...communityItems, ...results.filter((r) => !seen.has(r.md5)).map((r) => toBookItem(r, origin))];

  if (!merged.length) return json({ message: "No results found" }, 404);
  return json({ results: merged });
}

// Titles to put on the homepage shelf, newest bestsellers first. Live from the Apple
// Books charts; the hardcoded list is only a floor for a total Apple outage.
async function fetchTrendingTitles(env: Env, genreId: string): Promise<{ title: string; author: string }[]> {
  const chart = await apple.fetchChart(env, genreId, CHART_SIZE).catch(() => []);
  if (chart.length) return chart.map((b) => ({ title: b.title, author: b.author }));
  // A genre chart has no sensible fallback — showing the overall bestsellers under a
  // "Science Fiction" heading would be a lie, so return nothing and let the UI say so.
  if (genreId) return [];
  return TRENDING_TITLES.map((t) => ({ title: t, author: "" }));
}

/**
 * Resolve chart entries to real Bookracy results, preserving chart order. Bounded
 * concurrency keeps a cold cache from firing a swarm of simultaneous AA scrapes.
 *
 * Taking AA's top hit verbatim is not good enough here: a bare chart title like
 * "Backtrack" or "Ransom" happily matches an unrelated magazine scan or a different
 * author's novel. So each result set is relevance-ranked and then confirmed with the
 * same title+author matcher the download fallbacks use — an entry we can't confidently
 * match is dropped rather than shown as the wrong book.
 */
async function resolveChart(entries: { title: string; author: string }[], origin: string, ctx: ExecutionContext, env: Env) {
  const resolved: (RawBook | undefined)[] = new Array(entries.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < entries.length) {
      const index = cursor++;
      const { title, author } = entries[index];
      const query = author ? `${title} ${author}` : title;
      const hits = await search(query, 1, NO_FILTERS, ctx, env).catch(() => [] as RawBook[]);
      if (!hits.length) continue;
      const ranked = rankBooks(query, hits);
      resolved[index] = author ? ranked.find((r) => titleAuthorMatch(title, author, r.title, r.author)) : ranked[0];
    }
  };
  await Promise.all(Array.from({ length: Math.min(CHART_RESOLVE_CONCURRENCY, entries.length) }, worker));

  const seen = new Set<string>();
  const items = [];
  for (const raw of resolved) {
    if (raw && !seen.has(raw.md5)) {
      seen.add(raw.md5);
      items.push(toBookItem(raw, origin));
    }
    if (items.length >= CHART_SHELF_SIZE) break;
  }
  return items;
}

// A shelf is served as built for CHART_FRESH_S (Apple's charts move daily, not hourly,
// and every rebuild is a burst of upstream searches). After that it is *still served*,
// for up to CHART_GRACE_S more, while a rebuild runs behind the response — so the only
// request that ever waits on a rebuild is the very first one a POP sees.
//
// This used to be a plain 6h entry: when it lapsed, whoever came next paid the whole
// rebuild inline. Measured on prod 2026-09-14: 25.4s wall time for one such request
// (24 chart titles resolved through a serial mirror walk each), which the homepage
// shows as a 25s skeleton — and it recurs every 6h in every POP.
const CHART_FRESH_S = 6 * 3600;
const CHART_GRACE_S = 18 * 3600;
// The rebuild lock. Long enough to cover a cold build (~12s with the mirror pool warm,
// more if it has to re-mark dead hosts), short enough that a build the runtime cut off
// is retried by the next stale hit rather than an hour later.
const CHART_REBUILD_LOCK_S = 120;
const CHART_BUILT_AT = "X-Built-At";

async function buildChart(genreId: string, origin: string, env: Env, ctx: ExecutionContext): Promise<{ body: string; count: number }> {
  const entries = await fetchTrendingTitles(env, genreId);
  const items = await resolveChart(entries, origin, ctx, env);
  // The frontend renders one shelf per key, so the label travels with the data.
  const label = genreId ? `Top in ${apple.appleGenreName(genreId)}` : "trending";
  return { body: JSON.stringify({ [label]: items }), count: items.length };
}

/** What the client gets: browser-cacheable for the fresh window, no internal headers. */
function chartResponse(body: string): Response {
  return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${CHART_FRESH_S}` } });
}

// Global tier. The Cache API is per-datacenter, and a shelf a datacenter had never
// built was still assembled inline — measured 2026-09-15: eleven genres answered in
// ~70 ms from one POP and the twelfth took 21.8 s, every POP paying that once per
// genre. KV is global: whoever builds a shelf anywhere publishes it, and every other
// POP's first request reads it in milliseconds, fills its local cache, and refreshes
// it in the background if it's older than the fresh window. No expiry on purpose — a
// shelf nobody opened for a week is still a better first paint than a 20 s build.
const chartKvKey = (genreId: string) => `chart:${CHART_CACHE_VERSION}:${genreId || "all"}`;

async function readChartGlobal(env: Env, genreId: string): Promise<{ body: string; builtAt: number } | null> {
  if (!env.SYNC) return null;
  try {
    const raw = await env.SYNC.get(chartKvKey(genreId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { body?: unknown; builtAt?: unknown };
    return typeof parsed.body === "string" && typeof parsed.builtAt === "number" ? { body: parsed.body, builtAt: parsed.builtAt } : null;
  } catch {
    return null;
  }
}

async function publishChart(env: Env, genreId: string, cacheKey: Request, body: string, builtAt = Date.now()): Promise<void> {
  const local = new Response(body, {
    headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${CHART_FRESH_S + CHART_GRACE_S}`, [CHART_BUILT_AT]: String(builtAt) },
  });
  await Promise.all([
    caches.default.put(cacheKey, local),
    env.SYNC ? env.SYNC.put(chartKvKey(genreId), JSON.stringify({ body, builtAt })).catch(() => {}) : Promise.resolve(),
  ]);
}

async function rebuildChart(genreId: string, cacheKey: Request, origin: string, env: Env, ctx: ExecutionContext): Promise<void> {
  // Every request that lands during the stale window would otherwise start its own
  // rebuild; the lock collapses that to one (or two — see acquireLock) per POP.
  if (!(await acquireLock(`chart-rebuild/${CHART_CACHE_VERSION}/${genreId || "all"}`, CHART_REBUILD_LOCK_S))) return;
  const built = await buildChart(genreId, origin, env, ctx);
  // An empty build (Apple unreachable, every search missed) must not replace a good
  // stale shelf. The stale copy lives out its grace and the next hit tries again.
  if (built.count) await publishChart(env, genreId, cacheKey, built.body);
}

async function handleTrending(url: URL, origin: string, env: Env, ctx: ExecutionContext): Promise<Response> {
  // Only ids from our own allowlist reach the cache key, so `?genre=` can't be used to
  // mint unlimited distinct keys and force repeated upstream work.
  const requested = url.searchParams.get("genre") || "";
  const genreId = apple.isAppleGenre(requested) ? requested : "";

  const cache = caches.default;
  const cacheKey = new Request(`${origin}/api/trending?v=${CHART_CACHE_VERSION}${genreId ? `&genre=${genreId}` : ""}`);
  const cached = await cache.match(cacheKey);
  if (cached) {
    // An entry written before the build stamp existed reads as infinitely old, which is
    // right: it gets refreshed behind this response like any other lapsed shelf.
    const builtAt = Number(cached.headers.get(CHART_BUILT_AT)) || 0;
    if (Date.now() - builtAt > CHART_FRESH_S * 1000) {
      ctx.waitUntil(rebuildChart(genreId, cacheKey, origin, env, ctx).catch((e) => console.error("trending rebuild failed", e)));
    }
    return chartResponse(await cached.text());
  }

  // Cold in this datacenter: another one has very likely built it already.
  const global = await readChartGlobal(env, genreId);
  if (global) {
    const stale = Date.now() - global.builtAt > CHART_FRESH_S * 1000;
    ctx.waitUntil(
      (async () => {
        // Seed the local cache with the ORIGINAL build time so staleness carries over.
        const local = new Response(global.body, {
          headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${CHART_FRESH_S + CHART_GRACE_S}`, [CHART_BUILT_AT]: String(global.builtAt) },
        });
        await cache.put(cacheKey, local);
        if (stale) await rebuildChart(genreId, cacheKey, origin, env, ctx);
      })().catch((e) => console.error("trending seed failed", e)),
    );
    return chartResponse(global.body);
  }

  // Nothing cached anywhere: the one case that still builds inline (once, globally).
  const built = await buildChart(genreId, origin, env, ctx);
  if (built.count) ctx.waitUntil(publishChart(env, genreId, cacheKey, built.body));
  return chartResponse(built.body);
}

/** Search-as-you-type suggestions, straight from the Apple Books store's own autocomplete. */
async function handleSuggest(url: URL, origin: string, env: Env, ctx: ExecutionContext): Promise<Response> {
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  if (q.length < 2) return json({ suggestions: [] });

  const cache = caches.default;
  const cacheKey = new Request(`${origin}/api/suggest?q=${encodeURIComponent(q.toLowerCase())}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const suggestions = await apple.suggest(env, q).catch(() => []);
  const resp = json({ suggestions });
  resp.headers.set("Cache-Control", "max-age=86400");
  if (suggestions.length) ctx.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}

/**
 * Apple's metadata for a book we already serve (star rating, publisher description,
 * page count, ISBN) — the fields Anna's Archive doesn't give us. Keyed on md5 so the
 * cache key is bounded; title/author are only the lookup terms on a miss.
 */
// Bump when the SHAPE of an Apple record changes, or 7-day-cached entries keep serving
// the old one. v2 = `extend=description` added, so every entry cached before it has an
// empty description and would have kept every card reading "No summary available".
// Bump whenever the SHAPE or CLEANLINESS of a cached Apple record changes. Entries
// carry a 7-day TTL, so without a bump every book already in the cache keeps serving
// the old value for a week — v3 is `htmlToPlainText` on the description (v2 entries
// hold the raw publisher HTML, `&#xa0;` and all).
const METADATA_CACHE_VERSION = "v3";

async function handleMetadata(md5: string, url: URL, origin: string, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (takedown.isTakenDown(md5, url.searchParams.get("title"), url.searchParams.get("author"))) return json({ error: "Not found" }, 404);
  const cache = caches.default;
  const cacheKey = new Request(`${origin}/api/metadata/${METADATA_CACHE_VERSION}/${md5}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const title = (url.searchParams.get("title") || "").trim();
  const author = (url.searchParams.get("author") || "").trim();
  if (!title) return json({ metadata: null });

  const meta = await apple.findBook(env, title, author).catch(() => null);
  const resp = json({ metadata: meta });
  // Ratings drift slowly and a miss is stable; a week keeps Apple traffic negligible.
  resp.headers.set("Cache-Control", `max-age=${meta ? 604800 : 86400}`);
  ctx.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}

// Anna's Archive exposes a live "recently downloaded" feed as JSON ([{md5,title}]).
//
// This path stays OUTSIDE the mirror-down circuit on purpose. DDoS-Guard gates AA by
// PATH (HANDOFF §9.11): /search and /md5/ have answered 302 → challenge → 403 since
// 2026-08-13, while /dyn/* has kept answering 200 the whole time. Search marks a host
// down every time it hits that challenge, so consulting the circuit here skipped every
// mirror and this returned [] for three weeks — "No recent downloads to show" on the
// library page — while the feed itself was fine. Likewise a miss here says nothing
// about /search, so it doesn't add a strike either.
async function fetchRecent(ctx?: ExecutionContext): Promise<{ md5: string; title: string }[]> {
  // This used to walk every mirror regardless of the circuit breaker, on the theory
  // that a host search had benched might still serve the feed. With all of AA dark that
  // meant every POP paid the full walk (three DDoS-Guard round-trips, 1-6s each) once a
  // minute for a feed that has been empty since 2026-08-13. Honour the breaker like
  // every other AA caller; the feed comes back by itself when the hosts do.
  for (const base of await getAaMirrors(ctx)) {
    if (await isMirrorDown(base)) continue;
    if (await deferProbe(base, `${base}/dyn/recent_downloads/`, ctx)) continue;
    const raw = await fetchTextTimed(`${base}/dyn/recent_downloads/`, UPSTREAM_SEARCH_TIMEOUT_MS);
    if (!raw) {
      await markMirrorDown(base);
      continue;
    }
    try {
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) continue; // a challenge page or HTML wall, not the feed
      await markMirrorUp(base);
      const items = data
        .filter((d) => d && typeof d.md5 === "string" && /^[a-f0-9]{32}$/i.test(d.md5) && typeof d.title === "string" && d.title.trim())
        .map((d) => ({ md5: (d.md5 as string).toLowerCase(), title: (d.title as string).trim() }));
      if (items.length) return items;
    } catch {
      // Unparseable — the next mirror serves the same feed.
    }
  }
  return [];
}

async function handleRecent(request: Request, ctx: ExecutionContext): Promise<Response> {
  const cache = caches.default;
  // Fixed cache key (origin + path, no query) so it can't be cache-busted.
  const cacheKey = new Request(`${new URL(request.url).origin}/api/recent`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const items = await fetchRecent(ctx);
  const resp = json({ recent: items });
  // An empty answer is cached too, briefly: now that this walks every mirror instead of
  // skipping the ones search has benched, a genuinely dead feed would otherwise cost
  // each caller the full mirror walk (up to 4 × 8s) until it came back.
  resp.headers.set("Cache-Control", items.length ? "max-age=120" : "max-age=60");
  ctx.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}

// ---- Nonfiction prize index ---------------------------------------------------
// Browsable award-winning nonfiction from a bundled dataset (see src/awards.ts), so
// listing/filtering is pure in-memory work — no upstream, no scrape, no cache needed
// beyond letting the browser hold onto a response.

function nonfictionFilters(url: URL): awards.AwardQuery {
  return {
    program: awards.validProgram(url.searchParams.get("program")),
    subject: awards.validSubject(url.searchParams.get("subject")),
    status: awards.validStatus(url.searchParams.get("status")),
    decade: awards.validDecade(url.searchParams.get("decade")),
    q: (url.searchParams.get("q") || "").trim().slice(0, 120) || null,
    sort: url.searchParams.get("sort"),
    page: parseInt(url.searchParams.get("page") || "1", 10) || 1,
    limit: parseInt(url.searchParams.get("limit") || "24", 10) || 24,
  };
}

function handleNonfictionMeta(): Response {
  const resp = json({ version: awards.datasetVersion(), programs: awards.programList(), subjects: awards.subjects() });
  resp.headers.set("Cache-Control", "max-age=86400");
  return resp;
}

function handleNonfictionList(url: URL): Response {
  const filters = nonfictionFilters(url);
  const { total, books } = awards.queryBooks(filters);
  const resp = json({ total, page: filters.page, limit: filters.limit, books });
  resp.headers.set("Cache-Control", "max-age=3600");
  return resp;
}

// Candidates raced per shuffle. Cover lookups run in parallel, so this costs one
// round trip regardless — it just buys a much better chance of leading with art.
const SURPRISE_CANDIDATES = 3;

async function handleNonfictionRandom(url: URL, env: Env): Promise<Response> {
  const candidates = awards.randomBooks(nonfictionFilters(url), SURPRISE_CANDIDATES);

  let book: awards.AwardBook | null = null;
  let cover = "";
  if (candidates.length) {
    const covers = await Promise.all(candidates.map((b) => apple.findBook(env, b.title, b.authors[0] || "").catch(() => null)));
    const withArt = covers.findIndex((m) => m?.cover);
    const index = withArt >= 0 ? withArt : 0;
    book = candidates[index];
    // Hand back the resolved artwork so the hero doesn't need a second round trip.
    cover = covers[index]?.cover ?? "";
  }

  const resp = json({ book, cover });
  // Never cached — the whole point is a different book each time you press shuffle.
  resp.headers.set("Cache-Control", "no-store");
  return resp;
}

/**
 * Cover art for a prize-index book. The dataset ships no images, so we look the book
 * up on Apple Books and redirect to their artwork CDN. Keyed by the book's dataset id
 * (a bounded integer), so this can't be used to drive arbitrary Apple searches.
 */
async function handleNonfictionCover(id: number, origin: string, env: Env, ctx: ExecutionContext): Promise<Response> {
  const book = awards.bookById(id);
  if (!book) return new Response("Not Found", { status: 404 });

  const cache = caches.default;
  const cacheKey = new Request(`${origin}/api/nonfiction/${id}/cover.jpg`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const meta = await apple.findBook(env, book.title, book.authors[0] || "").catch(() => null);
  // A 404 lets <BookCover> fall straight through to its "No cover" state. Cache the
  // miss too (shorter), so an unmatched title doesn't re-query Apple on every render.
  const resp = meta?.cover
    ? new Response(null, { status: 302, headers: { Location: meta.cover, "Cache-Control": "max-age=2592000" } })
    : new Response("No cover", { status: 404, headers: { "Cache-Control": "max-age=86400" } });
  ctx.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}

// ---- Recommendations: curated ranked lists from thegreatestbooks.org -----------
// Every list shares the same `li.book-list-item` markup (parseGreatestBooks) and
// paginates via <link rel="next"> (parseTgbNext); single-page lists just omit it.
// So each list is a {path, limit} entry and one generic fetcher handles them all.
// Items are intentionally light (title/author/cover) — the frontend resolves each
// to a real Bookracy book via a normal search on click, so we never resolve upfront.
const TGB_BASE = "https://thegreatestbooks.org";
// Since 2026-10 the site answers a Worker with a Cloudflare managed challenge (403
// "Just a moment…"). The Wayback Machine's raw `id_` captures are the original HTML, so
// they parse unchanged; the `2` timestamp prefix resolves to the newest capture.
const TGB_WAYBACK = "https://web.archive.org/web/2id_/";
const TGB_PAGE_TIMEOUT_MS = 10_000;
// The last good copy of each list lives in KV `SYNC`, shared by every POP. Older than a
// day it is still served while one refresh runs behind it, and it is what keeps the page
// up when both sources fail. It also keeps Wayback, which throttles bursts, at roughly
// one refresh per list per day instead of one per POP.
const TGB_KV_PREFIX = "tgb:";
const TGB_FRESH_MS = 24 * 3600 * 1000;
const TGB_EDGE_TTL = 86400;
const TGB_STALE_EDGE_TTL = 3600;

const TGB_LISTS: Record<string, { path: string; limit: number }> = {
  tgb: { path: "/", limit: 100 },
  "since-2000": { path: "/the-greatest-books/since/2000", limit: 100 },
  "global-canon": { path: "/global-canon", limit: 100 },
  "readers-favorites": { path: "/lists/463", limit: 100 },
  "by-women": { path: "/women", limit: 50 },
  western: { path: "/western", limit: 50 },
  "non-western": { path: "/non-western", limit: 50 },
  african: { path: "/africa", limit: 50 },
  asian: { path: "/asia", limit: 50 },
  "latin-american": { path: "/latin-america", limit: 50 },
};

// Safety cap on upstream requests per list (25 items/page → 6 pages = 150 max).
const TGB_MAX_PAGES = 6;

interface TgbWalk {
  items: GreatestBook[];
  /** False when a page failed mid-walk, so the list is missing its tail. */
  complete: boolean;
}

async function walkTgbList(path: string, limit: number, viaWayback: boolean): Promise<TgbWalk> {
  const seen = new Set<string>();
  const all: GreatestBook[] = [];
  let next: string | null = path;

  for (let page = 0; page < TGB_MAX_PAGES && next && all.length < limit; page++) {
    const url = new URL(next, TGB_BASE).href;
    const html = await fetchTextTimed(viaWayback ? TGB_WAYBACK + url : url, TGB_PAGE_TIMEOUT_MS);
    if (!html) {
      all.sort((a, b) => a.rank - b.rank);
      return { items: all.slice(0, limit), complete: false };
    }
    for (const book of parseGreatestBooks(html)) {
      if (!seen.has(book.sourceId)) {
        seen.add(book.sourceId);
        all.push(book);
      }
    }
    next = parseTgbNext(html); // null on single-page lists → loop ends
  }

  all.sort((a, b) => a.rank - b.rank);
  return { items: all.slice(0, limit), complete: true };
}

async function fetchTgbList(path: string, limit: number): Promise<TgbWalk> {
  const live = await walkTgbList(path, limit, false);
  if (live.complete && live.items.length) return live;
  const archived = await walkTgbList(path, limit, true);
  if (archived.complete && archived.items.length) return archived;
  return archived.items.length >= live.items.length ? archived : live;
}

interface StoredTgbList {
  items: GreatestBook[];
  at: number;
}

async function refreshTgbList(env: Env, listId: string, prev: StoredTgbList | null): Promise<TgbWalk> {
  const list = TGB_LISTS[listId];
  const walk = await fetchTgbList(list.path, list.limit).catch((e): TgbWalk => {
    console.error("recommendation list fetch failed", listId, e);
    return { items: [], complete: false };
  });
  if (!walk.complete) console.error("recommendation list incomplete", listId, walk.items.length);
  if (!walk.items.length || (!walk.complete && prev && prev.items.length >= walk.items.length)) return walk;
  // A partial list is stored as already-stale, so the next request retries for the tail.
  const stored: StoredTgbList = { items: walk.items, at: walk.complete ? Date.now() : Date.now() - TGB_FRESH_MS };
  await env.SYNC.put(TGB_KV_PREFIX + listId, JSON.stringify(stored)).catch((e) => console.error("recommendation list store failed", listId, e));
  return walk;
}

async function handleRecommendationList(listId: string, origin: string, env: Env, ctx: ExecutionContext): Promise<Response> {
  const list = TGB_LISTS[listId];
  if (!list) return json({ error: "Unknown recommendation list" }, 404);

  const cache = caches.default;
  // Per-id fixed cache key (no query) so it can't be cache-busted into repeated scrapes.
  const cacheKey = new Request(`${origin}/api/recommendations/${listId}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const respond = (items: GreatestBook[], ttl: number): Response => {
    const resp = json({ recommendations: items });
    resp.headers.set("Cache-Control", `max-age=${ttl}`);
    ctx.waitUntil(cache.put(cacheKey, resp.clone()));
    return resp;
  };

  const stored = await env.SYNC.get<StoredTgbList>(TGB_KV_PREFIX + listId, "json").catch(() => null);
  if (stored?.items?.length) {
    if (Date.now() - stored.at < TGB_FRESH_MS) return respond(stored.items, TGB_EDGE_TTL);
    if (await acquireLock(`tgb-refresh/${listId}`, 300)) ctx.waitUntil(refreshTgbList(env, listId, stored));
    return respond(stored.items, TGB_STALE_EDGE_TTL);
  }

  const { items, complete } = await refreshTgbList(env, listId, null);
  if (!items.length) return json({ error: "Recommendations unavailable" }, 502);
  return respond(items, complete ? TGB_EDGE_TTL : TGB_STALE_EDGE_TTL);
}

// ---- Comic reading orders (comicbookreadingorders.com) --------------------------
// Marvel/DC "master reading orders": the index page gives ordered eras + metadata,
// each era page the full issue list. Scraped like the recommendation lists (one fetch
// per era, bounded concurrency) and cached a day. Reused by the frontend Recommendations.
const CBRO_ORDERS: Record<string, { title: string; source: string }> = {
  marvel: { title: "Marvel Master Reading Order", source: "https://comicbookreadingorders.com/marvel/marvel-master-reading-order/" },
  dc: { title: "DC Master Reading Order", source: "https://comicbookreadingorders.com/dc/dc-master-reading-order/" },
};
// Cap concurrent upstream fetches so a cache miss doesn't hammer the source (~14-19 eras).
const CBRO_CONCURRENCY = 6;

async function fetchReadingOrder(franchise: string): Promise<{ title: string; source: string; eras: ReadingOrderEra[] } | null> {
  const conf = CBRO_ORDERS[franchise];
  if (!conf) return null;

  const masterHtml = await fetchText(conf.source).catch(() => "");
  if (!masterHtml) return null;
  const metas = parseReadingOrderMaster(masterHtml);
  if (!metas.length) return null;

  const eras: ReadingOrderEra[] = metas.map((m) => ({ ...m, issues: [] }));

  // Fetch each era page with bounded concurrency; a failed/edited era is skipped, not fatal.
  let cursor = 0;
  const worker = async () => {
    while (cursor < eras.length) {
      const era = eras[cursor++];
      const html = await fetchText(era.url).catch(() => "");
      if (!html) continue;
      try {
        const { issues, subEvents } = parseReadingOrderIssues(html);
        era.issues = issues;
        if (!issues.length && subEvents.length) era.subEvents = subEvents;
      } catch (e) {
        console.error("reading-order era parse failed", era.url, e);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CBRO_CONCURRENCY, eras.length) }, worker));

  return { title: conf.title, source: conf.source, eras };
}

async function handleReadingOrder(franchise: string, origin: string, ctx: ExecutionContext): Promise<Response> {
  if (!CBRO_ORDERS[franchise]) return json({ error: "Unknown reading order" }, 404);

  const cache = caches.default;
  // Per-franchise fixed cache key (no query) so it can't be cache-busted into repeated scrapes.
  const cacheKey = new Request(`${origin}/api/reading-order/${franchise}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let data: Awaited<ReturnType<typeof fetchReadingOrder>>;
  try {
    data = await fetchReadingOrder(franchise);
  } catch (e) {
    console.error("reading-order fetch failed", franchise, e);
    return json({ error: "Reading order unavailable" }, 502);
  }
  if (!data) return json({ error: "Reading order unavailable" }, 502);

  const resp = json({ readingOrder: data });
  resp.headers.set("Cache-Control", "max-age=86400"); // refresh at most once a day
  ctx.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}

// ---- Five Books (fivebooks.com) expert recommendations --------------------------
// One query-param endpoint serving three views, all scraped + cached a day:
//   ?type=category&path=<cat[/sub…]>  -> { interviews } for a category page
//   ?type=best&year=<YYYY>            -> { interviews } for /books/best-books-of-<year>/
//   ?type=interview&slug=<slug>       -> { interview } for one …/best-books/<slug>/ page
// The taxonomy itself (the browsable tree) lives in the frontend as static config, so
// there's no taxonomy endpoint. Inputs are charset-validated so the cache key (built
// only from valid type+value) can't be busted into arbitrary scrapes.
const FB_PATH_RE = /^[a-z0-9-]+(?:\/[a-z0-9-]+){0,3}$/;
const FB_SLUG_RE = /^[a-z0-9-]+$/;
const FB_YEAR_RE = /^20\d{2}$/;

async function handleFiveBooks(url: URL, origin: string, ctx: ExecutionContext): Promise<Response> {
  const type = url.searchParams.get("type") || "";
  let source: string;
  let cacheId: string;
  let mode: "list" | "interview";

  if (type === "category") {
    const path = (url.searchParams.get("path") || "").toLowerCase();
    if (!FB_PATH_RE.test(path)) return json({ error: "Invalid category" }, 400);
    source = `${FB_BASE}/category/${path}/`;
    cacheId = `category/${path}`;
    mode = "list";
  } else if (type === "best") {
    const year = url.searchParams.get("year") || "";
    if (!FB_YEAR_RE.test(year)) return json({ error: "Invalid year" }, 400);
    source = `${FB_BASE}/books/best-books-of-${year}/`;
    cacheId = `best/${year}`;
    mode = "list";
  } else if (type === "interview") {
    const slug = (url.searchParams.get("slug") || "").toLowerCase();
    if (!FB_SLUG_RE.test(slug)) return json({ error: "Invalid interview" }, 400);
    source = `${FB_BASE}/best-books/${slug}/`;
    cacheId = `interview/${slug}`;
    mode = "interview";
  } else {
    return json({ error: "Unknown Five Books request" }, 400);
  }

  const cache = caches.default;
  // Key built only from validated type+value (no raw query) → not cache-bustable.
  const cacheKey = new Request(`${origin}/api/fivebooks/${cacheId}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let html: string;
  try {
    html = await fetchText(source);
  } catch (e) {
    console.error("five books fetch failed", cacheId, e);
    return json({ error: "Five Books unavailable" }, 502);
  }

  let payload: { interviews: ReturnType<typeof parseFiveBooksList> } | { interview: ReturnType<typeof parseFiveBooksInterview> };
  if (mode === "interview") {
    const interview = parseFiveBooksInterview(html, (url.searchParams.get("slug") || "").toLowerCase());
    if (!interview.books.length) return json({ error: "Interview unavailable" }, 502);
    payload = { interview };
  } else {
    const interviews = parseFiveBooksList(html);
    if (!interviews.length) return json({ error: "Five Books unavailable" }, 502);
    payload = { interviews };
  }

  const resp = json(payload);
  resp.headers.set("Cache-Control", "max-age=86400"); // refresh at most once a day
  ctx.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}

// Browser cache is long (a cover is immutable for a given md5). The edge copy is
// deliberately shorter: `caches.default.delete` only purges the datacenter it runs in,
// so a replaced or moderated cover needs a TTL to self-heal in every other POP.
const COVER_BROWSER_TTL = 7 * 24 * 3600;
const COVER_EDGE_TTL = 24 * 3600;
// A book with no cover upstream would otherwise re-scrape every AA mirror on *every*
// view forever. Remember the miss, but briefly — a cover can appear later.
const COVER_MISS_TTL = 12 * 3600;
// Miss TTL for the weaker evidence: Apple had no match and no AA mirror was reachable
// at all, so nothing *proved* the book is coverless. Short enough that an AA recovery
// (or a book newly appearing in Apple's catalogue) heals within the hour, long enough
// that a coverless book isn't re-querying Apple on every single view in the meantime.
const COVER_MISS_UNPROVEN_TTL = 3600;

// Bump to invalidate every cover's edge entry at once. `caches.default.delete()` is
// per-datacenter (see §5), so deleting a bad object from R2 does NOT stop the edge from
// serving its old bytes for up to COVER_EDGE_TTL in every other POP — which is exactly
// what happened after the 2026-08-14 poison purge: R2 was clean and the wrong covers
// were still on screen. Changing the key sidesteps that entirely: every POP misses,
// re-reads from R2, and a purged cover re-resolves through Apple. The cost is one extra
// R2 read per cover on first view (Class B, ~$0.36/M) — negligible, and one-time.
//
// v2 = post-poison-purge (2026-08-14).
const COVER_CACHE_VERSION = "v2";

function coverCacheKey(md5: string): Request {
  return new Request(`https://bookracy.internal/cover/${COVER_CACHE_VERSION}/${md5}.jpg`);
}

/**
 * R2 key for an Apple-resolved cover, addressed by the book it depicts rather than by
 * the md5 that happened to ask for it.
 *
 * Apple is keyed on title+author — the md5 plays no part in resolving the image — so
 * writing the result to `covers/<md5>.jpg` made the key space as large as the set of
 * md5s anyone cares to name. `/cover/<any 32 hex>/thumbnail.jpg?title=<real book>`
 * is unauthenticated and answers 200, so that was an open lever for writing unbounded
 * distinct objects into R2 (verified live 2026-08-20: a fabricated md5 produced a
 * 225 KB object under exactly the key requested, at 200/min/IP).
 *
 * Addressing by title+author bounds the key space to real books instead, and dedupes
 * the common legitimate case where one work is uploaded under many md5s (§9.17 found
 * real covers shared by 5-14 keys). It deliberately lives UNDER `covers/` so the
 * existing `expire-scraped-covers` lifecycle rule — a literal prefix match — keeps
 * applying with no new rule.
 */
function appleCoverKey(title: string, author: string): string {
  const norm = `${title}|${author}`.toLowerCase().replace(/\s+/g, " ").trim();
  return `covers/apple/${md5Lib(norm)}.jpg`;
}

// Community uploads keep their covers on their own prefix: they're user-supplied, so
// unlike a scraped cover they can never be re-fetched, which means the `covers/`
// lifecycle rule (which caps the unbounded scrape cache) must not be able to touch them.
function communityCoverKey(md5: string): string {
  return `community-covers/${md5}.jpg`;
}

/**
 * Resolve a cover from Apple Books using the title/author the caller already knows.
 *
 * This exists because Anna's Archive is not dependable as a cover source: the mirrors
 * sit behind DDoS-Guard, which serves datacenter egress (i.e. every Worker request) a
 * 403 challenge. Apple is a plain JSON API with no bot wall, it keys on title+author
 * rather than md5 so it survives AA being unreachable entirely, and `findBook` already
 * insists on an author match — so it fails closed rather than returning a near-miss.
 *
 * Returns the image bytes, not the URL: the caller stores them under `covers/<md5>.jpg`
 * exactly as with a scraped cover, so every downstream reader (R2, edge cache, Kindle
 * client, userscript) is unchanged and nothing needs to know where a cover came from.
 */
async function appleCover(
  md5: string,
  title: string,
  author: string,
  origin: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  if (!title) return null;
  const meta = await apple.findBook(env, title, author).catch(() => null);

  // The lookup we just paid for carries the description, rating, publisher and ISBN as
  // well as the artwork, and `handleMetadata` would otherwise repeat the exact same call
  // the moment the card asks for a blurb. Warm its cache with what we already have.
  // This matters more than it used to: Anna's Archive supplied descriptions and doesn't
  // any more, so without it every search result reads "No summary available".
  if (meta) {
    const metaResp = json({ metadata: meta });
    metaResp.headers.set("Cache-Control", "max-age=604800");
    ctx.waitUntil(caches.default.put(new Request(`${origin}/api/metadata/${METADATA_CACHE_VERSION}/${md5}`), metaResp.clone()).catch(() => {}));
  }

  if (!meta?.cover) return null;
  const resp = await fetchWithTimeout(meta.cover, UPSTREAM_SEARCH_TIMEOUT_MS);
  const contentType = resp?.headers.get("Content-Type") || "";
  if (!resp?.ok || !contentType.startsWith("image/")) {
    await resp?.body?.cancel();
    return null;
  }
  return { bytes: await resp.arrayBuffer(), contentType };
}

/**
 * What libgen had to say about a book's cover. The three cases are deliberately
 * distinct because they carry different amounts of evidence, and `handleCover` spends
 * that evidence on how long to remember a miss.
 */
type LibgenCover =
  | { kind: "cover"; bytes: ArrayBuffer; contentType: string }
  /** A mirror answered for this md5 and it has no cover (or libgen doesn't hold it). */
  | { kind: "none" }
  /** No mirror answered at all — proves nothing, so don't remember it as a miss. */
  | { kind: "unknown" };

/** Smallest response we'll accept as a real cover. See LIBGEN_COVER_MIRRORS: a
 *  hotlink-blocked fetch is a 200 with an empty body and an `image/jpeg` content type,
 *  so neither the status nor the type separates it from a hit — only the length does. */
const MIN_COVER_BYTES = 512;

/**
 * Anna's Archive was the md5-addressed cover source, and it has been dark since
 * 2026-08-13. Apple is title-addressed, so it can only find books its own store
 * carries — measured 2026-09-01, that left **74% of `/cover/` requests answering 404**,
 * overwhelmingly comics (cbr/cbz) and non-English editions that Apple Books has never
 * heard of.
 *
 * libgen has covers for its own catalogue, which is exactly the catalogue we serve, and
 * they are addressed BY MD5 — so a hit here is proof the image belongs to this book, the
 * same guarantee the AA `/md5/` page used to give. That is what makes it safe to store
 * under `covers/<md5>.jpg` rather than a title-addressed key.
 *
 * The path isn't in the search results we already have, but `libgenCoverPath` derives it
 * from the same `json.php` file record `resolveViaLibgenJson` already knows how to ask
 * for — see that function for the rule and the production verification behind it.
 *
 * `_small` (~3 KB, 65x100) is deliberately not used: the full-size image is ~22 KB and
 * this is a book cover on a card, stored once and served from R2 afterwards.
 */
async function libgenCover(md5: string): Promise<LibgenCover> {
  for (const base of LIBGEN_COVER_MIRRORS) {
    if (await isMirrorDown(base)) continue;
    const rec = (await fetchJsonTimed(
      `${base}/json.php?object=f&md5=${md5}&fields=cover_exists,libgen_topic,libgen_id,comics_id`,
      UPSTREAM_SEARCH_TIMEOUT_MS,
    )) as Record<string, LibgenCoverFields> | null;
    if (!rec || typeof rec !== "object") {
      await markMirrorDown(base);
      continue;
    }
    await markMirrorUp(base);

    // Object.values()[0] also rejects the {"error": …} shape — it has no file record.
    const path = libgenCoverPath(Object.values(rec)[0], md5);
    // These mirrors are frontends onto ONE database (same reasoning as the search and
    // md5 loops), so a mirror that answered has answered for all of them: asking the
    // next two about a book with no cover just spends two more requests to be told the
    // same thing.
    if (!path) return { kind: "none" };

    // The Referer is load-bearing, not politeness — see LIBGEN_COVER_MIRRORS. Serving
    // the image is the part that DOES vary per host, so a failure here is worth
    // retrying on the next mirror even though the record above was authoritative.
    const img = await fetchWithTimeout(`${base}${path}`, UPSTREAM_SEARCH_TIMEOUT_MS, { ...HEADERS, Referer: `${base}/` });
    const contentType = img?.headers.get("Content-Type") || "";
    if (!img?.ok || !contentType.startsWith("image/")) {
      await img?.body?.cancel();
      continue;
    }
    const bytes = await img.arrayBuffer();
    if (bytes.byteLength < MIN_COVER_BYTES) continue; // hotlink-blocked empty body
    return { kind: "cover", bytes, contentType };
  }
  // Either no mirror answered, or one told us the cover exists and then no mirror would
  // hand over the bytes. Both are "we don't know", never "the book has no cover" —
  // pinning a 12h miss on a book libgen just said HAS a cover is the one wrong outcome.
  return { kind: "unknown" };
}

async function handleCover(md5: string, title: string, author: string, origin: string, ip: string, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (takedown.isTakenDown(md5, title, author)) return json({ error: "No cover" }, 404);
  // Workers run *before* the CDN cache, so the Cache-Control header we return only ever
  // reaches the browser — without an explicit Cache API entry, every cover view costs a
  // fresh R2 read. Repeat views are the overwhelming majority of cover traffic.
  const cache = caches.default;
  const edgeKey = coverCacheKey(md5);
  const edgeHit = await cache.match(edgeKey);
  if (edgeHit) return edgeHit;

  // Community upload first (user-supplied, never re-scrapable), then the md5-addressed
  // scrape, then the title-addressed Apple copy — which is what a book that arrived
  // under a different md5 will already have populated.
  const cached =
    (await env.BOOKS.get(communityCoverKey(md5))) ||
    (await env.BOOKS.get(`covers/${md5}.jpg`)) ||
    (title ? await env.BOOKS.get(appleCoverKey(title, author)) : null);
  if (cached) {
    // Serve the stored type (uploaded covers are normalised to JPEG, but be faithful).
    const ct = cached.httpMetadata?.contentType || "image/jpeg";
    const resp = new Response(cached.body, { headers: { "Content-Type": ct, "Cache-Control": `public, max-age=${COVER_BROWSER_TTL}` } });
    ctx.waitUntil(cache.put(edgeKey, withEdgeTtl(resp.clone(), COVER_EDGE_TTL)));
    return resp;
  }

  // Cache miss → we're about to scrape Anna's Archive. Rate-limit ONLY this path
  // (cached hits above are never limited, so normal browsing — even a 100-cover
  // results page — is unaffected). This caps random-md5 scrape amplification that
  // could otherwise get our egress IP blocked upstream. Fail open if unavailable.
  if (env.COVER_LIMITER) {
    try {
      const { success } = await env.COVER_LIMITER.limit({ key: ip });
      if (!success) return json({ error: "Too many requests — please slow down." }, 429);
    } catch {
      /* limiter unavailable — don't block legitimate traffic */
    }
  }

  // Apple first. AA is the richer source by md5, but it's also the one behind a bot
  // wall we cannot pass, so trying it first means every cover on a book AA can't serve
  // pays the full mirror-failure path before we even reach a source that works. Apple
  // needs a title, so callers that have one (search results, trending) pass it through.
  const fromApple = title ? await appleCover(md5, title, author, origin, env, ctx) : null;
  // Stored under the title-addressed key, NOT `covers/<md5>.jpg` — see appleCoverKey.
  if (fromApple) return storeCover(appleCoverKey(title, author), fromApple.bytes, fromApple.contentType, edgeKey, env, ctx);

  // libgen next, and after Apple rather than before it on purpose: appleCover() warms
  // `/api/metadata` with the record it just paid for, which is what stops every card
  // reading "No summary available" now that AA supplies no descriptions. Running it
  // second would skip that for exactly the books most likely to need it.
  //
  // This runs for a book with no title too — the lookup is by md5, so unlike Apple it
  // works for a bookmark resolved straight off the shelf.
  const fromLibgen = await libgenCover(md5);
  // md5-addressed, so the bytes provably belong to this book: `covers/<md5>.jpg` is the
  // right home, same as a cover that came off an AA /md5/ page.
  if (fromLibgen.kind === "cover") return storeCover(`covers/${md5}.jpg`, fromLibgen.bytes, fromLibgen.contentType, edgeKey, env, ctx);

  // Try each AA mirror until one yields a cover URL (was single-mirror before, so a
  // down primary meant no cover even when other mirrors were fine). Circuit breaker
  // skips hosts that recently threw / timed out, so a dead mirror doesn't cost every
  // request an 8s wait.
  let imageUrl: string | null = null;
  // Only a mirror that actually served us a readable /md5/ page proves the book has no
  // cover. If every mirror was down or challenged we must NOT remember that as a miss,
  // or an upstream blip would pin a 404 on a perfectly good cover for hours.
  let reachedMirror = false;
  for (const base of await getAaMirrors(ctx)) {
    if (await isMirrorDown(base)) continue;
    if (await deferProbe(base, `${base}/md5/${md5}`, ctx)) continue; // long dead — probe off-request
    const html = await fetchTextTimed(`${base}/md5/${md5}`, UPSTREAM_SEARCH_TIMEOUT_MS);
    if (!html) {
      await markMirrorDown(base);
      continue;
    }
    if (isAaChallengePage(html)) continue; // interstitial, not the real /md5/ page
    await markMirrorUp(base);
    reachedMirror = true;
    // Pass the md5: it's what lets the parser prove the page it's reading is actually
    // this book's page, instead of returning some unrelated image off a generic one.
    imageUrl = parseCoverUrl(html, md5);
    if (imageUrl) break;
  }
  // An upstream that served us a real answer for THIS md5 is proof the book has no
  // cover (12h). A libgen mirror answering counts for exactly as much as an AA mirror
  // answering did, and since AA went dark it is the only one that ever does — without
  // this, every coverless book fell to the 1h unproven TTL and re-queried Apple and
  // libgen 24 times a day instead of twice.
  //
  // Failing both, an Apple lookup that came back empty is weaker evidence but still
  // worth remembering briefly, or every view of a coverless book re-queries Apple.
  if (!imageUrl) {
    return reachedMirror || fromLibgen.kind === "none"
      ? coverMiss("Image not found", true, edgeKey, ctx)
      : coverMiss("Image not found", Boolean(title), edgeKey, ctx, COVER_MISS_UNPROVEN_TTL);
  }

  // The cover image itself is a third-party URL off the AA page — bound it too, or a
  // stalled image host holds the request open long after we found the link.
  const imgResp = await fetchWithTimeout(imageUrl, UPSTREAM_SEARCH_TIMEOUT_MS);
  const contentType = imgResp?.headers.get("Content-Type") || "";
  if (!imgResp?.ok || !contentType.startsWith("image/")) {
    await imgResp?.body?.cancel();
    return coverMiss("Cover is not an image", true, edgeKey, ctx);
  }

  // A mirror served this book's own /md5/ page, so the md5 is proven real and the
  // md5-addressed key is the right home for it.
  return storeCover(`covers/${md5}.jpg`, await imgResp.arrayBuffer(), contentType, edgeKey, env, ctx);
}

/** Persist a freshly-resolved cover to R2 + the edge, and return it to the caller. */
function storeCover(key: string, bytes: ArrayBuffer, contentType: string, edgeKey: Request, env: Env, ctx: ExecutionContext): Response {
  ctx.waitUntil(env.BOOKS.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } }));
  const resp = new Response(bytes, { headers: { "Content-Type": contentType, "Cache-Control": `public, max-age=${COVER_BROWSER_TTL}` } });
  ctx.waitUntil(caches.default.put(edgeKey, withEdgeTtl(resp.clone(), COVER_EDGE_TTL)));
  return resp;
}

// Re-stamp a response with the TTL we want the *edge* copy to live for, leaving the
// client's own Cache-Control untouched.
function withEdgeTtl(resp: Response, ttl: number): Response {
  const headers = new Headers(resp.headers);
  headers.set("Cache-Control", `public, max-age=${ttl}`);
  return new Response(resp.body, { status: resp.status, headers });
}

function coverMiss(message: string, remember: boolean, edgeKey: Request, ctx: ExecutionContext, ttl = COVER_MISS_TTL): Response {
  const resp = json({ error: message }, 404);
  if (remember) ctx.waitUntil(caches.default.put(edgeKey, withEdgeTtl(resp.clone(), ttl)));
  return resp;
}

// Dead-letter queue for `book-backup`; the queue handler serves both, and uses this
// to tell "retry me later" from "this was the last attempt".
const DLQ_NAME = "book-backup-dlq";

// Queue a freshly-cached (or backup-served) book for long-term backup. Idempotent
// downstream: the consumer skips providers already marked done.
function enqueueBackup(env: Env, md5: string, ext: string, mime: string): Promise<void> {
  if (!env.BACKUP_QUEUE || !backup.backupConfigured(env)) return Promise.resolve();
  return env.BACKUP_QUEUE.send({ md5, ext, mime } satisfies BackupJob).then(
    () => {},
    (e) => console.error("enqueue backup failed", e),
  );
}

// Resolve one libgen mirror's md5 → direct get.php URL (which carries the mirror's
// own key). Never throws and is time-boxed, so it's safe to fire at every mirror
// concurrently and take whichever answers first (see handleDownload). Any fetch
// throw / non-2xx marks the mirror as down for the circuit-breaker window.
//
// It deliberately does NOT honour that window itself. The circuit exists to keep a
// *serial* walk (the libgen search fallback) from paying a dead host's timeout, but
// this resolver is only ever raced, so skipping a host saves no wall-clock — the race
// takes whoever answers first regardless. What skipping did cost us: the strikes are
// shared with search, whose 110 KB result pages push the slower mirrors past their 8s
// budget far more often than a 20 KB ads.php does, so a mirror that was fine for
// downloads kept getting benched by search's timeouts. During the 2026-09 booksdl CDN
// degradation the benched mirror was sometimes the only one that still served the file.
async function resolveLibgenLink(base: string, md5: string): Promise<{ base: string; url: string } | null> {
  const r = await resolveLibgenLinkOutcome(base, md5);
  return r.kind === "link" ? { base: r.base, url: r.url } : null;
}

/** Like resolveLibgenLink, but says WHY there's no link: a real miss or a failure. */
async function resolveLibgenLinkOutcome(base: string, md5: string): Promise<{ kind: "link"; base: string; url: string } | { kind: "miss" | "transient" }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const resp = await fetch(`${base}/ads.php?md5=${md5}`, { headers: HEADERS, signal: ctrl.signal });
    if (!resp.ok) {
      await resp.body?.cancel(); // free the connection slot (see fetchTextTimed)
      await markMirrorDown(base);
      return { kind: "transient" };
    }
    await markMirrorUp(base);
    const url = parseLibgenUrl(await resp.text(), base);
    return url ? { kind: "link", base, url } : { kind: "miss" }; // the mirror is up but doesn't have this md5
  } catch {
    await markMirrorDown(base);
    return { kind: "transient" };
  } finally {
    clearTimeout(timer);
  }
}

/** Request the rest of a file from `offset`. Only the response headers are time-boxed;
 *  the body streams for as long as the transfer needs (same contract as fetchFile). */
async function fetchRangeFrom(url: string, offset: number, headers: Record<string, string>): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    return await fetch(url, { headers: { ...headers, Range: `bytes=${offset}-` }, signal: ctrl.signal, redirect: "follow" });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// A validated upstream file response: OK, has a body, and isn't an HTML wall / error
// page. Anything else means "this source doesn't actually have the file".
function isFileResponse(resp: Response): boolean {
  return resp.ok && !!resp.body && !(resp.headers.get("Content-Type") || "").toLowerCase().includes("text/html");
}

// How long to wait before re-asking a file host that just answered 5xx. libgen's
// get.php now 307s every mirror to one CDN (cdn3.booksdl.lc) which, measured 2026-09-07,
// answered 503 for roughly a third of files — and a good share of those were transient:
// the same URL that 503'd three times in a row served bytes a few minutes later. One
// retry after a short pause is the cheapest way to catch the transient ones (a 503
// comes back in <1s, so the retry costs ~2s, not a second 15s budget).
const FILE_RETRY_DELAY_MS = 1500;

// Fetch a candidate direct file URL, time-boxing only the response headers (TTFB);
// once they arrive the body streams for as long as the transfer needs. Returns the
// validated Response, or null (cancelling any body) on a miss. A `referer` is sent for
// libgen hosts that gate get.php on it; IPFS/others use plain headers.
// `retry5xx` re-fetches once after FILE_RETRY_DELAY_MS when the (post-redirect) status
// is 5xx — for hosts known to shed load transiently rather than genuinely lack the file.
async function fetchFile(url: string, referer?: string, timeoutMs = 15000, retry5xx = false): Promise<Response | null> {
  const headers = referer ? { ...DL_HEADERS, Referer: referer } : HEADERS;
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { headers, signal: ctrl.signal, redirect: "follow" });
      if (isFileResponse(resp)) return resp;
      await resp.body?.cancel();
      if (!(retry5xx && resp.status >= 500 && attempt === 0)) return null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, FILE_RETRY_DELAY_MS));
  }
}

// Source #1 — libgen.li family. Every mirror is an independent chain — ads.php →
// get.php → (307 → CDN) → bytes — so run the WHOLE chain per mirror concurrently and
// take the first that yields a real file; the losers' bodies are cancelled.
//
// This used to race only the ads.php step and then fetch the winners' files one at a
// time. That was fine while get.php served bytes itself; it is not now that every
// mirror bounces to a shared CDN that 503s per-file and one mirror's get.php hangs the
// full 15s TTFB budget. Serially that was 1s + 1s + 1s + 15s + 5s ≈ 25s before the one
// chain that worked got its turn (measured on a real md5, 2026-09-07); concurrently the
// same download is bounded by the slowest *successful* chain, ~5-8s. The extra cost is
// up to four ads.php fetches and four cancelled CDN responses per cold download, which
// is nothing next to the bytes we are about to stream.
// One extra pass over the mirrors, only when every failure was transient (resolution.ts).
const LIBGEN_RESOLVE_PASSES = 2;
const LIBGEN_RETRY_PAUSE_MS = 2500;

async function fetchFromLibgenLi(md5: string): Promise<Response | null> {
  for (let pass = 1; pass <= LIBGEN_RESOLVE_PASSES; pass++) {
    const outcomes: ResolveOutcome[] = [];
    const chains = LIBGEN_MIRRORS.map(async (base) => {
      const r = await resolveLibgenLinkOutcome(base, md5);
      if (r.kind !== "link") {
        outcomes.push(r.kind);
        return null;
      }
      const file = await fetchFile(r.url, `${r.base}/`, 15000, true);
      // A link proves libgen holds the file, so a failed fetch of it is a CDN hiccup.
      outcomes.push(file ? "file" : "transient");
      return file;
    });
    for await (const resp of inCompletionOrder(chains)) {
      if (!resp) continue;
      // First real file wins. A straggler chain that also lands a file gets its body
      // cancelled to free the socket — fired without awaiting so it can't delay the win.
      Promise.all(chains.map((p) => p.then((r) => (r && r !== resp ? r.body?.cancel() : undefined)).catch(() => {}))).catch(() => {});
      return resp;
    }
    if (pass === LIBGEN_RESOLVE_PASSES || !shouldRetryResolution(outcomes)) return null;
    console.warn("libgen resolve retry", { md5, outcomes });
    await new Promise((r) => setTimeout(r, LIBGEN_RETRY_PAUSE_MS));
  }
  return null;
}

// Source #2 — libgen.rs fork (library.lol / books.ms). A different database, so it
// covers books libgen.li lacks. Scrape the /main/ then /fiction/ page for its GET link.
async function fetchFromLibraryLol(md5: string): Promise<Response | null> {
  for (const host of LIBGEN_RS_HOSTS) {
    if (await isMirrorDown(host)) continue;
    let anyReachable = false;
    for (const type of ["main", "fiction"] as const) {
      const html = await fetchTextTimed(`${host}/${type}/${md5}`, 8000);
      if (!html) continue;
      anyReachable = true;
      const url = parseLibraryLolUrl(html, host);
      if (!url) continue;
      const resp = await fetchFile(url, `${host}/`);
      if (resp) return resp;
    }
    if (!anyReachable) await markMirrorDown(host);
  }
  return null;
}

// True if the returned HTML is an AA anti-bot interstitial (a JS fingerprint challenge
// on .li that sets `redirect_link`, or a "Redirecting..." shim on .pm) rather than the
// real /md5/ page. These pages return 200 text/html but contain zero of the data we need,
// so parseIpfsCids / parseCoverUrl would silently find nothing. Reject them so the mirror
// loop moves on to one that answers with the actual page.
function isAaChallengePage(html: string): boolean {
  if (html.length < 2048 && /<title>\s*Redirecting/i.test(html)) return true;
  if (/var\s+redirect_link\s*=/.test(html) || /iife\.min\.js/.test(html)) return true;
  return false;
}

// The Anna's Archive /md5 page HTML (raced across mirrors) — the CID source for IPFS
// AND the slow_download partner list. Circuit-breaker aware.
async function fetchAaMd5Html(md5: string, ctx?: ExecutionContext): Promise<{ base: string; html: string } | null> {
  for (const base of await getAaMirrors(ctx)) {
    if (await isMirrorDown(base)) continue;
    if (await deferProbe(base, `${base}/md5/${md5}`, ctx)) continue; // long dead — probe off-request
    const html = await fetchTextTimed(`${base}/md5/${md5}`, 8000);
    if (!html) {
      await markMirrorDown(base);
      continue;
    }
    if (isAaChallengePage(html)) continue; // don't blame the mirror for an interstitial, just skip
    return { base, html };
  }
  return null;
}

// Cap on total IPFS (cid × gateway) fetch attempts, so the last-resort leg stays bounded
// even when a file lists several CIDs and every gateway is cold.
const IPFS_MAX_ATTEMPTS = 8;

// Source #3 — IPFS. Pull ALL CIDs off the AA md5 page (a file often has a CIDv0 + CIDv1
// from different providers) and try each across public gateways. Best-effort: unpinned
// CIDs 504, so this legitimately misses for many files. Tight per-attempt budget + a
// hard attempt cap keep it from stalling the auto-chain.
async function fetchFromIpfs(md5: string): Promise<Response | null> {
  const page = await fetchAaMd5Html(md5);
  if (!page) return null;
  const cids = parseIpfsCids(page.html);
  if (!cids.length) return null;
  let attempts = 0;
  for (const cid of cids) {
    for (const gw of IPFS_GATEWAYS) {
      if (attempts++ >= IPFS_MAX_ATTEMPTS) return null;
      const gwHost = gw.replace(/\/ipfs$/, "");
      if (await isMirrorDown(gwHost)) continue;
      const resp = await fetchFile(`${gw}/${cid}`, undefined, 6000);
      if (resp) return resp;
      await markMirrorDown(gwHost);
    }
  }
  return null;
}

// Context passed to resolvers: md5 for the exact-file sources; title/author/ext for the
// metadata-keyed ones (Gutenberg). Title/author ride along in the download URL.
interface DlContext {
  md5: string;
  title: string;
  author: string;
  ext: string; // includes the leading dot, e.g. ".epub"
}

// Source #4 — Project Gutenberg (public-domain classics via the free Gutendex API).
// Keyed by title+author: confirm a confident, public-domain match, then fetch the format
// matching the requested ext. Legal + rock-solid for the slice it covers, so it slots in
// ahead of the flaky IPFS leg. A different edition/md5 than the search hit, but the same
// work — exactly what the user wanted — and it caches to R2 under the requested key like any source.
async function fetchFromGutenberg(dl: DlContext): Promise<Response | null> {
  const ext = dl.ext.replace(/^\./, "");
  if (!dl.title || !gutenbergSupportsExt(ext)) return null; // Gutenberg has no PDF etc.
  const query = encodeURIComponent(`${dl.title} ${dl.author}`.trim());
  // Trailing slash avoids gutendex's 301 (see GUTENDEX_TIMEOUT_MS). The budget stays at
  // 8s here and is not cut to 5s like the search path: this leg decides whether the user
  // gets a file at all, and a download is a request they already expect to take a moment.
  const json = (await fetchJsonTimed(`https://gutendex.com/books/?search=${query}`, 8000)) as
    | { results?: { title?: string; copyright?: boolean | null; authors?: { name?: string }[]; formats?: Record<string, string> }[] }
    | null;
  const results = json?.results;
  if (!Array.isArray(results)) return null;
  for (const book of results.slice(0, 5)) {
    if (book.copyright !== false) continue; // public-domain records only
    const authors = (book.authors || []).map((a) => a.name || "");
    if (!gutenbergMatches(dl.title, dl.author, book.title || "", authors)) continue;
    const url = pickGutenbergFormat(book.formats || {}, ext);
    if (!url) continue;
    const resp = await fetchFile(url, undefined, 15000);
    if (resp) return resp;
  }
  return null;
}

// Source #5 — Internet Archive (public-domain books, comics, magazines via archive.org).
// Metadata-keyed like Gutenberg: advancedsearch by title+author, restricted to items
// marked NOT_IN_COPYRIGHT and NOT access-restricted (so we skip borrow-only DRM copies
// that would 401), then /metadata/<id> for the file list, then /download/<id>/<name>.
// Broader coverage than Gutenberg (older scans, comics collection, magazine rack) so it
// slots in right after Gutenberg and ahead of the last-resort IPFS leg.
async function fetchFromInternetArchive(dl: DlContext): Promise<Response | null> {
  const ext = dl.ext.replace(/^\./, "");
  if (!dl.title || !internetArchiveSupportsExt(ext)) return null;
  // Unquoted title/creator terms — the strict-quoted form is too restrictive on IA's
  // messy cataloging. We filter false positives client-side with internetArchiveMatches.
  const iaTerm = (s: string) => s.replace(/["\\()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  const titleTerm = iaTerm(dl.title);
  if (!titleTerm) return null;
  const authorTerm = iaTerm(dl.author);
  const q =
    `title:(${titleTerm})` +
    (authorTerm ? ` AND creator:(${authorTerm})` : "") +
    ` AND mediatype:texts AND possible-copyright-status:NOT_IN_COPYRIGHT AND -access-restricted-item:true`;
  const searchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=creator&rows=8&output=json`;
  const search = (await fetchJsonTimed(searchUrl, 8000)) as
    | { response?: { docs?: { identifier?: string; title?: string; creator?: string | string[] }[] } }
    | null;
  const docs = search?.response?.docs;
  if (!Array.isArray(docs) || !docs.length) return null;
  for (const doc of docs.slice(0, 5)) {
    if (!doc.identifier) continue;
    if (!internetArchiveMatches(dl.title, dl.author, doc.title || "", doc.creator)) continue;
    const meta = (await fetchJsonTimed(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`, 8000)) as
      | { files?: { name?: string; format?: string; source?: string }[] }
      | null;
    const name = pickInternetArchiveFile(meta?.files || [], ext);
    if (!name) continue;
    // archive.org paths are `/` per segment — encode each, keep the slash.
    const url = `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodeURIComponent(name)}`;
    const resp = await fetchFile(url, undefined, 20000);
    if (resp) return resp;
  }
  return null;
}

// Source #6 — libgen title/author search. Metadata-keyed like Gutenberg / Internet
// Archive, but covers copyrighted works (libgen has ~everything, PD sources don't).
// Used when the clicked md5 came from a source outside libgen's DB (typically a z-lib
// upload the AA aggregate returned): search libgen for the same title+author, filter
// candidates with the shared fuzzy matcher (never serve the wrong book).
//
// Two paths depending on whether libgen has the SAME ext or only a DIFFERENT ext:
//   (a) Same ext:      download the bytes directly, populate the alias map so future
//                      clicks on the requested md5 skip the search step next time.
//   (b) Different ext: return a 302 to the alternate-ext download URL. The browser
//                      follows, hits handleDownload again with the correct md5+ext,
//                      the file caches cleanly under its own key, no wrong-ext bytes
//                      served. We probe the candidate first so the redirect doesn't
//                      immediately 404.
async function fetchFromLibgenSearch(dl: DlContext): Promise<Response | null> {
  if (!dl.title) return null;
  const wantedExt = dl.ext.replace(/^\./, "").toLowerCase();
  // Raw (not pre-encoded) — libgenSearchUrl does the encoding, and double-encoding the
  // spaces here would search for the literal "%20".
  const query = `${dl.title} ${dl.author}`.trim();
  const tried = new Set<string>([dl.md5]); // skip the md5 we already know libgen doesn't have
  for (const base of LIBGEN_MIRRORS) {
    const html = await fetchTextTimed(libgenSearchUrl(base, query), 8000);
    if (!html || isLibgenErrorPage(html)) continue;
    const rows = parseLibgenSearch(html);
    if (!rows.length) continue;

    // Title+author fuzzy match — never serve the wrong book. The ext split happens
    // AFTER the match filter so we can pivot to the "different ext" path cleanly.
    const titleMatched = rows.filter((r) => titleAuthorMatch(dl.title, dl.author, r.title, r.author));
    if (!titleMatched.length) continue;

    // (a) Same-ext direct download. Populate alias on success so the next clicker
    //     skips this whole search dance. Cap at 3 candidates — a real match is almost
    //     always in the top few libgen rank, and each miss costs ~3s of mirror races.
    const sameExt = wantedExt ? titleMatched.filter((r) => r.book_filetype.toLowerCase() === wantedExt) : titleMatched;
    for (const cand of sameExt.slice(0, 3)) {
      if (tried.has(cand.md5)) continue;
      tried.add(cand.md5);
      const resp = await fetchFromLibgenLi(cand.md5);
      if (resp) {
        setAlias(dl.md5, cand.md5).catch(() => {}); // fire-and-forget; failure is harmless
        return resp;
      }
    }

    // (b) Different-ext redirect. Only kicks in when we asked for a specific ext AND
    //     no same-ext candidate resolved. Probe the alternate candidate before sending
    //     the redirect — verifying-then-cancelling costs one round trip but avoids
    //     bouncing the user to a URL that would 404.
    if (wantedExt) {
      const diffExt = titleMatched.filter((r) => {
        const ft = (r.book_filetype || "").toLowerCase();
        return ft && ft !== wantedExt && /^[a-z0-9]{1,6}$/.test(ft);
      });
      for (const cand of diffExt.slice(0, 3)) {
        if (tried.has(cand.md5)) continue;
        tried.add(cand.md5);
        const verify = await fetchFromLibgenLi(cand.md5);
        if (!verify) continue;
        await verify.body?.cancel(); // don't drain the file — we're only probing
        const candExt = cand.book_filetype.toLowerCase();
        const rawTitle = (dl.title || cand.title).replace(/\.[a-z0-9]{1,8}$/i, "");
        const safeTitle = safeFilename(rawTitle).replace(/[\\/]+/g, "-");
        const authorQs = dl.author ? `?author=${encodeURIComponent(dl.author)}` : "";
        const location = `/download/${cand.md5}/${encodeURIComponent(safeTitle)}.${candExt}${authorQs}`;
        return new Response(null, { status: 302, headers: { Location: location } });
      }
    }
  }
  return null;
}

// Source #7 — Standard Ebooks. Small (~800 titles) curated PD catalogue of
// professionally re-typeset EPUBs. For the slice it covers it beats anything else
// on quality, so it slots ahead of Gutenberg for `.epub` (and `.kepub`/`.azw3`)
// requests. Two-step: OpenSearch atom feed by title+author, then fetch the enclosure
// URL matching the requested ext.
async function fetchFromStandardEbooks(dl: DlContext): Promise<Response | null> {
  const ext = dl.ext.replace(/^\./, "");
  if (!dl.title || !standardEbooksSupportsExt(ext)) return null;
  const query = encodeURIComponent(`${dl.title} ${dl.author}`.trim());
  const xml = await fetchTextTimed(`https://standardebooks.org/feeds/atom/all?query=${query}`, 8000);
  if (!xml) return null;
  const entries = parseStandardEbooksFeed(xml);
  for (const book of entries.slice(0, 5)) {
    if (!standardEbooksMatches(dl.title, dl.author, book)) continue;
    const url = pickStandardEbooksFormat(book.formats, ext);
    if (!url) continue;
    const resp = await fetchFile(url, undefined, 15000);
    if (resp) return resp;
  }
  return null;
}

// Number of AA slow_download partner slots to try in parallel. AA typically exposes
// ~10 per md5; each fetch is cheap (the countdown page is small), and hitting several
// in parallel lets us take the fastest partner that's ready (some release the URL
// immediately, others gate 30s+). Capped low so we don't burn AA's IP-rate budget on
// a single md5 miss.
const AA_SLOW_PARTNERS = 4;
// Hard cap on wait time we'll respect from any single partner countdown. Kept ≤20s
// so aa_slow can run inside the auto chain without pushing the request past the
// Worker wall budget when it's the tail source (fires after exact-race + all metadata
// sources have already burned a chunk of the budget). A partner asking for >20s is
// throttled us specifically; hitting another partner is faster than waiting.
const AA_SLOW_MAX_WAIT_S = 20;

// Source #8 — Anna's Archive slow_download. Fires ~4 partner endpoints in parallel;
// any partner that either releases the direct URL immediately OR wants a bounded
// countdown wins, we wait its countdown, refetch, and stream the file. Last-resort
// because of the wait, but AA lists ~everything so this closes the gap for md5s that
// nothing else has (typically z-lib uploads: AA's aggregate has them, libgen never
// mirrored them). Requires a real AA md5 page to exist — we probe /md5 first so a
// bogus md5 doesn't cost 4 × 45s of waiting on non-existent partners.
async function fetchFromAaSlow(md5: string): Promise<Response | null> {
  // Confirm AA has this md5 at all — no md5 page means no partners exist.
  const md5Page = await fetchAaMd5Html(md5);
  if (!md5Page) return null;
  const partners = Array.from({ length: AA_SLOW_PARTNERS }, (_, i) => i);
  const attempts = partners.map((p) => attemptAaSlowPartner(md5Page.base, md5, p));
  for await (const resp of inCompletionOrder(attempts)) {
    if (resp) {
      Promise.all(attempts.map((a) => a.then((r) => (r && r !== resp ? r.body?.cancel() : undefined)).catch(() => {}))).catch(() => {});
      return resp;
    }
  }
  return null;
}

// Resolve one AA slow_download partner: GET the queue page, if URL is immediately
// present fetch it; else wait the countdown (capped) and refetch once. All errors
// silent-null so a bad partner doesn't take down the parallel race.
async function attemptAaSlowPartner(base: string, md5: string, partner: number): Promise<Response | null> {
  const queueUrl = `${base}/slow_download/${md5}/0/${partner}`;
  const first = await fetchTextTimed(queueUrl, 8000);
  if (!first) return null;
  const state = parseAaSlowDownloadPage(first);
  if (state.fatal) return null;
  if (state.url) return await fetchFile(state.url, `${base}/`, 20000);
  if (typeof state.waitSeconds !== "number" || state.waitSeconds > AA_SLOW_MAX_WAIT_S) return null;
  await new Promise((r) => setTimeout(r, (state.waitSeconds! + 1) * 1000));
  const second = await fetchTextTimed(queueUrl, 8000);
  if (!second) return null;
  const state2 = parseAaSlowDownloadPage(second);
  if (state2.url) return await fetchFile(state2.url, `${base}/`, 20000);
  return null;
}

// Dispatch to a single source (exhaustive switch). Called from both the auto chain
// (raceExactMd5 + the METADATA_SOURCES fallthrough) and from user-forced `?source=`.
// The per-mirror circuit breaker inside each resolver handles transient host failure;
// we deliberately do NOT cache source-level misses here — a source-wide "missed X"
// entry would poison recovery for every other user hitting the same md5, and the
// per-mirror breaker already provides thundering-herd protection where it matters
// (individual dead hosts, self-healing 60s TTL).
function fetchFromSource(source: DownloadSource, dl: DlContext): Promise<Response | null> {
  switch (source) {
    case "libgenli":
      return fetchFromLibgenLi(dl.md5);
    case "librarylol":
      return fetchFromLibraryLol(dl.md5);
    case "standardebooks":
      return fetchFromStandardEbooks(dl);
    case "gutenberg":
      return fetchFromGutenberg(dl);
    case "internetarchive":
      return fetchFromInternetArchive(dl);
    case "libgensearch":
      return fetchFromLibgenSearch(dl);
    case "ipfs":
      return fetchFromIpfs(dl.md5);
    case "aa_slow":
      return fetchFromAaSlow(dl.md5);
    default: {
      const _exhaustive: never = source;
      return Promise.resolve(_exhaustive);
    }
  }
}

// Auto-download: race the two exact-md5 sources concurrently (whichever answers
// first wins) since they hit different DBs and either could be down without the
// user paying serial timeouts. If both miss, walk the metadata-keyed sources
// serially — those ARE order-sensitive (best-quality PD sources first, then the
// broad copyrighted-works fallback, then the last-resort waits).
/**
 * A resolved download plus whether the md5 in the URL was *proven* by the source that
 * answered. Sources keyed on the md5 itself (libgen's ads.php, an AA IPFS CID, an AA
 * slow_download slot) only answer for an md5 that genuinely exists upstream. The
 * metadata-keyed sources answer on title+author and would happily serve Pride and
 * Prejudice for an md5 someone invented — which is what makes `proven` worth tracking:
 * it decides whether the bytes may be written to R2 under that md5. See handleDownload.
 */
interface ResolvedDownload {
  resp: Response;
  proven: boolean;
}

async function fetchAuto(dl: DlContext): Promise<ResolvedDownload | null> {
  const exact = await raceExactMd5(dl);
  if (exact) return { resp: exact, proven: true }; // every EXACT_MD5_SOURCE proves the md5
  for (const source of METADATA_SOURCES) {
    const resp = await fetchFromSource(source, dl);
    if (resp) return { resp, proven: MD5_PROVING_SOURCES.has(source) };
  }
  return null;
}

const EXACT_MD5_SOURCES: readonly DownloadSource[] = ["libgenli", "librarylol"];
const METADATA_SOURCES: readonly DownloadSource[] = ["standardebooks", "gutenberg", "internetarchive", "libgensearch", "ipfs", "aa_slow"];

/**
 * Sources that resolve by md5 and therefore prove the requested md5 is a real upstream
 * record. `ipfs` and `aa_slow` sit in METADATA_SOURCES purely for *ordering* (they're
 * slow, so they run last) — both are md5-keyed and belong here.
 */
const MD5_PROVING_SOURCES = new Set<DownloadSource>(["libgenli", "librarylol", "ipfs", "aa_slow"]);

// Race the exact-md5 sources: fire both, take the first that yields a real file,
// cancel the other's in-flight body. Wall-clock = fastest source, not sum of both.
async function raceExactMd5(dl: DlContext): Promise<Response | null> {
  const attempts = EXACT_MD5_SOURCES.map((s) => fetchFromSource(s, dl));
  for await (const resp of inCompletionOrder(attempts)) {
    if (resp) {
      // First non-null wins; any straggler that also succeeds gets its body cancelled
      // to free the socket. Fired without awaiting — it must not delay the response.
      Promise.all(attempts.map((p) => p.then((r) => (r && r !== resp ? r.body?.cancel() : undefined)).catch(() => {}))).catch(() => {});
      return resp;
    }
  }
  return null;
}

// ---- Range requests on the R2-cached download path ---------------------------
// Books are small; comics are not (measured up to 538 MB on libgen's `c` topic). Without
// range support a dropped connection restarts from byte zero, and no client can seek.
// Only the R2 paths honour ranges: the backup providers reassemble ordered chunks and
// the upstream proxy is a single pass, so neither can seek without buying the whole
// object first. Those keep answering 200 (legal for a Range request) and, because they
// re-warm R2 on the way out, the *next* request for that book is rangeable.
type RangeReq = { offset: number; length?: number } | { suffix: number };

/** Parse a single-range `Range: bytes=…` header. Multi-range and junk return null (serve 200). */
function parseRangeHeader(header: string | null | undefined): RangeReq | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null; // multi-range / non-byte units — answer 200 rather than guess
  const [, rawStart, rawEnd] = m;
  if (rawStart === "" && rawEnd === "") return null;
  if (rawStart === "") {
    const suffix = Number(rawEnd);
    return suffix > 0 ? { suffix } : null;
  }
  const offset = Number(rawStart);
  if (!Number.isSafeInteger(offset)) return null;
  if (rawEnd === "") return { offset };
  const end = Number(rawEnd);
  if (!Number.isSafeInteger(end) || end < offset) return null;
  return { offset, length: end - offset + 1 };
}

/** Build the 200 or 206 response for an R2 object, given the (already applied) range. */
function r2DownloadResponse(obj: R2ObjectBody, mime: string, disposition: string, range: RangeReq | null): Response {
  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Content-Disposition": disposition,
    "Accept-Ranges": "bytes",
  };
  if (!range) {
    headers["Content-Length"] = String(obj.size);
    return new Response(obj.body, { headers });
  }
  // `obj.size` is always the FULL object size, never the slice length.
  const start = "suffix" in range ? Math.max(0, obj.size - range.suffix) : range.offset;
  const avail = obj.size - start;
  const length = "suffix" in range ? Math.min(range.suffix, obj.size) : Math.min(range.length ?? avail, avail);
  headers["Content-Length"] = String(length);
  headers["Content-Range"] = `bytes ${start}-${start + length - 1}/${obj.size}`;
  return new Response(obj.body, { status: 206, headers });
}

/**
 * Ranged R2 read that can't be turned into an upstream re-fetch. A range past EOF makes
 * `BOOKS.get` return null, which is indistinguishable from a cache miss — so a client
 * sending `Range: bytes=99999999999-` on a book we *do* have would drive the full source
 * chain on every request. That's a free amplification lever, so an unsatisfiable range on
 * a present object is resolved to a 416 instead of a miss.
 */
async function getR2Ranged(
  bucket: R2Bucket,
  key: string,
  range: RangeReq | null,
): Promise<{ obj: R2ObjectBody } | { unsatisfiable: number } | null> {
  // R2 does not agree with itself on how an out-of-bounds range fails: an offset past
  // EOF *throws* on some objects and returns null on others. Both mean the same thing
  // here, and neither may be allowed to escape as a 502 or fall through to the source
  // chain, so collapse them into one "no ranged body" outcome.
  let obj: R2ObjectBody | null = null;
  try {
    obj = (await bucket.get(key, range ? { range } : undefined)) as R2ObjectBody | null;
  } catch (e) {
    if (!range) throw e; // an un-ranged failure is a real R2 error, not a bad request
    obj = null;
  }
  if (obj) return { obj };
  if (!range) return null;
  const head = await bucket.head(key);
  return head ? { unsatisfiable: head.size } : null;
}

function rangeNotSatisfiable(size: number): Response {
  return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" } });
}

async function handleDownload(
  md5: string,
  filename: string,
  env: Env,
  ctx: ExecutionContext,
  source?: string | null,
  author?: string | null,
  rangeHeader?: string | null,
  inline = false,
): Promise<Response> {
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 && /^\.[a-z0-9]{1,8}$/i.test(filename.slice(dot)) ? filename.slice(dot).toLowerCase() : "";
  const mime = MIME_BY_EXT[ext] || "application/octet-stream";
  const key = `files/${md5}${ext}`;
  const safeName = safeFilename(filename);
  // `?inline=1` lets a PDF open in the browser's own viewer (the reader only does EPUB).
  // Only for PDFs: everything else has no viewer and would just render as bytes.
  const disposition = inline && mime === "application/pdf" ? inlineDisposition(safeName) : attachmentDisposition(safeName);
  // Title/author (from the download URL) let the metadata-keyed sources (Gutenberg) find
  // the same work when the exact-md5 sources miss. Title is recovered from the filename.
  const dl: DlContext = { md5, ext, title: filename.replace(/\.[a-z0-9]{1,8}$/i, "").replace(/_+/g, " ").trim(), author: (author || "").slice(0, 200) };

  // Before every cache and source below: each of them would serve the bytes again.
  if (takedown.isTakenDown(md5, filename, dl.title, author)) {
    // Only a listed md5 triggers the purge. The title and author come from the URL, so
    // letting them delete storage would let anyone wipe any cached book.
    if (takedown.isTakenDownMd5(md5)) ctx.waitUntil(purgeTakedown(env, md5));
    return takedownGone();
  }

  // Community leaderboard: best-effort +1 on the upload's download counter (a no-op
  // for non-upload md5s). In waitUntil so it never delays or breaks the download.
  if (env.DB) ctx.waitUntil(community.incrementDownload(env, md5).catch(() => {}));

  const range = parseRangeHeader(rangeHeader);

  // Cache hit -> serve straight from R2 (free egress, instant).
  const cached = await getR2Ranged(env.BOOKS, key, range);
  if (cached && "unsatisfiable" in cached) return rangeNotSatisfiable(cached.unsatisfiable);
  if (cached) return r2DownloadResponse(cached.obj, mime, disposition, range);

  // Alias-aware R2 lookup — a prior libgensearch resolve may have mapped this md5
  // to a downloadable same-ext one; if that alias's bytes are already in R2 under
  // its own key, serve those instead of re-fetching. Alias TTL is 7d; expiration
  // gracefully degrades to "just re-run the source chain".
  const alias = await getAlias(md5);
  if (alias && takedown.isTakenDownMd5(alias)) return takedownGone();
  if (alias && alias !== md5) {
    const aliasKey = `files/${alias}${ext}`;
    const cachedAlias = await getR2Ranged(env.BOOKS, aliasKey, range);
    if (cachedAlias && "unsatisfiable" in cachedAlias) return rangeNotSatisfiable(cachedAlias.unsatisfiable);
    if (cachedAlias) return r2DownloadResponse(cachedAlias.obj, mime, disposition, range);
    // Alias set but its R2 evicted — fall through to source chain, but with the
    // aliased md5 in flight so we skip the search dance and go straight to libgenli.
    dl.md5 = alias;
  }

  // R2 miss -> try long-term backups before re-scraping. Telegram (primary) then
  // Discord (secondary); serving also re-warms R2. Each provider is validated on
  // its first chunk, so a dead provider fails over cleanly with no bytes sent.
  // Skip entirely when no provider is configured (e.g. bindings enabled but bot
  // secrets unset) so the feature stays truly inert — no wasted KV read per miss.
  if (env.BACKUPS && backup.backupConfigured(env)) {
    try {
      const { manifest, providers } = await backup.readableProviders(env, md5);
      for (const provider of providers) {
        try {
          // If the other configured provider is still missing this book, converge it —
          // but only once `serve` has re-warmed R2, since that's where ingest() reads
          // from. Passing it as a callback (rather than enqueueing here) is what makes
          // the convergence described in HANDOFF §4 actually reachable.
          const converge = backup.needsMoreBackup(env, manifest) ? () => enqueueBackup(env, md5, ext, mime) : undefined;
          return await backup.serve(env, manifest!, provider, safeName, ctx, converge, mime);
        } catch (e) {
          console.error(`backup serve via ${provider} failed`, e);
        }
      }
    } catch (e) {
      console.error("backup lookup failed", e);
    }
  }

  // R2 + backups miss -> resolve from the live sources. A forced `?source=` fetches
  // just that one; otherwise "auto" races the exact-md5 sources (libgenli || librarylol)
  // and, on miss, walks the metadata sources serially. Any source can return a 302 —
  // libgensearch does this when libgen has the same *work* in a different *ext* — in
  // which case we forward the redirect and skip R2/backup entirely (the follow-up
  // request handles caching under the correct key).
  const resolved: ResolvedDownload | null = isDownloadSource(source)
    ? await fetchFromSource(source, dl).then((r) => (r ? { resp: r, proven: MD5_PROVING_SOURCES.has(source) } : null))
    : await fetchAuto(dl);
  if (!resolved) return json({ error: "Download link not found." }, 404);
  const upstream = resolved.resp;
  if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get("Location")) {
    // Format-mismatch redirect — pass through verbatim; caching happens on the follow-up.
    return upstream;
  }
  if (!upstream.body) return json({ error: "Download link not found." }, 404);

  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Content-Disposition": disposition,
  };
  const len = upstream.headers.get("Content-Length");
  if (len) headers["Content-Length"] = len;

  // Keep the transfer alive when the upstream drops it partway through (see
  // resumable.ts: libgen's CDN ends slow transfers early, and cleanly). Only possible
  // with a known length and a plain 200 to resume from.
  const total = len ? Number(len) : NaN;
  const md5ForResume = dl.md5;
  const body =
    upstream.status === 200 && Number.isSafeInteger(total) && total > 0
      ? resumableBody(upstream.body, {
          total,
          onResume: (offset, attempt) => console.warn("download resume", { md5: md5ForResume, offset, total, attempt }),
          refetch: async (offset) => {
            // The same file URL first — usually still valid, and it keeps the same bytes.
            if (upstream.url) {
              const again = await fetchRangeFrom(upstream.url, offset, DL_HEADERS);
              if (again?.status === 206) return again;
              await again?.body?.cancel().catch(() => {});
            }
            // Its signed key may have expired. An md5-proven source's bytes are exactly what
            // that md5 names, so a fresh libgen link for the same md5 serves the same file.
            // A metadata-matched source (a different edition) must never be spliced this way.
            if (!resolved.proven) return null;
            for (const base of LIBGEN_MIRRORS) {
              const cand = await resolveLibgenLink(base, md5ForResume);
              if (!cand) continue;
              const fresh = await fetchRangeFrom(cand.url, offset, { ...DL_HEADERS, Referer: `${cand.base}/` });
              if (fresh?.status === 206) return fresh;
              await fresh?.body?.cancel().catch(() => {});
            }
            return null;
          },
        })
      : upstream.body;

  // Only an md5-proving source earns a place in R2 under this md5. A metadata source
  // matched on title+author alone, so `files/<md5><ext>` would be a key chosen by the
  // caller rather than by anything upstream — and `/download/<any 32 hex>/<real book
  // title>.epub` is unauthenticated. Verified live 2026-08-20: fabricated md5s produced
  // real 24 MB objects at exactly the requested keys, bounded only by RATE_LIMITER's
  // 100/60s. Caching them was worth a re-fetch on the rare legitimate hit; storing an
  // unbounded key space was not. The alias map (§libgensearch) already makes the
  // repeat cost a direct ads.php fetch rather than another search.
  //
  // A `search_index` attestation was briefly accepted here as a second way in, on the
  // theory that the durable backup layer had stalled because nothing was provable while
  // AA was down. That theory was wrong — the check behind it listed KV *locally* and
  // read 0 keys; production held ~149k manifests the whole time, with Telegram and
  // Discord both current. R2 shrinking is simply the 30-day `files/` cache draining
  // faster than a degraded upstream refills it, and `backup.serve()` re-warms any book
  // that expires. Nothing needed rescuing.
  //
  // Reverted because the trade only made sense against that imagined outage: attestation
  // lets Gutenberg/IA bytes take a real libgen md5's key, and since R2 is what the backup
  // consumer reads from, a substituted edition would become the *permanent* copy for that
  // md5. `proven` guarantees the bytes are the ones that md5 names upstream. Keep it.
  // The resumed body is a JavaScript stream, and a JS stream has no byte length of its
  // own. Workers then drop Content-Length from the response (the client loses its
  // progress bar) and R2 refuses it outright — "Provided readable stream must have a
  // known length" — so nothing got cached or backed up. Measured on the first deploy of
  // the resume, 2026-09-15. A FixedLengthStream gives each branch its length back, and
  // it also errors if the byte count comes out different: a second truncation guard.
  const sized = (stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> => {
    if (stream === upstream.body || !Number.isSafeInteger(total) || total <= 0) return stream;
    const fixed = new FixedLengthStream(total);
    stream.pipeTo(fixed.writable).catch(() => {
      /* the readable side errors with it; both consumers see the failure */
    });
    return fixed.readable;
  };

  if (!resolved.proven) return new Response(sized(body), { headers });

  // Stream to the client while teeing a copy into R2 for next time. Once the R2
  // copy lands, enqueue it for long-term backup (Telegram/Discord) — the consumer
  // reads the object back out of R2 in chunks.
  const [toClient, toR2] = body.tee();
  ctx.waitUntil(
    // The stored copy always carries the attachment form; `inline` is per-request.
    env.BOOKS.put(key, sized(toR2), { httpMetadata: { contentType: mime, contentDisposition: attachmentDisposition(safeName) } }).then(
      () => enqueueBackup(env, md5, ext, mime),
    ),
  );

  return new Response(sized(toClient), { headers });
}

// ---- Opt-in account sync (no passwords; the ID itself is the bearer secret) --
const ACCOUNT_ID_RE = /^[a-f0-9]{64}$/;
const MAX_SYNC_BYTES = 2 * 1024 * 1024; // 2 MB cap on a user's metadata blob

function genAccountId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function bearerId(request: Request): string | null {
  const m = (request.headers.get("Authorization") || "").match(/^Bearer\s+([A-Fa-f0-9]{64})$/);
  return m ? m[1].toLowerCase() : null;
}

// Verify a Cloudflare Turnstile token. No-ops (allows) when no secret is configured
// so local dev / un-provisioned envs keep working; fails closed once a secret is set.
async function verifyTurnstile(token: string | null, env: Env, ip: string | null): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  try {
    const form = new FormData();
    form.append("secret", env.TURNSTILE_SECRET);
    form.append("response", token);
    if (ip) form.append("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

async function handleAccount(request: Request, env: Env): Promise<Response> {
  if (!env.SYNC) return json({ error: "Sync is not configured" }, 503);

  // Create a brand-new account → return its key (the user's only credential).
  if (request.method === "POST") {
    // Stricter, dedicated limit on creation (the abusable, cost-bearing path).
    if (env.ACCOUNT_CREATE_LIMITER) {
      const ip = request.headers.get("CF-Connecting-IP") || "anon";
      try {
        const { success } = await env.ACCOUNT_CREATE_LIMITER.limit({ key: ip });
        if (!success) return json({ error: "Too many new accounts from your network — please slow down." }, 429);
      } catch {
        /* limiter unavailable — don't block */
      }
    }
    // Bot protection on the create path (only enforced when TURNSTILE_SECRET is set).
    let turnstileToken: string | null = null;
    try {
      const body = (await request.json()) as { token?: unknown };
      if (typeof body?.token === "string") turnstileToken = body.token;
    } catch {
      /* body is optional */
    }
    if (!(await verifyTurnstile(turnstileToken, env, request.headers.get("CF-Connecting-IP")))) {
      return json({ error: "Verification failed — please complete the challenge and try again." }, 403);
    }
    const id = genAccountId();
    // Empty accounts auto-expire in 7 days; the first real sync (PUT) makes them
    // permanent, so abandoned/spam empties clean themselves up without touching real data.
    await env.SYNC.put(`acct:${id}`, JSON.stringify({ type: "bookracy-data", version: 2, data: {} }), { expirationTtl: 7 * 24 * 60 * 60 });
    return json({ id });
  }

  const id = bearerId(request);
  if (!id || !ACCOUNT_ID_RE.test(id)) return json({ error: "Missing or invalid account key" }, 401);
  const key = `acct:${id}`;

  if (request.method === "GET") {
    const blob = await env.SYNC.get(key);
    if (blob === null) return json({ error: "Account not found" }, 404);
    return new Response(blob, { headers: { "Content-Type": "application/json" } });
  }

  if (request.method === "PUT") {
    const body = await request.text();
    if (body.length > MAX_SYNC_BYTES) return json({ error: "Backup too large" }, 413);
    try {
      const parsed = JSON.parse(body) as { type?: unknown };
      if (!parsed || parsed.type !== "bookracy-data") return json({ error: "Invalid payload" }, 400);
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    await env.SYNC.put(key, body);
    return json({ ok: true, updatedAt: new Date().toISOString() });
  }

  if (request.method === "DELETE") {
    await env.SYNC.delete(key);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
}

// ---- Community uploads (uploads, listing, leaderboard, profile) --------------
// Identity is the same no-password account key (Bearer) used for sync. We store
// only sha256(key) in D1, never the key itself. The whole feature is inert when
// D1 is unbound. Uploaded books flow through the SAME R2 + Telegram/Discord
// pipeline as scraped ones, so they're durable + free to serve.

// Resolve + verify the caller's account: the Bearer must be a real, created
// account (exists in SYNC). Returns the id + its stored blob, or null.
async function requireAccount(request: Request, env: Env): Promise<{ id: string; blob: string } | null> {
  const id = bearerId(request);
  if (!id) return null;
  const blob = await env.SYNC.get(`acct:${id}`);
  if (blob === null) return null;
  return { id, blob };
}

// Uploading / claiming a username is real activity → drop the 7-day TTL that empty
// accounts carry, so a contributor's identity never expires out from under their
// uploads. Only re-writes small (empty/near-empty) blobs to avoid churning big sync data.
async function persistAccount(env: Env, id: string, blob: string): Promise<void> {
  if (blob.length < 4096) {
    try {
      await env.SYNC.put(`acct:${id}`, blob);
    } catch {
      /* best effort */
    }
  }
}

// Shape a community upload like a normal BookItem (so the frontend reuses its book
// cards), plus a few community-only fields. Uploads have no scraped cover yet, so
// book_image is left empty → the cover component shows its on-brand fallback.
function communityToBookItem(u: community.CommunityUpload, origin: string) {
  const safeTitle = u.title.replace(/[\\/]+/g, "-");
  const ext = u.ext ? `.${u.ext}` : "";
  return {
    id: 0,
    title: u.title,
    author: u.author || "Unknown Author",
    md5: u.md5,
    link: `${origin}/download/${u.md5}/${encodeURIComponent(safeTitle)}${ext}`,
    // Once a cover is stored in R2 the existing /cover endpoint serves it; otherwise
    // leave it empty so the card shows the on-brand fallback (no wasted scrape).
    book_image: u.cover ? `${origin}/cover/${u.md5}/thumbnail.jpg` : "",
    book_filetype: u.ext,
    book_lang: u.lang,
    book_size: formatBytes(u.size),
    book_length: "",
    description: u.description,
    publisher: "",
    year: u.year,
    series: "",
    isbn: "",
    cid: "",
    external_cover_url: "",
    other_titles: u.title,
    uploader: u.uploader,
    downloads: u.downloads,
    uid: u.uid,
    createdAt: u.createdAt,
  };
}

async function handleUploadCreate(request: Request, url: URL, origin: string, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!community.communityEnabled(env)) return json({ error: "Uploads are not available." }, 503);
  // The durable store is Telegram/Discord (R2 alone is a 30-day cache); refuse
  // uploads we can't durably back up so a contributor's book is never silently lost.
  if (!backup.backupConfigured(env)) return json({ error: "Uploads are temporarily unavailable." }, 503);

  // Stricter, dedicated per-IP limit on this write-heavy, storage-bearing path.
  if (env.UPLOAD_LIMITER) {
    const ip = request.headers.get("CF-Connecting-IP") || "anon";
    try {
      const { success } = await env.UPLOAD_LIMITER.limit({ key: ip });
      if (!success) return json({ error: "Too many uploads — please slow down." }, 429);
    } catch {
      /* limiter unavailable — don't block */
    }
  }

  const account = await requireAccount(request, env);
  if (!account) return json({ error: "Sign in to upload (missing or unknown account key)." }, 401);

  // Bot check on the upload itself — same gate as account creation. No-ops when
  // TURNSTILE_SECRET is unset (local dev); fails closed once it's set (prod).
  if (!(await verifyTurnstile(request.headers.get("X-Turnstile-Token"), env, request.headers.get("CF-Connecting-IP")))) {
    return json({ error: "Verification failed — please complete the challenge and try again." }, 403);
  }

  // Moderation gate: banned / suspended contributors can't upload.
  const uid = await community.uidFor(account.id);
  const blocked = await community.isUploadBlocked(env, uid);
  if (blocked.blocked) return json({ error: blocked.reason || "Uploads are not allowed for this account." }, 403);

  // Metadata rides in the query string; the body is the raw file (so it streams).
  const claimed = (url.searchParams.get("md5") || "").toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(claimed)) return json({ error: "A valid md5 is required." }, 400);

  const extRaw = (url.searchParams.get("ext") || "").toLowerCase().replace(/^\.+/, "");
  if (!UPLOAD_EXT_ALLOW.has(extRaw)) return json({ error: "Unsupported file type." }, 400);
  const ext = `.${extRaw}`;
  const mime = MIME_BY_EXT[ext] || "application/octet-stream";

  const title = (url.searchParams.get("title") || "").trim().slice(0, 300);
  if (!title) return json({ error: "A title is required." }, 400);
  const author = (url.searchParams.get("author") || "").trim().slice(0, 200);
  const lang = (url.searchParams.get("lang") || "").trim().slice(0, 40);
  const year = (url.searchParams.get("year") || "").trim().slice(0, 8);
  const description = (url.searchParams.get("description") || "").trim().slice(0, 2000);

  if (takedown.isTakenDown(claimed, title, author, description)) return json({ error: "This book can't be uploaded to Bookracy." }, 451);
  if (await community.uploadExists(env, claimed)) return json({ error: "This book has already been uploaded.", md5: claimed }, 409);

  const max = maxUploadBytes(env);
  // R2 needs a known-length body; require Content-Length and use a FixedLengthStream
  // (it also enforces the cap — writing more/fewer bytes than declared errors the put).
  const size = parseInt(request.headers.get("Content-Length") || "", 10);
  if (!Number.isFinite(size) || size <= 0) return json({ error: "A Content-Length is required." }, 411);
  if (size > max) return json({ error: "File is too large." }, 413);
  if (!request.body) return json({ error: "Empty upload." }, 400);

  const key = `files/${claimed}${ext}`;

  // One streaming pass: hash for integrity + capture the leading bytes (for the
  // content guard) as data flows through, into a sized stream.
  const hasher = md5Lib.create();
  let head: Uint8Array | null = null;
  const hashing = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (!head && chunk.byteLength) head = chunk.slice(0, 16);
      hasher.update(chunk);
      controller.enqueue(chunk);
    },
  });
  const fixed = new FixedLengthStream(size);
  const pumped = request.body.pipeThrough(hashing).pipeTo(fixed.writable);

  try {
    await Promise.all([
      env.BOOKS.put(key, fixed.readable, {
        httpMetadata: { contentType: mime, contentDisposition: attachmentDisposition(`${title}${ext}`) },
      }),
      pumped,
    ]);
  } catch (e) {
    ctx.waitUntil(env.BOOKS.delete(key).catch(() => {}));
    console.error("upload store failed", e);
    return json({ error: "Upload failed (size mismatch or storage error)." }, 502);
  }

  // Integrity: the stored bytes must actually hash to the claimed md5. This stops
  // anyone poisoning a content key with mismatched bytes.
  if (hasher.hex() !== claimed) {
    ctx.waitUntil(env.BOOKS.delete(key).catch(() => {}));
    return json({ error: "Upload integrity check failed (md5 mismatch)." }, 400);
  }

  // Content guard: reject disguised executables / wrong container types.
  if (!isAllowedBookBytes(head, extRaw)) {
    ctx.waitUntil(env.BOOKS.delete(key).catch(() => {}));
    return json({ error: `That file doesn't look like a valid .${extRaw} book.` }, 400);
  }

  try {
    await community.recordUpload(env, { md5: claimed, uid, title, author, ext: extRaw, mime, size, lang, year, description });
  } catch (e) {
    // A clash here means a concurrent upload won the race — treat as already-uploaded.
    console.error("upload record failed", e);
    return json({ error: "This book has already been uploaded.", md5: claimed }, 409);
  }

  await persistAccount(env, account.id, account.blob);
  // Same long-term pipeline as scraped books: enqueue → chunk → Telegram + Discord.
  ctx.waitUntil(enqueueBackup(env, claimed, ext, mime));

  const safeTitle = title.replace(/[\\/]+/g, "-");
  return json({ ok: true, md5: claimed, link: `${origin}/download/${claimed}/${encodeURIComponent(safeTitle)}${ext}` });
}

async function handleUploadList(url: URL, origin: string, env: Env): Promise<Response> {
  if (!community.communityEnabled(env)) return json({ uploads: [] });
  const sort = url.searchParams.get("sort") === "popular" ? "popular" : "recent";
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "60", 10) || 60, 1), 100);
  const page = Math.max(parseInt(url.searchParams.get("page") || "1", 10) || 1, 1);
  const items = await community.listUploads(env, sort, limit, (page - 1) * limit);
  return json({ uploads: items.map((u) => communityToBookItem(u, origin)) });
}

async function handleLeaderboard(env: Env): Promise<Response> {
  if (!community.communityEnabled(env)) return json({ leaderboard: [] });
  return json({ leaderboard: await community.leaderboard(env, 50) });
}

async function handleProfile(request: Request, origin: string, env: Env): Promise<Response> {
  if (!community.communityEnabled(env)) return json({ error: "Profiles are not available." }, 503);
  const account = await requireAccount(request, env);
  if (!account) return json({ error: "Missing or unknown account key." }, 401);
  const uid = await community.uidFor(account.id);

  if (request.method === "GET") {
    const profile = await community.getProfile(env, uid);
    return json({ ...profile, uploads: profile.uploads.map((u) => communityToBookItem(u, origin)) });
  }

  if (request.method === "PUT") {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const username = (raw as { username?: unknown }).username;
    // Empty string / null clears the name (→ Anonymous).
    if (username === null || username === "") {
      await community.setUsername(env, uid, null);
      await persistAccount(env, account.id, account.blob);
      return json({ ok: true, username: null });
    }
    if (typeof username !== "string") return json({ error: "Username must be a string." }, 400);
    const v = community.validateUsername(username);
    if (!v.ok) {
      const msg =
        v.error === "reserved" ? "That username is reserved." : v.error === "taken" ? "That username is taken." : "Usernames are 3–20 letters, numbers or underscores.";
      return json({ error: msg }, v.error === "taken" ? 409 : 400);
    }
    const res = await community.setUsername(env, uid, v.value);
    if (!res.ok) return json({ error: "That username is taken." }, 409);
    await persistAccount(env, account.id, account.blob);
    return json({ ok: true, username: v.value });
  }

  return json({ error: "Method not allowed" }, 405);
}

// Delete a book's bytes everywhere we control: R2 file + cover + the KV backup
// manifest (so it can't be served from Telegram/Discord either). The provider
// chunks are left orphaned — free storage, and unreachable without the manifest.
async function purgeBook(env: Env, md5: string, ext: string, cover: boolean): Promise<void> {
  const ops: Promise<unknown>[] = [env.BOOKS.delete(`files/${md5}${ext}`).catch(() => {})];
  if (cover) {
    ops.push(env.BOOKS.delete(communityCoverKey(md5)).catch(() => {}));
    ops.push(env.BOOKS.delete(`covers/${md5}.jpg`).catch(() => {}));
    // The title-addressed Apple copy (appleCoverKey) is deliberately NOT purged here:
    // it isn't keyed by md5, it's Apple's own catalogue artwork for a published work
    // rather than anything a contributor supplied, and it may be the cover several
    // other books legitimately resolve through. Moderation targets user content, which
    // always lives at communityCoverKey.
    // Local to this datacenter only; every other POP falls off via COVER_EDGE_TTL.
    ops.push(caches.default.delete(coverCacheKey(md5)).catch(() => {}));
  }
  if (env.BACKUPS) ops.push(env.BACKUPS.delete(`backup:${md5}`).catch(() => {}));
  await Promise.all(ops);
}

function takedownGone(): Response {
  return new Response(JSON.stringify({ error: "This book is no longer available." }), {
    status: 410,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Unlike purgeBook, a takedown also deletes the Telegram/Discord chunks: an orphaned
// copy is still a copy. Runs on the first request for a listed md5 and records the
// outcome at `takedown:<md5>` in BACKUPS, so later requests only pay one KV read; an
// incomplete run (a provider refused a delete) is retried by the next request.
async function purgeTakedown(env: Env, md5: string): Promise<void> {
  if (!env.BACKUPS) return;
  const markerKey = `takedown:${md5}`;
  try {
    const prior = await env.BACKUPS.get<{ done?: boolean }>(markerKey, "json");
    if (prior?.done) return;

    const files = (await env.BOOKS.list({ prefix: `files/${md5}` })).objects.map((o) => o.key);
    await env.BOOKS.delete([...files, `covers/${md5}.jpg`, communityCoverKey(md5)]);
    await caches.default.delete(coverCacheKey(md5)).catch(() => {});
    const backups = await backup.destroy(env, md5);
    if (env.DB) {
      await searchIndex.forget(env, md5);
      await community.deleteUploadRow(env, md5).catch(() => {});
    }

    const done = backups.remaining.length === 0;
    await env.BACKUPS.put(markerKey, JSON.stringify({ done, at: new Date().toISOString(), files, backups }));
    if (!done) console.error("takedown incomplete", md5, backups.remaining);
  } catch (e) {
    console.error("takedown purge failed", md5, e);
  }
}

// Manage a single upload you own: edit metadata (PATCH) or delete it (DELETE).
async function handleUploadItem(request: Request, md5: string, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!community.communityEnabled(env)) return json({ error: "Uploads are not available." }, 503);
  const account = await requireAccount(request, env);
  if (!account) return json({ error: "Missing or unknown account key." }, 401);
  const uid = await community.uidFor(account.id);
  const core = await community.getUploadCore(env, md5);
  if (!core) return json({ error: "Upload not found." }, 404);
  if (core.uid !== uid) return json({ error: "You can only modify your own uploads." }, 403);

  if (request.method === "DELETE") {
    await community.deleteUploadRow(env, md5);
    ctx.waitUntil(purgeBook(env, md5, core.ext ? `.${core.ext}` : "", core.cover));
    return json({ ok: true });
  }

  if (request.method === "PATCH") {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const b = raw as Record<string, unknown>;
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);
    const edit: community.UploadEdit = {
      title: str(b.title, 300),
      author: str(b.author, 200),
      lang: str(b.lang, 40),
      year: str(b.year, 8),
      description: str(b.description, 2000),
    };
    if (edit.title === "") return json({ error: "Title can't be empty." }, 400);
    if (takedown.isDeniedWork(edit.title, edit.author, edit.description)) return json({ error: "This book can't be listed on Bookracy." }, 451);
    await community.updateUploadMeta(env, md5, edit);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
}

// Set/replace the cover for an upload you own. The client normalises the image to a
// small JPEG; we just store it at covers/<md5>.jpg so the existing cover endpoint serves it.
async function handleUploadCover(request: Request, md5: string, origin: string, env: Env): Promise<Response> {
  if (!community.communityEnabled(env)) return json({ error: "Uploads are not available." }, 503);
  const account = await requireAccount(request, env);
  if (!account) return json({ error: "Missing or unknown account key." }, 401);
  const uid = await community.uidFor(account.id);
  const owner = await community.ownerOf(env, md5);
  if (!owner) return json({ error: "Upload not found." }, 404);
  if (owner !== uid) return json({ error: "You can only modify your own uploads." }, 403);

  const cap = maxCoverBytes(env);
  const len = parseInt(request.headers.get("Content-Length") || "", 10);
  if (Number.isFinite(len) && len > cap) return json({ error: "Cover image is too large." }, 413);
  const ct = request.headers.get("Content-Type") || "";
  if (!ct.startsWith("image/")) return json({ error: "Cover must be an image." }, 400);

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) return json({ error: "Empty image." }, 400);
  if (bytes.byteLength > cap) return json({ error: "Cover image is too large." }, 413);

  await env.BOOKS.put(communityCoverKey(md5), bytes, { httpMetadata: { contentType: ct } });
  await community.setUploadCover(env, md5, true);
  // Drop the previous image (and any remembered "no cover" miss) for this md5. Only
  // this POP purges immediately; the rest expire via COVER_EDGE_TTL.
  await caches.default.delete(coverCacheKey(md5)).catch(() => {});
  return json({ ok: true, cover: `${origin}/cover/${md5}/thumbnail.jpg` });
}

// Delete every book the caller has uploaded (R2 + manifest + records).
async function handleDeleteAllUploads(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!community.communityEnabled(env)) return json({ error: "Uploads are not available." }, 503);
  if (request.method !== "DELETE") return json({ error: "Method not allowed" }, 405);
  const account = await requireAccount(request, env);
  if (!account) return json({ error: "Missing or unknown account key." }, 401);
  const uid = await community.uidFor(account.id);
  const keys = await community.listUploadKeysByUid(env, uid);
  await community.deleteAllByUid(env, uid);
  ctx.waitUntil(Promise.all(keys.map((k) => purgeBook(env, k.md5, k.ext ? `.${k.ext}` : "", k.cover))));
  return json({ ok: true, deleted: keys.length });
}

// ---- Admin moderation (gated by the ADMIN_KEY secret via X-Admin-Key) ---------
function isAdmin(request: Request, env: Env): boolean {
  return Boolean(env.ADMIN_KEY) && request.headers.get("X-Admin-Key") === env.ADMIN_KEY;
}

async function handleAdmin(request: Request, url: URL, origin: string, env: Env, ctx: ExecutionContext): Promise<Response> {
  // Hide the surface entirely unless an admin key is configured.
  if (!env.ADMIN_KEY) return json({ error: "Not found" }, 404);
  if (!isAdmin(request, env)) return json({ error: "Forbidden" }, 403);
  if (!community.communityEnabled(env)) return json({ error: "Community is not available." }, 503);

  const { pathname } = url;

  if (pathname === "/api/admin/uploads" && request.method === "GET") {
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 1), 200);
    const page = Math.max(parseInt(url.searchParams.get("page") || "1", 10) || 1, 1);
    const items = await community.adminListUploads(env, limit, (page - 1) * limit);
    return json({ uploads: items.map((u) => ({ ...communityToBookItem(u, origin), banned: u.banned })) });
  }

  const delMatch = pathname.match(/^\/api\/admin\/uploads\/([a-f0-9]{32})$/i);
  if (delMatch && request.method === "DELETE") {
    const md5 = delMatch[1].toLowerCase();
    const core = await community.getUploadCore(env, md5);
    if (!core) return json({ error: "Not found." }, 404);
    await community.deleteUploadRow(env, md5);
    ctx.waitUntil(purgeBook(env, md5, core.ext ? `.${core.ext}` : "", core.cover));
    return json({ ok: true });
  }

  if (pathname === "/api/admin/users" && request.method === "GET") {
    return json({ users: await community.adminListUsers(env, 200) });
  }

  const banMatch = pathname.match(/^\/api\/admin\/users\/([a-f0-9]{64})\/ban$/i);
  if (banMatch && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { banned?: unknown };
    await community.setBanned(env, banMatch[1].toLowerCase(), Boolean(body.banned));
    return json({ ok: true });
  }

  const suspMatch = pathname.match(/^\/api\/admin\/users\/([a-f0-9]{64})\/suspend$/i);
  if (suspMatch && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { until?: unknown };
    const until = typeof body.until === "string" && body.until ? body.until : null;
    await community.setSuspended(env, suspMatch[1].toLowerCase(), until);
    return json({ ok: true });
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") return applyCors(new Response(null, { status: 204 }), request);

    const url = new URL(request.url);
    const { pathname } = url;
    // Public origin used to build self-referential cover/download URLs. Defaults to
    // the request origin (correct in prod), but `wrangler dev` rewrites request.url
    // to the configured custom-domain route (api.bookracy.com), so set PUBLIC_ORIGIN
    // (e.g. http://localhost:8787) in .dev.vars to point links at the local instance.
    const origin = env.PUBLIC_ORIGIN || url.origin;
    const ip = request.headers.get("CF-Connecting-IP") || "anon";

    // Per-IP rate limit on the expensive endpoints (live scrape / upstream download).
    // Cover *cache hits* are cheap, so /cover/* is limited separately and only on a
    // cache miss (see handleCover) to avoid throttling normal browsing. Fail open if
    // the binding is unavailable (e.g. local `wrangler dev`).
    //
    // Bare-md5 lookups take the dedicated MD5_LIMITER below instead of this shared
    // bucket. They're not a search — the bookshelf fires one per saved book, all at
    // once, so a 100-book shelf spends a whole IP's budget rendering a page the user
    // already owns. Measured before this split: a 120-bookmark shelf sent 147 lookups
    // and **52 came back 429**, silently dropping books off the shelf.
    // `/api/books/md5/<md5>` is the same resolution as `/api/books?query=<md5>`, on its
    // own path so it can be told apart from free-text search *by path alone*.
    //
    // That matters outside this file: Cloudflare's Free-plan rate limiting rule can only
    // match on Path — no query string — and the two share a code-side story but not a
    // traffic story. Search is 2-3 requests a session and is the enumerable, upstream-
    // scraping, CPU-heavy path; the bookshelf legitimately fires one lookup per saved
    // book at once (§9.16), up to the client's concurrency cap of 8. Any burst threshold
    // tight enough to be worth setting on the first would break the second, so they need
    // to be separable at the edge. The query-string form is kept working forever — the
    // Kindle client, share links and every older frontend build use it.
    const md5Path = pathname.match(/^\/api\/books\/md5\/([a-f0-9]{32})$/i);
    const isMd5Lookup = md5Path !== null || (pathname === "/api/books" && MD5_QUERY.test((url.searchParams.get("query") || "").trim()));
    const expensive =
      (pathname === "/api/books" && !isMd5Lookup) ||
      pathname === "/api/trending" ||
      pathname === "/api/recent" ||
      pathname.startsWith("/api/recommendations/") ||
      pathname.startsWith("/api/reading-order/") ||
      pathname === "/api/fivebooks" ||
      pathname === "/api/suggest" ||
      pathname.startsWith("/api/nonfiction") ||
      pathname.startsWith("/download/") ||
      pathname === "/api/account" ||
      pathname.startsWith("/api/uploads") ||
      pathname === "/api/leaderboard" ||
      pathname.startsWith("/api/profile") ||
      pathname.startsWith("/api/admin/");
    if (expensive && env.RATE_LIMITER) {
      try {
        const { success } = await env.RATE_LIMITER.limit({ key: ip });
        if (!success) return applyCors(json({ error: "Too many requests — please slow down." }, 429), request);
      } catch {
        /* limiter unavailable — don't block legitimate traffic */
      }
    }

    // Apple metadata. Own bucket for the same reason the bookshelf below has one: a
    // results page fires one lookup per card, so the burst is set by page size, not by
    // user intent, and on the shared budget ordinary browsing tripped it — 1,290 of the
    // 1,465 429s served on 2026-08-31 were here. See METADATA_LIMITER in wrangler.toml.
    if (pathname.startsWith("/api/metadata/") && env.METADATA_LIMITER) {
      try {
        const { success } = await env.METADATA_LIMITER.limit({ key: ip });
        if (!success) return applyCors(json({ error: "Too many requests — please slow down." }, 429), request);
      } catch {
        /* limiter unavailable — don't block legitimate traffic */
      }
    }

    // Bookshelf resolution. Generous because the burst size is set by how many books a
    // user has *saved*, not by anything they're doing right now — but still bounded,
    // because each cold lookup is a real libgen fetch and unbounded amplification is
    // how we'd get our egress IP banned upstream. Same reasoning as COVER_LIMITER.
    if (isMd5Lookup && env.MD5_LIMITER) {
      try {
        const { success } = await env.MD5_LIMITER.limit({ key: ip });
        if (!success) return applyCors(json({ error: "Too many requests — please slow down." }, 429), request);
      } catch {
        /* limiter unavailable — don't block legitimate traffic */
      }
    }

    // Free-text search gets a much tighter budget than the shared bucket above: it's the
    // only endpoint that is both expensive (a live upstream scrape + parse whenever the
    // 30m cache misses) and *enumerable*, which is the combination a scraper needs.
    // A real session runs ~2-3 searches, so this is invisible to humans.
    //
    // Bare-md5 lookups are deliberately exempt. They resolve a book whose id you already
    // have, so they're worthless for enumeration — and the bookmarks page legitimately
    // fires one per saved book in a burst (see getBooksByMd5sQueryOptions), which this
    // limit would otherwise break outright.
    if (pathname === "/api/books" && env.SEARCH_LIMITER) {
      const q = (url.searchParams.get("query") || "").trim();
      if (q && !MD5_QUERY.test(q)) {
        try {
          const { success } = await env.SEARCH_LIMITER.limit({ key: ip });
          if (!success) return applyCors(json({ error: "Too many searches — please slow down." }, 429), request);
        } catch {
          /* limiter unavailable — don't block legitimate traffic */
        }
      }
    }

    const recMatch = pathname.match(/^\/api\/recommendations\/([a-z0-9-]+)$/);
    const readingOrderMatch = pathname.match(/^\/api\/reading-order\/([a-z]+)$/);
    const metadataMatch = pathname.match(/^\/api\/metadata\/([a-f0-9]{32})$/i);
    const nonfictionCover = pathname.match(/^\/api\/nonfiction\/(\d{1,6})\/cover\.jpg$/);
    const uploadCover = pathname.match(/^\/api\/uploads\/([a-f0-9]{32})\/cover$/i);
    const uploadItem = pathname.match(/^\/api\/uploads\/([a-f0-9]{32})$/i);

    let resp: Response;
    try {
      if (pathname === "/") {
        // Minimal health response — don't advertise mirrors/endpoints to scrapers.
        resp = json({ status: "ok" });
      } else if (md5Path) {
        // Rebuild the URL handleSearch expects, preserving any facets/format the caller
        // sent (the Kindle client's `format=text` in particular).
        const asQuery = new URL(url.toString());
        asQuery.pathname = "/api/books";
        asQuery.searchParams.set("query", md5Path[1].toLowerCase());
        asQuery.searchParams.set("limit", asQuery.searchParams.get("limit") || "1");
        resp = await handleSearch(asQuery, origin, env, ctx);
      } else if (pathname === "/api/books") {
        resp = await handleSearch(url, origin, env, ctx);
      } else if (pathname === "/api/trending") {
        resp = await handleTrending(url, origin, env, ctx);
      } else if (pathname === "/api/recent") {
        resp = await handleRecent(request, ctx);
      } else if (pathname === "/api/suggest") {
        resp = await handleSuggest(url, origin, env, ctx);
      } else if (metadataMatch) {
        resp = await handleMetadata(metadataMatch[1].toLowerCase(), url, origin, env, ctx);
      } else if (nonfictionCover) {
        resp = await handleNonfictionCover(Number(nonfictionCover[1]), origin, env, ctx);
      } else if (pathname === "/api/nonfiction/meta") {
        resp = handleNonfictionMeta();
      } else if (pathname === "/api/nonfiction/random") {
        resp = await handleNonfictionRandom(url, env);
      } else if (pathname === "/api/nonfiction") {
        resp = handleNonfictionList(url);
      } else if (recMatch) {
        resp = await handleRecommendationList(recMatch[1], origin, env, ctx);
      } else if (readingOrderMatch) {
        resp = await handleReadingOrder(readingOrderMatch[1], origin, ctx);
      } else if (pathname === "/api/fivebooks") {
        resp = await handleFiveBooks(url, origin, ctx);
      } else if (pathname === "/api/account") {
        resp = await handleAccount(request, env);
      } else if (pathname === "/api/uploads") {
        resp = request.method === "POST" ? await handleUploadCreate(request, url, origin, env, ctx) : await handleUploadList(url, origin, env);
      } else if (uploadCover) {
        resp = await handleUploadCover(request, uploadCover[1].toLowerCase(), origin, env);
      } else if (uploadItem) {
        resp = await handleUploadItem(request, uploadItem[1].toLowerCase(), env, ctx);
      } else if (pathname === "/api/leaderboard") {
        resp = await handleLeaderboard(env);
      } else if (pathname === "/api/profile/uploads") {
        resp = await handleDeleteAllUploads(request, env, ctx);
      } else if (pathname === "/api/profile") {
        resp = await handleProfile(request, origin, env);
      } else if (pathname.startsWith("/api/admin/")) {
        resp = await handleAdmin(request, url, origin, env, ctx);
      } else if (pathname === "/api/books/external_downloads") {
        resp = json([]);
      } else if (pathname === "/kindle/install.sh") {
        resp = serveScript(installScript, origin);
      } else if (pathname === "/kindle/bookracy.sh") {
        resp = serveScript(clientScript, origin);
      } else {
        const cover = pathname.match(/^\/cover\/([a-f0-9]{32})\/thumbnail\.jpg$/i);
        const download = pathname.match(/^\/download\/([a-f0-9]{32})\/(.+)$/i);
        if (cover) {
          resp = await handleCover(
            cover[1].toLowerCase(),
            (url.searchParams.get("title") || "").trim(),
            (url.searchParams.get("author") || "").trim(),
            origin,
            ip,
            env,
            ctx,
          );
        } else if (download) {
          resp = await handleDownload(
            download[1].toLowerCase(),
            decodeURIComponent(download[2]),
            env,
            ctx,
            url.searchParams.get("source"),
            url.searchParams.get("author"),
            request.headers.get("Range"),
            url.searchParams.get("inline") === "1",
          );
        } else {
          resp = new Response("Not Found", { status: 404 });
        }
      }
    } catch (e) {
      console.error("unhandled", e);
      resp = json({ error: "Request failed" }, 502);
    }

    return applyCors(resp, request);
  },

  // Consumes the `book-backup` queue: pushes each freshly-cached book into the
  // long-term providers (Telegram primary, Discord secondary). ingest() is
  // idempotent and streams R2 one chunk at a time, so retries are safe and memory
  // stays bounded. A failure retries the message (e.g. R2 not yet warm).
  //
  // Also consumes `book-backup-dlq`. That queue previously had no consumer, so a job
  // that burned all its retries sat there until the 4-day retention dropped it — the
  // book ended up with no manifest, and once R2's 30-day cache expired the bytes were
  // gone with no record of which book it was. Dead-lettered jobs now get one final
  // attempt (the most common causes — provider rate limits, a cold R2 object — are
  // transient and have usually cleared by the time the job lands here), and anything
  // that still fails is written to a durable failure ledger instead of vanishing.
  async queue(batch: MessageBatch<BackupJob>, env: Env): Promise<void> {
    const lastChance = batch.queue === DLQ_NAME;
    for (const message of batch.messages) {
      // A job queued just before a takedown would otherwise upload the book again.
      if (takedown.isTakenDownMd5(message.body?.md5)) {
        message.ack();
        continue;
      }
      try {
        await backup.ingest(env, message.body);
        if (lastChance) await backup.clearFailure(env, message.body.md5);
        message.ack();
      } catch (e) {
        console.error(`backup ingest failed${lastChance ? " (final attempt)" : ""}`, message.body?.md5, e);
        if (lastChance) {
          await backup.recordFailure(env, message.body, e).catch((err) => console.error("recordFailure failed", err));
          message.ack(); // nothing left to retry into; the ledger is the record
          continue;
        }
        // Back off before retrying: an immediate re-attempt just re-hits the same
        // provider rate limit that caused the failure.
        message.retry({ delaySeconds: Math.min(60 * message.attempts, 900) });
      }
    }
  },
} satisfies ExportedHandler<Env, BackupJob>;
