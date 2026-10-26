import { test } from "node:test";
import assert from "node:assert/strict";
import { safeFilename, attachmentDisposition } from "../src/filename.ts";

// The two titles that were actually tripping the runtime's non-ASCII warning in prod.
const JP_BOTANY = "日本の野生植物 草本 I-III+木本 I-II+シダ(写真) WILD FLOWERS OF JAPAN.pdf";
const JP_FANBOOK = "のーぶる わーくす オフィシャルビジュアルファンブック(NobleWorks Official Visual Fanbook).pdf";

// A header value the runtime will accept must be Latin-1 representable; anything above
// U+00FF is what produced "contains non-ASCII characters" and risks a browser TypeError.
const isHeaderSafe = (v: string) => /^[\x20-\x7e]*$/.test(v);

const params = (cd: string) => {
  const plain = cd.match(/filename="([^"]*)"/)?.[1] ?? null;
  const ext = cd.match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? null;
  return { plain, ext };
};

test("attachmentDisposition: header is pure ASCII even for CJK titles", () => {
  for (const name of [JP_BOTANY, JP_FANBOOK]) {
    assert.ok(isHeaderSafe(attachmentDisposition(name)), `not header-safe: ${name}`);
  }
});

test("attachmentDisposition: filename* round-trips back to the exact original", () => {
  for (const name of [JP_BOTANY, JP_FANBOOK, "Éloge de la fuite.epub", "Война и мир.pdf"]) {
    const { ext } = params(attachmentDisposition(name));
    assert.ok(ext, "missing filename*");
    assert.equal(decodeURIComponent(ext!), name);
  }
});

test("attachmentDisposition: RFC 5987 forbids the chars encodeURIComponent keeps", () => {
  const { ext } = params(attachmentDisposition("it's (a) test!*.epub"));
  assert.ok(ext);
  assert.ok(!/['()!*]/.test(ext!), `unescaped attr-char in: ${ext}`);
  assert.equal(decodeURIComponent(ext!), "it's (a) test!*.epub");
});

test("attachmentDisposition: ASCII fallback keeps the extension when nothing else survives", () => {
  assert.equal(params(attachmentDisposition("日本語.epub")).plain, "download.epub");
  assert.equal(params(attachmentDisposition("日本語")).plain, "download");
});

test("attachmentDisposition: ASCII fallback keeps readable ASCII runs", () => {
  assert.equal(params(attachmentDisposition(JP_BOTANY)).plain, "I-III+ I-II+ ( ) WILD FLOWERS OF JAPAN.pdf");
});

test("attachmentDisposition: a quote in the title cannot break out of the header", () => {
  const cd = attachmentDisposition('evil"; filename="pwned.exe');
  assert.equal(cd.match(/filename="/g)?.length, 1);
  assert.equal(params(cd).plain, "evil; filename=pwned.exe");
});

test("safeFilename: strips CR/LF and control chars, never returns empty", () => {
  assert.equal(safeFilename("a\r\nb.epub"), "ab.epub");
  assert.equal(safeFilename("\u0000\u001f  "), "download");
  assert.equal(safeFilename(""), "download");
});
