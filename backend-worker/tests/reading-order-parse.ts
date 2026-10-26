// Live regression check for the comic reading-order parsers (comicbookreadingorders.com).
// Scraping is brittle: run this if search/covers-style breakage is suspected for reading
// orders. Fetches the two master pages + a sample of era pages and asserts the parse.
//   Run: npx tsx tests/reading-order-parse.ts
import { parseReadingOrderMaster, parseReadingOrderIssues } from "../src/parse";

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

const MASTERS = {
  marvel: "https://comicbookreadingorders.com/marvel/marvel-master-reading-order/",
  dc: "https://comicbookreadingorders.com/dc/dc-master-reading-order/",
};

for (const [franchise, url] of Object.entries(MASTERS)) {
  console.log(`\n===== ${franchise} =====`);
  const eras = parseReadingOrderMaster(await get(url));
  check(`${franchise}: master lists eras`, eras.length >= 10, `${eras.length} eras`);
  check(`${franchise}: every era has name+url`, eras.every((e) => e.name && /reading-order/.test(e.url)));
  check(`${franchise}: metadata parsed`, eras.some((e) => e.years && e.issuesLabel && e.description));

  // Sample a few era pages: the first two + the last with issues, to catch both the
  // regular "Part N" pages and the larger event pages that broke a DOM parser.
  for (const era of [eras[0], eras[1], eras[eras.length - 1]]) {
    const { issues, subEvents } = parseReadingOrderIssues(await get(era.url));
    const ok = issues.length > 0 || subEvents.length > 0;
    check(`  ${franchise}/${era.name}`, ok, issues.length ? `${issues.length} issues` : `${subEvents.length} sub-events (summary)`);
    if (issues.length) check(`    ${era.name}: issue titles non-empty`, issues.every((i) => i.title.length > 0));
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
