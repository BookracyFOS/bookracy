// Reliability primitives for the download pipeline. All state lives in the Worker
// Cache API (caches.default) — no new bindings, no atomic RMW required. Each entry
// is a stored HTTP Response keyed by a synthetic internal URL, expiring by its own
// Cache-Control header. Per-datacenter, not global — which is *exactly* what we want
// for mirror-health (per-POP network reality varies) and fine for the rest (a couple
// of extra lookups when a request lands in a new POP is cheap).
//
// Four namespaces share the mechanism:
//   alias/{md5}                   -> resolved md5 (7d)   — one-time libgensearch cost
//   mirror-down/{host}            -> "1" (60s)            — circuit breaker
//   aa-mirrors                    -> JSON string[] (24h)  — auto-refreshed pool
//   search{upstream-path}         -> JSON RawBook[] (30m) — skips the scrape+parse
//   mirror-strikes/{host}         -> consecutive failures (6h) — drives the backoff
//   lock/{name}                   -> "1" (caller's TTL)  — best-effort stampede guard
//
// A per-(source, md5) miss cache used to sit here too, but it poisoned recovery on
// transient failures: user A's network hiccup would mark libgenli as "missed X" for
// 10 minutes, and every user B who clicked X in that window got an instant 404 even
// after libgen recovered. The mirror-level circuit breaker (60s, per-host) already
// covers the actual thundering-herd case with a shorter, self-healing TTL — the
// source-level cache added ~500ms of speedup per user for a 10-minute stale-miss
// blast radius, which was the wrong trade.

const INTERNAL_ORIGIN = "https://bookracy.internal";

function cacheKey(path: string): Request {
  // GET request is the only cacheable verb for cache.match/put. Origin is synthetic;
  // there's no real host, this URL is just the cache namespace identifier.
  return new Request(`${INTERNAL_ORIGIN}/${path.replace(/^\/+/, "")}`);
}

async function cacheGetText(path: string): Promise<string | null> {
  const resp = await caches.default.match(cacheKey(path));
  return resp ? await resp.text() : null;
}

async function cachePutText(path: string, value: string, ttlSeconds: number): Promise<void> {
  const resp = new Response(value, {
    headers: { "Cache-Control": `max-age=${ttlSeconds}`, "Content-Type": "text/plain" },
  });
  await caches.default.put(cacheKey(path), resp);
}

// ---- Alias map: md5 -> resolved-md5 --------------------------------------------
// Populated when libgensearch resolves a "clicked md5 that libgen doesn't have" to a
// different libgen md5 for the same work. Next click on the same requested md5 hits
// libgen exact-md5 directly, no search step, no wasted round trips.
const ALIAS_TTL = 7 * 24 * 3600;

export async function getAlias(md5: string): Promise<string | null> {
  return cacheGetText(`alias/${md5}`);
}

export async function setAlias(fromMd5: string, toMd5: string): Promise<void> {
  if (fromMd5 === toMd5) return;
  await cachePutText(`alias/${fromMd5}`, toMd5, ALIAS_TTL);
}

// ---- Mirror circuit breaker: skip a host that just failed --------------------
// Any host-scoped failure (fetch throw, timeout, 5xx, HTML wall on a download endpoint)
// marks the host "down". All subsequent requests skip that host until the entry expires.
//
// The TTL **backs off exponentially**, and that matters far more than it sounds. A flat
// 60s is right for a mirror having a bad minute, but Anna's Archive moved behind
// DDoS-Guard on 2026-08-13 and has 403'd every Worker request since. At a flat 60s each
// dead host got re-probed ~1,440 times a day *per POP*, and every probe cost a real
// request the full upstream timeout before failing. Measured on prod during the outage:
// a novel search took 24s and a cold `/api/trending` rebuild took 49s, nearly all of it
// waiting on hosts we already knew were dead.
//
// Strikes are tracked separately and outlive the down-window, so a host that is *still*
// broken when its window lapses escalates instead of restarting at 60s. A host that
// answers clears its strikes immediately (markMirrorUp), so recovery is still fast:
// worst case one request pays one timeout, then the host is trusted again.
const HOST_DOWN_BASE_TTL = 60;
const HOST_DOWN_MAX_TTL = 3600;
const HOST_STRIKE_TTL = 6 * 3600;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Down-window for the nth consecutive failure: 60s, 120s, 240s … capped at 1h. */
function downTtlFor(strikes: number): number {
  return Math.min(HOST_DOWN_MAX_TTL, HOST_DOWN_BASE_TTL * 2 ** Math.max(0, strikes - 1));
}

export async function isMirrorDown(url: string): Promise<boolean> {
  return (await cacheGetText(`mirror-down/${hostOf(url)}`)) !== null;
}

/**
 * How many times in a row this host has failed (0 when it last answered). Strikes
 * outlive the down-window, so a host whose window just lapsed still reports the run
 * that put it there — that is what lets a caller tell "hiccupped a minute ago" from
 * "has been dead for hours" and decide whether re-probing it is worth a user's time.
 */
