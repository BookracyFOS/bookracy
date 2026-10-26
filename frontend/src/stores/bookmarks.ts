import { create } from "zustand";
import { createJSONStorage, persist, subscribeWithSelector } from "zustand/middleware";

/** A saved book. `folderId === null` means it lives in the default "General" shelf. */
export interface Bookmark {
  md5: string;
  folderId: string | null;
  addedAt?: number;
}

/** A user-created shelf. Minimal by design: just a name + a colour. */
export interface BookmarkFolder {
  id: string;
  name: string;
  color: string;
  createdAt: number;
}

/** Curated palette users pick from when colouring a folder. */
export const FOLDER_COLORS = [
  "#8b5cf6", // violet (brand)
  "#ec4899", // pink
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // amber
  "#22c55e", // green
  "#14b8a6", // teal
  "#3b82f6", // blue
  "#a1a1aa", // zinc
] as const;

export const DEFAULT_FOLDER_COLOR = FOLDER_COLORS[0];

const createId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

interface BookmarksStoreState {
  bookmarks: Bookmark[];
  folders: BookmarkFolder[];
  /**
   * Tombstones: md5 -> when it was removed here. Sync merges are a union, so without
   * these every deletion came straight back from the cloud copy (or from the other
   * device) on the next pull. A tombstone newer than a bookmark's `addedAt` wins.
   */
  removed: Record<string, number>;

  // bookmark ops
  setBookmarks: (bookmarks: Bookmark[]) => void;
  setRemoved: (removed: Record<string, number>) => void;
  addBookmark: (md5: string, folderId?: string | null) => void;
  removeBookmark: (md5: string) => void;
  moveBookmark: (md5: string, folderId: string | null) => void;
  isBookmarked: (md5: string) => boolean;

  // folder ops
  setFolders: (folders: BookmarkFolder[]) => void;
  addFolder: (name: string, color?: string) => string;
  renameFolder: (id: string, name: string) => void;
  setFolderColor: (id: string, color: string) => void;
  removeFolder: (id: string) => void;
}

export const useBookmarksStore = create<BookmarksStoreState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        bookmarks: [],
        folders: [],
        removed: {},

        setBookmarks: (bookmarks) => set({ bookmarks }),
        setRemoved: (removed) => set({ removed }),
        addBookmark: (md5, folderId = null) =>
          set((state) => {
            const removed = { ...state.removed };
            delete removed[md5]; // re-saving clears any earlier removal
            if (state.bookmarks.some((b) => b.md5 === md5)) {
              // Already saved — treat add-with-folder as a move.
              return { bookmarks: state.bookmarks.map((b) => (b.md5 === md5 ? { ...b, folderId } : b)), removed };
            }
            return { bookmarks: [...state.bookmarks, { md5, folderId, addedAt: Date.now() }], removed };
          }),
        removeBookmark: (md5) => set((state) => ({ bookmarks: state.bookmarks.filter((b) => b.md5 !== md5), removed: { ...state.removed, [md5]: Date.now() } })),
        moveBookmark: (md5, folderId) => set((state) => ({ bookmarks: state.bookmarks.map((b) => (b.md5 === md5 ? { ...b, folderId } : b)) })),
        isBookmarked: (md5) => get().bookmarks.some((b) => b.md5 === md5),

        setFolders: (folders) => set({ folders }),
        addFolder: (name, color = DEFAULT_FOLDER_COLOR) => {
          const id = createId();
          set((state) => ({ folders: [...state.folders, { id, name: name.trim() || "Untitled", color, createdAt: Date.now() }] }));
          return id;
        },
        renameFolder: (id, name) => set((state) => ({ folders: state.folders.map((f) => (f.id === id ? { ...f, name: name.trim() || f.name } : f)) })),
        setFolderColor: (id, color) => set((state) => ({ folders: state.folders.map((f) => (f.id === id ? { ...f, color } : f)) })),
        removeFolder: (id) =>
          set((state) => ({
            folders: state.folders.filter((f) => f.id !== id),
            // Don't lose the books — drop them back into General.
            bookmarks: state.bookmarks.map((b) => (b.folderId === id ? { ...b, folderId: null } : b)),
          })),
      }),
      {
        name: "BR::bookmarks",
        storage: createJSONStorage(() => localStorage),
        version: 3,
        migrate(persistedState) {
          const state = (persistedState ?? {}) as Record<string, unknown>;
          const normalize = (raw: unknown): Bookmark[] => {
            if (!Array.isArray(raw)) return [];
            return raw
              .map((b): Bookmark | null => {
                if (typeof b === "string") return { md5: b, folderId: null };
                if (b && typeof b === "object" && "md5" in b) {
                  const obj = b as { md5?: unknown; folderId?: unknown };
                  if (typeof obj.md5 === "string") return { md5: obj.md5, folderId: typeof obj.folderId === "string" ? obj.folderId : null };
                }
                return null;
              })
              .filter((b): b is Bookmark => b !== null);
          };

          // v0: { bookmarks: [{ md5 }] }; v1: { bookmarks: string[] } → v2 objects.
          const bookmarks = normalize(state.bookmarks);
          const folders = Array.isArray(state.folders) ? (state.folders as BookmarkFolder[]) : [];
          // v3 adds tombstones; older state simply has none.
          const removed = state.removed && typeof state.removed === "object" ? (state.removed as Record<string, number>) : {};
          return { bookmarks, folders, removed } as Partial<BookmarksStoreState>;
        },
      },
    ),
  ),
);
