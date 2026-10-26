// Live source probe — checks every candidate book source the scraper could use, so
// we only wire up the ones that actually work. This is NOT a unit test (it hits the
// network); it's named *.ts (not *.test.ts) so `pnpm test` skips it. Run it directly:
//
//     node tests/source-probe.ts              # default query "dune"
//     node tests/source-probe.ts "clean code" # custom query
//
// It reports, per source: reachability, parsed result counts, a sample row, and for
// downloads it resolves a real md5 through the ads.php -> get.php chain and pulls the
// first bytes off the file to prove the mirror serves real content (not an HTML wall).

import { parseSearchHtml, parseLibgenSearch, parseLibgenUrl, parseCoverUrl } from "../src/parse.ts";

// --- Candidate sources (kept in sync with what we wire into src/index.ts) --------
const AA_MIRRORS = [
  "https://annas-archive.li",
  "https://annas-archive.gl",
  "https://annas-archive.pm",
  "https://annas-archive.pk",
  "https://annas-archive.gd",
  "https://annas-archive.se", // historically primary — included to confirm live status
  "https://annas-archive.org",
];
const LIBGEN_MIRRORS = ["https://libgen.li", "https://libgen.la", "https://libgen.gl", "https://libgen.vg", "https://libgen.bz", "https://libgen.ee"];

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const HEADERS = { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" };

const query = process.argv[2] || "dune";

const GREEN = "\x1b[32m", RED = "\x1b[31m", DIM = "\x1b[2m", YEL = "\x1b[33m", RST = "\x1b[0m";
const ok = (s: string) => `${GREEN}✓${RST} ${s}`;
const bad = (s: string) => `${RED}✗${RST} ${s}`;
const warn = (s: string) => `${YEL}!${RST} ${s}`;

async function fetchWithTimeout(url: string, ms: number, headers: Record<string, string> = HEADERS): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { headers, signal: ctrl.signal, redirect: "follow" });
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url: string, ms = 20000, headers = HEADERS): Promise<{ status: number; text: string; ms: number }> {
  const start = Date.now();
  const resp = await fetchWithTimeout(url, ms, headers);
  const text = await resp.text();
  return { status: resp.status, text, ms: Date.now() - start };
}

function section(title: string) {
  console.log(`\n${"─".repeat(72)}\n${title}\n${"─".repeat(72)}`);
}

// --- 1. Anna's Archive (primary search) -----------------------------------------
async function probeAA(): Promise<{ mirror: string; count: number }[]> {
  section(`ANNA'S ARCHIVE — search "${query}"`);
  const results: { mirror: string; count: number }[] = [];
  for (const base of AA_MIRRORS) {
    try {
      const { status, text, ms } = await fetchText(`${base}/search?q=${encodeURIComponent(query)}`);
      const books = parseSearchHtml(text);
      results.push({ mirror: base, count: books.length });
      const sample = books[0] ? `${DIM}e.g.${RST} "${books[0].title.slice(0, 40)}" — ${books[0].author.slice(0, 24)} [${books[0].book_filetype}]` : "";
      console.log(books.length ? ok(`${base.padEnd(26)} ${status} ${ms}ms — ${books.length} results  ${sample}`) : warn(`${base.padEnd(26)} ${status} ${ms}ms — 0 results (captcha/empty?)`));
    } catch (e) {
      results.push({ mirror: base, count: -1 });
      console.log(bad(`${base.padEnd(26)} ${(e as Error).message.slice(0, 40)}`));
    }
  }
  return results;
}

// --- 2. Library Genesis (fallback search + md5 source) --------------------------
async function probeLibgenSearch(): Promise<{ mirror: string; count: number; md5?: string; ext?: string }[]> {
  section(`LIBRARY GENESIS — search "${query}"`);
  const results: { mirror: string; count: number; md5?: string; ext?: string }[] = [];
  for (const base of LIBGEN_MIRRORS) {
    try {
      const { status, text, ms } = await fetchText(`${base}/index.php?req=${encodeURIComponent(query)}`);
      const books = parseLibgenSearch(text);
      const epub = books.find((b) => /^(epub|pdf|mobi|azw3)$/i.test(b.book_filetype)) || books[0];
      results.push({ mirror: base, count: books.length, md5: epub?.md5, ext: epub?.book_filetype?.toLowerCase() });
      const sample = books[0] ? `${DIM}e.g.${RST} "${books[0].title.slice(0, 34)}" — ${books[0].author.slice(0, 20)} [${books[0].book_filetype} ${books[0].book_size}]` : "";
      console.log(books.length ? ok(`${base.padEnd(16)} ${status} ${ms}ms — ${books.length} results  ${sample}`) : warn(`${base.padEnd(16)} ${status} ${ms}ms — 0 parsed`));
    } catch (e) {
      results.push({ mirror: base, count: -1 });
      console.log(bad(`${base.padEnd(16)} ${(e as Error).message.slice(0, 40)}`));
    }
  }
  return results;
}

