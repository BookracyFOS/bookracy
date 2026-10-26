// Importing a book file from the user's own device into the on-device library.
//
// Shared by the "Add your own books" drop zone and the PWA file handler (OS-level
// "Open with Bookracy"), so both paths produce identical records.
//
// The identity of a local book is a content md5 computed in the browser. That matters
// more than it looks: reading progress, in-reader bookmarks and the offline blob lookup
// are all keyed by md5, so hashing the bytes (rather than minting a random id) means
// re-adding the same file resumes exactly where the reader left off instead of creating
// a duplicate that has forgotten everything.

import { md5OfFile, imageToJpegBlob } from "@/api/backend/community/community";
import { useOfflineLibraryStore } from "@/stores/offline-library";
import type { OfflineBookRecord } from "@/lib/offline-books";

/**
 * Formats worth importing. Deliberately narrower than the community upload allowlist:
 * these are the ones the app can actually do something with (read in-app, convert, or
 * hand back to the OS), rather than everything the backend will store.
 */
export const LOCAL_BOOK_EXTS = ["epub", "pdf", "cbz", "cbr", "mobi", "azw3", "azw", "djvu", "fb2", "txt"] as const;

/** `accept` attribute for a file input covering the formats above. */
export const LOCAL_BOOK_ACCEPT = LOCAL_BOOK_EXTS.map((e) => `.${e}`).join(",");

/**
 * Refuse absurd files early. IndexedDB can hold far more than this, but a 2 GB blob
 * would hash for minutes on a phone and is almost certainly a mistake.
 */
export const MAX_LOCAL_BOOK_BYTES = 1024 * 1024 * 1024; // 1 GB

const MIME_BY_EXT: Record<string, string> = {
  epub: "application/epub+zip",
  pdf: "application/pdf",
  cbz: "application/vnd.comicbook+zip",
  cbr: "application/vnd.comicbook-rar",
  mobi: "application/x-mobipocket-ebook",
  azw3: "application/vnd.amazon.ebook",
  azw: "application/vnd.amazon.ebook",
  djvu: "image/vnd.djvu",
  fb2: "application/x-fictionbook+xml",
  txt: "text/plain",
};

export const extOf = (name: string): string => name.split(".").pop()?.toLowerCase() ?? "";
export const stripExt = (name: string): string => name.replace(/\.[^.]+$/, "");

export const isSupportedLocalBook = (name: string): boolean => (LOCAL_BOOK_EXTS as readonly string[]).includes(extOf(name));

export interface ImportResult {
  md5: string;
  title: string;
  ext: string;
  /** True when this md5 was already in the library (the record was refreshed in place). */
  duplicate: boolean;
}

export class ImportError extends Error {}

/**
 * Title, author and cover from an EPUB's own metadata, in a single parse.
 *
 * Worth doing rather than falling back to the filename: real-world EPUBs are named
 * things like `pg1342-images-3.epub`, and a shelf of those is unreadable. Everything
 * is best-effort — a malformed EPUB just yields nothing and the caller falls back.
 */
async function readEpubMeta(file: File): Promise<{ title?: string; author?: string; cover?: Blob }> {
  try {
    const ePub = (await import("epubjs")).default;
    const book = ePub(await file.arrayBuffer());

    const [meta, coverUrl] = await Promise.all([
      book.loaded.metadata.catch(() => null),
      book.coverUrl().catch(() => null),
    ]);

    let cover: Blob | undefined;
    if (coverUrl) {
      const raw = await fetch(coverUrl)
        .then((r) => r.blob())
        .catch(() => null);
      if (raw) cover = await imageToJpegBlob(raw).catch(() => undefined);
    }

    return {
      title: meta?.title?.trim() || undefined,
      author: meta?.creator?.trim() || undefined,
      cover,
    };
  } catch {
    return {};
  }
}

export interface ImportOptions {
  /** 0..1 while hashing — the slow part for a large file. */
  onProgress?: (fraction: number) => void;
}

/**
 * Hash, describe and store one user-supplied book file. Returns enough to tell the
 * user what happened (and to open the reader straight away).
 */
export async function importLocalBook(file: File, options: ImportOptions = {}): Promise<ImportResult> {
  const ext = extOf(file.name);
  if (!isSupportedLocalBook(file.name)) {
    throw new ImportError(`Bookracy can't open .${ext || "this"} files. Try EPUB, PDF, CBZ or MOBI.`);
  }
  if (file.size === 0) throw new ImportError("That file is empty.");
  if (file.size > MAX_LOCAL_BOOK_BYTES) throw new ImportError("That file is over 1 GB — too large to add to your device library.");

  const md5 = await md5OfFile(file, options.onProgress);

  const store = useOfflineLibraryStore.getState();
  const duplicate = store.has(md5);

  // Only EPUBs carry embedded metadata and a cover we can pull out. Everything else
  // falls back to the filename and the "No cover" tile — a deliberate design, not a gap.
  const epubMeta = ext === "epub" ? await readEpubMeta(file) : {};

  const record: OfflineBookRecord = {
    md5,
    title: epubMeta.title || stripExt(file.name).trim() || file.name,
    author: epubMeta.author,
    filename: file.name,
    ext: `.${ext}`,
    mime: file.type || MIME_BY_EXT[ext] || "application/octet-stream",
    size: file.size,
    downloadedAt: Date.now(),
    local: true,
    cover: epubMeta.cover,
    blob: file,
  };

  await store.add(record);
  return { md5, title: record.title, ext, duplicate };
}
