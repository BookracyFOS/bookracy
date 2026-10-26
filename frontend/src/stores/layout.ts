import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface LayoutStoreState {
  sidebar: {
    isOpen: boolean;
    setIsOpen: () => void;
  };
  page: {
    title: string;
    setTitle: (title: string) => void;
  };
}

export const useLayoutStore = create<LayoutStoreState>()(
  persist(
    (set) => ({
      sidebar: {
        isOpen: true,
        setIsOpen: () => {
          set((state) => ({ sidebar: { ...state.sidebar, isOpen: !state.sidebar.isOpen } }));
        },
      },
      page: {
        title: "",
        setTitle: (title) => {
          set((state) => ({ page: { ...state.page, title } }));
        },
      },
    }),
    {
      name: "BR::layout",
      storage: createJSONStorage(() => localStorage),
      // The persisted shape used to be `{ isOpen }` while the state is `{ sidebar: { isOpen } }`,
      // so the collapsed sidebar was forgotten on every load. Persist the real shape, and
      // read the old one too so nobody's existing preference is lost.
      partialize: (state) => ({ sidebar: { isOpen: state.sidebar.isOpen } }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as { sidebar?: { isOpen?: boolean }; isOpen?: boolean };
        const isOpen = p.sidebar?.isOpen ?? p.isOpen ?? current.sidebar.isOpen;
        return { ...current, sidebar: { ...current.sidebar, isOpen } };
      },
    },
  ),
);
