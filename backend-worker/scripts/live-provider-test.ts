// Live end-to-end test of the real chunk + provider modules against configured
// Telegram/Discord bots. Uploads a multi-chunk random payload, reassembles it the
// same way the Worker's read path does, and verifies it's byte-identical.
//
// Reads creds from the environment. Run with:
//   set -a && . ./.dev.vars && set +a && node scripts/live-provider-test.ts
//
// NOTE: posts a few small junk files to the configured channels. Safe to delete.

import { chunkRanges, streamConcat } from "../src/storage/chunk.ts";
import * as tg from "../src/storage/telegram.ts";
import * as dc from "../src/storage/discord.ts";
import type { BackupEnv } from "../src/storage/env.ts";

const env = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
  DISCORD_CHANNEL_ID: process.env.DISCORD_CHANNEL_ID,
} as unknown as BackupEnv;

const SIZE = 3 * 1024 * 1024; // 3 MiB
const CHUNK = 1 * 1024 * 1024; // -> 3 chunks, exercising real reassembly

function makePayload(size: number): Uint8Array {
  const buf = new Uint8Array(size);
  for (let o = 0; o < size; o += 65536) crypto.getRandomValues(buf.subarray(o, Math.min(o + 65536, size)));
  return buf;
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) parts.push(value);
  }
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.byteLength));
  return out;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const data = makePayload(SIZE);
const ranges = chunkRanges(SIZE, CHUNK);
const srcHash = await sha256(data);
console.log(`payload: ${SIZE} bytes, ${ranges.length} chunks of ${CHUNK}, sha256=${srcHash.slice(0, 16)}…`);

// --- Telegram ---
if (tg.tgConfigured(env)) {
  console.log("\n[telegram] uploading chunks…");
  const handles: string[] = [];
  for (const r of ranges) {
    const up = await tg.uploadChunk(env, data.buffer.slice(r.offset, r.offset + r.length), `livetest.part${r.i}`);
    handles.push(up.fileId);
    console.log(`  chunk ${r.i}: msg ${up.messageId} file_id ${up.fileId.slice(0, 12)}…`);
  }
  const reassembled = await readAll(streamConcat(handles.map((fileId) => () => tg.chunkStream(env, fileId))));
  const ok = (await sha256(reassembled)) === srcHash && reassembled.byteLength === SIZE;
  console.log(`[telegram] reassembled ${reassembled.byteLength} bytes — ${ok ? "IDENTICAL ✓" : "MISMATCH ✗"}`);
} else {
  console.log("\n[telegram] not configured — skipped");
}

// --- Discord ---
if (dc.dcConfigured(env)) {
  console.log("\n[discord] uploading chunks…");
  const channelId = env.DISCORD_CHANNEL_ID!;
  const msgs: string[] = [];
  for (const r of ranges) {
    const up = await dc.uploadChunk(env, data.buffer.slice(r.offset, r.offset + r.length), `livetest.part${r.i}`);
    msgs.push(up.messageId);
    console.log(`  chunk ${r.i}: msg ${up.messageId} attachment ${up.attachmentId}`);
  }
  const reassembled = await readAll(streamConcat(msgs.map((messageId) => () => dc.chunkStream(env, channelId, messageId))));
  const ok = (await sha256(reassembled)) === srcHash && reassembled.byteLength === SIZE;
  console.log(`[discord] reassembled ${reassembled.byteLength} bytes — ${ok ? "IDENTICAL ✓" : "MISMATCH ✗"}`);
} else {
  console.log("\n[discord] not configured — skipped");
}

console.log("\ndone.");
