/** A filename-safe slug that keeps letters from every script — a Cyrillic or Greek
 *  title used to collapse to a row of dashes because only ASCII `\w` survived. */
export const titleToSlug = (title: string) => {
  const slug = title
    .toLowerCase()
    .replace(/[\s/\\:*?"<>|]+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "book";
};
