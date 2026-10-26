import { queryOptions, infiniteQueryOptions } from "@tanstack/react-query";
import { ofetch } from "ofetch";
import SparkMD5 from "spark-md5";
import { client } from "../base";
import { BookItem } from "../types";
import { useSettingsStore } from "@/stores/settings";
import { useSyncStore } from "@/stores/sync";
import { createAccount } from "../sync/sync";

// A community-uploaded book. Backend shapes it like a normal BookItem (so the
// existing book cards render it) plus a few community-only fields.
export interface CommunityBook extends BookItem {
  uploader: string | null; // display name, or null = anonymous
  downloads: number;
  uid: string; // public one-way hash of the uploader's account key
  createdAt: string;
  cover: boolean; // whether a cover image is stored for this book
}

/** One upload as seen in the admin dashboard (adds the uploader's ban state). */
export interface AdminUpload extends CommunityBook {
  banned: boolean;
}

/** A contributor as seen in the admin dashboard. */
export interface AdminUser {
  uid: string;
  username: string | null;
  books: number;
  downloads: number;
  banned: boolean;
  suspendedUntil: string | null;
  createdAt: string;
}

export interface Badge {
  tier: number;
  label: string;
}

export interface LeaderboardEntry {
  rank: number;
  uid: string;
  name: string; // username or "Anonymous"
  books: number;
  downloads: number;
  badge: Badge;
}

export interface Profile {
  uid: string;
  username: string | null;
  books: number;
  downloads: number;
  badge: Badge;
  uploads: CommunityBook[];
}

export type UploadSort = "recent" | "popular";

// File types the backend accepts (mirrors UPLOAD_EXT_ALLOW in backend-worker).
export const UPLOAD_EXTS = ["epub", "pdf", "mobi", "azw3", "azw", "cbz", "cbr", "djvu", "txt", "fb2", "rtf", "doc", "docx"] as const;

// The backend pages at 60 (max 100). The UI used to ask for page 1 only and render no
// pager, so everything past the newest 60 uploads was unreachable from the library.
export const COMMUNITY_PAGE_SIZE = 60;

export const communityUploadsInfiniteOptions = (sort: UploadSort) =>
  infiniteQueryOptions({
    queryKey: ["community-uploads", sort],
    queryFn: ({ pageParam }) => client<{ uploads: CommunityBook[] }>("/uploads", { query: { sort, page: pageParam, limit: COMMUNITY_PAGE_SIZE } }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage.uploads.length >= COMMUNITY_PAGE_SIZE ? allPages.length + 1 : undefined),
    staleTime: 1000 * 60,
  });

export const leaderboardQueryOptions = () =>
  queryOptions({
    queryKey: ["leaderboard"],
    queryFn: () => client<{ leaderboard: LeaderboardEntry[] }>("/leaderboard"),
    staleTime: 1000 * 60,
  });

const profileUrl = () => `${useSettingsStore.getState().backendURL}/api/profile`;

/** The current device's contributor profile (uploads + stats). Requires an account. */
export const profileQueryOptions = (accountId: string | null) =>
  queryOptions({
    queryKey: ["profile", accountId],
    queryFn: () => ofetch<Profile>(profileUrl(), { headers: { Authorization: `Bearer ${accountId}` } }),
    enabled: Boolean(accountId),
    staleTime: 1000 * 30,
  });

/** Set (or clear, with null) this account's public username. */
export async function setUsername(accountId: string, username: string | null): Promise<{ ok: boolean; username: string | null }> {
  return await ofetch(profileUrl(), {
    method: "PUT",
    headers: { Authorization: `Bearer ${accountId}`, "Content-Type": "application/json" },
    body: { username },
  });
}

/**
 * Return the saved account key, minting one on first use (uploading needs an
 * identity). Account creation is Turnstile-gated server-side in prod, so pass a
 * token when minting a new account (ignored if one already exists).
 */
