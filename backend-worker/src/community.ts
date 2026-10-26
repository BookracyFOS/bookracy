// Community uploads: contributor identities, upload records, the per-book download
// counter, the leaderboard, and moderation — all backed by D1 (see migrations/).
//
// Privacy: a contributor is keyed by `uid = sha256(account key)`, a one-way hash —
// D1 never stores the secret account key, so a D1 leak can't impersonate anyone.
// The whole feature is inert when D1 is unbound (communityEnabled() === false), so
// it degrades gracefully exactly like the Turnstile / backup layers.

export interface CommunityEnv {
  DB?: D1Database;
}

export interface UploadInput {
  md5: string;
  uid: string;
  title: string;
  author: string;
  ext: string; // no leading dot, e.g. "epub"
  mime: string;
  size: number;
  lang: string;
  year: string;
  description: string;
}

/** Editable metadata fields (everything except the immutable md5/file). */
export interface UploadEdit {
  title?: string;
  author?: string;
  lang?: string;
  year?: string;
  description?: string;
}

// A row shaped for the public listing. `uploader` is the current display name
// (null = anonymous). `uid` is the public one-way hash, so the client can tell
// "this is me" by hashing its own key — never the secret itself.
export interface CommunityUpload {
  md5: string;
  title: string;
  author: string;
  ext: string;
  mime: string;
  size: number;
  lang: string;
  year: string;
  description: string;
  downloads: number;
  createdAt: string;
  uploader: string | null;
  uid: string;
  cover: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  uid: string;
  name: string; // username or "Anonymous"
  books: number;
  downloads: number;
  badge: Badge;
}

export interface Badge {
  tier: number;
  label: string;
}

export interface Profile {
  uid: string;
  username: string | null;
  books: number;
  downloads: number;
  badge: Badge;
  uploads: CommunityUpload[];
}

/** A contributor as seen by the admin moderation dashboard. */
export interface AdminUser {
  uid: string;
  username: string | null;
  books: number;
  downloads: number;
  banned: boolean;
  suspendedUntil: string | null;
  createdAt: string;
}

export function communityEnabled(env: CommunityEnv): boolean {
  return Boolean(env.DB);
}

/** A contributor's stable, non-reversible public id: sha256 of their account key. */
export async function uidFor(accountId: string): Promise<string> {
  const data = new TextEncoder().encode(accountId);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- Username rules --------------------------------------------------------
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const RESERVED = new Set(["anonymous", "anon", "admin", "bookracy", "system", "moderator", "mod"]);

export type UsernameError = "invalid" | "reserved" | "taken";

/** Normalise + validate a requested username. Returns the cleaned value or an error. */
export function validateUsername(raw: string): { ok: true; value: string } | { ok: false; error: UsernameError } {
  const value = raw.trim();
  if (!USERNAME_RE.test(value)) return { ok: false, error: "invalid" };
  if (RESERVED.has(value.toLowerCase())) return { ok: false, error: "reserved" };
  return { ok: true, value };
}

// ---- Badges ----------------------------------------------------------------
// Pure vanity ladder keyed off total downloads across a contributor's uploads.
const BADGE_LADDER: Badge[] = [
  { tier: 0, label: "Contributor" },
  { tier: 1, label: "Rising" },
  { tier: 2, label: "Popular" },
  { tier: 3, label: "Star" },
  { tier: 4, label: "Legend" },
];
const BADGE_THRESHOLDS = [0, 50, 250, 1000, 5000];

export function badgeFor(downloads: number): Badge {
  let badge = BADGE_LADDER[0];
  for (let i = 0; i < BADGE_THRESHOLDS.length; i++) {
    if (downloads >= BADGE_THRESHOLDS[i]) badge = BADGE_LADDER[i];
  }
  return badge;
}

// ---- Users -----------------------------------------------------------------
const now = () => new Date().toISOString();

/** Ensure a contributor row exists (idempotent). */
export async function ensureUser(env: CommunityEnv, uid: string): Promise<void> {
  if (!env.DB) return;
  const ts = now();
  await env.DB.prepare("INSERT INTO users (uid, username, created_at, updated_at) VALUES (?, NULL, ?, ?) ON CONFLICT(uid) DO NOTHING")
    .bind(uid, ts, ts)
    .run();
}

export async function getUsername(env: CommunityEnv, uid: string): Promise<string | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare("SELECT username FROM users WHERE uid = ?").bind(uid).first<{ username: string | null }>();
  return row?.username ?? null;
}

