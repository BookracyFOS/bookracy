/**
 * Regression tests for the 2026-09-15 converter pass: compression, run batching,
 * overlong words, @font-face mapping, font sniffing, WOFF safety, the Unicode
 * fallback font, outline, metadata, progress and abort.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { convertEpubToPdf, composeLines, parseFontFaces, sniffFontFormat, handleEpub, type LineToken } from '../src/index.ts';

const CONTAINER = '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';

interface Opts { chapters?: number; paras?: number; text?: string; css?: string; fonts?: Record<string, Uint8Array | string>; ncx?: boolean }
async function makeEpub(o: Opts = {}): Promise<ArrayBuffer> {
  const chapters = o.chapters ?? 2, paras = o.paras ?? 5;
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip');
  z.file('META-INF/container.xml', CONTAINER);
  const fontItems = Object.keys(o.fonts ?? {}).map((f, i) => `<item id="f${i}" href="${f}" media-type="font/ttf"/>`).join('');
  const items = Array.from({ length: chapters }, (_, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join('');
  const refs = Array.from({ length: chapters }, (_, i) => `<itemref idref="c${i}"/>`).join('');
  z.file('content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Regression Book</dc:title><dc:identifier id="id">x</dc:identifier></metadata><manifest>${o.css ? '<item id="css" href="style.css" media-type="text/css"/>' : ''}${fontItems}${items}${o.ncx ? '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' : ''}</manifest><spine${o.ncx ? ' toc="ncx"' : ''}>${refs}</spine></package>`);
  if (o.css) z.file('style.css', o.css);
  for (const [name, data] of Object.entries(o.fonts ?? {})) z.file(name, data);
  if (o.ncx) z.file('toc.ncx', `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>${Array.from({ length: chapters }, (_, i) => `<navPoint id="n${i}" playOrder="${i + 1}"><navLabel><text>Chapter ${i}</text></navLabel><content src="c${i}.xhtml"/></navPoint>`).join('')}</navMap></ncx>`);
  const text = o.text ?? 'The quick brown fox jumps over the lazy dog and keeps running through the fields. ';
  for (let i = 0; i < chapters; i++) {
    const body = Array.from({ length: paras }, () => `<p class="body">${text.repeat(6)}</p>`).join('');
    z.file(`c${i}.xhtml`, `<?xml version="1.0"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c</title>${o.css ? '<link rel="stylesheet" href="style.css"/>' : ''}</head><body><h1>Chapter ${i}</h1>${body}</body></html>`);
  }
  return z.generateAsync({ type: 'arraybuffer' });
}
const pdfBytes = (pdf: { output: (t: 'arraybuffer') => ArrayBuffer }) => Buffer.from(pdf.output('arraybuffer'));

test('output is compressed: a 100+ page text book stays well under a megabyte', async () => {
  const pdf = await convertEpubToPdf(await makeEpub({ chapters: 10, paras: 40 }));
  const bytes = pdfBytes(pdf);
  assert.ok(pdf.getNumberOfPages() >= 60, `expected a long book, got ${pdf.getNumberOfPages()} pages`);
  assert.ok(bytes.length < 400_000, `expected a compact PDF, got ${bytes.length} bytes`);
  assert.ok(bytes.toString('latin1').includes('/FlateDecode'), 'page streams should be Flate-compressed');
});

test('document title comes from the EPUB metadata', async () => {
  const pdf = await convertEpubToPdf(await makeEpub());
  assert.match(pdfBytes(pdf).toString('latin1'), /\/Title \(Regression Book\)/);
});

test('composeLines splits a word wider than the line instead of overflowing', () => {
  const tokens: LineToken[] = [{ kind: 'word', text: 'x'.repeat(50), width: 500 }];
  const lines = composeLines(tokens, 120);
  assert.ok(lines.length >= 5, `expected the word broken over several lines, got ${lines.length}`);
  for (const l of lines) assert.ok(l.naturalWidth <= 120, `line wider than available: ${l.naturalWidth}`);
  assert.equal(lines.flatMap((l) => l.tokens).map((t) => (t.kind === 'word' ? t.text : '')).join(''), 'x'.repeat(50));
});

test('parseFontFaces reads family, sources, weight and style', () => {
  const css = `@font-face { font-family: "Bookerly"; src: url("../fonts/Bookerly-Bold.ttf") format("truetype"); font-weight: 700; font-style: normal; }
    @font-face{font-family:Literata;src:url(fonts/lit-it.otf);font-style:italic}
    p { font-family: "Bookerly"; }`;
  const faces = parseFontFaces(css);
  assert.deepEqual(faces, [
    { family: 'Bookerly', sources: ['../fonts/Bookerly-Bold.ttf'], bold: true, italic: false },
    { family: 'Literata', sources: ['fonts/lit-it.otf'], bold: false, italic: true },
  ]);
});

test('sniffFontFormat trusts magic bytes, not the manifest', () => {
  assert.equal(sniffFontFormat(new Uint8Array([0, 1, 0, 0, 9, 9]).buffer), 'truetype');
  assert.equal(sniffFontFormat(new TextEncoder().encode('OTTOxxxx').buffer), 'opentype');
  assert.equal(sniffFontFormat(new TextEncoder().encode('wOFFxxxx').buffer), 'woff');
  assert.equal(sniffFontFormat(new TextEncoder().encode('wOF2xxxx').buffer), 'woff2');
  assert.equal(sniffFontFormat(new TextEncoder().encode('nope').buffer), 'unknown');
});

test('handleEpub links @font-face rules to the font files they name', async () => {
  const fonts = { 'fonts/reg.ttf': new Uint8Array([0, 1, 0, 0, 1, 2, 3]), 'fonts/b.woff': new TextEncoder().encode('wOFFjunk') };
  const css = `@font-face { font-family: "Bookerly"; src: url(fonts/reg.ttf); }\n@font-face { font-family: "Bookerly"; src: url(fonts/b.woff); font-weight: bold; }`;
  const parsed = await handleEpub(await makeEpub({ css, fonts }));
  const reg = parsed.fonts.get('fonts/reg.ttf');
  const bold = parsed.fonts.get('fonts/b.woff');
  assert.equal(reg?.nameInCss, 'Bookerly'); assert.equal(reg?.format, 'truetype'); assert.equal(reg?.bold, false);
  assert.equal(bold?.nameInCss, 'Bookerly'); assert.equal(bold?.format, 'woff'); assert.equal(bold?.bold, true);
});

test('a WOFF font declared as TTF is skipped and the book still converts', async () => {
  const fonts = { 'fonts/bad.ttf': new TextEncoder().encode('wOFF' + 'x'.repeat(200)) };
  const css = `@font-face { font-family: "Bad"; src: url(fonts/bad.ttf); } p { font-family: "Bad"; }`;
  const pdf = await convertEpubToPdf(await makeEpub({ css, fonts }));
  assert.ok(pdf.getNumberOfPages() >= 1);
});

const NOTO = path.resolve(import.meta.dirname ?? '.', '../../frontend/public/fonts/NotoSans-Regular.ttf');
test('non-Latin text is drawn with the fallback font when one is supplied', { skip: !existsSync(NOTO) && 'Noto font not present' }, async () => {
  const epub = await makeEpub({ chapters: 1, paras: 2, text: 'Привет мир, это проверка кириллицы. ' });
  const plain = await convertEpubToPdf(epub);
  assert.ok(!pdfBytes(plain).toString('latin1').includes('/FontFile2'), 'without a fallback nothing TrueType is embedded');
  const font = readFileSync(NOTO);
  const pdf = await convertEpubToPdf(epub, { fallbackFont: { family: 'Noto Sans', sources: { normal: font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) } } });
  assert.ok(pdfBytes(pdf).toString('latin1').includes('/FontFile2'), 'fallback TrueType font should be embedded');
});

test('the fallback font is not fetched for a Latin-only book', async () => {
  let fetched = false;
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => { fetched = true; throw new Error('should not fetch'); }) as typeof fetch;
  try {
    await convertEpubToPdf(await makeEpub(), { fallbackFont: { family: 'X', sources: { normal: 'https://example.invalid/x.ttf' } } });
  } finally { globalThis.fetch = orig; }
  assert.equal(fetched, false);
});

test('an NCX table of contents becomes PDF outline entries', async () => {
  const pdf = await convertEpubToPdf(await makeEpub({ chapters: 3, ncx: true }));
  assert.match(pdfBytes(pdf).toString('latin1'), /\/Outlines/);
});

test('onProgress reports every chapter and an abort signal stops the conversion', async () => {
  const epub = await makeEpub({ chapters: 4 });
  const seen: number[] = [];
  await convertEpubToPdf(epub, { onProgress: (done, total) => seen.push(done * 100 + total) });
  assert.deepEqual(seen, [104, 204, 304, 404]);
  const ctrl = new AbortController();
  await assert.rejects(
    convertEpubToPdf(epub, { signal: ctrl.signal, onProgress: (done) => { if (done === 1) ctrl.abort(new Error('stop')); } }),
    /stop/,
  );
});