export async function ensureAccountId(turnstileToken?: string): Promise<string> {
  const existing = useSyncStore.getState().accountId;
  if (existing) return existing;
  const id = await createAccount(turnstileToken);
  useSyncStore.getState().setAccount(id);
  return id;
}

/** The public contributor id for an account key: sha256(key), matching the backend. */
export async function uidForAccount(accountId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(accountId));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Streaming md5 of a File (the backend keys + verifies uploads by content md5). */
export async function md5OfFile(file: File, onProgress?: (fraction: number) => void): Promise<string> {
  const CHUNK = 4 * 1024 * 1024;
  const spark = new SparkMD5.ArrayBuffer();
  let offset = 0;
  while (offset < file.size) {
    const slice = file.slice(offset, Math.min(offset + CHUNK, file.size));
    spark.append(await slice.arrayBuffer());
    offset += CHUNK;
    onProgress?.(Math.min(1, offset / file.size));
  }
  return spark.end();
}

export interface UploadMeta {
  title: string;
  author?: string;
  ext: string;
  lang?: string;
  year?: string;
  description?: string;
}

export interface UploadResult {
  ok: boolean;
  md5: string;
  link: string;
}

/**
 * Upload a book file with real progress. Sends metadata in the query string and the
 * raw file as the body (so it streams), authenticated with the account key. Uses XHR
 * because fetch can't report upload progress in browsers.
 */
