/*
 * Bookracy service worker (SOURCE) — makes the SPA installable and resilient on both
 * Android (Chromium) and iOS (Safari 16.4+), with no native app needed.
 *
 * This is the readable source. `pnpm build` bundles + minifies it (comments stripped)
 * to `dist/sw.js` via vite.sw.config.ts — edit here, never edit the built file.
 *
 * Design goals (a books SPA with an offline library, not a general offline DB):
 *   1. Installable + instant repeat launches (precache the app shell).
 *   2. Always-fresh app on redeploys (network-first HTML + immutable hashed assets).
 *   3. Graceful offline: the UI still boots; book bytes come from IndexedDB (lib/offline-books.ts),
 *      not from the SW cache — SW isn't the right place for tens/hundreds of MB of blobs.
 *   4. Reasonably-fresh book covers between sessions (SWR the cross-origin cover endpoint
 *      so browsing works offline and covers pop in without a flash on every navigation).
 *
 * Strategy per request type:
 *   - HTML navigations → network-first WITH navigation preload, falling back to the cached shell offline.
 *   - Vite-fingerprinted assets (/assets/*) → cache-first (they're immutable, so no revalidation needed).
 *   - Other same-origin statics (icons, manifest, logo) → stale-while-revalidate.
 *   - api.bookracy.com/covers/* → stale-while-revalidate (cross-origin; makes offline browsing tolerable).
 *   - api.bookracy.com/download/* + everything else → left completely untouched (real bytes need the network).
 *
 * iOS notes: navigation preload / SWR are feature-detected and degrade cleanly; cached
 * responses are rebuilt before use to strip the "redirected" flag Safari refuses on navigations.
 * Bump VERSION whenever this file changes — activate() then purges every older cache.
 */
const VERSION = "v4";
const PRECACHE = `bookracy-precache-${VERSION}`;
const RUNTIME = `bookracy-runtime-${VERSION}`;
const COVERS = `bookracy-covers-${VERSION}`;
const OFFLINE_URL = "/index.html";

// Web Share Target hand-off. Deliberately NOT version-suffixed: a file shared moments
// before a redeploy must still be there for the page to collect afterwards, and
// activate() only purges caches whose names it doesn't recognise as current.
const SHARE_CACHE = "bookracy-share";
const SHARE_ENTRY = "/__shared-book";
const SHARE_TARGET_PATH = "/library";

// Cover cache cap — bounds the cross-origin SWR entries so we don't hoard covers from
// every search a user has ever typed. Evicted LRU-style on write.
const COVER_CACHE_MAX_ENTRIES = 500;

// The minimum needed to boot the SPA offline and look right once installed.
const PRECACHE_URLS = ["/", OFFLINE_URL, "/site.webmanifest", "/logo.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];

// Safari throws on navigations answered with a response flagged `redirected`. Rebuild
// such responses (and only those) from their body so the flag is dropped.
async function safeResponse(response) {
  if (!response || !response.redirected) return response;
  const body = await response.blob();
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

// Only cache first-party, fully successful responses (never opaque/partial/error).
function isCacheable(response) {
  return response && response.ok && response.type === "basic";
}

// Precache the shell resiliently: fetch each entry fresh (bypassing the HTTP cache so we
// never bake in a stale build) and tolerate individual failures — one bad asset must not
// abort the whole install the way cache.addAll() would.
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE);
      await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          const response = await fetch(new Request(url, { cache: "reload" }));
          if (response.ok) await cache.put(url, await safeResponse(response));
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

// Take over immediately: drop caches from older versions and turn on navigation preload
// (lets the browser start the HTML request in parallel with SW boot — big win on mobile).
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([PRECACHE, RUNTIME, COVERS, SHARE_CACHE]);
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => !keep.has(key)).map((key) => caches.delete(key)));
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
      // Nudge every open tab that a new SW is active so the app can react (e.g. refresh
      // stale in-memory state). Silent no-op for pages that don't listen for it.
      const clientsList = await self.clients.matchAll({ includeUncontrolled: true });
      for (const client of clientsList) client.postMessage({ type: "sw-activated", version: VERSION });
    })(),
  );
});

self.addEventListener("message", (event) => {
  // Legacy string form (kept for older builds still in the wild).
  if (event.data === "SKIP_WAITING") return void self.skipWaiting();
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") return void self.skipWaiting();
  // Debug/admin: wipe every cache we own. Useful if something bad got precached and we
  // want a clean-slate boot without waiting for the version bump.
  if (data.type === "PURGE_CACHES") {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("bookracy-")).map((k) => caches.delete(k)));
    })());
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Web Share Target: Android shares an EPUB to Bookracy as a multipart POST. A static
  // SPA can't receive a POST, so the SW is the only place this can be handled — stash
  // the file where the page can pick it up, then redirect to a normal GET.
  if (request.method === "POST" && new URL(request.url).pathname === SHARE_TARGET_PATH) {
    event.respondWith(handleSharedFile(request));
    return;
  }

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Non-http(s) schemes (e.g. chrome-extension://) — leave the browser to it.
  if (!url.protocol.startsWith("http")) return;
  // Byte-range requests (media seeking) need real 206s — don't answer them from the cache.
  if (request.headers.has("range")) return;

  // Cross-origin: cache book covers (SWR), leave book downloads + everything else alone.
  if (url.origin !== self.location.origin) {
    if (isCoverRequest(url)) {
      event.respondWith(coverSWR(request));
    }
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(event));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});

