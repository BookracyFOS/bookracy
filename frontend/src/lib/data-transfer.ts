import { z } from "zod";
import { Bookmark, BookmarkFolder, DEFAULT_FOLDER_COLOR, useBookmarksStore } from "@/stores/bookmarks";
import { useReadingProgressStore, type ProgressItem } from "@/stores/progress";
import { useSettingsStore } from "@/stores/settings";
import { useReaderStore } from "@/stores/reader";
import { useViewStore } from "@/stores/view";
import { wipeOfflineLibrary } from "@/lib/offline-books";

const EXPORT_TYPE = "bookracy-data";
const EXPORT_VERSION = 2;

// Everything past `location` is additive (v2.1+). It stays optional so older
// backups still import, and it must be listed here explicitly — zod strips unknown
// keys, so an unlisted field would be silently dropped on every sync round-trip.
const progressItemSchema = z.object({
  md5: z.string(),
  currentPage: z.number(),
  totalPages: z.number(),
  location: z.string(),
  updatedAt: z.number().optional(),
  title: z.string().optional(),
  author: z.string().optional(),
  image: z.string().optional(),
  link: z.string().optional(),
  chapter: z.string().optional(),
  size: z.string().optional(),
  device: z.string().optional(),
  deviceId: z.string().optional(),
});

const bookmarkObjectSchema = z.object({
  md5: z.string(),
  folderId: z.string().nullable().optional(),
  addedAt: z.number().optional(),
});

// Accept both the legacy flat md5 strings (v1) and the new objects (v2).
const bookmarksSchema = z.array(z.union([z.string(), bookmarkObjectSchema]));

const folderSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  createdAt: z.number().optional(),
});

// md5 -> removed-at (ms). Optional and additive, so payloads from older clients parse.
const tombstonesSchema = z.record(z.string(), z.number());

const exportSchema = z.object({
  type: z.literal(EXPORT_TYPE),
  version: z.number(),
  exportedAt: z.string().optional(),
  data: z.object({
    bookmarks: bookmarksSchema.optional(),
    folders: z.array(folderSchema).optional(),
    readingProgress: z.array(progressItemSchema).optional(),
    deleted: z.object({ bookmarks: tombstonesSchema.optional(), readingProgress: tombstonesSchema.optional() }).optional(),
    settings: z
      .object({
        theme: z.enum(["dark", "light"]).optional(),
        language: z.string().optional(),
        fontSize: z.number().optional(),
        view: z.enum(["list", "grid"]).optional(),
      })
      .optional(),
  }),
});

export type CategoryMode = "keep" | "merge" | "overwrite";
type PreferencesMode = "keep" | "overwrite";

export interface ImportPlan {
  bookmarks: CategoryMode;
  folders: CategoryMode;
  readingProgress: CategoryMode;
  preferences: PreferencesMode;
}

export interface ParsedBackup {
  bookmarks: Bookmark[];
  folders: BookmarkFolder[];
  readingProgress: ProgressItem[];
  deleted: { bookmarks: Record<string, number>; readingProgress: Record<string, number> };
  preferences: { theme?: "dark" | "light"; language?: string; fontSize?: number; view?: "list" | "grid" };
}

// Tombstones only need to outlive the window in which a stale copy can still arrive;
// 90 days covers a device that has been off for a season, and keeps the map small.
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function pruneTombstones(t: Record<string, number>): Record<string, number> {
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  return Object.fromEntries(Object.entries(t).filter(([, at]) => at >= cutoff));
}

/** Union of two tombstone maps, newest removal wins. */
function mergeTombstones(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a };
  for (const [md5, at] of Object.entries(b)) if ((out[md5] ?? 0) < at) out[md5] = at;
  return out;
}

/**
 * Merge two lists of md5-keyed items with their tombstones. An item survives unless
 * some tombstone is newer than the item's own timestamp; anything without a timestamp
 * (legacy rows) counts as 0, so an explicit removal always beats it. Local wins on
 * overlap unless `pick` says otherwise. Returns the merged list and the tombstones
 * that are still meaningful (a re-added item clears its tombstone).
 */
