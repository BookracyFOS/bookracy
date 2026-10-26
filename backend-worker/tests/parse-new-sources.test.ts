import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStandardEbooksFeed, pickStandardEbooksFormat, standardEbooksMatches, parseAaSlowDownloadPage } from "../src/parse.ts";

// ---- Standard Ebooks ---------------------------------------------------------

const SE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Alice's Adventures in Wonderland</title>
    <author><name>Lewis Carroll</name></author>
    <link rel="alternate" type="application/xhtml+xml" href="https://standardebooks.org/ebooks/lewis-carroll/alices-adventures-in-wonderland/john-tenniel"/>
    <link rel="enclosure" type="application/epub+zip" href="https://standardebooks.org/ebooks/lewis-carroll/alices-adventures-in-wonderland/john-tenniel/downloads/lewis-carroll_alices-adventures-in-wonderland_john-tenniel.epub?source=feed"/>
    <link rel="enclosure" type="application/epub+zip" href="https://standardebooks.org/ebooks/lewis-carroll/alices-adventures-in-wonderland/john-tenniel/downloads/lewis-carroll_alices-adventures-in-wonderland_john-tenniel_advanced.epub?source=feed"/>
    <link rel="enclosure" type="application/kepub+zip" href="https://standardebooks.org/ebooks/lewis-carroll/alices-adventures-in-wonderland/john-tenniel/downloads/lewis-carroll_alices-adventures-in-wonderland_john-tenniel.kepub.epub?source=feed"/>
    <link rel="enclosure" type="application/x-mobipocket-ebook" href="https://standardebooks.org/ebooks/lewis-carroll/alices-adventures-in-wonderland/john-tenniel/downloads/lewis-carroll_alices-adventures-in-wonderland_john-tenniel.azw3?source=feed"/>
  </entry>
</feed>`;

test("parseStandardEbooksFeed: extracts title/author/formats", () => {
  const books = parseStandardEbooksFeed(SE_XML);
  assert.equal(books.length, 1);
  assert.equal(books[0].title, "Alice's Adventures in Wonderland");
  assert.equal(books[0].author, "Lewis Carroll");
  assert.ok(books[0].formats["application/epub+zip"]);
  assert.ok(books[0].formats["application/x-mobipocket-ebook"]);
});

test("pickStandardEbooksFormat: prefers plain .epub over _advanced.epub", () => {
  const book = parseStandardEbooksFeed(SE_XML)[0];
  const url = pickStandardEbooksFormat(book.formats, "epub");
  assert.ok(url);
  assert.ok(!/_advanced\.epub/.test(url!), "should not pick the advanced variant");
});

test("pickStandardEbooksFormat: returns null for unsupported ext", () => {
  const book = parseStandardEbooksFeed(SE_XML)[0];
  assert.equal(pickStandardEbooksFormat(book.formats, "pdf"), null);
  assert.equal(pickStandardEbooksFormat(book.formats, "mobi"), null);
});

test("pickStandardEbooksFormat: handles azw3 and kepub", () => {
  const book = parseStandardEbooksFeed(SE_XML)[0];
  assert.ok(pickStandardEbooksFormat(book.formats, "azw3"));
  assert.ok(pickStandardEbooksFormat(book.formats, "kepub"));
});

test("standardEbooksMatches: matches on title+author", () => {
  const book = parseStandardEbooksFeed(SE_XML)[0];
  assert.equal(standardEbooksMatches("Alice's Adventures in Wonderland", "Lewis Carroll", book), true);
  assert.equal(standardEbooksMatches("Alice Wonderland", "Carroll", book), true);
  assert.equal(standardEbooksMatches("Some Other Book", "Somebody Else", book), false);
});

test("parseStandardEbooksFeed: empty feed yields nothing", () => {
  const empty = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`;
  assert.deepEqual(parseStandardEbooksFeed(empty), []);
});

// ---- AA slow_download page ---------------------------------------------------

test("parseAaSlowDownloadPage: extracts direct URL from ready page", () => {
  const html = `<div class="download">
    <span class="bg-gray-200 break-all">https://cdn.example.com/download/xyz.epub</span>
    <a href="...">Download now</a>
  </div>`;
  const result = parseAaSlowDownloadPage(html);
  assert.equal(result.url, "https://cdn.example.com/download/xyz.epub");
});

test("parseAaSlowDownloadPage: extracts countdown from waiting page", () => {
  const html = `<div>Please wait <span class="js-partner-countdown">27</span> seconds</div>`;
  const result = parseAaSlowDownloadPage(html);
  assert.equal(result.waitSeconds, 27);
  assert.equal(result.url, undefined);
});

test("parseAaSlowDownloadPage: URL takes priority over countdown", () => {
  const html = `
    <span class="js-partner-countdown">10</span>
    <span class="bg-gray-200 break-all">https://cdn.example.com/file.pdf</span>
  `;
  const result = parseAaSlowDownloadPage(html);
  assert.equal(result.url, "https://cdn.example.com/file.pdf");
});

test("parseAaSlowDownloadPage: rejects garbage in the URL span", () => {
  const html = `<span class="bg-gray-200 break-all">not-a-url</span>`;
  const result = parseAaSlowDownloadPage(html);
  assert.equal(result.url, undefined);
  assert.equal(result.fatal, true);
});

test("parseAaSlowDownloadPage: no URL + no countdown = fatal (captcha/offline)", () => {
  const html = `<div>Please solve the captcha</div>`;
  const result = parseAaSlowDownloadPage(html);
  assert.equal(result.fatal, true);
});

test("parseAaSlowDownloadPage: caps unreasonable countdown as fatal", () => {
  const html = `<span class="js-partner-countdown">9999</span>`;
  const result = parseAaSlowDownloadPage(html);
  assert.equal(result.waitSeconds, undefined);
  assert.equal(result.fatal, true);
});
