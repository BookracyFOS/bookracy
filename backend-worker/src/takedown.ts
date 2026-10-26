// Rights-holder takedowns. A book listed here is refused on every path — download,
// cover, search, md5 lookup, metadata, community upload — and the check runs BEFORE any
// cache or source is consulted. That ordering is the whole point: R2, the
// Telegram/Discord backups and libgen would each hand the bytes straight back (and
// `backup.serve` re-warms R2 on the way out), so deleting storage alone is undone by the
// next request for the same URL.
//
// Oswaal Books and Learning Pvt. Ltd., 2026-09-26: 44 reported URLs, plus every other
// Oswaal title we found in `search_index` and in R2's stored filenames.

/** Purged on first request (see purgeTakedown in index.ts), then refused forever. */
export const TAKEDOWN_MD5S: ReadonlySet<string> = new Set([
  // Reported.
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

  // Same publisher, found in our own storage.
  "076bbf77dc909aa404c3c42bbd15c8e1", "088181c35eb7d7b63b8b98b09304a3bf", "0a1e64a837f284b142dc3e2f59d5ee42",
  "0c381811ea838419377e2667178d8873", "0dcc14ee392fba0575c873c5c3ff204f", "1344dc7762f2254796a87fe7ed0b2fbf",
  "24c32cdb77a6c5f8688e08d16c244a40", "297ee0ef850d7a82efbd56c68c1c74ea", "37169db642b7c7a2c14d75d70e0a3b03",
  "3e0165d00515c4c9d74a096d5698a2d9", "48cb319d14ae3fc826ea2d5fd8c7f747", "599c9faa3c14e334eba2c6f52735f77e",
  "66664a96547a0ea05117e82817076bc1", "666d20b989dc566f3952719f8f89b3b6", "6932fe0b867272becdf584b2a6af4281",
  "7035dc4bcd712857e9bba37a52cc1b05", "70c945d2c8e62520a064b4e3130ab737", "7b0c61ecb24460959209c597844ce836",
  "7e3bfbd2ed2ebc29bbf832aaa05ecf4d", "81ac237b190c3435b201544182bae416", "8c4fd7fd60ab1ab1978351a567b7eb6e",
  "8c59688fb481dfb9c2e9e0ff88eca984", "8d6608e584203428fffe432b700dcc35", "8e397f2f80b1d70966bcdf36ef576e65",
  "92e7928b08fe98549e37b3c3024daa72", "99d27539a341eb9b4ff089f14ed2e901", "afc20cb19a589a08af17397879553382",
  "bd677432538fca96a96a4cfb4505a335", "bfc54b58ad82bac11965915739372021", "c27afb03f086a3c53f10744d2a34a3c2",
  "c37f04a21bf77edc520b349979cf5b60", "caf60456c15f080ad428899e6846b956", "caff6485138aa9888b7f17d31756d52a",
  "cc5c690dff4ec40d6e239c49dcc50b55", "d8524999a073e18ab4796d11a2e136da", "e506769c5aa21eda383cdb4e14010d13",
  "ec448da500644462274db737044a6b67", "f1c6635edf91483639c81c575330e3ba", "f28720dd981dbf614ccb57f9e2b26ce4",
  "f2aebb4f0377a52e17eeeac9528e395a", "f377002e42bdc90ababd3c6c60d99bb3", "fc98777aa0b5b0c5e30b3d3a2c6fa096",

  // ABDR (Brazilian Reproduction Rights Organization), 2026-10-07: "Quarta Asa", Rebecca Yarros.
  "e2181a2bd6c365bcce7f835488484049", "487da7fcfe2ed4f77ea2fb2c25830947", "022861d64b85f82f0edf32cd7232d701",
]);

// "Oswaal", "Oswaal Editorial Board", "Oswaal Panel Of Experts", "Oswaal Books and Learning
// Private Limited", "OSWAAL", "Oswaal_CBSE…". No word boundary: `_` is a word character,
// so `\b` would miss underscore-joined filenames. Single-a "Oswal" is deliberately NOT
// matched — Oswal Publishers (Gurukul) is a different company, and Oswal is a surname.
// Re-uploads of these files often carry junk names (`5_6140…`, `@Cbsebookshub`,
// `MATHS CLASS 12 QB`), which is why callers pass the author as well as the title.
const DENIED_PUBLISHER = /oswaa+l/;

// Zero-width characters and soft hyphens would otherwise split the name invisibly.
const INVISIBLE = /[\u00ad\u200b-\u200f\u2060\ufeff]/g;

function normalize(s: string): string {
  return s.normalize("NFKC").replace(INVISIBLE, "").toLowerCase();
}

/** A title, author or publisher string that names a denied publisher. */
export function isDeniedWork(...fields: (string | null | undefined)[]): boolean {
  return fields.some((f) => !!f && DENIED_PUBLISHER.test(normalize(f)));
}

export function isTakenDownMd5(md5: string | null | undefined): boolean {
  return !!md5 && TAKEDOWN_MD5S.has(md5.toLowerCase());
}

export function isTakenDown(md5: string | null | undefined, ...fields: (string | null | undefined)[]): boolean {
  return isTakenDownMd5(md5) || isDeniedWork(...fields);
}
