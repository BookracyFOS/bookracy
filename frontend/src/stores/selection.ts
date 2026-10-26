import { create } from "zustand";
import { BookItem } from "@/api/backend/types";

/**
 * Ephemeral multi-select used by the bulk downloader. Keyed by md5 and kept in
 * memory only (selections shouldn't survive a reload). We store the whole
 * BookItem so the selection bar can enqueue downloads without re-resolving.
 */
interface SelectionState {
  /** Whether bulk-select mode is active (checkboxes shown, selection bar live). */
  active: boolean;
  selected: Record<string, BookItem>;
  setActive: (active: boolean) => void;
  toggleActive: () => void;
  toggle: (book: BookItem) => void;
  add: (books: BookItem | BookItem[]) => void;
  remove: (md5: string) => void;
  clear: () => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  active: false,
  selected: {},
  // Leaving select mode always clears the current selection.
  setActive: (active) => set((s) => ({ active, selected: active ? s.selected : {} })),
  toggleActive: () => set((s) => ({ active: !s.active, selected: s.active ? {} : s.selected })),
  toggle: (book) =>
    set((s) => {
      const next = { ...s.selected };
      if (next[book.md5]) delete next[book.md5];
      else next[book.md5] = book;
      return { selected: next };
    }),
  add: (books) =>
    set((s) => {
      const list = Array.isArray(books) ? books : [books];
      const next = { ...s.selected };
      for (const b of list) if (b?.md5 && b?.link) next[b.md5] = b;
      return { selected: next };
    }),
  remove: (md5) =>
    set((s) => {
      const next = { ...s.selected };
      delete next[md5];
      return { selected: next };
    }),
  clear: () => set({ selected: {} }),
}));
