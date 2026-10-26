import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { getDeviceId, getDeviceName } from "@/lib/device";

export interface ProgressItem {
  md5: string;
  currentPage: number;
  totalPages: number;
  location: string;
  /** When this position was last written (ms epoch). Orders "last read" AND resolves
   *  cross-device conflicts on sync — the newest position for a book wins. Rows saved
   *  before this field existed migrate to 0, so any real update beats them. */
  updatedAt: number;
  /** A snapshot of the book itself, so a device that has never opened it can still
   *  render a "Continue reading" card (and launch the reader) straight from sync,
   *  with no search round-trip and no network. */
  title?: string;
  author?: string;
  /** Cover URL. Falls back to the API's /cover/<md5> endpoint when absent. */
  image?: string;
  /** Download URL for the epub. Rebuildable from the md5, but stored so it survives. */
  link?: string;
  /** Chapter label at the saved position, e.g. "Chapter 7 — The Return". */
  chapter?: string;
  /** Human size of the source file ("2.4 MB") — drives the reader's big-book messaging. */
  size?: string;
  /** Which device wrote this position last, so the UI can say where you left off. */
  device?: string;
  deviceId?: string;
}

/** What callers pass in: the position, plus whatever metadata they happen to know.
 *  `updatedAt`/`device` are stamped by the store, never by the caller. */
export type ProgressInput = Omit<ProgressItem, "updatedAt" | "device" | "deviceId"> & Partial<Pick<ProgressItem, "updatedAt">>;

/** The book-describing half of a position — everything that isn't the position itself. */
export type ProgressMeta = Partial<Pick<ProgressItem, "title" | "author" | "image" | "link" | "size" | "chapter">>;

interface ReadingProgressStoreState {
  readingProgress: ProgressItem[];
  /** Tombstones (md5 -> removed-at), so a removed position isn't resurrected by sync. */
  removed: Record<string, number>;
  setRemoved: (removed: Record<string, number>) => void;
  findReadingProgress: (md5: string) => ProgressItem | undefined;
  setReadingProgress: (progressItem: ProgressInput) => void;
  annotateReadingProgress: (md5: string, meta: ProgressMeta) => void;
  removeReadingProgress: (md5: string) => void;
}

/** Drop undefined values so a partial update never blanks metadata we already hold. */
function defined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export const useReadingProgressStore = create<ReadingProgressStoreState>()(
  persist(
    (set, get) => ({
      readingProgress: [],
      removed: {},
      setRemoved: (removed) => set({ removed }),
      findReadingProgress: (md5) => get().readingProgress.find((p) => p.md5 === md5),
      setReadingProgress: (progressItem) =>
        set((state) => {
          const removed = { ...state.removed };
          delete removed[progressItem.md5]; // reading it again clears any earlier removal
          const index = state.readingProgress.findIndex((p) => p.md5 === progressItem.md5);
          const previous = index === -1 ? undefined : state.readingProgress[index];
          const next: ProgressItem = {
            // Metadata merges (a caller that only knows the position keeps what we have)…
            ...previous,
            ...defined(progressItem),
            // …but the position itself is always exactly what this call reported.
            md5: progressItem.md5,
            currentPage: progressItem.currentPage,
            totalPages: progressItem.totalPages,
            location: progressItem.location,
            updatedAt: Date.now(),
            device: getDeviceName(),
            deviceId: getDeviceId(),
          };
          if (index === -1) return { readingProgress: [...state.readingProgress, next], removed };
          const newReadingProgress = [...state.readingProgress];
          newReadingProgress[index] = next;
          return { readingProgress: newReadingProgress, removed };
        }),
      // Backfill book metadata onto an existing position WITHOUT touching the position,
      // its timestamp or its device. Used when a row saved before the reader recorded
      // metadata gets resolved from the API — stamping it would fake "you just read
      // this here", reordering the shelf and mislabelling which device you left off on.
      annotateReadingProgress: (md5, meta) =>
        set((state) => {
          const index = state.readingProgress.findIndex((p) => p.md5 === md5);
          if (index === -1) return state;
          const previous = state.readingProgress[index];
          // Only ever fill gaps, and bail out when there's nothing new — an
          // unconditional write would re-render and re-sync on every page load.
          const additions = (Object.entries(defined(meta)) as [keyof ProgressMeta, string][]).filter(([key]) => previous[key] === undefined);
          if (additions.length === 0) return state;
          const newReadingProgress = [...state.readingProgress];
          newReadingProgress[index] = { ...previous, ...Object.fromEntries(additions) };
          return { readingProgress: newReadingProgress };
        }),
      removeReadingProgress: (md5) => set((state) => ({ readingProgress: state.readingProgress.filter((p) => p.md5 !== md5), removed: { ...state.removed, [md5]: Date.now() } })),
    }),
    {
      name: "BR::progress",
      storage: createJSONStorage(() => localStorage),
      version: 2,
      // v0 rows have no timestamp. Stamping them 0 (rather than "now") is deliberate:
      // an un-timestamped local row must never outrank a real, dated position that
      // arrives from another device. v2 adds tombstones.
      migrate: (persisted) => {
        const state = persisted as Partial<ReadingProgressStoreState> | undefined;
        return {
          ...state,
          readingProgress: (state?.readingProgress ?? []).map((p) => ({ ...p, updatedAt: p.updatedAt ?? 0 })),
          removed: state?.removed && typeof state.removed === "object" ? state.removed : {},
        } as ReadingProgressStoreState;
      },
    },
  ),
);

/**
 * Books still being read, most recently opened first. Finished ones are excluded.
 * A row with a position but no page count yet is a book that was opened and closed
 * before its page map finished building — that's still a book being read, and it must
 * not read as "finished" (0 >= 0) or vanish from the shelf.
 */
export function selectInProgress(items: ProgressItem[]): ProgressItem[] {
  return items.filter((p) => (p.totalPages > 0 ? p.currentPage < p.totalPages : Boolean(p.location))).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}
