import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type Theme = "dark" | "light";
type BulkDownloadFormat = "queue" | "zip";
// What a swipe does on a saved-book tile. More actions ("coming soon") will slot in
// here later; the Settings UI shows those as disabled options for now.
export type SwipeAction = "remove" | "complete" | "none";

// The backend only does book fetching. Defaults to the live API (works in dev
// too); override at build time with VITE_BACKEND_URL if you run a local backend.
const DEFAULT_BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "https://api.bookracy.com";

interface SettingsStoreState {
  language: string;
  backendURL: string;
  theme: Theme;
  // Opt-in: shows the bulk-download toggle in the navbar (multi-select + queue).
  bulkDownload: boolean;
  // How a bulk selection is delivered: a per-file queue or a single ZIP archive.
  bulkDownloadFormat: BulkDownloadFormat;
  // Show the floating downloads panel in the corner (off = only in the Library).
  floatingDownloads: boolean;
  // When a download fails, silently try the next result on the search page instead
  // of prompting each time. The user opts in either from Settings or from the
  // "Auto" action on a failure toast.
  autoTryNextOnFail: boolean;
  // Touch swipe gestures on saved books (swipe to delete / mark complete).
  mobileGestures: boolean;
  // What each swipe direction does on a saved-book tile (when gestures are on).
  swipeRightAction: SwipeAction;
  swipeLeftAction: SwipeAction;

  setLanguage: (language: string) => void;
  setBackendURL: (url: string) => void;
  setTheme: (theme: Theme) => void;
  setBulkDownload: (enabled: boolean) => void;
  setBulkDownloadFormat: (format: BulkDownloadFormat) => void;
  setFloatingDownloads: (enabled: boolean) => void;
  setAutoTryNextOnFail: (enabled: boolean) => void;
  setMobileGestures: (enabled: boolean) => void;
  setSwipeRightAction: (action: SwipeAction) => void;
  setSwipeLeftAction: (action: SwipeAction) => void;
}

export const useSettingsStore = create<SettingsStoreState>()(
  persist(
    (set) => ({
      language: "en",
      backendURL: DEFAULT_BACKEND_URL,
      theme: "dark",
      bulkDownload: false,
      bulkDownloadFormat: "queue",
      floatingDownloads: true,
      autoTryNextOnFail: false,
      mobileGestures: false,
      swipeRightAction: "complete",
      swipeLeftAction: "remove",

      setLanguage: (language) => set({ language }),
      setBackendURL: (url) => set({ backendURL: url }),
      setTheme: (theme) => set({ theme }),
      setBulkDownload: (bulkDownload) => set({ bulkDownload }),
      setBulkDownloadFormat: (bulkDownloadFormat) => set({ bulkDownloadFormat }),
      setFloatingDownloads: (floatingDownloads) => set({ floatingDownloads }),
      setAutoTryNextOnFail: (autoTryNextOnFail) => set({ autoTryNextOnFail }),
      setMobileGestures: (mobileGestures) => set({ mobileGestures }),
      setSwipeRightAction: (swipeRightAction) => set({ swipeRightAction }),
      setSwipeLeftAction: (swipeLeftAction) => set({ swipeLeftAction }),
    }),
    {
      name: "BR::settings",
      storage: createJSONStorage(() => localStorage),
      version: 5,
      // Without `migrate`, zustand throws persisted state away on any version mismatch —
      // every bump of the number above used to reset theme, language and gestures.
      migrate: (persisted) => persisted as Partial<SettingsStoreState>,
      // Persist only real user prefs. backendURL is derived from the build-time
      // default and must NEVER be pinned to a stale persisted value (e.g. an old
      // localhost dev URL) — always force it back to the current default on load.
      partialize: ({ language, theme, bulkDownload, bulkDownloadFormat, floatingDownloads, autoTryNextOnFail, mobileGestures, swipeRightAction, swipeLeftAction }) => ({
        language,
        theme,
        bulkDownload,
        bulkDownloadFormat,
        floatingDownloads,
        autoTryNextOnFail,
        mobileGestures,
        swipeRightAction,
        swipeLeftAction,
      }),
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<SettingsStoreState>),
        backendURL: current.backendURL,
      }),
    },
  ),
);
