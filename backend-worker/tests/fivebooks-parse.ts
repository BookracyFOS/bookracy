// Live regression check for the Five Books parsers (fivebooks.com). Scraping is brittle:
// run this if the Five Books recommendation views break. Fetches a best-of-year page, a
// category page and a single interview, and asserts the parse.
//   Run: npx tsx tests/fivebooks-parse.ts
import { parseFiveBooksList, parseFiveBooksInterview } from "../src/parse";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const get = async (url: string) => {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`${r.status} for ${url}`);
  return r.text();
};

let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

// --- listing pages (best-of-year + category) ---
for (const [label, url] of [
  ["best 2025", "https://fivebooks.com/books/best-books-of-2025/"],
  ["category economics", "https://fivebooks.com/category/economics/"],
] as const) {
  console.log(`\n===== ${label} =====`);
  const list = parseFiveBooksList(await get(url));
  check(`${label}: has interviews`, list.length >= 3, `${list.length} interviews`);
  check(`${label}: every interview has a slug + books`, list.every((i) => i.slug && i.books.length >= 3));
  check(`${label}: books have titles`, list.every((i) => i.books.every((b) => b.title.length > 0)));
  check(`${label}: covers resolved`, list.some((i) => i.books.some((b) => /^https?:\/\//.test(b.cover))));
  check(`${label}: most interviews name an expert`, list.filter((i) => i.expert).length >= Math.floor(list.length / 2));
}

// --- a single interview ---
console.log(`\n===== interview =====`);
const slug = "inequality-daron-acemoglu";
const iv = parseFiveBooksInterview(await get(`https://fivebooks.com/best-books/${slug}/`), slug);
check("interview: subject parsed", iv.subject.length > 0, iv.subject);
check("interview: expert parsed", iv.expert.length > 0, iv.expert);
check("interview: exactly the shelf (≈5 books)", iv.books.length >= 4 && iv.books.length <= 8, `${iv.books.length} books`);
check("interview: books have title + author", iv.books.every((b) => b.title && b.author));

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
