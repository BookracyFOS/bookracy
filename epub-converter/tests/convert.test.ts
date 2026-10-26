/**
 * Real conversion tests: build a minimal valid EPUB in-memory (no network),
 * convert it, and assert a valid PDF comes out. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { convertEpubToPdf, composeLines, type LineToken } from '../src/index.ts';

// Tiny valid baseline JPEG — exercises the image path (getImageProperties + addImage).
const JPEG_1x1_BASE64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAAAv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==';

async function makeMinimalEpub(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );
  zip.file('OEBPS/cover.jpg', JPEG_1x1_BASE64, { base64: true });
  zip.file('OEBPS/style.css', 'h1 { color: #112233; font-size: 20pt; } p { font-size: 12pt; }');
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Book</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier id="bookid">urn:uuid:test-123</dc:identifier>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="cover-img" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="chap1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chap1"/>
  </spine>
</package>`
  );
  zip.file(
    'OEBPS/chapter1.xhtml',
    `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 1</title><link rel="stylesheet" href="style.css"/></head>
<body>
  <h1>Chapter One</h1>
  <p>${'The quick brown fox jumps over the lazy dog. '.repeat(60)}</p>
  <ul><li>First item</li><li>Second item</li></ul>
  <p><strong>Bold</strong> and <em>italic</em> text, plus an image:</p>
  <img src="cover.jpg" alt="cover"/>
</body>
</html>`
  );
  return zip.generateAsync({ type: 'arraybuffer' });
}

test('converts a valid EPUB (ArrayBuffer) into a non-empty PDF', async () => {
  const epub = await makeMinimalEpub();
  const pdf = await convertEpubToPdf(epub);

  const bytes = new Uint8Array(pdf.output('arraybuffer') as ArrayBuffer);
  const header = String.fromCharCode(...bytes.subarray(0, 5));
  assert.equal(header, '%PDF-', `expected a PDF header, got "${header}"`);
  assert.ok(bytes.length > 1000, `expected a substantial PDF, got ${bytes.length} bytes`);
  assert.ok(pdf.getNumberOfPages() >= 1, 'expected at least one page');
});

test('multi-page content spans more than one page', async () => {
  // A large body should overflow A4 and force page breaks (regression guard for
  // the tolerant-XML fix: chapters must not be silently dropped).
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
  );
  zip.file(
    'content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Big</dc:title><dc:identifier id="id">x</dc:identifier></metadata>
<manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="c1"/></spine></package>`
  );
  const paragraphs = Array.from({ length: 60 }, (_, i) => `<p>Paragraph ${i}: ${'lorem ipsum '.repeat(30)}</p>`).join('');
  zip.file('c1.xhtml', `<?xml version="1.0"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c1</title></head><body><h1>Big Chapter</h1>${paragraphs}</body></html>`);

  const pdf = await convertEpubToPdf(await zip.generateAsync({ type: 'arraybuffer' }));
  assert.ok(pdf.getNumberOfPages() > 1, `expected multiple pages, got ${pdf.getNumberOfPages()}`);
});

test('rejects an invalid (non-zip) buffer', async () => {
  const garbage = new TextEncoder().encode('this is definitely not an epub').buffer;
  await assert.rejects(() => convertEpubToPdf(garbage));
});

// Regression guard for the headline bug: inline runs (<b>/<i>/<a>) used to be
// drawn one fragment per line, shredding paragraphs to one word per line. The
// pure line packer must now pack as many words as fit before wrapping.
test('composeLines packs multiple words onto one line (one-word-per-line regression)', () => {
  const tokens: LineToken[] = [];
  for (let i = 0; i < 8; i++) {
    if (i) tokens.push({ kind: 'space', width: 4 });
    tokens.push({ kind: 'word', text: `w${i}`, width: 10 });
  }
  // 8 words * 10 + 7 spaces * 4 = 108 <= 200 -> everything on ONE line.
  const lines = composeLines(tokens, 200);
  assert.equal(lines.length, 1, `expected 1 line, got ${lines.length}`);
  assert.equal(lines[0].tokens.filter((t) => t.kind === 'word').length, 8);
});

test('composeLines wraps words that exceed the available width', () => {
  const tokens: LineToken[] = [];
  for (let i = 0; i < 6; i++) {
    if (i) tokens.push({ kind: 'space', width: 10 });
    tokens.push({ kind: 'word', text: `w${i}`, width: 60 });
  }
  const lines = composeLines(tokens, 200);
  assert.ok(lines.length >= 2, `expected wrapping into >=2 lines, got ${lines.length}`);
  for (const ln of lines) assert.ok(ln.naturalWidth <= 200, `line width ${ln.naturalWidth} exceeds 200`);
});

test('composeLines honours an explicit break (<br>)', () => {
  const lines = composeLines(
    [
      { kind: 'word', text: 'a', width: 10 },
      { kind: 'break' },
      { kind: 'word', text: 'b', width: 10 },
    ],
    500,
  );
  assert.equal(lines.length, 2, `expected a forced break into 2 lines, got ${lines.length}`);
});

// End-to-end guard: an inline-heavy paragraph (nested <b><i>, <a>, justify) plus
// an UNKNOWN CSS font-family must convert cleanly. A missing font used to throw
// out of jsPDF setFont() and abort the whole book; the safe resolver prevents it.
test('converts inline-heavy text with an unknown CSS font-family without crashing', async () => {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  zip.file(
    'style.css',
    'body { font-family: "Totally Missing Font", FancySerif; } p { text-align: justify; } .blue { color: #0000ff; }',
  );
  zip.file(
    'content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Inline</dc:title><dc:identifier id="id">x</dc:identifier></metadata><manifest><item id="css" href="style.css" media-type="text/css"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`,
  );
  const inner = 'This is <strong>bold text</strong> and <em>italic</em> and a <a href="https://example.com">real link</a> flowing together as <b><i>one nested run</i></b> that must wrap across lines. '.repeat(8);
  zip.file(
    'c1.xhtml',
    `<?xml version="1.0"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c1</title><link rel="stylesheet" href="style.css"/></head><body><h1>Inline Heavy</h1><p class="blue">${inner}</p></body></html>`,
  );

  const pdf = await convertEpubToPdf(await zip.generateAsync({ type: 'arraybuffer' }));
  const bytes = new Uint8Array(pdf.output('arraybuffer') as ArrayBuffer);
  assert.equal(String.fromCharCode(...bytes.subarray(0, 5)), '%PDF-');
  assert.ok(bytes.length > 1000, `expected a substantial PDF, got ${bytes.length} bytes`);
  assert.ok(pdf.getNumberOfPages() >= 1, 'expected at least one page');
});
