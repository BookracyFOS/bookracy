import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanBookTitle, appleTitleMatches, htmlToPlainText } from "../src/apple.ts";

// libgen/AA record titles carry cataloguing debris that Apple's store search can't
// parse. Measured on prod: "g1 127014 9781668065945 Choke Point - Brad Thor" returned
// NO MATCH, while "Choke Point" matched immediately — so this cleanup is the difference
// between a book having a cover and not, now that AA can't serve covers at all.

test("cleanBookTitle: strips shelf-code + id + ISBN prefix", () => {
  assert.equal(cleanBookTitle("yi 127011 9780063458819 The Secrets We Hide - Karin Slaughter", "Karin Slaughter"), "The Secrets We Hide");
  assert.equal(cleanBookTitle("g1 127014 9781668065945 Choke Point - Brad Thor", "Brad Thor"), "Choke Point");
  assert.equal(cleanBookTitle("fn 155 9780593804223 Yesteryear", "Various"), "Yesteryear");
});

test("cleanBookTitle: strips the prefix even without an ISBN", () => {
  assert.equal(cleanBookTitle("ab 4471 Dolores Claiborne", ""), "Dolores Claiborne");
});

test("cleanBookTitle: drops a trailing author duplicate", () => {
  assert.equal(cleanBookTitle("The Calamity Club - Kathryn Stockett", "Kathryn Stockett"), "The Calamity Club");
  assert.equal(cleanBookTitle("Verity by Colleen Hoover", "Colleen Hoover"), "Verity");
});

test("cleanBookTitle: drops a trailing edition parenthetical", () => {
  assert.equal(cleanBookTitle("Nelson's Complete Book of Bible Maps and Charts (2010, Thomas Nelson)", ""), "Nelson's Complete Book of Bible Maps and Charts");
  assert.equal(cleanBookTitle("The Fourth Day (epub)", ""), "The Fourth Day");
});

test("cleanBookTitle: leaves a clean title alone", () => {
  assert.equal(cleanBookTitle("Dune", "Frank Herbert"), "Dune");
  assert.equal(cleanBookTitle("1984", "George Orwell"), "1984");
});

test("cleanBookTitle: a year in the title is not an ISBN prefix", () => {
  assert.equal(cleanBookTitle("1984", ""), "1984");
  assert.equal(cleanBookTitle("2001: A Space Odyssey", "Arthur C. Clarke"), "2001: A Space Odyssey");
});

test("cleanBookTitle: an author with regex metacharacters doesn't blow up", () => {
  assert.equal(cleanBookTitle("Blindness - Saramago (J.)", "Saramago (J.)"), "Blindness");
});

test("cleanBookTitle: never strips down to nothing", () => {
  assert.equal(cleanBookTitle("Karin Slaughter", "Karin Slaughter"), "Karin Slaughter");
});

// --- authorless title matching (the comic cover-poisoning guard) ----------------
// Regression guard for 2026-08-20: with no author to verify against, accepting an Apple
// entry whose title is a truncation of the query gave five different Avengers issues the
// same Marvel collection cover, and pointed "Watchmen 09" at a study guide. Comics always
// arrive authorless (libgen leaves the field blank, coverQuery drops "Unknown Author"),
// so this is the only thing standing between them and a confidently wrong cover.

test("appleTitleMatches: store title containing ours always matches", () => {
  assert.equal(appleTitleMatches("dune messiah", "dune messiah the graphic novel", true), true);
  assert.equal(appleTitleMatches("dune messiah", "dune messiah the graphic novel", false), true);
  assert.equal(appleTitleMatches("watchmen 09", "watchmen 09 deluxe", false), true);
});

test("appleTitleMatches: truncated store title needs an author to vouch for it", () => {
  // "Watchmen 09" must not resolve to a book merely called "Watchmen" when we have no
  // author to check it against.
  assert.equal(appleTitleMatches("watchmen 09", "watchmen", false), false);
  assert.equal(appleTitleMatches("avengers 001", "avengers", false), false);
  assert.equal(appleTitleMatches("berserk v1", "berserk", false), false);
  // With an author the caller still verifies it, so the loose direction stays available.
  assert.equal(appleTitleMatches("watchmen 09", "watchmen", true), true);
  assert.equal(appleTitleMatches("mistborn the final empire", "mistborn", true), true);
});

test("appleTitleMatches: unrelated titles never match", () => {
  assert.equal(appleTitleMatches("berserk v1", "avengers the vibranium collection", true), false);
  assert.equal(appleTitleMatches("berserk v1", "avengers the vibranium collection", false), false);
});

// --- description flattening ----------------------------------------------------
// Apple's description.standard is a publisher HTML fragment. Regression guard for
// 2026-08-20, when live cards read "BESTSELLER&#xa0;*&#xa0;The multimillion-copy…"
// because the only decoder in the stack knew six named entities and no numeric ones.

test("htmlToPlainText: decodes numeric character references", () => {
  assert.equal(htmlToPlainText("BESTSELLER&#xa0;*&#xa0;The Help"), "BESTSELLER * The Help");
  assert.equal(htmlToPlainText("a&#160;b"), "a b"); // decimal NBSP
  assert.equal(htmlToPlainText("caf&#233;"), "café");
  assert.equal(htmlToPlainText("&#x2014;Oprah Daily"), "—Oprah Daily");
});

test("htmlToPlainText: strips tags and keeps paragraph structure", () => {
  assert.equal(htmlToPlainText("<b>Bold</b> and <i>italic</i>"), "Bold and italic");
  assert.equal(htmlToPlainText("one<br /><br />two"), "one\n\ntwo");
  assert.equal(htmlToPlainText("<p>one</p><p>two</p>"), "one\n\ntwo");
});

test("htmlToPlainText: single-pass decode cannot double-decode", () => {
  // Naive sequential replacement turns this into "<script>" — the whole reason the
  // decode is one pass over `&…;` rather than a chain of .replace() calls.
  assert.equal(htmlToPlainText("&amp;lt;script&amp;gt;"), "&lt;script&gt;");
  assert.equal(htmlToPlainText("Tom &amp; Jerry"), "Tom & Jerry");
});

test("htmlToPlainText: leaves malformed or unknown references alone", () => {
  assert.equal(htmlToPlainText("100&percnt; sure"), "100&percnt; sure");
  assert.equal(htmlToPlainText("&#xd800; lone surrogate"), "&#xd800; lone surrogate");
  assert.equal(htmlToPlainText("&#0; nul"), "&#0; nul");
  assert.equal(htmlToPlainText("A &amp B"), "A &amp B"); // no semicolon, not a reference
});

test("htmlToPlainText: empty input stays empty", () => {
  assert.equal(htmlToPlainText(""), "");
  assert.equal(htmlToPlainText("<b></b>"), "");
});
