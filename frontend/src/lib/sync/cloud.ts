import { useSyncStore } from "@/stores/sync";
import { useBookmarksStore } from "@/stores/bookmarks";
import { useReadingProgressStore } from "@/stores/progress";
import { useSettingsStore } from "@/stores/settings";
import { useReaderStore } from "@/stores/reader";
import { useViewStore } from "@/stores/view";
import { applyBackup, buildExportPayload, parseBackupObject, type ImportPlan } from "@/lib/data-transfer";
import { createAccount, deleteAccount, pullAccount, pushAccount } from "@/api/backend/sync/sync";

// Routine sync-down (on load / re-enable) keeps everything you already have and only
// folds in anything new (yours wins on overlap) — it can never destroy local data, and
// it deliberately KEEPS this device's preferences so a reload never surprise-flips your
// theme/font size.
const SYNC_MERGE_PLAN: ImportPlan = { bookmarks: "merge", folders: "merge", readingProgress: "merge", preferences: "keep" };

// Explicit restore (a new device, from a pasted key) DOES adopt your saved preferences
// (theme / language / reader font size / list-grid view) — that's the point of restoring.
// Bookmarks/folders/progress still merge so nothing already on this device is lost.
const SYNC_RESTORE_PLAN: ImportPlan = { bookmarks: "merge", folders: "merge", readingProgress: "merge", preferences: "overwrite" };

const PUSH_DEBOUNCE_MS = 4000;
// Anti-spam: coalesce automatic pushes to at most one every 2 hours, and cap manual
// "Sync now" to 100/day. (Cheap reads/pulls are unaffected; the worker's per-IP rate
// limiter is the server-side backstop.)
const AUTO_SYNC_INTERVAL_MS = 2 * 60 * 60 * 1000;
const MANUAL_SYNC_DAILY_CAP = 100;
const todayKey = () => new Date().toISOString().slice(0, 10);
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let applying = false; // suppress auto-push while we're writing a pulled blob in
let initialized = false;

async function pushNow(opts: { keepalive?: boolean } = {}): Promise<void> {
  const { enabled, accountId, setStatus, setLastSyncedAt } = useSyncStore.getState();
  if (!enabled || !accountId) return;
  setStatus("syncing");
  try {
    await pushAccount(accountId, buildExportPayload(), opts);
    setLastSyncedAt(Date.now());
    setStatus("synced");
  } catch {
    setStatus("error");
  }
}

type PullOutcome = "merged" | "empty" | "error";

/**
 * Fold the cloud copy in. The outcome matters to callers: a push after a FAILED pull
 * is a whole-blob PUT of this device's data over a copy we never read — on a fresh
 * phone that is an empty payload wiping the account. `syncNow` therefore only pushes
 * after a pull that actually succeeded.
 */
async function pullNow(plan: ImportPlan = SYNC_MERGE_PLAN): Promise<PullOutcome> {
  const { enabled, accountId, setStatus, setLastSyncedAt } = useSyncStore.getState();
  if (!enabled || !accountId) return "error";
  setStatus("syncing");
  try {
    const remote = await pullAccount(accountId);
    if (remote) {
      const parsed = parseBackupObject(remote);
      applying = true;
      try {
        applyBackup(parsed, plan);
      } finally {
        applying = false;
      }
    }
    setLastSyncedAt(Date.now());
    setStatus("synced");
    return remote ? "merged" : "empty";
  } catch {
    setStatus("error");
    return "error";
  }
}

/** An automatic push that records when it ran (drives the 2-hour throttle). */
async function autoPush(): Promise<void> {
  await pushNow();
  if (useSyncStore.getState().status === "synced") useSyncStore.getState().setLastAutoSyncAt(Date.now());
}

/** Manual "sync now": fold in the cloud copy, then push the merged result up so it converges. */
export async function syncNow(plan: ImportPlan = SYNC_MERGE_PLAN): Promise<PullOutcome> {
  const outcome = await pullNow(plan);
  if (outcome !== "error") await pushNow();
  return outcome;
}

/** How many manual syncs remain today (resets at midnight UTC). */
export function manualSyncRemaining(): number {
  const s = useSyncStore.getState();
  const used = s.manualSyncDay === todayKey() ? s.manualSyncCount : 0;
  return Math.max(0, MANUAL_SYNC_DAILY_CAP - used);
}

/**
 * Explicit "Sync now" button — capped at 100/day to stop spamming. Beyond the cap it
 * refuses (data still auto-syncs in the background); manual taps don't bypass that.
 */