/**
 * Receive a file shared into the installed app (manifest `share_target`), park it in a
 * dedicated cache, and 303 the browser to a plain GET the SPA can render. The page
 * picks the file up from that cache and imports it into the on-device library.
 *
 * A cache entry (rather than IndexedDB) keeps this self-contained: the SW already owns
 * the Cache API, and a Response carries the bytes plus the filename header together.
 */
async function handleSharedFile(request) {
  try {
    const form = await request.formData();
    const file = form.get("book");
    if (file && typeof file !== "string") {
      const cache = await caches.open(SHARE_CACHE);
      await cache.put(
        SHARE_ENTRY,
        new Response(file, {
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "X-Shared-Filename": encodeURIComponent(file.name || "shared-book"),
          },
        }),
      );
    }
  } catch {
    /* Malformed share — fall through and just open the library. */
  }
  return Response.redirect(`${SHARE_TARGET_PATH}?open=share`, 303);
}

// Backend cover URL pattern — api.bookracy.com/covers/{md5} (and any future path prefix
// we want to opt into offline browsing). Kept as a substring check so the SW doesn't
// need redeploying to catch a subdomain switch.
function isCoverRequest(url) {
  return /\/(covers?|cover)\//.test(url.pathname) && /(^|\.)bookracy\.com$/.test(url.hostname);
}

// HTML: prefer the preloaded/network response (keeps redeploys instant), refresh the cached
// shell, and fall back to that shell — then a tiny inline page — when offline.
async function handleNavigation(event) {
  try {
    const preloaded = await event.preloadResponse;
    const response = preloaded || (await fetch(event.request));
    if (isCacheable(response)) {
      const copy = response.clone();
      event.waitUntil(caches.open(PRECACHE).then(async (cache) => cache.put(OFFLINE_URL, await safeResponse(copy))));
    }
    return response;
  } catch {
    const cached = await caches.match(OFFLINE_URL, { ignoreSearch: true });
    return (await safeResponse(cached)) || offlineFallback();
  }
}

// Immutable, content-hashed assets: serve from cache instantly; only hit the network on a miss.
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isCacheable(response)) {
    const cache = await caches.open(RUNTIME);
    cache.put(request, response.clone());
  }
  return response;
}

// Everything else same-origin: instant from cache, refreshed in the background for next time.
async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const network = fetch(request)
    .then((response) => {
      if (isCacheable(response)) caches.open(RUNTIME).then((cache) => cache.put(request, response.clone()));
      return response;
    })
    .catch(() => undefined);
  return cached || (await network) || Response.error();
}

// Cross-origin cover SWR: same shape as the same-origin SWR, but with a dedicated cache
// (so cover eviction never nukes app assets) and a size cap on writes. Opaque cross-
// origin responses can't be inspected but ARE cacheable — that's what we want here.
async function coverSWR(request) {
  const cache = await caches.open(COVERS);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async (response) => {
      if (response && response.ok) {
        await cache.put(request, response.clone());
        await trimCache(cache, COVER_CACHE_MAX_ENTRIES);
      }
      return response;
    })
    .catch(() => undefined);
  return cached || (await network) || Response.error();
}

// Simple LRU-ish trim: cache.keys() returns insertion order, so drop the oldest N when
// the cache overshoots. Runs on background writes, never blocks the response.
async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  const overflow = keys.length - maxEntries;
  if (overflow <= 0) return;
  await Promise.all(keys.slice(0, overflow).map((k) => cache.delete(k)));
}

// Last-resort offline screen, only shown if even the precached shell is unavailable.
function offlineFallback() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Offline · Bookracy</title>
<style>html{color-scheme:dark}body{margin:0;min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.75rem;padding:2rem;text-align:center;font-family:Inter,system-ui,-apple-system,sans-serif;background:#16161a;color:#e5e7eb}h1{margin:0;font-size:1.25rem}p{margin:0;color:#9ca3af;max-width:28rem;line-height:1.5}button{margin-top:.5rem;padding:.6rem 1.25rem;border:0;border-radius:.6rem;background:#7c3aed;color:#fff;font:inherit;font-weight:600;cursor:pointer}</style>
</head><body>
<h1>You're offline</h1>
<p>Bookracy needs a connection to search and open books. Reconnect and try again — anything you've already saved is still on your device.</p>
<button onclick="location.reload()">Retry</button>
</body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
