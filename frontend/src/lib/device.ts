/**
 * A stable, local-only identity for this browser.
 *
 * Reading positions sync between devices, so when a book resumes we want to be able
 * to say *where* it was left off ("picked up from iPhone"). The id is an opaque
 * random string that identifies a browser to itself — it only ever travels inside
 * the user's own sync blob, and it isn't derived from anything about them.
 */

const ID_KEY = "BR::device-id";

let cachedId: string | null = null;
let cachedName: string | null = null;

export function getDeviceId(): string {
  if (cachedId) return cachedId;
  try {
    const stored = localStorage.getItem(ID_KEY);
    if (stored) {
      cachedId = stored;
      return stored;
    }
  } catch {
    /* storage unavailable (private mode) — fall through to a session-only id */
  }
  const random = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Math.random()}${Date.now()}`;
  cachedId = random.replace(/[^a-z0-9]/gi, "").slice(0, 12);
  try {
    localStorage.setItem(ID_KEY, cachedId);
  } catch {
    /* ignore — the in-memory id still works for this session */
  }
  return cachedId;
}

/** A friendly label for this device, e.g. "Safari on iPhone" or "Chrome on Mac". */
export function getDeviceName(): string {
  if (cachedName) return cachedName;
  if (typeof navigator === "undefined") return "another device";
  const ua = navigator.userAgent;

  // Order matters: Edge/Opera also say "Chrome", and Chrome also says "Safari".
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";

  const platform = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh|Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "";

  cachedName = platform && browser ? `${browser} on ${platform}` : platform || browser || "another device";
  return cachedName;
}
