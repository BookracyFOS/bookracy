import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { BookItem } from "@/api/backend/types";
import { downloadFilename, downloadWithProgress, fetchBlobWithProgress, RateLimitedError } from "@/lib/download";
import { saveAs } from "@/lib/saveAs";
import { useOfflineLibraryStore } from "@/stores/offline-library";

type DownloadStatus = "queued" | "downloading" | "done" | "error" | "canceled";

type ZipStatus = "downloading" | "zipping" | "done" | "error";

/** A single "download everything as one .zip" job (only one runs at a time). */
export interface ZipJob {
  status: ZipStatus;
  total: number;
  done: number;
  failed: number;
  currentTitle: string;
  /** 0–100 overall (fetching files = 0–90, compressing = 90–100). */
  percent: number;
  error?: string;
}

export interface DownloadItem {
  md5: string;
  title: string;
  author?: string;
  link: string;
  filename: string;
  status: DownloadStatus;
  /** 0–100 when the size is known. */
  percent?: number;
  receivedBytes: number;
  totalBytes?: number;
  error?: string;
  addedAt: number;
  /** Human-readable size from the search result — kept for the reader's "big book" copy. */
  sourceSize?: string;
}

// Gap between downloads. The worker rate-limits /download/* at ~100 req/60s per
// IP (1 every 600ms), so we pace starts to stay comfortably under that even when
// files are tiny R2 cache hits that return instantly.
const ITEM_GAP_MS = 700;
// Extra cooldown when the worker actually rate-limits us.
const RATE_LIMIT_COOLDOWN_MS = 5000;

// AbortControllers are runtime-only and never persisted.
const controllers = new Map<string, AbortController>();
let zipController: AbortController | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface DownloadQueueState {
  items: DownloadItem[];
  isPaused: boolean;
  /** internal: a download is currently in flight (not persisted). */
  active: boolean;
  /** UI: whether the downloads panel is expanded (not persisted). */
  panelOpen: boolean;
  /** Active "download all as one ZIP" job, if any (not persisted). */
  zip: ZipJob | null;

  /** Add one or more books. Returns how many were newly queued. */
  enqueue: (books: BookItem | BookItem[]) => number;
  remove: (md5: string) => void;
  retry: (md5: string) => void;
  cancel: (md5: string) => void;
  pause: () => void;
  resume: () => void;
  clearFinished: () => void;
  clearAll: () => void;
  setPanelOpen: (open: boolean) => void;
  /** Fetch all books and save them as a single .zip archive. */
  startZip: (books: BookItem[]) => Promise<void>;
  cancelZip: () => void;
  clearZip: () => void;
  /** internal: pull and process the next queued item. */
  _process: () => Promise<void>;
}

function toItem(b: BookItem): DownloadItem {
  return {
    md5: b.md5,
    title: b.title,
    author: b.author,
    link: b.link,
    filename: downloadFilename(b.title, b.book_filetype, b.link),
    status: "queued",
    receivedBytes: 0,
    addedAt: Date.now(),
    sourceSize: b.book_size,
  };
}

const ACTIVE_STATUSES: DownloadStatus[] = ["queued", "downloading"];

