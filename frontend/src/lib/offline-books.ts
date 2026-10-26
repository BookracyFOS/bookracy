// IndexedDB-backed offline library. Stores book blobs + metadata so downloads survive
// reloads / offline use / weeks of not opening the app (with persistent storage).
//
// Why IndexedDB, not OPFS: OPFS isn't in Firefox yet and Safari's implementation is
// partial. IndexedDB with a Blob value is universally supported (iOS Safari, Android
// Chrome, macOS, Windows, desktop everything), handles large binaries efficiently
// (browsers store them out-of-line, not in-memory), and is the same API on every
// platform. A single store + a single get-put-delete API keeps this file tiny.
//
// Storage quotas in 2026 are effectively per-origin percentages of free disk (Chrome:
// up to 60% of disk per origin). The one platform quirk that matters is Safari's
// 7-day script-writable eviction — installed PWAs are exempt, but non-installed Safari
// users need `navigator.storage.persist()` to opt in. We fire the request opportunistically
// on the first successful save (see saveBook), wrapped in a user gesture so browsers
// that prompt (Firefox) don't do it on cold-load.

const DB_NAME = "bookracy-offline";
// v2 splits each record into a metadata row and a payload row (see BLOBS below).
const DB_VERSION = 2;
/** Payload store: `{ md5, blob }` — the bytes, kept apart from the listing. */
const BLOBS = "blobs";
const STORE = "books";

export interface OfflineBookMeta {
  md5: string;
  title: string;
  author?: string;
  filename: string;
  ext: string; // ".epub", ".pdf", … (leading dot preserved for consistency w/ the queue)
  mime: string;
  size: number; // bytes — the blob's actual size, not the human-readable one
  downloadedAt: number; // epoch ms
  /** Human-readable size the search response gave, kept for the reader's "big book" messaging. */
  sourceSize?: string;
  /**
   * True for a file the user added from their own device rather than downloaded from
   * Bookracy. Its md5 is a content hash we computed locally, so the backend knows
   * nothing about it — no cover endpoint, no search entry.
   */
  local?: boolean;
  /**
   * Cover image bytes. Only set for local books: downloaded ones reconstruct their
   * cover from the API by md5, but a user's file has no server-side cover to fetch,
   * so we extract one from the EPUB at add-time and keep it here. Small (a ~600px
   * JPEG), so it stays in the metadata listing rather than needing a separate read.
   */
  cover?: Blob;
}

export interface OfflineBookRecord extends OfflineBookMeta {
  blob: Blob;
}

// ---- Blob ⇄ ArrayBuffer at the storage boundary --------------------------------
// WebKit refuses to store a Blob in IndexedDB: the transaction aborts with a null
// error, so the write fails *silently* and the library just stays empty on Safari.
// ArrayBuffers round-trip fine on every engine (verified against WebKit, Gecko and
// Chromium), so bytes are converted on the way in and rebuilt on the way out.
//
// Only the on-disk representation changes — every caller still sees `blob: Blob`.
// Records written by older builds hold a real Blob and are passed straight through,
// so this needs no migration.

// Metadata row. Before v2 this also carried `blob`, which meant listing the library
// deserialised every book's full payload just to throw it away — on boot and after
// every add/remove. Forty 20 MB books = 800 MB churned per download; iOS Safari kills
// the tab for less. The payload now lives in its own store, keyed by the same md5.
interface StoredMeta extends Omit<OfflineBookRecord, "blob" | "cover"> {
  /** Only present on rows written before v2 that haven't been migrated (never, after upgrade). */
  blob?: Blob | ArrayBuffer;
  cover?: Blob | ArrayBuffer;
}
interface StoredBlob {
  md5: string;
  blob: Blob | ArrayBuffer;
}

const toBytes = async (value: Blob | ArrayBuffer): Promise<ArrayBuffer> => (value instanceof Blob ? await value.arrayBuffer() : value);

const toBlob = (value: Blob | ArrayBuffer | undefined, type: string): Blob | undefined => {
  if (!value) return undefined;
  return value instanceof Blob ? value : new Blob([value], { type });
};

/** Rebuild the caller-facing record (Blob-shaped) from the two on-disk rows. */
function hydrate(meta: StoredMeta | undefined, payload: StoredBlob | undefined): OfflineBookRecord | undefined {
  if (!meta) return undefined;
  const bytes = payload?.blob ?? meta.blob;
  if (!bytes) return undefined;
  const rest: StoredMeta = { ...meta };
  delete rest.blob;
  return {
    ...rest,
    blob: toBlob(bytes, meta.mime || "application/octet-stream")!,
    cover: toBlob(meta.cover, "image/jpeg"),
  };
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    // Feature-detect indexedDB defensively — very old / privacy-restricted contexts
    // (Safari private mode used to break here) can throw the moment we touch it.
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // keyPath: md5 — unique per book, indexes the natural id we already have.
        // A `downloadedAt` index gives us cheap chronological listing for the library UI.
        const store = db.createObjectStore(STORE, { keyPath: "md5" });
        store.createIndex("downloadedAt", "downloadedAt");
      }
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS, { keyPath: "md5" });
      // v1 -> v2: move each payload out of its metadata row, one record at a time,
      // inside the upgrade transaction (so a half-done migration can't be observed).
      if (event.oldVersion > 0 && event.oldVersion < 2 && req.transaction) {
        const meta = req.transaction.objectStore(STORE);
        const blobs = req.transaction.objectStore(BLOBS);
        const cursor = meta.openCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (!c) return;
          const { blob, ...rest } = c.value as StoredMeta;
          if (blob !== undefined) {
            blobs.put({ md5: rest.md5, blob } satisfies StoredBlob);
            c.update(rest);
          }
          c.continue();
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    req.onblocked = () => reject(new Error("indexedDB open blocked by another tab"));
  });
  // A failed open (private mode, blocked upgrade) must not be cached for the tab's
  // lifetime, or every later save/list fails silently even after the cause clears.
  dbPromise = dbPromise.catch((e) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

/** Close and delete the whole library — used by "Delete all local data". */
export async function wipeOfflineLibrary(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    db.close();
  } catch {
    /* nothing open — deleting still works */
  }
  dbPromise = null;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("indexedDB delete failed"));
    req.onblocked = () => resolve(); // another tab holds it open; it goes when they close
  });
}

