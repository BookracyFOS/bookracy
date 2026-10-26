import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLibgenSearch, parseLibgenUrl } from "../src/parse.ts";

// A compact but faithful slice of a libgen.li "Format 2" results table. It reproduces
// the real-world quirks the parser has to survive:
//   - the stray extra attribute quote in the title cell's badge (`badge-secondary""`),
//     which defeats whole-table DOM parsing (that's why we parse row-by-row);
//   - the title living in a tooltip ("… ID: <n><br><title>") or an edition link;
//   - the md5 sitting only in the trailing "Mirrors" column's ads.php link.
const FIXTURE = `
<html><body>
<style>#tablelibgen td { padding: 2px; } #tablelibgen1 td { padding: 0; }</style>
<table class="table table-striped" id="tablelibgen"><thead><tr>
<th>Title</th><th>Author(s)</th><th>Publisher</th><th>Year</th><th>Language</th><th>Pages</th><th>Size</th><th>Ext.</th><th>Mirrors</th>
</tr></thead><tbody>
<tr>
<td><b>Le cycle de Dune 1</b><br><a data-toggle="tooltip" data-html="true" title="Add/Edit : 2023-07-11; ID: 99923650<br>Dune Messiah" href="edition.php?id=143673667">Dune 1 <i></i></a>
<nobr><span class="badge badge-primary"><a title="Book">b</a></span> <span class="badge badge-secondary"">f 4572086</span></nobr>
</td>
<td>Frank Herbert</td>
<td>Presses Pocket</td>
<td>1969</td>
<td>English</td>
<td>412</td>
<td>781 kB</td>
<td>epub</td>
<td><a href="/ads.php?md5=e7c75dc2964ce80c19cb69140aae8614">1</a> <a href="/get.php?md5=e7c75dc2964ce80c19cb69140aae8614">[2]</a></td>
</tr>
<tr>
<td><b><a href="edition.php?id=1">Dune</a></b><br><a href="edition.php?id=2">Children of Dune</a></td>
<td>Herbert, Frank</td>
<td>Ace</td>
<td>1976</td>
<td>English</td>
<td>444</td>
<td>1 MB</td>
<td>pdf</td>
<td><a href="/ads.php?md5=0123456789abcdef0123456789abcdef">1</a></td>
</tr>
<tr>
<td><b>Dune (duplicate md5)</b><br><a title="ID: 5<br>Dune dup" href="edition.php?id=3">x</a></td>
<td>Frank Herbert</td><td>Ace</td><td>1965</td><td>English</td><td>1</td><td>2 MB</td><td>epub</td>
<td><a href="/ads.php?md5=e7c75dc2964ce80c19cb69140aae8614">1</a></td>
</tr>
</tbody></table>
</body></html>`;

test("parseLibgenSearch: extracts rows despite the malformed badge quote", () => {
  const books = parseLibgenSearch(FIXTURE);
  assert.equal(books.length, 2, "two unique md5s (the third row is a dup)");

  const [a, b] = books;
  assert.equal(a.md5, "e7c75dc2964ce80c19cb69140aae8614");
  assert.equal(a.title, "Dune Messiah"); // pulled from the tooltip tail
  assert.equal(a.author, "Frank Herbert"); // right-anchored column mapping
  assert.equal(a.book_year, "1969");
  assert.equal(a.book_lang, "English");
  assert.equal(a.book_size, "781 kB");
  assert.equal(a.book_filetype, "EPUB");
  assert.equal(a.book_source, "Library Genesis");

  assert.equal(b.md5, "0123456789abcdef0123456789abcdef");
  assert.equal(b.title, "Children of Dune"); // falls back to the (last) edition link
  assert.equal(b.book_filetype, "PDF");
});

// A real libgen.li comic row (topic `c`), reduced. The load-bearing difference from a
// book row is the Mirrors cell: comics get **no `ads.php` link at all** — only
// `get.php?md5=` and an off-site Anna's Archive link. Author/publisher/year cells are
// empty for comics, so the right-anchored column mapping still has to line up.
const COMIC_FIXTURE = `
<html><body>
<table class="table table-striped" id="tablelibgen"><thead><tr>
<th>Title</th><th>Author(s)</th><th>Publisher</th><th>Year</th><th>Language</th><th>Pages</th><th>Size</th><th>Ext.</th><th>Mirrors</th>
</tr></thead><tbody>
<tr>
<td><b><a href="series.php?id=390693">Berserk   </a><a data-toggle="tooltip" data-html="true" title="Add/Edit : 2015-07-29/2024-12-16; ID: 283839<br>Berserk v1" href="edition.php?id=142379458"><i> #1</i></a></b>
<nobr><span class="badge badge-primary"><a title="Comics issue">c</a></span> <span class="badge badge-secondary"">c 947291</span></nobr>
<font size=1 color="gray"><br>Berserk v1 <br><b>754x1100px 163dpi</b></font>
</td>
<td></td>
<td></td>
<td><nobr></nobr></td>
<td>Dutch</td>
<td>218</td>
<td><nobr><a href="/file.php?id=947291">53 MB</a></nobr></td>
<td>cbr</td>
<td><a title="libgen" href="/get.php?md5=e94521019b856b82ebd83cd42ada5882"><span class="badge badge-primary">Libgen</span></a> <a title="anna's archive" href="https://en.annas-archive.gl/md5/e94521019b856b82ebd83cd42ada5882?r=Ax2w6jC"><span class="badge badge-primary">Anna's arch</span></a> </td>
</tr>
</tbody></table>
</body></html>`;

test("parseLibgenSearch: keeps comic rows, which only ever carry get.php", () => {
  const books = parseLibgenSearch(COMIC_FIXTURE);
  assert.equal(books.length, 1, "the comic row must survive the md5 gate");

  const [c] = books;
  assert.equal(c.md5, "e94521019b856b82ebd83cd42ada5882");
  assert.equal(c.title, "Berserk v1");
  assert.equal(c.book_filetype, "CBR");
  assert.equal(c.book_lang, "Dutch");
  assert.equal(c.book_size, "53 MB");
  // Comics leave author/publisher/year blank upstream — the row must still parse, and
  // the empty year must not become a bogus one.
  assert.equal(c.author, "Unknown Author");
  assert.equal(c.book_year, "");
});

test("parseLibgenSearch: dedupes repeated md5s", () => {
  const md5s = parseLibgenSearch(FIXTURE).map((b) => b.md5);
  assert.equal(new Set(md5s).size, md5s.length);
});

test("parseLibgenSearch: empty / non-libgen HTML yields nothing", () => {
  assert.deepEqual(parseLibgenSearch("<html><body>no table here</body></html>"), []);
});

test("parseLibgenUrl: absolutises relative get.php links against the given mirror", () => {
  const html = `<a href="get.php?md5=abc&key=XYZ">download</a>`;
  assert.equal(parseLibgenUrl(html, "https://libgen.la"), "https://libgen.la/get.php?md5=abc&key=XYZ");
  // trailing slash on the base is handled
  assert.equal(parseLibgenUrl(html, "https://libgen.la/"), "https://libgen.la/get.php?md5=abc&key=XYZ");
});

test("parseLibgenUrl: keeps absolute links as-is, returns null when absent", () => {
  assert.equal(parseLibgenUrl(`<a href="https://cdn.example/get.php?md5=abc">d</a>`, "https://libgen.li"), "https://cdn.example/get.php?md5=abc");
  assert.equal(parseLibgenUrl(`<a href="/file.php?id=1">nope</a>`, "https://libgen.li"), null);
});
