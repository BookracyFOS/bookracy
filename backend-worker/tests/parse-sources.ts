// Pure unit tests for the multi-source download parsers + search re-ranking.
// No network — deterministic. Run:  npx tsx tests/parse-sources.ts
import { parseLibraryLolUrl, parseIpfsCids, parseLibgenUrl, rankBooks, pickGutenbergFormat, gutenbergMatches, gutenbergSupportsExt, pickInternetArchiveFile, internetArchiveMatches, internetArchiveSupportsExt } from "../src/parse";

let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

// ---- parseLibraryLolUrl (libgen.rs fork download page) ----------------------
console.log("\n===== parseLibraryLolUrl =====");
{
  const html = `
    <div id="download">
      <h2><a href="https://download.library.lol/main/1234/abcd/The%20Book.epub">GET</a></h2>
      <ul>
        <li><a href="https://cloudflare-ipfs.com/ipfs/bafyexamplecid?filename=x.epub">Cloudflare</a></li>
        <li><a href="https://ipfs.io/ipfs/bafyexamplecid">IPFS.io</a></li>
      </ul>
    </div>`;
  const url = parseLibraryLolUrl(html);
  check("picks the direct GET link, not the IPFS mirrors", url === "https://download.library.lol/main/1234/abcd/The%20Book.epub", String(url));
}
{
  // Relative get.php link is absolutised against the host it came from.
  const html = `<div id="download"><a href="/get.php?md5=deadbeef&key=ABC">GET</a></div>`;
  const url = parseLibraryLolUrl(html, "https://books.ms");
  check("absolutises a relative get.php against the host", url === "https://books.ms/get.php?md5=deadbeef&key=ABC", String(url));
}
{
  check("returns null when there is no download link", parseLibraryLolUrl("<div>nothing here</div>") === null);
  check("returns null when the only links are IPFS", parseLibraryLolUrl(`<div id="download"><a href="https://ipfs.io/ipfs/x">m</a></div>`) === null);
}

// ---- parseIpfsCids (Anna's Archive md5 page) --------------------------------
console.log("\n===== parseIpfsCids =====");
{
  // The real AA format: multiple `ipfs_cid:`/`ipfs://` tagged CIDs (v0 + v1) — return all.
  const v0 = "QmX1eYSMGVHpLwWrjL97U2vuqp4PT8dcVSePxUw3vtdimT";
  const v1 = "bafk2bzacecek2htutcvrk2sbsbgibdp22j65745s5d5anapcglkshrryozfqa";
  const html = `<a href="ipfs://${v0}">g1</a> ... ipfs_cid:${v1} ...`;
  const cids = parseIpfsCids(html);
  check("extracts ALL tagged CIDs (v0 + v1)", cids.length === 2 && cids.includes(v0) && cids.includes(v1), cids.join(","));
}
{
  const v0 = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
  check("falls back to a labelled CID when untagged", parseIpfsCids(`<tr><td>IPFS CID:</td><td>${v0}</td></tr>`)[0] === v0);
}
{
  // A tagged CID wins; a stray untagged token is ignored when a tag exists.
  const tagged = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
  const html = `<img src="bafystraycidnotthelabelledone000000000000"> ipfs_cid:${tagged}`;
  const cids = parseIpfsCids(html);
  check("prefers tagged CID over a stray token", cids.length === 1 && cids[0] === tagged, cids.join(","));
}
{
  check("returns [] when no CID is present", parseIpfsCids("<div>no cid here</div>").length === 0);
}

// ---- parseLibgenUrl (existing, sanity) --------------------------------------
console.log("\n===== parseLibgenUrl =====");
{
  const html = `<a href="get.php?md5=abc&key=XYZ">GET</a>`;
  check("resolves + absolutises a get.php link", parseLibgenUrl(html, "https://libgen.li") === "https://libgen.li/get.php?md5=abc&key=XYZ");
}

// ---- rankBooks (search relevance) ------------------------------------------
console.log("\n===== rankBooks =====");
type B = { title: string; book_filetype?: string; book_year?: string };
{
  // The comic issue-number case from the screenshots: exact #1 must beat the collected
  // "part five" edition, and a different issue (#3) must sink below both.
  const books: B[] = [
    { title: "Thor Son of Asgard Part Five The Lake of Lilitha", book_filetype: "PDF" },
    { title: "Thor: Son of Asgard #1", book_filetype: "PDF" },
    { title: "Thor: Son of Asgard #3", book_filetype: "PDF" },
  ];
  const ranked = rankBooks("Thor: Son of Asgard #1", books);
  check("exact issue #1 ranks first", ranked[0].title === "Thor: Son of Asgard #1", ranked.map((b) => b.title).join(" | "));
  check("a different issue #3 ranks last", ranked[ranked.length - 1].title === "Thor: Son of Asgard #3");
}
{
  // Exact title beats a superstring.
  const ranked = rankBooks("Dune", [{ title: "Dune Messiah" }, { title: "Dune" }]);
  check("exact 'Dune' beats 'Dune Messiah'", ranked[0].title === "Dune", ranked.map((b) => b.title).join(" | "));
}
{
  // Token coverage promotes the real match over an unrelated result.
  const ranked = rankBooks("Project Hail Mary", [{ title: "Some Unrelated Book" }, { title: "Project Hail Mary by Andy Weir" }]);
  check("covers query tokens -> real match first", ranked[0].title.startsWith("Project Hail Mary"));
}
{
  // No-ops: single result and empty-ish query are returned unchanged.
  const one: B[] = [{ title: "Only One" }];
  check("single result unchanged", rankBooks("anything", one)[0] === one[0]);
  const two: B[] = [{ title: "B" }, { title: "A" }];
  check("stopword-only query keeps upstream order", rankBooks("the of and", two)[0].title === "B");
}
{
  // epub tiebreak over pdf when everything else ties.
  const ranked = rankBooks("Mistborn", [
    { title: "Mistborn", book_filetype: "PDF" },
    { title: "Mistborn", book_filetype: "EPUB" },
  ]);
  check("epub edges out pdf on a tie", ranked[0].book_filetype === "EPUB");
}