function mergeWithTombstones<T extends { md5: string }>(
  local: T[],
  incoming: T[],
  localTomb: Record<string, number>,
  incomingTomb: Record<string, number>,
  stamp: (item: T) => number,
  pick: (mine: T, theirs: T) => T,
): { items: T[]; tombstones: Record<string, number>; added: number } {
  const tomb = mergeTombstones(localTomb, incomingTomb);
  const byMd5 = new Map<string, T>();
  for (const item of local) byMd5.set(item.md5, item);
  const fresh = new Set<string>();
  for (const theirs of incoming) {
    const mine = byMd5.get(theirs.md5);
    if (!mine) {
      byMd5.set(theirs.md5, theirs);
      fresh.add(theirs.md5);
    } else {
      byMd5.set(theirs.md5, pick(mine, theirs));
    }
  }
  const items: T[] = [];
  let added = 0;
  for (const item of byMd5.values()) {
    const removedAt = tomb[item.md5];
    if (removedAt !== undefined && removedAt > stamp(item)) continue; // deleted after it was last touched
    items.push(item);
    if (fresh.has(item.md5)) added += 1; // only count what actually survived the merge
    if (removedAt !== undefined) delete tomb[item.md5]; // re-added since: the tombstone is spent
  }
  return { items, tombstones: pruneTombstones(tomb), added };
}

export interface CategoryDiff {
  incoming: number;
  current: number;
  /** How many incoming items collide with something already here. */
  overlap: number;
}

export interface ImportDiff {
  bookmarks: CategoryDiff;
  folders: CategoryDiff;
  readingProgress: CategoryDiff;
  preferences: { incoming: boolean; conflict: boolean };
}

export interface ImportSummary {
  bookmarks: number;
  folders: number;
  progress: number;
}

/** True if there's local data that an import could clobber (so we can ask first). */
export function hasExistingData(): boolean {
  return useBookmarksStore.getState().bookmarks.length > 0 || useBookmarksStore.getState().folders.length > 0 || useReadingProgressStore.getState().readingProgress.length > 0;
}

/** Snapshot all locally-stored user data into a download-ready JSON payload. */
export function buildExportPayload() {
  return {
    type: EXPORT_TYPE,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      bookmarks: useBookmarksStore.getState().bookmarks,
      folders: useBookmarksStore.getState().folders,
      readingProgress: useReadingProgressStore.getState().readingProgress,
      deleted: {
        bookmarks: pruneTombstones(useBookmarksStore.getState().removed ?? {}),
        readingProgress: pruneTombstones(useReadingProgressStore.getState().removed ?? {}),
      },
      settings: {
        theme: useSettingsStore.getState().theme,
        language: useSettingsStore.getState().language,
        fontSize: useReaderStore.getState().fontSize,
        view: useViewStore.getState().view,
      },
    },
  };
}

/** Download all local data (bookmarks, folders, reading progress, preferences) as JSON. */
export function exportUserData() {
  const json = JSON.stringify(buildExportPayload(), null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `bookracy-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Firefox can cancel a download whose blob URL is revoked before it starts.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Permanently wipe every bit of Bookracy data this browser holds — bookmarks,
 * reading progress, preferences (all in localStorage) plus sessionStorage and any
 * JS-readable cookies. Caller should reload afterwards so stores re-init to defaults.
 */
export async function clearLocalData() {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    /* storage may be unavailable (private mode, etc.) */
  }
  // "All local data" has to include the offline library (IndexedDB, potentially
  // gigabytes of books) and our service-worker caches, which localStorage.clear()
  // never touched — the toast said everything was gone while the books stayed.
  await wipeOfflineLibrary().catch(() => {});
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("bookracy-")).map((k) => caches.delete(k)));
    }
  } catch {
    /* cache API unavailable */
  }
  try {
    for (const cookie of document.cookie.split(";")) {
      const name = cookie.split("=")[0]?.trim();
      if (!name) continue;
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${location.hostname}`;
    }
  } catch {
    /* ignore cookie clearing errors */
  }
}

