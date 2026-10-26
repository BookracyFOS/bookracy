import type { BookItem } from "@/api/backend/types";
import type { ProgressItem } from "@/stores/progress";
import { useSettingsStore } from "@/stores/settings";

/** Everything the reader needs in order to reopen a book from a saved position. */
export interface ResumeTarget {
  md5: string;
  title: string;
  author?: string;
  link: string;
  image?: string;
  size?: string;
}

/**
 * Turn a saved reading position into something openable.
 *
 * Positions written before metadata was stored — or synced from an older client —
 * carry only an md5. The API serves both covers and downloads keyed by md5 alone, so
 * everything a card needs is rebuildable locally, with no search round-trip and no
 * dependency on the book still being findable upstream.
 */
export function resolveResumeTarget(item: ProgressItem): ResumeTarget {
  const api = useSettingsStore.getState().backendURL;
  const title = item.title?.trim() || "Your book";
  const safeTitle = title.replace(/[\\/]+/g, "-");
  return {
    md5: item.md5,
    title,
    author: item.author,
    link: item.link || `${api}/download/${item.md5}/${encodeURIComponent(safeTitle)}.epub`,
    image: item.image || `${api}/cover/${item.md5}/thumbnail.jpg`,
    size: item.size,
  };
}

/** How far through the book this position is, 0–100. */
export function resumePercent(item: ProgressItem): number {
  if (!item.totalPages) return 0;
  return Math.max(0, Math.min(100, (item.currentPage / item.totalPages) * 100));
}

/**
 * A book card built purely from what the position remembers. Used as the fallback on
 * the bookshelf when the md5 lookup can't resolve (offline, rate-limited, or the book
 * has since dropped out of the index) so a synced position never renders as a hole.
 */
export function bookItemFromProgress(item: ProgressItem): BookItem {
  const target = resolveResumeTarget(item);
  return {
    id: 0,
    md5: item.md5,
    title: target.title,
    author: target.author || "Unknown Author",
    link: target.link,
    book_image: target.image ?? "",
    book_filetype: "epub",
    book_size: item.size ?? "",
    book_lang: "",
    book_length: "",
    description: "",
    publisher: "",
    series: "",
    isbn: "",
    cid: "",
    external_cover_url: "",
    other_titles: target.title,
    year: "",
  };
}