/**
 * Set (or clear, with null) a contributor's username. Enforces the unique index
 * case-insensitively; a clash surfaces as "taken" rather than a 500.
 */
export async function setUsername(env: CommunityEnv, uid: string, username: string | null): Promise<{ ok: true } | { ok: false; error: UsernameError }> {
  if (!env.DB) return { ok: false, error: "invalid" };
  await ensureUser(env, uid);
  try {
    await env.DB.prepare("UPDATE users SET username = ?, updated_at = ? WHERE uid = ?").bind(username, now(), uid).run();
    return { ok: true };
  } catch (e) {
    // The partial UNIQUE index throws on a case-insensitive clash.
    if (e instanceof Error && /UNIQUE|constraint/i.test(e.message)) return { ok: false, error: "taken" };
    throw e;
  }
}

interface UserStatus {
  banned: boolean;
  suspendedUntil: string | null;
}

export async function getUserStatus(env: CommunityEnv, uid: string): Promise<UserStatus> {
  if (!env.DB) return { banned: false, suspendedUntil: null };
  const row = await env.DB.prepare("SELECT banned, suspended_until FROM users WHERE uid = ?").bind(uid).first<{ banned: number; suspended_until: string | null }>();
  return { banned: Boolean(row?.banned), suspendedUntil: row?.suspended_until ?? null };
}

/** Whether this contributor is currently blocked from uploading (banned or under an active suspension). */
export async function isUploadBlocked(env: CommunityEnv, uid: string): Promise<{ blocked: boolean; reason?: string }> {
  const { banned, suspendedUntil } = await getUserStatus(env, uid);
  if (banned) return { blocked: true, reason: "Your account has been banned from uploading." };
  if (suspendedUntil && Date.parse(suspendedUntil) > Date.now()) {
    return { blocked: true, reason: `Uploads are suspended until ${suspendedUntil}.` };
  }
  return { blocked: false };
}

export async function setBanned(env: CommunityEnv, uid: string, banned: boolean): Promise<void> {
  if (!env.DB) return;
  await ensureUser(env, uid);
  await env.DB.prepare("UPDATE users SET banned = ?, updated_at = ? WHERE uid = ?").bind(banned ? 1 : 0, now(), uid).run();
}

export async function setSuspended(env: CommunityEnv, uid: string, untilIso: string | null): Promise<void> {
  if (!env.DB) return;
  await ensureUser(env, uid);
  await env.DB.prepare("UPDATE users SET suspended_until = ?, updated_at = ? WHERE uid = ?").bind(untilIso, now(), uid).run();
}

// ---- Uploads ---------------------------------------------------------------
export async function uploadExists(env: CommunityEnv, md5: string): Promise<boolean> {
  if (!env.DB) return false;
  const row = await env.DB.prepare("SELECT 1 AS x FROM uploads WHERE md5 = ?").bind(md5).first<{ x: number }>();
  return Boolean(row);
}

/** The contributor uid that owns an upload, or null if unknown. */
export async function ownerOf(env: CommunityEnv, md5: string): Promise<string | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare("SELECT uid FROM uploads WHERE md5 = ?").bind(md5).first<{ uid: string }>();
  return row?.uid ?? null;
}

/** Owner + the bits needed to purge an upload's R2 objects (file ext, whether a cover exists). */
export async function getUploadCore(env: CommunityEnv, md5: string): Promise<{ uid: string; ext: string; cover: boolean } | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare("SELECT uid, ext, cover FROM uploads WHERE md5 = ?").bind(md5).first<{ uid: string; ext: string; cover: number }>();
  return row ? { uid: row.uid, ext: row.ext, cover: Boolean(row.cover) } : null;
}

