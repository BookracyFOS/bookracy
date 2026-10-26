import { saveAs } from "./saveAs";
import { titleToSlug } from "./string";

/** Append `inline=1` so the backend serves a PDF for viewing (browser viewer) instead of as an attachment. */
export const inlinePdfLink = (link: string) => `${link}${link.includes("?") ? "&" : "?"}inline=1`;

export interface DownloadProgress {
  /** 0–100 when the total size is known; undefined when it isn't (indeterminate). */
  percent?: number;
  receivedBytes: number;
  totalBytes?: number;
}

/** Raised when the worker rate-limits us (HTTP 429) so the queue can back off. */
export class RateLimitedError extends Error {
  constructor() {
    super("RATE_LIMITED");
    this.name = "RateLimitedError";
  }
}

/** Build a safe local filename from a book's title + filetype (falling back to the link's extension). */
export function downloadFilename(title: string, filetype?: string, link?: string): string {
  const slug = titleToSlug(title) || "book";
  let ext = (filetype || "").replace(/^\./, "").toLowerCase();
  if (!ext && link) {
    const m = link.split(/[?#]/)[0].match(/\.([a-z0-9]{1,8})$/i);
    if (m) ext = m[1].toLowerCase();
  }
  return ext ? `${slug}.${ext}` : slug;
}

/** Human-readable byte count, e.g. "12.3 MB". */
export function formatBytes(bytes?: number): string {
  if (!bytes || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Extract the server-suggested filename from a Content-Disposition header.
 * Handles the three shapes browsers/servers actually use:
 *   filename="foo.epub"           (quoted)
 *   filename=foo.epub             (unquoted)
 *   filename*=UTF-8''foo%2Eepub   (RFC 5987 encoded, wins if present)
 * Returns null when the header is absent / unparseable.
 */
export function parseContentDispositionFilename(cd: string | null | undefined): string | null {
  if (!cd) return null;
  // filename* (encoded) takes precedence per RFC 6266 when both forms are present.
  const enc = cd.match(/filename\*\s*=\s*(?:UTF-8|iso-8859-1)?''([^;]+)/i);
  if (enc) {
    try {
      return decodeURIComponent(enc[1].trim());
    } catch {
      /* fall through to plain filename */
    }
  }
  const plain = cd.match(/filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i);
  if (plain) return (plain[1] ?? plain[2] ?? "").trim() || null;
  return null;
}

/** Result of a completed download fetch — includes the effective filename the server labelled the response with. */
export interface DownloadResult {
  blob: Blob;
  /**
   * Filename the SERVER sent (Content-Disposition), or derived from the final URL
   * after any redirect follow. Undefined only when neither carries a filename.
   * Matters for the backend's format-mismatch redirect: the queued item's filename
   * might be "Hatchet.pdf" but the served file is "Hatchet.epub" — callers should
   * save under the effective filename, not the requested one, so the file opens.
   */
  filename?: string;
}

/**
 * Fetch a file into a Blob while reporting progress.
 *
 * We read the response body stream so we can report bytes as they arrive (the
 * worker exposes Content-Length, which is CORS-safelisted, so the percentage is
 * available cross-origin). Used by both the per-file queue (then saved) and the
 * ZIP builder (then added to the archive).
 *
 * Returns the blob plus the effective server-side filename so callers can save
 * under the correct name when the backend redirected to a different format
 * (see backend's libgensearch format-mismatch 302 flow).
 *
 * Throws `RateLimitedError` on HTTP 429, a generic `Error` on other failures,
 * and a DOMException("AbortError") when the signal is aborted (cancel/pause).
 */
export async function fetchBlobWithProgress(
  url: string,
  opts: { signal?: AbortSignal; onProgress?: (p: DownloadProgress) => void } = {},
): Promise<DownloadResult> {
  const { signal, onProgress } = opts;

  const res = await fetch(url, { signal });
  if (res.status === 429) throw new RateLimitedError();
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`);

  const totalHeader = res.headers.get("Content-Length");
  const totalBytes = totalHeader ? Number(totalHeader) : undefined;
  const hasTotal = Boolean(totalBytes && totalBytes > 0);

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    receivedBytes += value.length;
    onProgress?.({
      receivedBytes,
      totalBytes: hasTotal ? totalBytes : undefined,
      percent: hasTotal ? Math.min(100, (receivedBytes / (totalBytes as number)) * 100) : undefined,
    });
  }

  const type = res.headers.get("Content-Type") || "application/octet-stream";
  const blob = new Blob(chunks as BlobPart[], { type });

  // Effective filename: prefer the server's Content-Disposition (backend always
  // sets this to the served file's real name), then fall back to the last path
  // segment of the final URL after any redirect follow.
  let filename = parseContentDispositionFilename(res.headers.get("Content-Disposition")) ?? undefined;
  if (!filename && res.url) {
    const seg = res.url.split(/[?#]/)[0].split("/").pop();
    if (seg && /\.[a-z0-9]{1,8}$/i.test(seg)) {
      try {
        filename = decodeURIComponent(seg);
      } catch {
        filename = seg;
      }
    }
  }

  return { blob, filename };
}

/**
 * Fetch a file with progress and trigger a normal browser "Save as". Uses the
 * server-suggested filename (from Content-Disposition / final URL) over the
 * caller-provided one when they differ — see fetchBlobWithProgress.
 *
 * Returns { filename, blob } so callers (the download queue) can both reflect the
 * true ext in their UI AND persist the same bytes into the offline library without
 * re-fetching them.
 */
export async function downloadWithProgress(
  url: string,
  filename: string,
  opts: { signal?: AbortSignal; onProgress?: (p: DownloadProgress) => void } = {},
): Promise<{ filename: string; blob: Blob }> {
  const { blob, filename: served } = await fetchBlobWithProgress(url, opts);
  const effective = served || filename;
  const objectUrl = URL.createObjectURL(blob);
  try {
    saveAs(objectUrl, effective);
  } finally {
    // Give the browser time to start the download before we release the blob.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
  return { filename: effective, blob };
}