export const useDownloadQueueStore = create<DownloadQueueState>()(
  persist(
    (set, get) => ({
      items: [],
      isPaused: false,
      active: false,
      panelOpen: false,
      zip: null,

      enqueue: (books) => {
        const list = Array.isArray(books) ? books : [books];
        let added = 0;
        set((state) => {
          const items = [...state.items];
          const indexByMd5 = new Map(items.map((i, idx) => [i.md5, idx] as const));
          for (const b of list) {
            if (!b?.md5 || !b?.link) continue;
            const idx = indexByMd5.get(b.md5);
            if (idx === undefined) {
              items.push(toItem(b));
              indexByMd5.set(b.md5, items.length - 1);
              added++;
            } else if (!ACTIVE_STATUSES.includes(items[idx].status)) {
              // Re-download a previously finished/failed/canceled item in place.
              items[idx] = toItem(b);
              added++;
            }
          }
          return { items };
        });
        if (added > 0) {
          set({ isPaused: false });
          void get()._process();
        }
        return added;
      },

      remove: (md5) => {
        controllers.get(md5)?.abort();
        controllers.delete(md5);
        set((s) => ({ items: s.items.filter((i) => i.md5 !== md5) }));
      },

      retry: (md5) => {
        set((s) => ({
          items: s.items.map((i) =>
            i.md5 === md5 ? { ...i, status: "queued", error: undefined, percent: undefined, receivedBytes: 0, totalBytes: undefined } : i,
          ),
        }));
        set({ isPaused: false });
        void get()._process();
      },

      cancel: (md5) => {
        controllers.get(md5)?.abort();
        controllers.delete(md5);
        set((s) => ({
          items: s.items.map((i) => (i.md5 === md5 && ACTIVE_STATUSES.includes(i.status) ? { ...i, status: "canceled", percent: undefined } : i)),
        }));
      },

      pause: () => {
        set({ isPaused: true });
        // Abort the in-flight download; it drops back to "queued" so resume re-runs it.
        for (const [md5, c] of controllers) {
          c.abort();
          controllers.delete(md5);
        }
        set((s) => ({
          items: s.items.map((i) => (i.status === "downloading" ? { ...i, status: "queued", percent: undefined, receivedBytes: 0 } : i)),
        }));
      },

      resume: () => {
        set({ isPaused: false });
        void get()._process();
      },

      clearFinished: () => set((s) => ({ items: s.items.filter((i) => ACTIVE_STATUSES.includes(i.status)) })),

      clearAll: () => {
        for (const c of controllers.values()) c.abort();
        controllers.clear();
        zipController?.abort();
        zipController = null;
        set({ items: [], active: false, zip: null });
      },

      setPanelOpen: (open) => set({ panelOpen: open }),

      startZip: async (books) => {
        const list = books.filter((b) => b?.md5 && b?.link);
        if (list.length === 0) return;

        zipController?.abort();
        zipController = new AbortController();
        const signal = zipController.signal;

        set({ zip: { status: "downloading", total: list.length, done: 0, failed: 0, currentTitle: list[0].title, percent: 0 }, panelOpen: true });

        let zip: import("jszip");
        try {
          const { default: JSZip } = await import("jszip");
          zip = new JSZip();
        } catch {
          set((s) => (s.zip ? { zip: { ...s.zip, status: "error", error: "Couldn't load the zip library." } } : {}));
          return;
        }
        const usedNames = new Set<string>();
        let done = 0;
        let failed = 0;

        for (let i = 0; i < list.length; i++) {
          if (signal.aborted) {
            set({ zip: null });
            return;
          }
          const b = list[i];
          set((s) => (s.zip ? { zip: { ...s.zip, currentTitle: b.title } } : {}));
          try {
            const { blob, filename: served } = await fetchBlobWithProgress(b.link, {
              signal,
              onProgress: (p) =>
                set((s) => (s.zip ? { zip: { ...s.zip, percent: Math.min(90, ((i + (p.percent ?? 0) / 100) / list.length) * 90) } } : {})),
            });
            // Prefer the server's filename (correct ext when libgensearch redirected)
            // over the guessed one — otherwise a `.pdf`-requested book that resolved
            // to `.epub` ends up in the archive as `Foo.pdf` with EPUB bytes inside.
            let name = served || downloadFilename(b.title, b.book_filetype, b.link);
            if (usedNames.has(name)) {
              const dot = name.lastIndexOf(".");
              name = dot > 0 ? `${name.slice(0, dot)}-${b.md5.slice(0, 6)}${name.slice(dot)}` : `${name}-${b.md5.slice(0, 6)}`;
            }
            usedNames.add(name);
            zip.file(name, blob);
            done++;
          } catch {
            if (signal.aborted) {
              set({ zip: null });
              return;
            }
            failed++;
          }
          set((s) => (s.zip ? { zip: { ...s.zip, done, failed } } : {}));
        }

        if (done === 0) {
          set((s) => (s.zip ? { zip: { ...s.zip, status: "error", error: "None of the files could be fetched." } } : {}));
          return;
        }

        set((s) => (s.zip ? { zip: { ...s.zip, status: "zipping", percent: 90 } } : {}));
        try {
          const blob = await zip.generateAsync({ type: "blob", compression: "STORE" }, (meta) =>
            set((s) => (s.zip ? { zip: { ...s.zip, percent: 90 + meta.percent * 0.1 } } : {})),
          );
          if (signal.aborted) {
            set({ zip: null });
            return;
          }
          const objectUrl = URL.createObjectURL(blob);
          saveAs(objectUrl, `bookracy-${done}-book${done !== 1 ? "s" : ""}.zip`);
          setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
          set((s) => (s.zip ? { zip: { ...s.zip, status: "done", percent: 100 } } : {}));
        } catch {
          set((s) => (s.zip ? { zip: { ...s.zip, status: "error", error: "Couldn't build the zip archive." } } : {}));
        }
      },

      cancelZip: () => {
        zipController?.abort();
        zipController = null;
        set({ zip: null });
      },

      clearZip: () => set({ zip: null }),

      _process: async () => {
        if (get().active || get().isPaused) return;
        const next = get().items.find((i) => i.status === "queued");
        if (!next) return;

        set({ active: true });
        set((s) => ({ items: s.items.map((i) => (i.md5 === next.md5 ? { ...i, status: "downloading", percent: undefined, receivedBytes: 0 } : i)) }));

        const controller = new AbortController();
        controllers.set(next.md5, controller);

        let cooldown = ITEM_GAP_MS;
        try {
          // Server may serve a different-ext file than we requested when the backend's
          // libgensearch redirects to an alternate format for the same work — take the
          // effective filename it actually saved as, so the UI reflects the real ext.
          const { filename: effective, blob } = await downloadWithProgress(next.link, next.filename, {
            signal: controller.signal,
            onProgress: (p) =>
              set((s) => ({
                items: s.items.map((i) => (i.md5 === next.md5 ? { ...i, percent: p.percent, receivedBytes: p.receivedBytes, totalBytes: p.totalBytes } : i)),
              })),
          });
          set((s) => ({
            items: s.items.map((i) => (i.md5 === next.md5 ? { ...i, filename: effective, status: "done", percent: 100 } : i)),
          }));

          // Persist to the offline library so the book survives reloads and works
          // offline. Never let a save failure surface as a download failure — the user
          // already has the bytes on disk via the browser save; the offline copy is a
          // bonus. Uses the same blob we already fetched (no re-download).
          void persistToOfflineLibrary(next, effective, blob).catch((e) => {
            console.warn("offline save failed", e);
          });
        } catch (e) {
          const aborted = e instanceof DOMException && e.name === "AbortError";
          if (aborted) {
            // Paused → back to queued; explicit cancel already set "canceled".
            if (get().isPaused) {
              set((s) => ({ items: s.items.map((i) => (i.md5 === next.md5 && i.status === "downloading" ? { ...i, status: "queued" } : i)) }));
            }
          } else if (e instanceof RateLimitedError) {
            // Re-queue and cool down so we don't keep tripping the limiter.
            set((s) => ({ items: s.items.map((i) => (i.md5 === next.md5 ? { ...i, status: "queued", percent: undefined, receivedBytes: 0 } : i)) }));
            cooldown = RATE_LIMIT_COOLDOWN_MS;
          } else {
            set((s) => ({
              items: s.items.map((i) => (i.md5 === next.md5 ? { ...i, status: "error", error: e instanceof Error ? e.message : "Download failed" } : i)),
            }));
          }
        } finally {
          controllers.delete(next.md5);
          set({ active: false });
        }

        if (get().items.some((i) => i.status === "queued") && !get().isPaused) {
          await sleep(cooldown);
          void get()._process();
        }
      },
    }),
    {
      name: "BR::downloads",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      migrate: (persisted) => persisted as { items?: DownloadItem[] },
      // Persist only the list — never the live flags or (unserializable) controllers.
      partialize: (s) => ({ items: s.items }),
      // After a reload, blob/stream state is gone: reset in-flight items to queued
      // and start paused so nothing auto-downloads without the user resuming. Done in
      // `merge` (the sanctioned hook) rather than by mutating the hydrated state.
      merge: (persisted, current) => {
        const items = ((persisted as { items?: DownloadItem[] } | undefined)?.items ?? []).map((i) =>
          i.status === "downloading" ? { ...i, status: "queued" as const, percent: undefined, receivedBytes: 0 } : i,
        );
        return { ...current, items, active: false, isPaused: items.some((i) => i.status === "queued") };
      },
    },
  ),
);

// Save the just-downloaded blob into the offline library. Derives the ext + mime from
// the actual served filename (which honours format-mismatch redirects — see download.ts),
// so a `.pdf`-requested book that came down as `.epub` is filed as an EPUB and shows the
// right reader affordance later. Author is optional — search results usually carry it
// but community uploads / recent-downloads carousel items may not.
async function persistToOfflineLibrary(item: DownloadItem, effectiveFilename: string, blob: Blob): Promise<void> {
  const dot = effectiveFilename.lastIndexOf(".");
  const ext = dot >= 0 ? effectiveFilename.slice(dot).toLowerCase() : "";
  const mime = blob.type || "application/octet-stream";
  await useOfflineLibraryStore.getState().add({
    md5: item.md5,
    title: item.title,
    author: item.author,
    filename: effectiveFilename,
    ext,
    mime,
    size: blob.size,
    downloadedAt: Date.now(),
    sourceSize: item.sourceSize,
    blob,
  });
}