export async function manualSyncNow(): Promise<void> {
  const s = useSyncStore.getState();
  const day = todayKey();
  const used = s.manualSyncDay === day ? s.manualSyncCount : 0;
  if (used >= MANUAL_SYNC_DAILY_CAP) {
    throw new Error("You've hit today's manual sync limit (100). Your data still syncs automatically.");
  }
  const outcome = await syncNow();
  if (outcome === "error" || useSyncStore.getState().status === "error") throw new Error("Couldn't reach the cloud copy. Check your connection and try again.");
  // Only a sync that happened counts against the daily cap.
  s.setManualSync(day, used + 1);
}

// Auto-push at most once per AUTO_SYNC_INTERVAL_MS: a burst of changes reschedules to
// the end of the current window, so at most one push lands per 2 hours (the latest state).
function schedulePush() {
  if (applying || !useSyncStore.getState().enabled) return;
  const last = useSyncStore.getState().lastAutoSyncAt ?? 0;
  const elapsed = Date.now() - last;
  const delay = elapsed >= AUTO_SYNC_INTERVAL_MS ? PUSH_DEBOUNCE_MS : AUTO_SYNC_INTERVAL_MS - elapsed;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void autoPush();
  }, delay);
}

/** Turn on sync: mint a new account, seed it with current local data, return the key. */
export async function enableSync(turnstileToken?: string): Promise<string> {
  const id = await createAccount(turnstileToken);
  useSyncStore.getState().setAccount(id);
  useSyncStore.getState().setEnabled(true);
  await pushNow();
  return id;
}

/**
 * Restore on a new device from an existing key. The key is only kept once the cloud
 * copy has actually been read: a mistyped key used to be committed and then have this
 * device's (empty) data pushed under it, and the UI toasted "Restored and merged".
 */
export async function restoreSync(rawId: string): Promise<void> {
  const id = rawId.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("That doesn't look like a valid sync key.");
  const previous = useSyncStore.getState();
  const { accountId: prevAccount, enabled: prevEnabled } = previous;
  previous.setAccount(id);
  previous.setEnabled(true);
  const outcome = await pullNow(SYNC_RESTORE_PLAN);
  if (outcome !== "merged") {
    useSyncStore.getState().setAccount(prevAccount);
    useSyncStore.getState().setEnabled(prevEnabled);
    useSyncStore.getState().setStatus(prevEnabled ? "synced" : "idle");
    throw new Error(outcome === "empty" ? "No data found for that key — double-check it and try again." : "Couldn't reach the cloud copy. Check your connection and try again.");
  }
  await pushNow();
}

/** Re-enable sync with the key already saved on this device — does NOT mint a new account. */
export async function resumeSync(): Promise<void> {
  if (!useSyncStore.getState().accountId) return;
  useSyncStore.getState().setEnabled(true);
  await syncNow();
}

/** Stop syncing on this device (keeps the key so re-enabling is instant). */
export function disableSync(): void {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  useSyncStore.getState().setEnabled(false);
  useSyncStore.getState().setStatus("idle");
}

/** Delete the cloud copy entirely and forget the key on this device. */
export async function deleteCloudData(): Promise<void> {
  const { accountId } = useSyncStore.getState();
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  if (accountId) {
    try {
      await deleteAccount(accountId);
    } catch {
      /* best effort — still forget it locally below */
    }
  }
  useSyncStore.getState().setAccount(null);
  useSyncStore.getState().setEnabled(false);
  useSyncStore.getState().setLastSyncedAt(null);
  useSyncStore.getState().setStatus("idle");
}

export function initCloudSync(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  // Quietly fold in the cloud copy on load.
  if (useSyncStore.getState().enabled && useSyncStore.getState().accountId) {
    void pullNow();
  }

  // Auto-push (debounced) whenever the user's data OR preferences change.
  useBookmarksStore.subscribe(schedulePush);
  useReadingProgressStore.subscribe(schedulePush);
  useSettingsStore.subscribe(schedulePush);
  useReaderStore.subscribe(schedulePush);
  useViewStore.subscribe(schedulePush);

  // Flush on tab hide/close, but ONLY if a push was already pending — so closing the
  // tab saves the latest changes without turning every open/close into a sync. The
  // request is sent with `keepalive` so the browser lets it finish after the page is
  // gone; without it the last reading position of the session was routinely dropped.
  const flush = () => {
    if (!pushTimer) return;
    clearTimeout(pushTimer);
    pushTimer = null;
    void pushNow({ keepalive: true }).then(() => {
      if (useSyncStore.getState().status === "synced") useSyncStore.getState().setLastAutoSyncAt(Date.now());
    });
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
}
