import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type SyncStatus = "idle" | "syncing" | "synced" | "error";

interface SyncStoreState {
  /** The account key — the user's only credential (a bearer secret). */
  accountId: string | null;
  enabled: boolean;
  lastSyncedAt: number | null;
  /** Runtime only (not persisted). */
  status: SyncStatus;

  /** Anti-spam: last automatic push, and the daily manual-sync quota. */
  lastAutoSyncAt: number | null;
  manualSyncDay: string | null; // YYYY-MM-DD
  manualSyncCount: number;

  setAccount: (id: string | null) => void;
  setEnabled: (enabled: boolean) => void;
  setLastSyncedAt: (t: number | null) => void;
  setStatus: (status: SyncStatus) => void;
  setLastAutoSyncAt: (t: number | null) => void;
  setManualSync: (day: string, count: number) => void;
}

export const useSyncStore = create<SyncStoreState>()(
  persist(
    (set) => ({
      accountId: null,
      enabled: false,
      lastSyncedAt: null,
      status: "idle",
      lastAutoSyncAt: null,
      manualSyncDay: null,
      manualSyncCount: 0,

      setAccount: (accountId) => set({ accountId }),
      setEnabled: (enabled) => set({ enabled }),
      setLastSyncedAt: (lastSyncedAt) => set({ lastSyncedAt }),
      setStatus: (status) => set({ status }),
      setLastAutoSyncAt: (lastAutoSyncAt) => set({ lastAutoSyncAt }),
      setManualSync: (manualSyncDay, manualSyncCount) => set({ manualSyncDay, manualSyncCount }),
    }),
    {
      name: "BR::sync",
      storage: createJSONStorage(() => localStorage),
      // status is transient; the key, flags, and anti-spam counters persist.
      partialize: ({ accountId, enabled, lastSyncedAt, lastAutoSyncAt, manualSyncDay, manualSyncCount }) => ({
        accountId,
        enabled,
        lastSyncedAt,
        lastAutoSyncAt,
        manualSyncDay,
        manualSyncCount,
      }),
    },
  ),
);
