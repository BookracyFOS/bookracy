import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TAKEDOWN_MD5S, isDeniedWork, isTakenDown, isTakenDownMd5 } from "../src/takedown.ts";

// The three junk-named reports: the title alone says nothing, only md5 or author catch them.
const JUNK_TITLES = [
  "5_6140877762316993205",
  "MATHS CLASS 12 QB BY @PROCBSE_2303",
  "APznzaZzo1TZ63Dz2y17EW0ggiDXWoJL_XlGcIyt6eWn7NuNBStDZfVA",
];

test("every md5 in the 2026-09-26 report is listed", () => {
  const reported = [
    "699ca754ab5bf6e05d8ea8852d661844", "8c0054cfa098715b735729c8fd448abe", "1c0cee6af597e678f4f212b0e0b23a0a",
    "227fb17b697540afbf5724d79e506eb4", "4e5fd1eefa68b4c23afa9cb7c5be3ce4", "33fd249ddaba35e3c81d24656cc98aec",
    "be53ee716af3681cde4df55f9394b02c", "0447542c05e3a11dcd5193073f84159e", "ae236f5624385c321bbf18bd786578cb",
    "4baca7754257e162cd39e57f11ef24ec", "8f25fea8b6c839f6a457d243284604fc", "75865d2e182878834b99a74999f15f85",
    "e5758a49057e831a60ece274fd37d99c", "fc6775d486e1961f2a1e9f2909d79b5a", "1300c71e789efd32e36c0aeed08ba7c5",
    "e9628c78bfda8a2f9582a6027af8a2e0", "9ba64ff694fa531a495c16210b93a83f", "a92660324c0c91c038f87435ad3822ed",
    "d897ba4c6ad07a7f3ab6c49215d755d6", "912c1130ad56f312ddf03f45d04e006c", "ad5ae9a51c320178bd76bbbf5c07ece8",
    "674485aa9d0d9b663a2a73c6f7cc8512", "2c0ec4e308706141c5d4ffac40341681", "925b229701f23acb478779c8040f2c19",
    "b6d10e9b26fe1090a44a0ad8708dc446", "b908d839b240eba5e550b932ef0205fc", "89162c1ffd40614051a5c22fd149041a",
    "7bdf037c6f36f440faf712b1e88197a5", "39240631a590f52d660ab716377da2f2", "a8d376ee74f5255ffbd2c435227b73b1",
    "a05fe3565b2a92913c5e68f04002466b", "195dac2ce585496c5c55814703d277d4", "11204badc03e26874304634a1deeb2c0",
    "7c9fe4bc34166e71bf99b104934458f7", "344c49c7ccefeba2d6c74f9840afc601", "c60def9b2623a8cd03dceb4ec6c1de49",
    "a19d8bce613c43b7eca789563466c33f", "3f26342f9ad981510e0aa09aab7dc866", "5a964e70543c4bfeaa5d1f91d9dc971d",
    "c2a9082d0a09d98c3e42a45242ffe6e1", "1a46ca5fd823ff271b079aed637b4072", "8ae84471acc096b2180fef0c23a68a8c",
    "90f333a2d0e96b40b7b6b2a020e41515", "a626288cdf7ba2dec00332eb049b8cf8",
  ];
  assert.equal(new Set(reported).size, 44);
  for (const m of reported) assert.ok(isTakenDownMd5(m), m);
  assert.ok(isTakenDownMd5("699CA754AB5BF6E05D8EA8852D661844"), "md5 match must be case-insensitive");
});

test("every md5 in the 2026-10-07 ABDR report is listed", () => {
  for (const m of [
    "e2181a2bd6c365bcce7f835488484049",
    "487da7fcfe2ed4f77ea2fb2c25830947",
    "022861d64b85f82f0edf32cd7232d701",
  ]) {
    assert.ok(isTakenDownMd5(m), m);
  }
});

test("the list is well-formed: lowercase 32-hex, no duplicates lost to the Set", () => {
  const src = readFileSync(new URL("../src/takedown.ts", import.meta.url), "utf8");
  const literals = src.match(/"[a-f0-9]{32}"/g) ?? [];
  assert.equal(literals.length, TAKEDOWN_MD5S.size, "a duplicate md5 in the source list");
  for (const m of TAKEDOWN_MD5S) assert.match(m, /^[a-f0-9]{32}$/);
});

test("junk-named files are caught by md5 alone, or by the author param", () => {
  for (const title of JUNK_TITLES) {
    assert.equal(isDeniedWork(title), false, "the title alone shouldn't be enough to match");
    assert.ok(isTakenDown("00000000000000000000000000000000", title, "Oswaal Editorial Board"), title);
  }
  assert.ok(isTakenDown("c60def9b2623a8cd03dceb4ec6c1de49", "5_6140877762316993205", null));
});

test("publisher variants all match, on title or author", () => {
  for (const s of [
    "Oswaal Editorial Board",
    "Oswaal Editorial board",
    "Oswaal Panel Of Experts",
    "Oswaal Books and Learning Private Limited",
    "@STUDYMASTER11 OSWAAL CLASS 12 QUESTION BANK CHEMISTRY FOR 2023 EXAM",
    "Oswaal_CBSE_Question_Bank_Class_10",
    "oswaal pw educart mtg arihant",
    "Osw\u200baal Editorial Board",
    "Ｏｓｗａａｌ Editorial Board",
  ]) {
    assert.ok(isDeniedWork(s), s);
  }
});

test("unrelated names that merely look similar are not blocked", () => {
  for (const s of [
    "Oswald Spengler",
    "Alice Oswald",
    "Goswami, Raj",
    "Oswal - Gurukul",
    "Oswal Publishers",
    "Tammy Jordan Wyatt, Sara B. Oswalt",
    "",
  ]) {
    assert.equal(isDeniedWork(s), false, s);
  }
  assert.equal(isTakenDown(null, null, undefined), false);
});
