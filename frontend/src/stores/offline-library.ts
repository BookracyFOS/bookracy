import { create } from "zustand";
import { listBooks, saveBook, removeBook, getBook, storageEstimate, type OfflineBookMeta, type OfflineBookRecord } from "@/lib/offline-books";

// Zustand shell over the IndexedDB layer. IDB is async + not reactive, so we keep an
// in-memory mirror of the metadata list here (blobs stay in IDB — no reason to load
// megabytes into RAM until a reader actually opens one). Components subscribe to the
// mirror; mutations write through to IDB then refresh the mirror in one pass.

interface OfflineLibraryState {
  /** Metadata for every offline book, newest download first. Blobs live in IndexedDB. */
  books: OfflineBookMeta[];
  /** Optimistic set of md5s we know are offline — cheap presence lookups from anywhere. */
  md5s: Set<string>;
  /** Approx storage usage / quota (bytes). Refreshed on save/remove; undefined when unsupported. */
  usage?: number;
  quota?: number;
  /** True after the first hydrate() completes so components can skip the empty-flash. */
  hydrated: boolean;

  hydrate: () => Promise<void>;
  /** Persist a blob and its metadata. Overwrites in place when the md5 is already saved. */
  add: (record: OfflineBookRecord) => Promise<void>;
  remove: (md5: string) => Promise<void>;
  /** Fetch the full record (with blob) — used by the reader to open a saved book offline. */
  getRecord: (md5: string) => Promise<OfflineBookRecord | undefined>;
  /** True iff md5 is in the offline library right now. Selector-friendly. */
  has: (md5: string) => boolean;
}

export const useOfflineLibraryStore = create<OfflineLibraryState>((set, get) => ({
  books: [],
  md5s: new Set(),
  hydrated: false,

  hydrate: async () => {
    try {
      const [books, est] = await Promise.all([listBooks(), storageEstimate()]);
      set({ books, md5s: new Set(books.map((b) => b.md5)), usage: est.usage, quota: est.quota, hydrated: true });
    } catch {
      // IDB unavailable (private mode etc.) — mark hydrated so UI stops waiting.
      set({ hydrated: true });
    }
  },

  add: async (record) => {
    await saveBook(record);
    const [books, est] = await Promise.all([listBooks(), storageEstimate()]);
    set({ books, md5s: new Set(books.map((b) => b.md5)), usage: est.usage, quota: est.quota });
  },

  remove: async (md5) => {
    await removeBook(md5);
    const [books, est] = await Promise.all([listBooks(), storageEstimate()]);
    set({ books, md5s: new Set(books.map((b) => b.md5)), usage: est.usage, quota: est.quota });
  },

  getRecord: (md5) => getBook(md5),

  has: (md5) => get().md5s.has(md5),
}));

/**
 * Selector for a specific md5 — subscribes only to that md5's presence so a card doesn't
 * re-render when unrelated books get added or removed. Use in book cards / anywhere a
 * "download indicator" needs to react to library changes.
 */
export const useIsOfflineBook = (md5: string): boolean =>
  useOfflineLibraryStore((s) => s.md5s.has(md5));