/** Insert an upload record. Throws on a duplicate md5 (caller should pre-check). */
export async function recordUpload(env: CommunityEnv, up: UploadInput): Promise<void> {
  if (!env.DB) return;
  await ensureUser(env, up.uid);
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO uploads (md5, uid, title, author, ext, mime, size, lang, year, description, downloads, cover, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
  )
    .bind(up.md5, up.uid, up.title, up.author, up.ext, up.mime, up.size, up.lang, up.year, up.description, ts, ts)
    .run();
}

/** Patch an upload's metadata (only the provided fields). */
export async function updateUploadMeta(env: CommunityEnv, md5: string, edit: UploadEdit): Promise<void> {
  if (!env.DB) return;
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [col, val] of Object.entries(edit)) {
    if (val === undefined) continue;
    sets.push(`${col} = ?`);
    vals.push(val);
  }
  if (!sets.length) return;
  sets.push("updated_at = ?");
  vals.push(now(), md5);
  await env.DB.prepare(`UPDATE uploads SET ${sets.join(", ")} WHERE md5 = ?`).bind(...vals).run();
}

export async function setUploadCover(env: CommunityEnv, md5: string, hasCover: boolean): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare("UPDATE uploads SET cover = ?, updated_at = ? WHERE md5 = ?").bind(hasCover ? 1 : 0, now(), md5).run();
}

export async function deleteUploadRow(env: CommunityEnv, md5: string): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare("DELETE FROM uploads WHERE md5 = ?").bind(md5).run();
}

/** md5/ext/cover for every upload by a contributor (used to delete the R2 objects too). */
export async function listUploadKeysByUid(env: CommunityEnv, uid: string): Promise<{ md5: string; ext: string; cover: boolean }[]> {
  if (!env.DB) return [];
  const rows = await env.DB.prepare("SELECT md5, ext, cover FROM uploads WHERE uid = ?").bind(uid).all<{ md5: string; ext: string; cover: number }>();
  return (rows.results || []).map((r) => ({ md5: r.md5, ext: r.ext, cover: Boolean(r.cover) }));
}

export async function deleteAllByUid(env: CommunityEnv, uid: string): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare("DELETE FROM uploads WHERE uid = ?").bind(uid).run();
}

/** Best-effort +1 to a book's download counter. A no-op for non-community md5s. */
export async function incrementDownload(env: CommunityEnv, md5: string): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare("UPDATE uploads SET downloads = downloads + 1 WHERE md5 = ?").bind(md5).run();
}

interface UploadRow {
  md5: string;
  title: string;
  author: string;
  ext: string;
  mime: string;
  size: number;
  lang: string;
  year: string;
  description: string;
  downloads: number;
  cover: number;
  created_at: string;
  username: string | null;
  uid: string;
}

const UPLOAD_COLS = "p.md5, p.title, p.author, p.ext, p.mime, p.size, p.lang, p.year, p.description, p.downloads, p.cover, p.created_at, p.uid, u.username";

function toCommunityUpload(r: UploadRow): CommunityUpload {
  return {
    md5: r.md5,
    title: r.title,
    author: r.author,
    ext: r.ext,
    mime: r.mime,
    size: r.size,
    lang: r.lang,
    year: r.year,
    description: r.description,
    downloads: r.downloads,
    createdAt: r.created_at,
    uploader: r.username,
    uid: r.uid,
    cover: Boolean(r.cover),
  };
}

export type UploadSort = "recent" | "popular";

export async function listUploads(env: CommunityEnv, sort: UploadSort, limit: number, offset: number): Promise<CommunityUpload[]> {
  if (!env.DB) return [];
  const order = sort === "popular" ? "p.downloads DESC, p.created_at DESC" : "p.created_at DESC";
  const rows = await env.DB.prepare(
    `SELECT ${UPLOAD_COLS} FROM uploads p JOIN users u ON u.uid = p.uid
     WHERE u.banned = 0
     ORDER BY ${order}
     LIMIT ? OFFSET ?`,
  )
    .bind(limit, offset)
    .all<UploadRow>();
  return (rows.results || []).map(toCommunityUpload);
}

