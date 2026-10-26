// Content-Disposition filename encoding (RFC 6266 / RFC 5987).
//
// Book titles are routinely CJK, Cyrillic or accented, and a bare `filename="…"` may only
// carry ASCII. Emitting raw UTF-8 there made the Workers runtime log a warning on roughly
// a quarter of all downloads — "in a browser this would likely result in a TypeError
// exception" — and the clients that did accept it saved the book under a mojibake name.
//
// So the header carries both halves: an ASCII-only `filename=` that anything can read,
// and `filename*=UTF-8''…`, which every current browser prefers when both are present.

/**
 * Strip anything that could malform / inject the Content-Disposition header: quotes and
 * backslashes (which would break out of the quoted filename) plus CR/LF and other control
 * chars (the Workers runtime throws on raw CR/LF).
 */
export function safeFilename(name: string): string {
  const cleaned = name
    .replace(/[\r\n"\\]+/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, "")
    .trim();
  return cleaned || "download";
}

// encodeURIComponent leaves ! ' ( ) * alone, but none of them are in RFC 5987's
// attr-char set, so they have to be percent-encoded by hand.
function encodeExtValue(name: string): string {
  return encodeURIComponent(name).replace(/['()!*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// Value for the legacy `filename=`. Non-ASCII runs collapse to a space rather than
// vanishing, so word boundaries survive ("Дом  I-II.pdf" beats "DomI-II.pdf"). If nothing
// printable is left — a title that's entirely CJK — keep just the extension so the OS
// still opens the fallback name with the right app.
function asciiFallback(name: string): string {
  const stripped = name
    .replace(/[^\x20-\x7e]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (stripped && !stripped.startsWith(".")) return stripped;
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot).replace(/[^\x20-\x7e]+/g, "") : "";
  return `download${ext}`;
}

/** Full `Content-Disposition` value for an attachment whose name may hold any Unicode. */
export function attachmentDisposition(name: string): string {
  const safe = safeFilename(name);
  return `attachment; filename="${asciiFallback(safe)}"; filename*=UTF-8''${encodeExtValue(safe)}`;
}

/** Same header, but `inline`: the browser renders the file (its own PDF viewer) instead
 *  of saving it, while "Save as" still gets the right name. */
export function inlineDisposition(name: string): string {
  const safe = safeFilename(name);
  return `inline; filename="${asciiFallback(safe)}"; filename*=UTF-8''${encodeExtValue(safe)}`;
}