export async function mirrorStrikes(url: string): Promise<number> {
  const n = parseInt((await cacheGetText(`mirror-strikes/${hostOf(url)}`)) || "0", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Consecutive failures after which a host is re-probed in the background instead of
 * on a user's request. Below this the inline retry is the right call — a mirror having
 * a bad minute should be trusted again as soon as its 60/120/240s window lapses. At
 * four strikes the host has been failing for at least seven minutes straight
 * (60+120+240s of windows); from there each lapse is far more likely another timeout
 * than a recovery, and paying it inline means one user per POP per window eats a full
 * upstream timeout *per dead host*. Anna's Archive has been in that state for a month.
 */
export const BACKGROUND_PROBE_STRIKES = 4;

// ---- Best-effort lock: collapse a stampede into a handful ---------------------
// Cache API get-then-put is not atomic and the store is per-POP, so this is not mutual
// exclusion — two requests a few ms apart can both win. It doesn't need to be: its job
// is to turn "every request during the window fires the job" into "one or two do".
export async function acquireLock(name: string, ttlSeconds: number): Promise<boolean> {
  if ((await cacheGetText(`lock/${name}`)) !== null) return false;
  await cachePutText(`lock/${name}`, "1", ttlSeconds);
  return true;
}

export async function markMirrorDown(url: string): Promise<void> {
  const host = hostOf(url);
  const prior = parseInt((await cacheGetText(`mirror-strikes/${host}`)) || "0", 10);
  const strikes = (Number.isFinite(prior) ? prior : 0) + 1;
  await Promise.all([
    cachePutText(`mirror-down/${host}`, "1", downTtlFor(strikes)),
    cachePutText(`mirror-strikes/${host}`, String(strikes), HOST_STRIKE_TTL),
  ]);
}

/**
 * Clear a host's strike count after it serves us something usable. Without this the
 * backoff would be one-way: a mirror that recovered would still be treated as an
 * hour-long outage the next time it hiccupped.
 */
export async function markMirrorUp(url: string): Promise<void> {
  await cachePutText(`mirror-strikes/${hostOf(url)}`, "0", HOST_STRIKE_TTL);
}

// ---- AA hosts a Worker must never fetch ------------------------------------------
// `annas-archive.mx` now 302s to `annas-archive.is`, and both sit on Cloudflare behind a
// Worker route. A Worker fetching a Worker-routed host is refused by the platform with
// **error 1042 — and it is the CALLING invocation that is terminated**, not the
// subrequest: measured 2026-09-15 from a probe Worker, the probe's own response came back
// as the plain-text "error code: 1042" page, try/catch and all. On the rare request that
// got through, `.is` answered 429 (datacenter egress) or a real page whose results carry
// no `/md5/` links (AA's new frontend renders them client-side), so there is nothing to
// gain and a user-facing 5xx to lose. Filtered at every point a host enters the pool.
export const AA_UNFETCHABLE_HOSTS: ReadonlySet<string> = new Set(["annas-archive.mx", "annas-archive.is"]);

export function fetchableAaMirrors(mirrors: readonly string[]): string[] {
  return mirrors.filter((m) => !AA_UNFETCHABLE_HOSTS.has(hostOf(m)));
}

// ---- AA mirror pool: auto-refreshed clearnet domain list ---------------------
// AA rotates clearnet domains every few months under legal pressure (.org, .se, .li,
// .pm all fell in 2025-26). Hard-coding is a bit-rot trap; lazy-refreshing from AA's
// own /mirrors page + a public status tracker keeps the pool fresh without redeploy.
// Cached for 24h — a stale entry is at worst 1 day out of date.
const AA_POOL_TTL = 24 * 3600;
const HOST_RE = /(?:https?:\/\/)?(annas-archive\.[a-z]{2,10})\b/gi;

export async function getCachedAaMirrors(): Promise<string[] | null> {
  const raw = await cacheGetText("aa-mirrors");
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    // Filter on the way OUT as well as in: a pool written before the deny-list existed
    // sits in every POP's cache for up to 24h with `.mx` still in it.
    const usable = Array.isArray(arr) ? fetchableAaMirrors(arr) : [];
    return usable.length ? usable : null;
  } catch {
    return null;
  }
}

export async function setCachedAaMirrors(mirrors: string[]): Promise<void> {
  const usable = fetchableAaMirrors(mirrors);
  if (!usable.length) return;
  await cachePutText("aa-mirrors", JSON.stringify(usable), AA_POOL_TTL);
}

// ---- Search results: skip the scrape + parse on a repeat query ---------------
// A search is by far the most expensive thing the Worker does — a live AA fetch plus
// a full HTML parse of a large results page — and it ran on *every* request, so the
// same popular query was re-scraped from scratch every time. The upstream result set
// for a given query/page/facet combo barely moves minute to minute, so we cache the
// parsed rows rather than the finished response: relevance re-ranking, the `limit`
// slice and the community-uploads merge all still run live on top of a cache hit.
// The upstream path already encodes query + page + every validated facet, which makes
// it an exact cache key.
const SEARCH_TTL = 30 * 60;

export async function getCachedSearch<T>(upstreamPath: string): Promise<T[] | null> {
  try {
    const raw = await cacheGetText(`search${upstreamPath}`);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length ? (arr as T[]) : null;
  } catch {
    // Unreadable/absent cache entry — fall through to a live scrape.
    return null;
  }
}

export async function setCachedSearch(upstreamPath: string, rows: unknown[]): Promise<void> {
  // Never cache an empty result set: a transient upstream failure looks identical to
  // "genuinely no matches", and caching it would pin a 404 on a good query for 30m.
  if (!rows.length) return;
  await cachePutText(`search${upstreamPath}`, JSON.stringify(rows), SEARCH_TTL);
}

/**
 * Extract every `https://annas-archive.<tld>` clearnet host from arbitrary HTML.
 * Dedupes, keeps insertion order, ignores tor/i2p (they wouldn't work from a Worker).
 */
export function extractAaHostsFromHtml(html: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of html.matchAll(HOST_RE)) {
    const host = m[1].toLowerCase();
    // AA's own /mirrors page cross-links to help/faq/etc under the mirror domain, but
    // those aren't proof of liveness — the caller probes candidates before committing.
    if (seen.has(host) || AA_UNFETCHABLE_HOSTS.has(host)) continue;
    seen.add(host);
    out.push(`https://${host}`);
  }
  return out;
}
