// Live smoke test for the Internet Archive integration — hits the same code paths
// (advancedsearch → title/author match → /metadata → file pick → HEAD download) as
// fetchFromInternetArchive. Network + availability dependent, some misses are
// expected (a title Gutenberg covers but IA doesn't index as public-domain, etc.).
// Run:  npx tsx tests/ia-smoke.ts
import { pickInternetArchiveFile, internetArchiveMatches, internetArchiveSupportsExt } from "../src/parse";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const H = { "User-Agent": UA, Accept: "application/json" };

let passes = 0;
let attempts = 0;

async function tryOne(title: string, author: string, ext: string): Promise<void> {
  attempts++;
  console.log(`\n=== ${title} / ${author} / ${ext} ===`);
  if (!internetArchiveSupportsExt(ext)) {
    console.log("skip - ext unsupported");
    return;
  }
  const iaTerm = (s: string) => s.replace(/["\\()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  const q =
    `title:(${iaTerm(title)})` +
    (author ? ` AND creator:(${iaTerm(author)})` : "") +
    ` AND mediatype:texts AND possible-copyright-status:NOT_IN_COPYRIGHT AND -access-restricted-item:true`;
  const searchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=creator&rows=8&output=json`;
  const search = (await fetch(searchUrl, { headers: H }).then((r) => r.json())) as {
    response?: { docs?: { identifier?: string; title?: string; creator?: string | string[] }[] };
  };
  const docs = search?.response?.docs || [];
  console.log(`search: ${docs.length} candidates`);
  for (const doc of docs.slice(0, 5)) {
    if (!doc.identifier) continue;
    if (!internetArchiveMatches(title, author, doc.title || "", doc.creator)) continue;
    const meta = (await fetch(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`, { headers: H }).then((r) => r.json())) as {
      files?: { name?: string; format?: string; source?: string }[];
    };
    const name = pickInternetArchiveFile(meta?.files || [], ext);
    if (!name) continue;
    const url = `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodeURIComponent(name)}`;
    const resp = await fetch(url, { headers: { "User-Agent": UA }, method: "HEAD", redirect: "follow" });
    console.log(`  ${doc.identifier}: HEAD ${resp.status} size=${resp.headers.get("content-length")} type=${resp.headers.get("content-type")}`);
    if (resp.ok) {
      console.log(`  PASS`);
      passes++;
      return;
    }
  }
  console.log(`  no downloadable candidate (expected sometimes — Gutenberg or libgen backstops)`);
}

(async () => {
  await tryOne("Alice in Wonderland", "Lewis Carroll", "epub");
  await tryOne("Pride and Prejudice", "Jane Austen", "epub");
  await tryOne("Frankenstein", "Mary Shelley", "pdf");
  await tryOne("The Time Machine", "H G Wells", "pdf");
  await tryOne("The Great Gatsby", "F Scott Fitzgerald", "epub");
  console.log(`\n${passes}/${attempts} live checks passed`);
})().catch(console.error);
