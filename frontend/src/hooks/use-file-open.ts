import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { ImportError, importLocalBook, isSupportedLocalBook } from "@/lib/import-local-book";

// Two OS-level ways a book file can arrive at the installed app, both declared in
// site.webmanifest:
//
//   file_handlers  — "Open with Bookracy" from a file manager. The browser hands us
//                    FileSystemFileHandles through window.launchQueue.
//   share_target   — sharing an EPUB from another Android app. That arrives as a POST,
//                    which only the service worker can receive, so it parks the file in
//                    a cache and redirects here (see handleSharedFile in src/sw/sw.js).
//
// Both are progressive enhancements: absent on iOS Safari and Firefox, where the
// in-app drop zone remains the way in.

const SHARE_CACHE = "bookracy-share";
const SHARE_ENTRY = "/__shared-book";

interface LaunchParams {
  files?: FileSystemFileHandle[];
}

interface LaunchQueue {
  setConsumer: (consumer: (params: LaunchParams) => void) => void;
}

async function importAndReport(file: File): Promise<void> {
  if (!isSupportedLocalBook(file.name)) {
    toast.error(`Bookracy can't open ${file.name}.`);
    return;
  }
  const id = toast.loading(`Adding ${file.name}…`);
  try {
    const { title, duplicate } = await importLocalBook(file);
    toast.success(duplicate ? `“${title}” is already in your library.` : `Added “${title}” to your library.`, { id });
  } catch (e) {
    toast.error(e instanceof ImportError ? e.message : `Couldn't add ${file.name}.`, { id });
  }
}

/** Collect a file the service worker parked from a Web Share, if there is one. */
async function collectSharedFile(): Promise<File | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(SHARE_CACHE);
    const response = await cache.match(SHARE_ENTRY);
    if (!response) return null;
    // Consume it immediately — a share is a one-shot hand-off, and leaving it behind
    // would re-import the same book on every future visit to /library.
    await cache.delete(SHARE_ENTRY);
    const blob = await response.blob();
    const name = decodeURIComponent(response.headers.get("X-Shared-Filename") || "shared-book.epub");
    return new File([blob], name, { type: blob.type });
  } catch {
    return null;
  }
}

/**
 * Wires up OS-level file opening for the installed PWA. Mount once, on the route the
 * manifest points at (`/library`).
 */
export function useFileOpen(): void {
  // React 19 StrictMode double-mounts effects in dev; importing the same file twice
  // would be harmless (md5 dedupes) but would double the toasts.
  const claimed = useRef(false);

  useEffect(() => {
    if (claimed.current) return;
    claimed.current = true;

    void (async () => {
      const shared = await collectSharedFile();
      if (shared) await importAndReport(shared);
    })();

    const queue = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
    if (!queue) return;
    queue.setConsumer((params) => {
      if (!params.files?.length) return;
      void (async () => {
        for (const handle of params.files ?? []) {
          try {
            await importAndReport(await handle.getFile());
          } catch {
            toast.error("Couldn't read that file.");
          }
        }
      })();
    });
  }, []);
}
