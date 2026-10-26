import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type ResultView = "list" | "grid";

interface ViewStoreState {
  /** Shared list/grid preference used by search, trending and the bookshelf so
   *  the whole app stays consistent. */
  view: ResultView;
  setView: (view: ResultView) => void;
}

export const useViewStore = create<ViewStoreState>()(
  persist(
    (set) => ({
      view: "list",
      setView: (view) => set({ view }),
    }),
    {
      name: "BR::view",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
