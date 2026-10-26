import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Whether the home page's "Continue reading" card is currently dismissed.
 *
 * Deliberately device-local (never part of the sync blob): hiding the card on a
 * laptop shouldn't blank it on a phone. It's also scoped to one book at one point in
 * time rather than being an on/off switch — dismissing means "not this, not now", so
 * reading that book again, or starting a different one, brings the card back on its
 * own and the user never has to go hunting for a setting to undo it.
 */
interface ResumeCardState {
  dismissedMd5: string | null;
  /** The position's `updatedAt` at the moment it was dismissed. */
  dismissedAt: number;
  dismiss: (md5: string, updatedAt: number) => void;
  restore: () => void;
}

export const useResumeCardStore = create<ResumeCardState>()(
  persist(
    (set) => ({
      dismissedMd5: null,
      dismissedAt: 0,
      dismiss: (dismissedMd5, dismissedAt) => set({ dismissedMd5, dismissedAt }),
      restore: () => set({ dismissedMd5: null, dismissedAt: 0 }),
    }),
    {
      name: "BR::resume-card",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
