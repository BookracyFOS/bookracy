import { test } from "node:test";
import assert from "node:assert/strict";
import { libgenSearchUrl, isLibgenErrorPage, locatorTitle, LIBGEN_SEARCH_PARAMS } from "../src/parse.ts";

// Regression cover for the 2026-08-24 outage: libgen stopped treating a bare
// `index.php?req=<q>` as a search and started answering 200 with the page it renders
// when no search ran. With AA behind DDoS-Guard since 08-13, libgen was the only
// search source left, so /api/books answered "No results found" for every query.
//
// Measured on libgen.la, back-to-back, while diagnosing:
//   bare `req=dune`            -> 50,100 B, 0 result rows
//   `req=dune` + these params  -> 110,311 B, 25 result rows

test("libgenSearchUrl sends every field libgen's own search form submits", () => {
  const url = libgenSearchUrl("https://libgen.la", "dune");
  const qs = new URL(url).searchParams;

  assert.equal(qs.get("req"), "dune");
  // The exact checked-box sets read off the form markup. A missing group is what
  // silently zeroed search, so assert the whole set rather than "some columns".
  assert.deepEqual(qs.getAll("columns[]"), ["t", "a", "s", "y", "p", "i"]);
  assert.deepEqual(qs.getAll("objects[]"), ["f", "e", "s", "a", "p", "w"]);
  assert.deepEqual(qs.getAll("topics[]"), ["l", "c", "f", "a", "m", "r", "s"]);
  // Comics/manga live under topic `c` — dropping it is how the catalogue loses them.
  assert.ok(qs.getAll("topics[]").includes("c"));
  // Matches the frontend's FETCH_PAGE_SIZE, which fetches a whole upstream page.
  assert.equal(qs.get("res"), "100");
});

test("libgenSearchUrl encodes the query exactly once", () => {
  const url = libgenSearchUrl("https://libgen.la", "dune messiah");
  // A pre-encoded caller (the download path used to pass encodeURIComponent'd text)
  // would search for the literal "%20" and match nothing.
  assert.ok(url.includes("req=dune%20messiah") || url.includes("req=dune+messiah"));
  assert.ok(!url.includes("%2520"));
  assert.equal(new URL(url).searchParams.get("req"), "dune messiah");
});

test("libgenSearchUrl keeps the mirror it was handed", () => {
  for (const base of ["https://libgen.la", "https://libgen.li", "https://libgen.bz"]) {
    assert.ok(libgenSearchUrl(base, "dune").startsWith(`${base}/index.php?req=dune&`));
  }
});

test("LIBGEN_SEARCH_PARAMS is a non-empty prebuilt query string", () => {
  assert.ok(LIBGEN_SEARCH_PARAMS.includes("columns%5B%5D=t"));
  assert.ok(LIBGEN_SEARCH_PARAMS.includes("topics%5B%5D=c"));
});

// libgen fronts a Manticore/Sphinx daemon on 9306; when it's out of connections the
// PHP layer still answers 200 with the normal shell plus an alert div. The results
// table is empty, so it is indistinguishable from a genuine "no matches" unless we
// look for the error — and a miss counts toward search()'s two-strikes budget.
test("isLibgenErrorPage detects the search daemon's 200-with-an-error page", () => {
  const dbDown = `<html><body><form></form><div class="alert alert-danger" role="alert">Could not connect to the database 9306. Too many connections<br><a href="">Report an error.</a></div></body></html>`;
  assert.equal(isLibgenErrorPage(dbDown), true);
});

test("isLibgenErrorPage treats the stock nginx placeholder as the host not answering", () => {
  // Verbatim what every mirror returned to a non-browser User-Agent on 2026-09-14:
  // 200 OK, 641 bytes, no results table — indistinguishable from "no matches" otherwise.
  const nginx = `\uFEFF<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
<style>
html { color-scheme: light dark; }
body { width: 35em; margin: 0 auto;
font-family: Tahoma, Verdana, Arial, sans-serif; }
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and
working. Further configuration is required.</p>
</body>
</html>`;
  assert.equal(isLibgenErrorPage(nginx), true);
});

test("isLibgenErrorPage ignores a real page that merely mentions nginx", () => {
  const page = `<html><head><title>Library Genesis</title></head><body><table id="tablelibgen"><tr><td>Welcome to nginx! (a book title)</td></tr></table>${"x".repeat(5000)}</body></html>`;
  assert.equal(isLibgenErrorPage(page), false);
});

test("isLibgenErrorPage does not fire on a healthy page", () => {
  const ok = `<html><body><table id="tablelibgen"><tr><td><a href="ads.php?md5=${"a".repeat(32)}">m</a></td></tr></table></body></html>`;
  assert.equal(isLibgenErrorPage(ok), false);
  // An empty-but-healthy results page is a real "no matches" and must stay one.
  assert.equal(isLibgenErrorPage(`<html><body><table id="tablelibgen"></table></body></html>`), false);
});

// Comics carry no edition title in json.php (measured: a Berserk artbook returns "" for
// both title and author), so the file row's `locator` path is the only place the real
// name survives — this is what makes the json.php md5 fallback usable for them at all.
test("locatorTitle recovers a comic's name from its archive path", () => {
  assert.equal(
    locatorTitle("V:\\comics\\_MANGA\\!JAP\\!artbooks\\[Berserk][Artbook]Berserk.Illustration.Book.2.[madoka(a)jojohot].rar"),
    "[Berserk][Artbook]Berserk.Illustration.Book.2.[madoka(a)jojohot]",
  );
});

test("locatorTitle handles POSIX separators and bare names", () => {
  assert.equal(locatorTitle("/srv/fiction/Dune.epub"), "Dune");
  assert.equal(locatorTitle("Watchmen 001.cbz"), "Watchmen 001");
  // No extension to strip is fine; a directory-only path yields nothing to show.
  assert.equal(locatorTitle("some/dir/plain name"), "plain name");
});

test("locatorTitle returns empty for missing input", () => {
  assert.equal(locatorTitle(undefined), "");
  assert.equal(locatorTitle(""), "");
});