/** Wrap an IDBRequest in a Promise. Every low-level call goes through this. */
function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save (or replace) a book. Safe to call repeatedly — a re-download overwrites the
 * previous copy in place. Fires `navigator.storage.persist()` opportunistically so
 * Safari doesn't evict the library after 7 idle days.
 */
export async function saveBook(record: OfflineBookRecord): Promise<void> {
  const db = await openDb();
  const { blob, cover, ...meta } = record;
  const metaRow: StoredMeta = { ...meta, cover: cover ? await toBytes(cover) : undefined };
  const blobRow: StoredBlob = { md5: record.md5, blob: await toBytes(blob) };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE, BLOBS], "readwrite");
    tx.oncomplete = () => resolve();
    // WebKit reports a null error on abort, so never surface a bare `null` rejection.
    tx.onerror = () => reject(tx.error ?? new Error("offline save failed"));
    tx.onabort = () => reject(tx.error ?? new Error("offline save aborted"));
    tx.objectStore(STORE).put(metaRow);
    tx.objectStore(BLOBS).put(blobRow);
  });
  // Best-effort persistence upgrade — no UI hook, browsers that prompt (Firefox)
  // will show their own prompt inline with the download the user just triggered.
  void requestPersistence();
}

/** Look up one book's full record (metadata + blob). Undefined when not present. */
export async function getBook(md5: string): Promise<OfflineBookRecord | undefined> {
  const db = await openDb();
  const tx = db.transaction([STORE, BLOBS], "readonly");
  const [meta, payload] = await Promise.all([
    req(tx.objectStore(STORE).get(md5)) as Promise<StoredMeta | undefined>,
    req(tx.objectStore(BLOBS).get(md5)) as Promise<StoredBlob | undefined>,
  ]);
  return hydrate(meta, payload);
}

/** Cheap presence check — reads the metadata row only, never the bytes. */
export async function hasBook(md5: string): Promise<boolean> {
  const db = await openDb();
  const meta = (await req(db.transaction(STORE, "readonly").objectStore(STORE).get(md5))) as StoredMeta | undefined;
  return meta !== undefined;
}

/** All books, most-recently-downloaded first. Reads metadata rows only — the payloads
 *  live in their own store, so this stays cheap however large the library is. */
export async function listBooks(): Promise<OfflineBookMeta[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const out: OfflineBookMeta[] = [];
    const tx = db.transaction(STORE, "readonly");
    // Reverse cursor on the downloadedAt index → newest first, no post-sort.
    const cursor = tx.objectStore(STORE).index("downloadedAt").openCursor(null, "prev");
    cursor.onerror = () => reject(cursor.error);
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return resolve(out);
      const { blob, cover, ...meta } = c.value as StoredMeta;
      void blob; // absent after the v2 migration; tolerated for a row written mid-upgrade
      // The cover is small and every card needs it, so it rides along with the listing.
      out.push({ ...meta, cover: toBlob(cover, "image/jpeg") });
      c.continue();
    };
  });
}

/** Delete one book. No-op when the md5 isn't stored. */
export async function removeBook(md5: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE, BLOBS], "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("offline delete failed"));
    tx.onabort = () => reject(tx.error ?? new Error("offline delete aborted"));
    tx.objectStore(STORE).delete(md5);
    tx.objectStore(BLOBS).delete(md5);
  });
}

/** Sum of stored blob sizes — cheap because we tracked size at save time. */
export async function totalBytes(): Promise<number> {
  const list = await listBooks();
  return list.reduce((sum, b) => sum + (b.size || 0), 0);
}

/** Storage quota + usage snapshot for the library UI ("14 MB of ~2 GB used"). */
export async function storageEstimate(): Promise<{ usage?: number; quota?: number }> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return {};
  try {
    const est = await navigator.storage.estimate();
    return { usage: est.usage, quota: est.quota };
  } catch {
    return {};
  }
}

/**
 * Ask the browser to keep our storage across quota pressure and Safari's 7-day
 * inactivity eviction. Chromium approves silently based on engagement heuristics,
 * Safari treats installed PWAs as auto-approved, Firefox may prompt (worth the
 * one-time interruption right after a real user download completes).
 * Idempotent — checking + granting are both cheap.
 */
export async function requestPersistence(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
