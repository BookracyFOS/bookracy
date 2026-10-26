import { readFileSync, writeFileSync } from 'node:fs';
import { convertEpubToPdf } from './src/index.ts';

async function main() {
  const inPath = process.argv[2];
  const outPath = process.argv[3] ?? '/tmp/converted.pdf';
  if (!inPath) throw new Error('usage: tsx demo-convert.ts <input.epub> [output.pdf]');

  const buf = readFileSync(inPath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

  const start = Date.now();
  const pdf = await convertEpubToPdf(ab);
  const bytes = new Uint8Array(pdf.output('arraybuffer') as ArrayBuffer);
  writeFileSync(outPath, bytes);

  console.error(`Converted ${inPath}`);
  console.error(`  -> ${outPath}`);
  console.error(`  pages: ${pdf.getNumberOfPages()}`);
  console.error(`  size:  ${(bytes.length / 1024).toFixed(1)} KB`);
  console.error(`  time:  ${Date.now() - start} ms`);
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