export function uploadBook(opts: { file: File; md5: string; meta: UploadMeta; accountId: string; turnstileToken?: string; onProgress?: (fraction: number) => void }): Promise<UploadResult> {
  const { file, md5, meta, accountId, turnstileToken, onProgress } = opts;
  const base = useSettingsStore.getState().backendURL;
  const params = new URLSearchParams({ md5, ext: meta.ext, title: meta.title });
  if (meta.author) params.set("author", meta.author);
  if (meta.lang) params.set("lang", meta.lang);
  if (meta.year) params.set("year", meta.year);
  if (meta.description) params.set("description", meta.description);

  return new Promise<UploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${base}/api/uploads?${params.toString()}`);
    xhr.setRequestHeader("Authorization", `Bearer ${accountId}`);
    if (turnstileToken) xhr.setRequestHeader("X-Turnstile-Token", turnstileToken);
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    });
    xhr.addEventListener("load", () => {
      let body: { ok?: boolean; md5?: string; link?: string; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON error body */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.ok) resolve(body as UploadResult);
      else reject(new Error(body.error || `Upload failed (${xhr.status})`));
    });
    xhr.addEventListener("error", () => reject(new Error("Upload failed — network error")));
    xhr.send(file);
  });
}

const apiBase = () => useSettingsStore.getState().backendURL;

// ---- Owner-scoped management (edit / delete / cover / delete-all) -----------
export async function updateUpload(accountId: string, md5: string, fields: { title?: string; author?: string; lang?: string; year?: string; description?: string }): Promise<void> {
  await ofetch(`${apiBase()}/api/uploads/${md5}`, { method: "PATCH", headers: { Authorization: `Bearer ${accountId}`, "Content-Type": "application/json" }, body: fields });
}

export async function deleteUpload(accountId: string, md5: string): Promise<void> {
  await ofetch(`${apiBase()}/api/uploads/${md5}`, { method: "DELETE", headers: { Authorization: `Bearer ${accountId}` } });
}

export async function uploadCover(accountId: string, md5: string, image: Blob): Promise<void> {
  await ofetch(`${apiBase()}/api/uploads/${md5}/cover`, { method: "POST", headers: { Authorization: `Bearer ${accountId}`, "Content-Type": "image/jpeg" }, body: image });
}

export async function deleteAllUploads(accountId: string): Promise<number> {
  const r = await ofetch<{ deleted: number }>(`${apiBase()}/api/profile/uploads`, { method: "DELETE", headers: { Authorization: `Bearer ${accountId}` } });
  return r.deleted ?? 0;
}

// ---- Cover helpers (client-side) --------------------------------------------
/** Pull the cover image out of an EPUB (via epubjs), or null if it has none. */
interface CoverBook {
  coverUrl: () => Promise<string | null>;
  destroy: () => void;
  on: (event: string, fn: () => void) => void;
}

export async function extractEpubCover(file: File): Promise<Blob | null> {
  let book: CoverBook | null = null;
  try {
    const ePub = (await import("epubjs")).default;
    book = ePub(await file.arrayBuffer()) as unknown as CoverBook;
    // `coverUrl()` waits on a promise epub.js never settles for a file it can't open,
    // which left the "Add cover" button spinning forever on a broken EPUB.
    const url = await Promise.race([
      book.coverUrl(),
      new Promise<null>((_, reject) => {
        book?.on("openFailed", () => reject(new Error("not an EPUB")));
        setTimeout(() => reject(new Error("cover extraction timed out")), 10_000);
      }),
    ]);
    if (!url) return null;
    return await (await fetch(url)).blob();
  } catch {
    return null;
  } finally {
    try {
      book?.destroy();
    } catch {
      /* already torn down */
    }
  }
}

/** Normalise any image (File/Blob) to a small JPEG so covers stay consistent + tiny. */
export async function imageToJpegBlob(source: Blob, maxW = 600): Promise<Blob> {
  const url = URL.createObjectURL(source);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Could not read that image."));
      i.src = url;
    });
    const scale = Math.min(1, maxW / (img.width || maxW));
    const w = Math.max(1, Math.round((img.width || maxW) * scale));
    const h = Math.max(1, Math.round((img.height || maxW) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable.");
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Image conversion failed."))), "image/jpeg", 0.85));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Search the main library (Anna's Archive) to warn if a book is already available. */
export async function checkAvailability(query: string): Promise<BookItem[]> {
  if (!query.trim()) return [];
  try {
    const r = await client<{ results: BookItem[] }>("/books", { query: { query, lang: "all", limit: 5 } });
    return r.results ?? [];
  } catch {
    return [];
  }
}

// ---- Admin moderation (X-Admin-Key) -----------------------------------------
export const adminUploadsQueryOptions = (adminKey: string) =>
  queryOptions({
    // A wrong key must not sit on the empty state through three silent retries.
    retry: false,
    queryKey: ["admin-uploads"],
    enabled: Boolean(adminKey),
    queryFn: () => ofetch<{ uploads: AdminUpload[] }>(`${apiBase()}/api/admin/uploads`, { headers: { "X-Admin-Key": adminKey } }),
  });

export const adminUsersQueryOptions = (adminKey: string) =>
  queryOptions({
    // A wrong key must not sit on the empty state through three silent retries.
    retry: false,
    queryKey: ["admin-users"],
    enabled: Boolean(adminKey),
    queryFn: () => ofetch<{ users: AdminUser[] }>(`${apiBase()}/api/admin/users`, { headers: { "X-Admin-Key": adminKey } }),
  });

export async function adminDeleteUpload(adminKey: string, md5: string): Promise<void> {
  await ofetch(`${apiBase()}/api/admin/uploads/${md5}`, { method: "DELETE", headers: { "X-Admin-Key": adminKey } });
}

export async function adminBan(adminKey: string, uid: string, banned: boolean): Promise<void> {
  await ofetch(`${apiBase()}/api/admin/users/${uid}/ban`, { method: "POST", headers: { "X-Admin-Key": adminKey, "Content-Type": "application/json" }, body: { banned } });
}

export async function adminSuspend(adminKey: string, uid: string, until: string | null): Promise<void> {
  await ofetch(`${apiBase()}/api/admin/users/${uid}/suspend`, { method: "POST", headers: { "X-Admin-Key": adminKey, "Content-Type": "application/json" }, body: { until } });
}