/** Community uploads whose title/author match a search query (excludes banned). */
export async function searchUploads(env: CommunityEnv, q: string, limit: number): Promise<CommunityUpload[]> {
  if (!env.DB) return [];
  // `instr` rather than `LIKE '%term%'`: D1 intermittently rejects ordinary
  // book-title-length patterns with "LIKE or GLOB pattern too complex", which silently
  // dropped community results from that search. instr does a plain substring scan with
  // no pattern engine, so the error is structurally impossible — and there are no
  // wildcards left for a user to inject. `lower()` reproduces LIKE's default
  // case-insensitivity, which is ASCII-only either way.
  const term = q.trim().toLowerCase();
  if (!term) return [];
  const rows = await env.DB.prepare(
    `SELECT ${UPLOAD_COLS} FROM uploads p JOIN users u ON u.uid = p.uid
     WHERE u.banned = 0 AND (instr(lower(p.title), ?) > 0 OR instr(lower(p.author), ?) > 0)
     ORDER BY p.downloads DESC, p.created_at DESC
     LIMIT ?`,
  )
    .bind(term, term, limit)
    .all<UploadRow>();
  return (rows.results || []).map(toCommunityUpload);
}

export async function leaderboard(env: CommunityEnv, limit: number): Promise<LeaderboardEntry[]> {
  if (!env.DB) return [];
  const rows = await env.DB.prepare(
    `SELECT u.uid AS uid, u.username AS username, COUNT(p.md5) AS books, COALESCE(SUM(p.downloads), 0) AS downloads
     FROM users u JOIN uploads p ON p.uid = u.uid
     WHERE u.banned = 0
     GROUP BY u.uid
     ORDER BY downloads DESC, books DESC, u.created_at ASC
     LIMIT ?`,
  )
    .bind(limit)
    .all<{ uid: string; username: string | null; books: number; downloads: number }>();
  return (rows.results || []).map((r, i) => ({
    rank: i + 1,
    uid: r.uid,
    name: r.username || "Anonymous",
    books: r.books,
    downloads: r.downloads,
    badge: badgeFor(r.downloads),
  }));
}

export async function getProfile(env: CommunityEnv, uid: string): Promise<Profile> {
  const username = await getUsername(env, uid);
  // A contributor always sees their OWN uploads (even if banned), so they can manage them.
  const uploads = env.DB
    ? (
        await env.DB.prepare(`SELECT ${UPLOAD_COLS} FROM uploads p JOIN users u ON u.uid = p.uid WHERE p.uid = ? ORDER BY p.created_at DESC`)
          .bind(uid)
          .all<UploadRow>()
      ).results || []
    : [];
  const list = uploads.map(toCommunityUpload);
  const downloads = list.reduce((n, u) => n + u.downloads, 0);
  return { uid, username, books: list.length, downloads, badge: badgeFor(downloads), uploads: list };
}

// ---- Admin / moderation views ----------------------------------------------
export async function adminListUploads(env: CommunityEnv, limit: number, offset: number): Promise<(CommunityUpload & { banned: boolean })[]> {
  if (!env.DB) return [];
  const rows = await env.DB.prepare(
    `SELECT ${UPLOAD_COLS}, u.banned AS banned FROM uploads p JOIN users u ON u.uid = p.uid
     ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(limit, offset)
    .all<UploadRow & { banned: number }>();
  return (rows.results || []).map((r) => ({ ...toCommunityUpload(r), banned: Boolean(r.banned) }));
}

export async function adminListUsers(env: CommunityEnv, limit: number): Promise<AdminUser[]> {
  if (!env.DB) return [];
  const rows = await env.DB.prepare(
    `SELECT u.uid AS uid, u.username AS username, u.banned AS banned, u.suspended_until AS suspended_until, u.created_at AS created_at,
            COUNT(p.md5) AS books, COALESCE(SUM(p.downloads), 0) AS downloads
     FROM users u LEFT JOIN uploads p ON p.uid = u.uid
     GROUP BY u.uid
     ORDER BY downloads DESC, books DESC, u.created_at ASC
     LIMIT ?`,
  )
    .bind(limit)
    .all<{ uid: string; username: string | null; banned: number; suspended_until: string | null; created_at: string; books: number; downloads: number }>();
  return (rows.results || []).map((r) => ({
    uid: r.uid,
    username: r.username,
    books: r.books,
    downloads: r.downloads,
    banned: Boolean(r.banned),
    suspendedUntil: r.suspended_until,
    createdAt: r.created_at,
  }));
}
