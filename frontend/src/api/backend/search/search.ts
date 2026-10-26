import { keepPreviousData, queryOptions, useInfiniteQuery, useQueries } from "@tanstack/react-query";
import { BaseResponse, client } from "../base";
import { BookItem } from "../types";
import { SearchParams } from "./types";

/**
 * Resolve a single md5 through its own endpoint rather than `/books?query=<md5>`.
 *
 * Same work on the backend — the query-string form still resolves identically and is
 * kept forever for the Kindle client and old share links — but a distinct path is what
 * lets the edge tell a bookshelf apart from a search. Cloudflare's Free-plan rate
 * limiting rule can only match on Path, and the two have opposite traffic shapes: a
 * search is 2-3 requests a session, while a shelf legitimately fires one lookup per
 * saved book at once. Sharing a path meant any threshold worth setting on search would
 * have broken the shelf.
 */
const getBookByMd5 = (md5: string) => client<BaseResponse<BookItem>>(`/books/md5/${md5}`, { query: { limit: 1 } });

const getBooks = (params: SearchParams) => {
  // Only forward facets that are actually set so we never send empty filters.
  const query: Record<string, string | number> = { query: params.query, lang: params.lang, limit: params.limit };
  if (params.page) query.page = params.page;
  if (params.content) query.content = params.content;
  if (params.ext) query.ext = params.ext;
  if (params.sort) query.sort = params.sort;
  return client<BaseResponse<BookItem>>("/books", { query });
};

// We fetch a full upstream results page at a time and let the UI paginate
// client-side, so every single result is reachable (no upstream-page slicing).
const FETCH_PAGE_SIZE = 100;

export const useInfiniteBooksQuery = (params: { query: string; lang: string; content?: string; ext?: string; sort?: string }) =>
  useInfiniteQuery({
    queryKey: ["search-infinite", params],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      try {
        return await getBooks({
          query: params.query,
          lang: params.lang,
          content: params.content,
          ext: params.ext,
          sort: params.sort,
          limit: FETCH_PAGE_SIZE,
          page: pageParam,
        });
      } catch (error) {
        // A 404 just means "no more results" — return an empty page so the infinite
        // query stops cleanly instead of erroring out.
        if (error && typeof error === "object" && "status" in error && (error as { status?: number }).status === 404) {
          return { results: [] } as BaseResponse<BookItem>;
        }
        throw error;
      }
    },
    // A short page is the last page: asking for one more would only buy a 404 from a
    // search budget of 30/min. A full page might have more behind it, so keep going.
    getNextPageParam: (lastPage, allPages) => (lastPage.results.length >= FETCH_PAGE_SIZE ? allPages.length + 1 : undefined),
    enabled: params.query !== "",
    placeholderData: keepPreviousData,
    // Search is the most expensive call we make (the backend scrapes + parses a live
    // upstream results page), so don't re-run an identical query just because the
    // component remounted. Kept under the backend's own 30m cache window.
    staleTime: 5 * 60 * 1000,
  });

/**
 * Resolve one bookmarked / in-progress book from its md5.
 *
 * Cached per md5 rather than per list. That distinction is the whole point: keying a
 * whole collection on its array of md5s means removing a single book mints a brand-new
 * cache key, so every *remaining* book is treated as never-seen and re-fetched. Keyed
 * individually, dropping one book leaves the others' cache entries untouched.
 *
 * An md5 nothing can resolve (removed upstream) yields null rather than throwing, so
 * one dead entry can't blank out the shelf.
 */
/**
 * Cap on how many md5 resolutions are in flight at once.
 *
 * `useQueries` fires every query immediately, which is right for a handful of books and
 * wrong for a large shelf: a 120-bookmark shelf opened 120 simultaneous lookups, and
 * each cold one is a real upstream (libgen) fetch behind the Worker. That's both a
 * self-inflicted rate-limit burst and an amplification we'd rather not point at an
 * upstream we depend on. Eight keeps a cold shelf quick while staying polite; warm
 * lookups resolve from cache and never queue at all.
 */
const MD5_CONCURRENCY = 8;
let inFlight = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= MD5_CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve));
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

export const bookByMd5QueryOptions = (md5: string) =>
  queryOptions({
    queryKey: ["bookByMd5", md5],
    queryFn: async (): Promise<BookItem | null> => {
      try {
        const response = await withSlot(() => getBookByMd5(md5));
        return response.results?.[0] ?? null;
      } catch {
        return null;
      }
    },
    enabled: Boolean(md5),
    // An md5 identifies exact bytes, so a resolved book never changes.
    staleTime: 60 * 60 * 1000,
  });

// Module-level so its identity is stable across renders — TanStack memoises the
// combined result on it, and an inline closure would defeat that.
const combineBooks = (results: { data?: BookItem | null; isLoading: boolean }[]) => ({
  data: results.map((r) => r.data).filter((b): b is BookItem => Boolean(b)),
  isLoading: results.some((r) => r.isLoading),
});

/**
 * Resolve many md5s at once — one independent query each, so the set can change
 * without re-fetching the survivors, and a cold shelf loads in parallel instead of
 * one blocking request after another.
 */
export const useBooksByMd5s = (md5s: string[]) =>
  useQueries({
    queries: md5s.map((md5) => bookByMd5QueryOptions(md5)),
    combine: combineBooks,
  });
