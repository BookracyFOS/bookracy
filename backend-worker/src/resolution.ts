/**
 * When to give libgen's download resolution a second pass.
 *
 * Measured from Cloudflare's edge on 2026-09-15 for a niche file libgen definitely holds:
 * at any moment roughly ONE of the five mirrors produced a working file (ads.php 500/503
 * or get.php 500 on the rest), and which one kept rotating between passes a minute apart.
 * A single race therefore answered "Download link not found" on attempt after attempt
 * for a book the next attempt could fetch.
 *
 * The retry is only worth its latency when nothing actually said "no". The mirrors are
 * frontends onto one database, so a mirror that answered normally and simply has no link
 * for this md5 is a real miss for all of them — keep those fast.
 */
export type ResolveOutcome =
  /** a mirror served the file */
  | "file"
  /** a mirror answered normally and has no such md5 */
  | "miss"
  /** a 5xx, a timeout, or a link whose file fetch failed */
  | "transient";

export function shouldRetryResolution(outcomes: readonly ResolveOutcome[]): boolean {
  if (outcomes.includes("file") || outcomes.includes("miss")) return false;
  return outcomes.includes("transient");
}