function normalizeBookmarks(raw: z.infer<typeof bookmarksSchema> | undefined): Bookmark[] {
  if (!raw) return [];
  return raw.map((b) => (typeof b === "string" ? { md5: b, folderId: null } : { md5: b.md5, folderId: b.folderId ?? null, addedAt: b.addedAt }));
}

function normalizeFolders(raw: z.infer<typeof folderSchema>[] | undefined): BookmarkFolder[] {
  if (!raw) return [];
  return raw.map((f) => ({ id: f.id, name: f.name, color: f.color || DEFAULT_FOLDER_COLOR, createdAt: f.createdAt ?? Date.now() }));
}

function normalizeProgress(raw: z.infer<typeof progressItemSchema>[] | undefined): ProgressItem[] {
  if (!raw) return [];
  // A backup written before positions were timestamped sorts to the bottom (0), so it
  // can never overwrite a dated position that's already on this device.
  return raw.map((p) => ({ ...p, updatedAt: p.updatedAt ?? 0 }));
}

/** Validate an already-parsed backup object (e.g. the cloud-sync blob). Throws on bad shape. */
export function parseBackupObject(raw: unknown): ParsedBackup {
  const parsed = exportSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("This doesn't look like a Bookracy backup file.");
  }

  const { bookmarks, folders, readingProgress, settings, deleted } = parsed.data.data;
  return {
    bookmarks: normalizeBookmarks(bookmarks),
    folders: normalizeFolders(folders),
    readingProgress: normalizeProgress(readingProgress),
    deleted: { bookmarks: deleted?.bookmarks ?? {}, readingProgress: deleted?.readingProgress ?? {} },
    preferences: { theme: settings?.theme, language: settings?.language, fontSize: settings?.fontSize, view: settings?.view },
  };
}

/** Read + validate a backup file. Throws a friendly Error on bad input. */
export async function parseBackupFile(file: File): Promise<ParsedBackup> {
  const text = await file.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  return parseBackupObject(raw);
}

/** Compare a parsed backup against what's currently stored, per category. */
export function diffBackup(parsed: ParsedBackup): ImportDiff {
  const localBookmarks = useBookmarksStore.getState().bookmarks;
  const localFolders = useBookmarksStore.getState().folders;
  const localProgress = useReadingProgressStore.getState().readingProgress;

  const localBookmarkMd5s = new Set(localBookmarks.map((b) => b.md5));
  const localFolderIds = new Set(localFolders.map((f) => f.id));
  const localProgressMd5s = new Set(localProgress.map((p) => p.md5));

  const settings = useSettingsStore.getState();
  const currentFontSize = useReaderStore.getState().fontSize;
  const currentView = useViewStore.getState().view;
  const prefConflict =
    (parsed.preferences.theme != null && parsed.preferences.theme !== settings.theme) ||
    (parsed.preferences.language != null && parsed.preferences.language !== settings.language) ||
    (parsed.preferences.fontSize != null && parsed.preferences.fontSize !== currentFontSize) ||
    (parsed.preferences.view != null && parsed.preferences.view !== currentView);

  return {
    bookmarks: {
      incoming: parsed.bookmarks.length,
      current: localBookmarks.length,
      overlap: parsed.bookmarks.filter((b) => localBookmarkMd5s.has(b.md5)).length,
    },
    folders: {
      incoming: parsed.folders.length,
      current: localFolders.length,
      overlap: parsed.folders.filter((f) => localFolderIds.has(f.id)).length,
    },
    readingProgress: {
      incoming: parsed.readingProgress.length,
      current: localProgress.length,
      overlap: parsed.readingProgress.filter((p) => localProgressMd5s.has(p.md5)).length,
    },
    preferences: {
      incoming: parsed.preferences.theme != null || parsed.preferences.language != null || parsed.preferences.fontSize != null || parsed.preferences.view != null,
      conflict: prefConflict,
    },
  };
}

