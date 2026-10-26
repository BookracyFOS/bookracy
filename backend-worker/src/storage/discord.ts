// Discord backup provider (secondary store). A bot posts each chunk as an
// attachment in a storage channel. The per-attachment cap is the channel guild's
// Boost Level ceiling (10 / 50 / 100 MB), so the storage guild should be boosted
// to fit the chosen chunk size.
//
// Discord CDN URLs are signed and expire (ex/is/hm params), so we never persist a
// download URL — we store the message id and re-fetch the message to get a fresh
// signed url on each read.

import type { BackupEnv } from "./env";

const API = "https://discord.com/api/v10";
const UA = "Bookracy (https://bookracy.com, 1.0)";
const MAX_429_RETRIES = 5;

export interface DcUploaded {
  messageId: string;
  attachmentId: string;
  size: number;
}

export function dcConfigured(env: BackupEnv): boolean {
  return Boolean(env.DISCORD_BOT_TOKEN && env.DISCORD_CHANNEL_ID);
}

interface DcAttachment {
  id: string;
  url: string;
  size: number;
}
interface DcMessage {
  id: string;
  attachments: DcAttachment[];
}

/** Authenticated Discord REST call with bounded 429 (rate-limit) backoff. */
async function dcRequest(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const resp = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bot ${token}`, "User-Agent": UA, ...(init.headers || {}) },
    });
    if (resp.status !== 429 || attempt >= MAX_429_RETRIES) return resp;
    // Honor Retry-After (seconds, may be fractional). Fall back to header if no body.
    let retryAfter = 1;
    try {
      const body = (await resp.clone().json()) as { retry_after?: number };
      if (typeof body.retry_after === "number") retryAfter = body.retry_after;
    } catch {
      const hdr = parseFloat(resp.headers.get("Retry-After") || "1");
      if (!Number.isNaN(hdr)) retryAfter = hdr;
    }
    await new Promise((r) => setTimeout(r, Math.min(retryAfter, 10) * 1000));
  }
}

/** Upload one chunk as a message attachment; returns message + attachment ids. */
export async function uploadChunk(env: BackupEnv, bytes: ArrayBuffer, filename: string): Promise<DcUploaded> {
  const token = env.DISCORD_BOT_TOKEN!;
  const channelId = env.DISCORD_CHANNEL_ID!;

  const form = new FormData();
  form.append("payload_json", JSON.stringify({ attachments: [{ id: 0, filename }] }));
  form.append("files[0]", new Blob([bytes], { type: "application/octet-stream" }), filename);

  const resp = await dcRequest(token, `/channels/${channelId}/messages`, { method: "POST", body: form });
  if (!resp.ok) throw new Error(`discord upload failed: ${resp.status} ${await resp.text().catch(() => "")}`.trim());

  const msg = (await resp.json()) as DcMessage;
  const attachment = msg.attachments?.[0];
  if (!attachment) throw new Error("discord message returned no attachment");
  return { messageId: msg.id, attachmentId: attachment.id, size: bytes.byteLength };
}

/** Delete a stored chunk's message (and with it the attachment). A 404 means it's already gone. */
export async function deleteMessage(env: BackupEnv, channelId: string, messageId: string): Promise<void> {
  const resp = await dcRequest(env.DISCORD_BOT_TOKEN!, `/channels/${channelId}/messages/${messageId}`, { method: "DELETE" });
  const detail = resp.ok || resp.status === 404 ? "" : await resp.text().catch(() => "");
  await resp.body?.cancel().catch(() => {});
  if (!resp.ok && resp.status !== 404) throw new Error(`discord delete failed: ${resp.status} ${detail}`.trim());
}

/**
 * Open a fresh download stream for a stored chunk. Re-fetches the message to get a
 * freshly-signed CDN url (stored urls expire). Throws on failure so the read path
 * can fail over.
 */
export async function chunkStream(env: BackupEnv, channelId: string, messageId: string): Promise<ReadableStream<Uint8Array>> {
  const token = env.DISCORD_BOT_TOKEN!;
  const resp = await dcRequest(token, `/channels/${channelId}/messages/${messageId}`);
  if (!resp.ok) throw new Error(`discord message fetch failed: ${resp.status}`);

  const msg = (await resp.json()) as DcMessage;
  const url = msg.attachments?.[0]?.url;
  if (!url) throw new Error("discord message has no attachment url");

  const file = await fetch(url);
  if (!file.ok || !file.body) throw new Error(`discord cdn download failed: ${file.status}`);
  return file.body;
}
