// Regenerates src/data/awards.dataset from the Book Prize Index (CC-BY-4.0).
//
//     node scripts/build-awards.mjs
//
// The upstream JSON is a 28 MB normalised graph (books / awards / appearances /
// publishers / sources). We only need enough to browse and to hand a title+author
// to Bookracy search, so this flattens it to ~1.8 MB (~0.4 MB gzipped) — small
// enough to bundle into the Worker, which keeps the endpoint dependency-free at
// runtime (no upstream fetch, no scrape, no cold-start network hop).
//
// Re-run when manifest.json's `datasetVersion` changes, then redeploy.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://book-prize-index.vercel.app/data/latest";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../src/data/awards.dataset");

// Appearance statuses worth keeping, ranked best-first. `rank` drives which
// accolade a book leads with when it has several.
const STATUS_RANK = { winner: 0, co_winner: 1, finalist: 2, shortlist: 3, longlist: 4, honorable_mention: 5 };

const getJson = async (url) => {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`${resp.status} fetching ${url}`);
  return resp.json();
};

const manifest = await getJson(`${BASE}/manifest.json`);
console.log(`dataset ${manifest.datasetVersion} (generated ${manifest.generatedAt})`);

const src = await getJson(`${BASE}/book-prize-index.json`);
const programById = new Map(src.awardPrograms.map((p) => [p.id, p]));
const awardById = new Map(src.awards.map((a) => [a.id, a]));
const bookById = new Map(src.books.map((b) => [b.id, b]));

// Collapse the appearance list onto its book. Each accolade keeps only what the UI
// renders: which prize, which category, which year, and how the book placed.
const byBook = new Map();
for (const ap of src.appearances) {
  const book = bookById.get(ap.bookId);
  const award = awardById.get(ap.awardId);
  if (!book || !award) continue;
  const status = ap.status;
  if (!(status in STATUS_RANK)) continue;

  let entry = byBook.get(book.id);
  if (!entry) {
    entry = {
      t: book.title,
      // Two authors is enough for a card; the rest are "et al." territory.
      a: (book.authors || []).slice(0, 2).map((x) => x.name),
      y: book.publicationYear || 0,
      s: book.primarySubject || "",
      w: [],
    };
    byBook.set(book.id, entry);
  }
  entry.w.push([award.programId, award.categoryName || "", Number(ap.year) || 0, status]);
}

// Best accolade first, so a card can lead with "Pulitzer Prize winner" over a
// longlisting from some other year.
for (const entry of byBook.values()) {
  entry.w.sort((x, y) => STATUS_RANK[x[3]] - STATUS_RANK[y[3]] || y[2] - x[2]);
}

// Only ship programs that actually have books attached, and only the fields the UI shows.
const used = new Set();
for (const entry of byBook.values()) for (const w of entry.w) used.add(w[0]);

const programs = src.awardPrograms
  .filter((p) => used.has(p.id))
  .map((p) => ({ id: p.id, n: p.name, o: p.organization || "", g: p.geography || "", u: p.officialUrl || "" }))
  .sort((a, b) => a.n.localeCompare(b.n));

// Most-decorated first: a book with a Pulitzer AND a NBCC is a better lead than a
// lone longlisting, and it makes the default (unsorted) browse view genuinely good.
const books = [...byBook.values()].sort((a, b) => {
  const aBest = STATUS_RANK[a.w[0][3]];
  const bBest = STATUS_RANK[b.w[0][3]];
  return aBest - bBest || b.w.length - a.w.length || (b.y || 0) - (a.y || 0);
});
books.forEach((b, i) => (b.i = i));

const subjects = [...new Set(books.map((b) => b.s).filter(Boolean))].sort();

const payload = { v: manifest.datasetVersion, programs, subjects, books };
const text = JSON.stringify(payload);

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, text, "utf8");

console.log(`books:    ${books.length}`);
console.log(`programs: ${programs.length}`);
console.log(`subjects: ${subjects.length}`);
console.log(`written:  ${OUT} (${(text.length / 1048576).toFixed(2)} MB)`);
