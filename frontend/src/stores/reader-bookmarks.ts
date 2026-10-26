import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** A saved reading position inside a single book. `cfi` is epub.js's canonical
 *  location string; `label` is a short human hint (chapter / page) for the list. */
export interface ReaderBookmark {
  cfi: string;
  label: string;
  chapter?: string;
  createdAt: number;
}

interface ReaderBookmarksStoreState {
  /** Bookmarks keyed by book md5, newest last. */
  byBook: Record<string, ReaderBookmark[]>;
  getBookmarks: (md5: string) => ReaderBookmark[];
  isBookmarked: (md5: string, cfi: string) => boolean;
  addBookmark: (md5: string, bookmark: ReaderBookmark) => void;
  removeBookmark: (md5: string, cfi: string) => void;
}

export const useReaderBookmarksStore = create<ReaderBookmarksStoreState>()(
  persist(
    (set, get) => ({
      byBook: {},
      getBookmarks: (md5) => get().byBook[md5] ?? [],
      isBookmarked: (md5, cfi) => (get().byBook[md5] ?? []).some((b) => b.cfi === cfi),
      addBookmark: (md5, bookmark) =>
        set((state) => {
          const existing = state.byBook[md5] ?? [];
          if (existing.some((b) => b.cfi === bookmark.cfi)) return state;
          return { byBook: { ...state.byBook, [md5]: [...existing, bookmark] } };
        }),
      removeBookmark: (md5, cfi) =>
        set((state) => {
          const existing = state.byBook[md5];
          if (!existing) return state;
          const next = existing.filter((b) => b.cfi !== cfi);
          const byBook = { ...state.byBook };
          if (next.length) byBook[md5] = next;
          else delete byBook[md5];
          return { byBook };
        }),
    }),
    {
      name: "BR::reader-bookmarks",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
