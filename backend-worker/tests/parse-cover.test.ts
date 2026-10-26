import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCoverUrl, libgenCoverPath } from "../src/parse.ts";

// Regression tests for the 2026-08-13 cover-poisoning incident.
//
// Every AA mirror moved behind DDoS-Guard, which answers datacenter egress (i.e. the
// Worker) with a challenge instead of the page we asked for. Some of those responses
// were still 200s with images on them, and the old parser's "first <img> on the page"
// rule returned that image for *whatever* md5 was being looked up — so one unrelated
// thumbnail got written to R2 as the cover for many different books. R2's covers/
// lifecycle is 90 days, so the wrong cover did not age out on its own.
//
// The guard: a real /md5/<md5> page always carries its own md5 in the markup. If we
// can't see the md5 we asked for, we're not on the right page, and "no cover" is the
// only safe answer.

const MD5 = "5535d5c434c9c85e3d5d7657fa60975a";
const OTHER = "187c9b05a721a209af602d63e933a577";

const bookPage = (md5: string) => `<!doctype html><html><head>
  <meta property="og:image" content="https://example.org/covers/${md5}.jpg">
  </head><body><a href="/md5/${md5}">download</a></body></html>`;

// A generic AA page: 200, real markup, real images — just not this book's page.
const CAROUSEL = `<!doctype html><html><head><title>Anna's Archive</title></head><body>
  <img src="https://example.org/logo.png">
  <img src="https://example.org/recently-added/hersenschimmen.jpg">
  <img src="https://example.org/recently-added/other.jpg">
  </body></html>`;

test("parseCoverUrl: takes og:image from the right book's page", () => {
  assert.equal(parseCoverUrl(bookPage(MD5), MD5), `https://example.org/covers/${MD5}.jpg`);
});

test("parseCoverUrl: rejects a generic page that never mentions the md5", () => {
  assert.equal(parseCoverUrl(CAROUSEL, MD5), null);
});

test("parseCoverUrl: rejects another book's page", () => {
  assert.equal(parseCoverUrl(bookPage(OTHER), MD5), null);
});

test("parseCoverUrl: md5 match is case-insensitive", () => {
  assert.equal(parseCoverUrl(bookPage(MD5.toUpperCase()), MD5), `https://example.org/covers/${MD5.toUpperCase()}.jpg`);
});

test("parseCoverUrl: falls back to a page <img> when og:image is absent", () => {
  const html = `<html><body><a href="/md5/${MD5}">x</a>
    <img src="https://example.org/logo.png">
    <img src="https://example.org/real-cover.jpg"></body></html>`;
  assert.equal(parseCoverUrl(html, MD5), "https://example.org/real-cover.jpg");
});

test("parseCoverUrl: without an md5, behaviour is unchanged (callers that can't verify)", () => {
  assert.equal(parseCoverUrl(CAROUSEL), "https://example.org/recently-added/hersenschimmen.jpg");
});

test("parseCoverUrl: no images at all yields null", () => {
  assert.equal(parseCoverUrl(`<html><body><p>${MD5}</p></body></html>`, MD5), null);
});

// ---------------------------------------------------------------------------
// libgenCoverPath — the replacement for AA as an md5-addressed cover source.
//
// AA has been dark since 2026-08-13, which left Apple (title-addressed) as the only
// cover source and 74% of /cover/ requests answering 404. libgen has covers for its own
// catalogue, keyed by md5, bucketed by a thousand-wide slice of the row's catalogue id.
// These pin the rule, and especially the part that is NOT guessable.

const LG_MD5 = "65e5bdb6807bb180ed3af728f3327226";
const CX_MD5 = "e94521019b856b82ebd83cd42ada5882";

test("libgenCoverPath: comics use comicscovers/ keyed on comics_id", () => {
  assert.equal(
    libgenCoverPath({ cover_exists: "1", libgen_topic: "c", comics_id: "947291", libgen_id: "0" }, CX_MD5),
    `/comicscovers/947000/${CX_MD5}.jpg`,
  );
});

test("libgenCoverPath: libgen topic uses covers/ keyed on libgen_id", () => {
  assert.equal(
    libgenCoverPath({ cover_exists: "1", libgen_topic: "l", libgen_id: "2603963", comics_id: "0" }, LG_MD5),
    `/covers/2603000/${LG_MD5}.jpg`,
  );
});

// The counter-intuitive half, and the reason this is one rule rather than four: fiction
// and Russian fiction carry fiction_id / fiction_rus_id on the record, but their covers
// live under /covers/ keyed on libgen_id like everything else. Verified against
// production 2026-09-01 — reading the "obvious" id here produces a path that 404s.
for (const topic of ["f", "r", "m", "s", ""]) {
  test(`libgenCoverPath: topic ${topic || "(empty)"} falls back to covers/ + libgen_id`, () => {
    assert.equal(
      libgenCoverPath({ cover_exists: "1", libgen_topic: topic, libgen_id: "467224", comics_id: "0" }, LG_MD5),
      `/covers/467000/${LG_MD5}.jpg`,
    );
  });
}

test("libgenCoverPath: cover_exists is the gate — anything but \"1\" is no cover", () => {
  for (const cover_exists of ["0", "", undefined]) {
    assert.equal(libgenCoverPath({ cover_exists, libgen_topic: "l", libgen_id: "2603963" }, LG_MD5), null);
  }
});

test("libgenCoverPath: a missing or zero id yields null rather than /covers/0/", () => {
  assert.equal(libgenCoverPath({ cover_exists: "1", libgen_topic: "l", libgen_id: "0" }, LG_MD5), null);
  assert.equal(libgenCoverPath({ cover_exists: "1", libgen_topic: "l" }, LG_MD5), null);
  assert.equal(libgenCoverPath({ cover_exists: "1", libgen_topic: "c", comics_id: "" }, CX_MD5), null);
});

test("libgenCoverPath: rejects a non-md5, so nothing can build a path out of user input", () => {
  const rec = { cover_exists: "1", libgen_topic: "l", libgen_id: "2603963" };
  assert.equal(libgenCoverPath(rec, "../../etc/passwd"), null);
  assert.equal(libgenCoverPath(rec, ""), null);
  assert.equal(libgenCoverPath(rec, "zz".repeat(16)), null);
});

test("libgenCoverPath: lowercases the md5 and survives a null record", () => {
  assert.equal(
    libgenCoverPath({ cover_exists: "1", libgen_topic: "l", libgen_id: "2603963" }, LG_MD5.toUpperCase()),
    `/covers/2603000/${LG_MD5}.jpg`,
  );
  assert.equal(libgenCoverPath(null, LG_MD5), null);
  assert.equal(libgenCoverPath(undefined, LG_MD5), null);
});
