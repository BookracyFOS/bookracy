// Telegram Bot API backup provider (primary long-term store).
//
// Limits (cloud Bot API, verified 2026): sendDocument uploads <= 50 MB, but
// getFile *downloads* are capped at 20 MB — the binding constraint. Chunks are
// sized under that cap upstream (see BACKUP_CHUNK_BYTES). getFile download URLs
// expire (~1h), so we re-resolve a fresh file_path on every read.

import type { BackupEnv } from "./env";

const API = "https://api.telegram.org";

export interface TgUploaded {
  messageId: number;
  fileId: string;
  size: number;
}

export function tgConfigured(env: BackupEnv): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
}

interface TgResponse<T> {
  ok: boolean;
  description?: string;
  result?: T;
  /** Present on 429s: how many seconds Telegram wants us to wait. */
  parameters?: { retry_after?: number };
}

// Telegram throttles a bot's writes to one chat and answers 429 with an exact
// `retry_after`. Ignoring it was the single biggest source of failed backups — every
// dead-lettered job we captured was a sendDocument 429 asking for 3-15s. Waiting the
// requested time costs no CPU (the invocation is idle) and turns almost all of those
// into successes on the spot, so a book no longer has to survive the queue's own
// retry budget just to reach Telegram.
const TG_MAX_RETRIES = 4;
const TG_MAX_TOTAL_WAIT_MS = 90_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// `makeBody` is a factory, not a value: each attempt builds a fresh body so a retry
// can never post a half-consumed payload.
async function tgCall<T>(token: string, method: string, makeBody?: () => FormData | string, query?: string): Promise<T> {
  const url = `${API}/bot${token}/${method}${query ? `?${query}` : ""}`;
  let waited = 0;

  for (let attempt = 0; ; attempt++) {
    const body = makeBody?.();
    const init: RequestInit = body
      ? { method: "POST", body, headers: typeof body === "string" ? { "Content-Type": "application/json" } : undefined }
      : { method: "GET" };
    const resp = await fetch(url, init);
    const data = (await resp.json()) as TgResponse<T>;
    if (data.ok && data.result !== undefined) return data.result;

    // Honour an explicit throttle instruction; a couple of seconds of headroom on top
    // avoids bouncing straight off the same window.
    const retryAfter = resp.status === 429 ? Math.max(data.parameters?.retry_after ?? 1, 1) : 0;
    const waitMs = retryAfter * 1000 + 500;
    if (retryAfter && attempt < TG_MAX_RETRIES && waited + waitMs <= TG_MAX_TOTAL_WAIT_MS) {
      waited += waitMs;
      await sleep(waitMs);
      continue;
    }
    throw new Error(`telegram ${method} failed: ${resp.status} ${data.description || ""}`.trim());
  }
}

/** Upload one chunk as a document and return its message + reusable file id. */
export async function uploadChunk(env: BackupEnv, bytes: ArrayBuffer, filename: string): Promise<TgUploaded> {
  const token = env.TELEGRAM_BOT_TOKEN!;
  const form = () => {
    const f = new FormData();
    f.append("chat_id", env.TELEGRAM_CHAT_ID!);
    f.append("disable_content_type_detection", "true");
    f.append("document", new Blob([bytes], { type: "application/octet-stream" }), filename);
    return f;
  };

  const result = await tgCall<{ message_id: number; document?: { file_id: string }; size?: number }>(
    token,
    "sendDocument",
    form,
  );
  const fileId = result.document?.file_id;
  if (!fileId) throw new Error("telegram sendDocument returned no file_id");
  return { messageId: result.message_id, fileId, size: bytes.byteLength };
}

/**
 * Delete stored chunks for good. `deleteMessages` takes up to 100 ids and skips ones
 * already gone; if it refuses the batch, each id is retried alone so one undeletable
 * message can't hide the rest. Returns the ids that could not be deleted.
 */
export async function deleteMessages(env: BackupEnv, chatId: string, messageIds: number[]): Promise<number[]> {
  const token = env.TELEGRAM_BOT_TOKEN!;
  const failed: number[] = [];
  for (let i = 0; i < messageIds.length; i += 100) {
    const batch = messageIds.slice(i, i + 100);
    try {
      await tgCall<boolean>(token, "deleteMessages", () => JSON.stringify({ chat_id: chatId, message_ids: batch }));
      continue;
    } catch (e) {
      console.warn("telegram deleteMessages failed, retrying singly", e);
    }
    for (const id of batch) {
      try {
        await tgCall<boolean>(token, "deleteMessage", () => JSON.stringify({ chat_id: chatId, message_id: id }));
      } catch (e) {
        if (/message to delete not found/i.test(String(e))) continue;
        console.error("telegram deleteMessage failed", id, e);
        failed.push(id);
      }
    }
  }
  return failed;
}

/**
 * Open a fresh download stream for a stored chunk. Re-resolves getFile every call
 * because the download URL is short-lived. Throws on any failure so the read path
 * can fail over to the next provider.
 */
export async function chunkStream(env: BackupEnv, fileId: string): Promise<ReadableStream<Uint8Array>> {
  const token = env.TELEGRAM_BOT_TOKEN!;
  const file = await tgCall<{ file_path?: string }>(token, "getFile", undefined, `file_id=${encodeURIComponent(fileId)}`);
  if (!file.file_path) throw new Error("telegram getFile returned no file_path");

  const resp = await fetch(`${API}/file/bot${token}/${file.file_path}`);
  if (!resp.ok || !resp.body) throw new Error(`telegram file download failed: ${resp.status}`);
  return resp.body;
}
