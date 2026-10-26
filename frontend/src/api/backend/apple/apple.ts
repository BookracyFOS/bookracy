import { queryOptions } from "@tanstack/react-query";
import { client } from "../base";

/**
 * Chart genres offered as chips on the homepage. Ids are Apple's own iTunes genre ids
 * and must stay in sync with APPLE_GENRES in the backend — anything not on the
 * backend's allowlist silently falls back to the overall chart.
 */
export const CHART_GENRES: { id: string; label: string }[] = [
  { id: "", label: "All books" },
  { id: "9031", label: "Fiction" },
  { id: "9032", label: "Mystery & Thriller" },
  { id: "9020", label: "Sci-Fi & Fantasy" },
  { id: "9003", label: "Romance" },
  { id: "10047", label: "Historical Fiction" },
  { id: "9008", label: "Biography" },
  { id: "9007", label: "History" },
  { id: "9026", label: "Science & Nature" },
  { id: "9009", label: "Business" },
  { id: "10042", label: "Classics" },
  { id: "9028", label: "Young Adult" },
];

// ---- search suggestions -------------------------------------------------------

/** Search-as-you-type suggestions, proxied from the Apple Books store's autocomplete. */
export const suggestionsQueryOptions = (term: string) =>
  queryOptions({
    queryKey: ["suggestions", term.toLowerCase()],
    queryFn: () => client<{ suggestions: string[] }>(`/suggest?q=${encodeURIComponent(term)}`),
    // A prefix's suggestions are effectively static, and the backend caches for a day.
    staleTime: 24 * 60 * 60 * 1000,
    enabled: term.trim().length >= 2,
    // Suggestions are a nicety — never retry or spam the endpoint when it's unhappy.
    retry: false,
  });

// ---- per-book metadata --------------------------------------------------------

export interface AppleMetadata {
  title: string;
  author: string;
  cover: string;
  description: string;
  rating: number;
  ratingCount: number;
  pageCount: number;
  publisher: string;
  isbn: string;
  releaseDate: string;
  genres: string[];
  url: string;
  /** Edition subtitle ("The Final Empire"). */
  subtitle: string;
  /** Series name + position — Apple knows these, libgen records don't. */
  seriesName: string;
  seriesPosition: string;
  /** BCP-47 locale of the edition ("en-US"). */
  locale: string;
}

/**
 * Publisher description, star rating, page count and ISBN for a book we already serve.
 * Anna's Archive gives us none of that, so this fills the detail dialog. Keyed by md5;
 * title/author are the lookup terms the backend uses on a cache miss.
 */
export const bookMetadataQueryOptions = (md5: string, title: string, author: string, enabled: boolean) =>
  queryOptions({
    queryKey: ["book_metadata", md5],
    queryFn: () => {
      const params = new URLSearchParams({ title, author: author || "" });
      return client<{ metadata: AppleMetadata | null }>(`/metadata/${md5}?${params.toString()}`);
    },
    staleTime: 7 * 24 * 60 * 60 * 1000,
    enabled: enabled && Boolean(md5 && title),
    retry: false,
  });
