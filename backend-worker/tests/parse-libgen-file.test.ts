import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLibgenFilePage } from "../src/parse.ts";

// Every title string below was captured from a live libgen `file.php?md5=` response on
// 2026-08-14 — these are the real shapes, not invented ones. This endpoint is what
// restores bare-md5 resolution (bookmarks / continue-reading / share links) now that
// Anna's Archive `/md5/` is behind a bot wall.

const page = (title: string, extra = "") => `<html><head><title>${title}</title></head><body>${extra}</body></html>`;
const MD5 = "30359bb1e26a6626bea6cbceb3377eb9";

test("parseLibgenFilePage: series + author + id + ext", () => {
  const b = parseLibgenFilePage(page("LG+: [Red Rising 1 - Red Rising 1] Red Rising{Pierce Brown}{93452685} libgen.li.epub"), MD5);
  assert.equal(b?.title, "Red Rising");
  assert.equal(b?.author, "Pierce Brown");
  assert.equal(b?.book_filetype, "EPUB");
  assert.equal(b?.md5, MD5);
});

test("parseLibgenFilePage: no series, trailing comma in author", () => {
  const b = parseLibgenFilePage(page("LG+: Dolores Claiborne{Stephen King,}{6662014} libgen.li.pdf"), MD5);
  assert.equal(b?.title, "Dolores Claiborne");
  assert.equal(b?.author, "Stephen King");
  assert.equal(b?.book_filetype, "PDF");
});

test("parseLibgenFilePage: (year, publisher) parenthetical", () => {
  const b = parseLibgenFilePage(page("LG+: [Dune 2 - Dune 2] Dune Messiah{Herbert, Frank}(1969, Ace Books){104893815} libgen.li.epub"), MD5);
  assert.equal(b?.title, "Dune Messiah");
  assert.equal(b?.author, "Herbert, Frank");
  assert.equal(b?.book_year, "1969");
});

test("parseLibgenFilePage: bare (year)", () => {
  const b = parseLibgenFilePage(page("LG+: The Secrets We Hide{Karin Slaughter}(2025){116203216} libgen.li.epub"), MD5);
  assert.equal(b?.title, "The Secrets We Hide");
  assert.equal(b?.book_year, "2025");
});

test("parseLibgenFilePage: nested brackets inside the series clause", () => {
  // The one that breaks a non-greedy series match — note the inner [АСТ].
  const t = "LG+: [Dune Universe _ Вселенная Дюны _ Дюна [АСТ] Berkley science fiction_reference Dune 1 Dune Universe] The Dune Encyclopedia{Herbert, Frank Patrick(Author)_ Willis E. McNelly}(1984 P 536_1984-06-00, Berkley Books){4073943} libgen.li.pdf";
  const b = parseLibgenFilePage(page(t), MD5);
  assert.equal(b?.title, "The Dune Encyclopedia");
  assert.equal(b?.book_year, "1984");
  assert.ok(b?.author.startsWith("Herbert, Frank Patrick"));
});

test("parseLibgenFilePage: a hyphenated author in the title is left alone", () => {
  const b = parseLibgenFilePage(page("LG+: Verity - Colleen Hoover{Colleen Hoover}{112425223} libgen.li.pdf"), MD5);
  assert.equal(b?.title, "Verity - Colleen Hoover");
  assert.equal(b?.author, "Colleen Hoover");
});

test("parseLibgenFilePage: picks up the size from the page body", () => {
  const b = parseLibgenFilePage(page("LG+: X{Y}{1} libgen.li.pdf", "<div>31 MB</div>"), MD5);
  assert.equal(b?.book_size, "31 MB");
});

test("parseLibgenFilePage: rejects a non-file page rather than guessing", () => {
  assert.equal(parseLibgenFilePage(page("Library Genesis"), MD5), null);
  assert.equal(parseLibgenFilePage("<html><body>no title</body></html>", MD5), null);
  assert.equal(parseLibgenFilePage(page("LG+: "), MD5), null);
});

test("parseLibgenFilePage: rejects the empty template libgen serves for an unknown md5", () => {
  // Verified live: `file.php?md5=<anything unknown>` answers 200 with exactly this.
  // It used to parse into a book titled "{} libgen.li." — a stale bookmark then rendered
  // as a garbage row instead of dropping off the shelf.
  assert.equal(parseLibgenFilePage(page("LG+: {} libgen.li."), MD5), null);
});

test("parseLibgenFilePage: rejects a record with no file extension", () => {
  assert.equal(parseLibgenFilePage(page("LG+: Some Book{An Author}{123} libgen.li."), MD5), null);
});

test("parseLibgenFilePage: rejects a title still carrying template braces", () => {
  assert.equal(parseLibgenFilePage(page("LG+: {}{} libgen.li.epub"), MD5), null);
});

test("parseLibgenFilePage: missing fields degrade instead of throwing", () => {
  const b = parseLibgenFilePage(page("LG+: Lonely Title{}{7} libgen.li.epub"), MD5);
  assert.equal(b?.title, "Lonely Title");
  assert.equal(b?.author, "Unknown Author");
  assert.equal(b?.book_size, "Unknown Size");
  assert.equal(b?.book_year, "");
});
