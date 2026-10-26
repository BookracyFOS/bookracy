import { useMutation } from "@tanstack/react-query";
import { fetchBlobWithProgress, type DownloadProgress } from "@/lib/download";
import { useOfflineLibraryStore } from "@/stores/offline-library";

// Every download link now points back at our own Worker (the primary link, or a
// `?source=` variant), which proxies the real file with permissive CORS + progress
// headers. So we always fetch it as a blob (no cross-origin/IPFS special-casing) and
// hand back an object URL for saveAs. Errors bubble up so the UI can offer another source.
//
// Persistence: on success we also stash the blob in the offline library (IndexedDB)
// so the book survives reloads, works offline, and lights up the "Saved" chip on the
// card — the button used to skip this step, so single-book downloads never joined the
// Library page. Failures are best-effort silent; the user already has the bytes on
// disk via the browser save.

export interface DownloadRequest {
  /** Full download URL (already contains ?author=… etc.). */
  link: string;
  md5: string;
  title: string;
  author?: string;
  /** Human-readable size from the search result — kept for the reader's "big book" copy. */
  sourceSize?: string;
  /** Fallback filename to use if the server didn't send Content-Disposition. */
  fallbackFilename: string;
  /** Wired to fetch() so the toast's Cancel action can abort a long-running download. */
  signal?: AbortSignal;
  /**
   * Byte-level transfer progress. Only fires once the Worker starts streaming — the
   * wait *before* that is the backend racing download sources, which reports nothing,
   * so callers should treat "no progress yet" as the indeterminate phase rather than
   * as 0%.
   */
  onProgress?: (p: DownloadProgress) => void;
}

/** Distinguishable error when the user cancelled the download themselves — lets the
 *  caller show a neutral "cancelled" toast instead of a red "download failed" one. */
export class DownloadAbortedError extends Error {
  constructor() {
    super("aborted");
    this.name = "DownloadAbortedError";
  }
}

export interface DownloadResult {
  /** Object URL for saveAs — caller is responsible for calling saveAs and revoking. */
  url: string;
  /** Effective filename the server chose (or the fallback). Matches the saved offline copy. */
  filename: string;
}

export const useDownloadMutation = () => {
  return useMutation({
    mutationKey: ["download"],
    // Never retry a download from byte zero behind the user's back. The global
    // mutation default retries twice, so a stream that dropped at 4% silently
    // restarted under the same toast — the progress bar "reset" for no visible
    // reason. The Worker now resumes a dropped upstream stream itself; if that
    // still fails, the user gets a real error and chooses what to do.
    retry: false,
    mutationFn: async (req: DownloadRequest): Promise<DownloadResult> => {
      // Shares the bulk queue's reader (lib/download) rather than response.blob():
      // same Content-Disposition / Content-Type handling, but it drains the body a
      // chunk at a time so the caller can show real transfer progress. The Worker sets
      // Content-Length on every download path, and it's CORS-safelisted, so the
      // percentage is genuinely available here — nothing about the bar is invented.
      let blob: Blob;
      let served: string | undefined;
      try {
        ({ blob, filename: served } = await fetchBlobWithProgress(req.link, { signal: req.signal, onProgress: req.onProgress }));
      } catch (e) {
        if (req.signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) throw new DownloadAbortedError();
        throw e;
      }
      const url = URL.createObjectURL(blob);

      // Prefer the server-sent filename (handles format-mismatch redirects — see
      // libgensearch) over the caller's guess.
      const filename = served || req.fallbackFilename;
      const dot = filename.lastIndexOf(".");
      const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : "";

      // Best-effort offline save. Never let it break the download UX — if IDB is
      // unavailable (Safari private mode, quota exhausted, etc.), the user already has
      // the bytes on disk via the browser save that follows this call.
      void useOfflineLibraryStore
        .getState()
        .add({
          md5: req.md5,
          title: req.title,
          author: req.author,
          filename,
          ext,
          mime: blob.type || "application/octet-stream",
          size: blob.size,
          downloadedAt: Date.now(),
          sourceSize: req.sourceSize,
          blob,
        })
        .catch((e) => {
          console.warn("offline save failed", e);
        });

      return { url, filename };
    },
  });
};