// --- 3. Download chain: ads.php -> get.php -> first bytes ------------------------
async function probeDownload(md5: string, ext: string) {
  section(`DOWNLOAD CHAIN — md5 ${md5} (.${ext}) via ads.php → get.php → bytes`);
  for (const base of LIBGEN_MIRRORS) {
    try {
      const { text } = await fetchText(`${base}/ads.php?md5=${md5}`, 20000);
      const getUrl = parseLibgenUrl(text, base);
      if (!getUrl) {
        console.log(warn(`${base.padEnd(16)} no get.php link on ads page`));
        continue;
      }
      // Pull just the first chunk to prove real file bytes (not an HTML error wall).
      const resp = await fetchWithTimeout(getUrl, 25000, { ...HEADERS, Referer: `${base}/` });
      const ct = resp.headers.get("Content-Type") || "";
      const len = resp.headers.get("Content-Length") || "?";
      if (!resp.ok || ct.includes("text/html")) {
        console.log(bad(`${base.padEnd(16)} get.php -> ${resp.status} ${ct || "no-ct"} (not a file)`));
        await resp.body?.cancel();
        continue;
      }
      const reader = resp.body!.getReader();
      const { value } = await reader.read();
      await reader.cancel();
      const head = value ? [...value.slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join(" ") : "";
      console.log(ok(`${base.padEnd(16)} ${resp.status} ${ct} len=${len}  ${DIM}magic=[${head}] first ${value?.length ?? 0}B${RST}`));
    } catch (e) {
      console.log(bad(`${base.padEnd(16)} ${(e as Error).message.slice(0, 44)}`));
    }
  }
}

// --- 4. Covers: AA /md5/<md5> -> og:image ---------------------------------------
async function probeCovers(md5: string, aaLive: string[]) {
  section(`COVERS — og:image scrape for md5 ${md5}`);
  for (const base of aaLive.slice(0, 3)) {
    try {
      const { text } = await fetchText(`${base}/md5/${md5}`, 20000);
      const img = parseCoverUrl(text);
      console.log(img ? ok(`${base.padEnd(26)} ${img.slice(0, 60)}`) : warn(`${base.padEnd(26)} no cover url found`));
    } catch (e) {
      console.log(bad(`${base.padEnd(26)} ${(e as Error).message.slice(0, 40)}`));
    }
  }
}

// --- 5. Gutendex (legal, public-domain JSON API) --------------------------------
async function probeGutendex() {
  section(`GUTENDEX (Project Gutenberg API) — search "${query}"`);
  try {
    const { status, text, ms } = await fetchText(`https://gutendex.com/books/?search=${encodeURIComponent(query)}`, 20000, { "User-Agent": UA });
    const data = JSON.parse(text) as { count: number; results: { title: string; authors: { name: string }[]; formats: Record<string, string> }[] };
    const b = data.results?.[0];
    const fmts = b ? Object.keys(b.formats).filter((k) => /epub|mobi|text\/plain|pdf/.test(k)).join(", ") : "";
    console.log(ok(`gutendex.com ${status} ${ms}ms — count=${data.count}`));
    if (b) {
      console.log(`   ${DIM}e.g.${RST} "${b.title.slice(0, 44)}" — ${b.authors?.[0]?.name ?? "?"}`);
      console.log(`   ${DIM}formats:${RST} ${fmts}`);
      const epub = Object.entries(b.formats).find(([k]) => k.includes("epub"));
      const cover = Object.entries(b.formats).find(([k]) => k.startsWith("image/"));
      console.log(`   ${DIM}epub:${RST} ${epub?.[1] ?? "none"}`);
      console.log(`   ${DIM}cover:${RST} ${cover?.[1] ?? "none"}`);
    }
  } catch (e) {
    console.log(bad(`gutendex.com ${(e as Error).message.slice(0, 50)}`));
  }
}

// --- 6. Open Library (legal metadata + readable IA links) -----------------------
async function probeOpenLibrary() {
  section(`OPEN LIBRARY — search "${query}"`);
  try {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=5&fields=key,title,author_name,first_publish_year,cover_i,ia,ebook_access`;
    const { status, text, ms } = await fetchText(url, 20000, { "User-Agent": UA });
    const data = JSON.parse(text) as { numFound: number; docs: { title: string; author_name?: string[]; ebook_access?: string; cover_i?: number }[] };
    console.log(ok(`openlibrary.org ${status} ${ms}ms — numFound=${data.numFound}`));
    const readable = data.docs?.filter((d) => d.ebook_access === "public" || d.ebook_access === "borrowable").length ?? 0;
    const b = data.docs?.[0];
    if (b) console.log(`   ${DIM}e.g.${RST} "${b.title?.slice(0, 44)}" — ${b.author_name?.[0] ?? "?"} [access=${b.ebook_access}] (${readable}/5 readable, covers via covers.openlibrary.org)`);
  } catch (e) {
    console.log(bad(`openlibrary.org ${(e as Error).message.slice(0, 50)}`));
  }
}

// --- Run everything -------------------------------------------------------------
console.log(`\n${"═".repeat(72)}\n  BOOKRACY SOURCE PROBE — query="${query}"  ${new Date().toISOString()}\n${"═".repeat(72)}`);

const aa = await probeAA();
const lg = await probeLibgenSearch();

const aaLive = aa.filter((r) => r.count > 0).map((r) => r.mirror);
const lgHit = lg.find((r) => r.md5);
// Fall back to a well-known libgen md5 if search yielded none, so the chain still runs.
const testMd5 = lgHit?.md5 || "e7c75dc2964ce80c19cb69140aae8614";
const testExt = lgHit?.ext || "epub";

await probeDownload(testMd5, testExt);
await probeCovers(testMd5, aaLive.length ? aaLive : AA_MIRRORS);
await probeGutendex();
await probeOpenLibrary();

section("SUMMARY");
console.log(`Anna's Archive live mirrors : ${aaLive.length ? aaLive.map((m) => m.replace("https://annas-archive.", ".")).join("  ") : RED + "NONE" + RST}`);
console.log(`Libgen search mirrors w/ hits: ${lg.filter((r) => r.count > 0).map((r) => r.mirror.replace("https://", "")).join("  ") || RED + "NONE" + RST}`);
console.log(`Download test md5           : ${testMd5} (.${testExt})`);
console.log(`\nDone.\n`);