/** Apply a parsed backup using a per-category plan. Returns how much each category took from the file. */
export function applyBackup(parsed: ParsedBackup, plan: ImportPlan): ImportSummary {
  const bookmarksStore = useBookmarksStore.getState();
  const progressStore = useReadingProgressStore.getState();
  const settingsStore = useSettingsStore.getState();

  const summary: ImportSummary = { bookmarks: 0, folders: 0, progress: 0 };

  // Folders
  let nextFolders = bookmarksStore.folders;
  if (plan.folders === "overwrite") {
    nextFolders = parsed.folders;
    summary.folders = parsed.folders.length;
  } else if (plan.folders === "merge") {
    const existingIds = new Set(bookmarksStore.folders.map((f) => f.id));
    const added = parsed.folders.filter((f) => !existingIds.has(f.id));
    nextFolders = [...bookmarksStore.folders, ...added];
    summary.folders = added.length;
  }

  // Bookmarks. Merging honours tombstones from both sides: a book removed on any
  // device after it was saved stays removed instead of being resurrected by the union.
  let nextBookmarks = bookmarksStore.bookmarks;
  let nextBookmarkTombstones = bookmarksStore.removed ?? {};
  if (plan.bookmarks === "overwrite") {
    nextBookmarks = parsed.bookmarks;
    nextBookmarkTombstones = pruneTombstones(parsed.deleted.bookmarks);
    summary.bookmarks = parsed.bookmarks.length;
  } else if (plan.bookmarks === "merge") {
    const merged = mergeWithTombstones(
      bookmarksStore.bookmarks,
      parsed.bookmarks,
      bookmarksStore.removed ?? {},
      parsed.deleted.bookmarks,
      (b) => b.addedAt ?? 0,
      (mine) => mine,
    );
    nextBookmarks = merged.items;
    nextBookmarkTombstones = merged.tombstones;
    summary.bookmarks = merged.added;
  }

  // Safety net: never leave a bookmark pointing at a folder that no longer exists.
  const finalFolderIds = new Set(nextFolders.map((f) => f.id));
  nextBookmarks = nextBookmarks.map((b) => (b.folderId && !finalFolderIds.has(b.folderId) ? { ...b, folderId: null } : b));

  bookmarksStore.setFolders(nextFolders);
  bookmarksStore.setBookmarks(nextBookmarks);
  bookmarksStore.setRemoved(nextBookmarkTombstones);

  // Reading progress. Merging is last-write-wins PER BOOK rather than "keep whatever
  // is already here": a book you advanced on another device has to actually move
  // forward on this one, which is the whole point of syncing a reading position.
  // (A plain skip-if-present merge strands every book both devices have ever opened.)
  if (plan.readingProgress === "overwrite") {
    useReadingProgressStore.setState({ readingProgress: parsed.readingProgress, removed: pruneTombstones(parsed.deleted.readingProgress) });
    summary.progress = parsed.readingProgress.length;
  } else if (plan.readingProgress === "merge") {
    let advanced = 0;
    const merged = mergeWithTombstones(
      progressStore.readingProgress,
      parsed.readingProgress,
      progressStore.removed ?? {},
      parsed.deleted.readingProgress,
      (p) => p.updatedAt ?? 0,
      (mine, theirs) => {
        if ((mine.updatedAt ?? 0) >= (theirs.updatedAt ?? 0)) return mine;
        advanced += 1;
        // Keep any metadata the incoming copy lacks (an older client may not have it).
        return { ...mine, ...theirs };
      },
    );
    useReadingProgressStore.setState({ readingProgress: merged.items, removed: merged.tombstones });
    summary.progress = merged.added + advanced;
  }

  // Preferences
  if (plan.preferences === "overwrite") {
    if (parsed.preferences.theme) settingsStore.setTheme(parsed.preferences.theme);
    if (parsed.preferences.language) settingsStore.setLanguage(parsed.preferences.language);
    if (parsed.preferences.fontSize != null) useReaderStore.getState().setFontSize(parsed.preferences.fontSize);
    if (parsed.preferences.view) useViewStore.getState().setView(parsed.preferences.view);
  }

  return summary;
}