// ---- Project Gutenberg helpers ---------------------------------------------
console.log("\n===== Gutenberg =====");
{
  check("gutenbergSupportsExt: epub yes, pdf no", gutenbergSupportsExt("epub") && gutenbergSupportsExt(".txt") && !gutenbergSupportsExt("pdf"));
}
{
  const formats: Record<string, string> = {
    "text/html": "https://www.gutenberg.org/ebooks/1342.html.images",
    "application/epub+zip": "https://www.gutenberg.org/ebooks/1342.epub3.images",
    "application/octet-stream": "https://www.gutenberg.org/cache/epub/1342/pg1342-h.zip",
    "text/plain; charset=utf-8": "https://www.gutenberg.org/ebooks/1342.txt.utf-8",
  };
  check("pickGutenbergFormat: epub -> epub url", pickGutenbergFormat(formats, "epub") === "https://www.gutenberg.org/ebooks/1342.epub3.images");
  check("pickGutenbergFormat: txt -> txt url", pickGutenbergFormat(formats, "txt") === "https://www.gutenberg.org/ebooks/1342.txt.utf-8");
  check("pickGutenbergFormat: pdf -> null (no mismatched type)", pickGutenbergFormat(formats, "pdf") === null);
}
{
  check("gutenbergMatches: exact title + author", gutenbergMatches("Pride and Prejudice", "Jane Austen", "Pride and Prejudice", ["Austen, Jane"]));
  check("gutenbergMatches: wrong author -> false", !gutenbergMatches("Pride and Prejudice", "Charles Dickens", "Pride and Prejudice", ["Austen, Jane"]));
  check("gutenbergMatches: different book -> false", !gutenbergMatches("Pride and Prejudice", "Jane Austen", "Sense and Sensibility", ["Austen, Jane"]));
  check("gutenbergMatches: one-word title, no author -> false", !gutenbergMatches("Emma", "", "Emma", ["Austen, Jane"]));
  check("gutenbergMatches: one-word title with author -> true", gutenbergMatches("Emma", "Jane Austen", "Emma", ["Austen, Jane"]));
}

// ---- Internet Archive helpers -----------------------------------------------
console.log("\n===== Internet Archive =====");
{
  check("internetArchiveSupportsExt: epub/pdf/cbz yes, mobi no", internetArchiveSupportsExt("epub") && internetArchiveSupportsExt(".pdf") && internetArchiveSupportsExt("cbz") && !internetArchiveSupportsExt("mobi"));
}
{
  const files = [
    { name: "book_encrypted.epub", format: "EPUB", source: "original" }, // DRM copy - skipped
    { name: "book.epub", format: "EPUB", source: "derivative" },
    { name: "book.pdf", format: "Text PDF", source: "original" },
    { name: "cover.jpg", format: "JPEG", source: "derivative" },
  ];
  check("pickInternetArchiveFile: prefers non-encrypted derivative over encrypted original", pickInternetArchiveFile(files, "epub") === "book.epub");
  check("pickInternetArchiveFile: pdf -> original text pdf", pickInternetArchiveFile(files, "pdf") === "book.pdf");
  check("pickInternetArchiveFile: unsupported ext -> null", pickInternetArchiveFile(files, "mobi") === null);
  check("pickInternetArchiveFile: no match -> null", pickInternetArchiveFile([{ name: "x.jpg", format: "JPEG", source: "original" }], "epub") === null);
}
{
  check("internetArchiveMatches: string creator", internetArchiveMatches("Alice in Wonderland", "Lewis Carroll", "Alice in Wonderland", "Lewis Carroll"));
  check("internetArchiveMatches: array creator", internetArchiveMatches("Alice in Wonderland", "Lewis Carroll", "Alice in Wonderland", ["Broadwood", "Lewis Carroll"]));
  check("internetArchiveMatches: wrong author -> false", !internetArchiveMatches("Alice in Wonderland", "Charles Dickens", "Alice in Wonderland", "Lewis Carroll"));
  check("internetArchiveMatches: partial title too weak -> false", !internetArchiveMatches("Alice in Wonderland", "Carroll", "Alice", "Lewis Carroll"));
  check("internetArchiveMatches: undefined creator with author query -> false", !internetArchiveMatches("Alice in Wonderland", "Lewis Carroll", "Alice in Wonderland", undefined));
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
