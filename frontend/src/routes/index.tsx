import { useInfiniteBooksQuery } from "@/api/backend/search/search";
import { SkeletonBookItem, SkeletonBookItemGrid } from "@/components/books/book-item";
import { useDebounce } from "@/hooks/use-debounce";
import { useSettingsStore } from "@/stores/settings";
import { createFileRoute, useNavigate, useRouter, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Download, FileArchive, Info, ListChecks, Loader2, TrendingUp } from "lucide-react";
import { useSelectionStore } from "@/stores/selection";
import { useBulkDownload } from "@/hooks/use-bulk-download";
import { useState, useMemo, useEffect } from "react";
import { Filters, SearchFilters, filterToParam, FILTER_DEFAULTS } from "@/components/books/filters";
import { BookList } from "@/components/books/book-list";
import { BookGallery } from "@/components/books/book-gallery";
import { ContinueReading } from "@/components/books/continue-reading";
import { ChartGenres } from "@/components/books/chart-genres";
import { SearchWithSuggestions } from "@/components/books/search-suggestions";
import { useViewStore } from "@/stores/view";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { trendingQueryOptions } from "@/api/backend/trending/trending";

export const Route = createFileRoute("/")({
  component: Index,
  validateSearch: (search): { q: string; content?: string; ext?: string } => {
    // Whitelist of accepted filter param names, so an arbitrary `?ext=` from an old
    // bookmark can't smuggle a garbage value into the search UI. Values themselves are
    // still re-validated by the backend before hitting AA/libgen. content/ext are kept
    // optional so navigate({ to: "/", search: { q } }) at existing call sites still
    // typechecks without changes — reading-order pages opt-in to the filter explicitly.
    const toStr = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
    const out: { q: string; content?: string; ext?: string } = {
      q: typeof search.q === "string" ? search.q : search.q == null ? "" : String(search.q),
    };
    const content = toStr(search.content);
    const ext = toStr(search.ext);
    if (content) out.content = content;
    if (ext) out.ext = ext;
    return out;
  },
});

function Index() {
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();
  const { q, content: contentParam, ext: extParam } = Route.useSearch();

  // Typing rewrites the URL's `q` in place. Every keystroke used to PUSH a history
  // entry, so after typing "dune" the Back button walked "dun" → "du" → "d" instead of
  // leaving the search — measured 4 entries for a 4-letter query. It also replaced the
  // whole search object, so a `content`/`ext` filter that arrived in the URL (the
  // reading-order pages link to "comics, cbz only") vanished on the first keystroke.
  // Replace, and carry the other params along. The first keystroke from an empty box
  // still pushes, so Back from a results page returns to the plain homepage.
  const setQuery = (next: string) => navigate({ search: (prev) => ({ ...prev, q: next }), replace: Boolean(q) });

  const view = useViewStore((state) => state.view);
  const addSelection = useSelectionStore((state) => state.add);
  const bulkActive = useSelectionStore((state) => state.active);
  const { download: bulkDownload, format: bulkFormat } = useBulkDownload();
  const [perPage, setPerPage] = useState(10);

  const language = useSettingsStore((state) => state.language);
  const setLanguage = useSettingsStore((state) => state.setLanguage);
  const bulkDownloadEnabled = useSettingsStore((state) => state.bulkDownload);
  const debouncedQ = useDebounce(q, 500);
  const isDebouncing = q !== debouncedQ;
  const [page, setPage] = useState(1);

  // Search facets (validated server-side). Type and format live in the URL, so the
  // Marvel/DC reading-order pages can link straight to "comic books, cbz/cbr only", a
  // shared link lands on the same results, and reload keeps what's on screen. These
  // used to be copied into state once on mount, which meant the URL and the filters
  // disagreed as soon as either changed. Sort stays a local preference.
  const contentType = contentParam || FILTER_DEFAULTS.contentType;
  const fileType = extParam || FILTER_DEFAULTS.fileType;
  const setContentType = (next: string) => navigate({ search: (prev) => ({ ...prev, content: filterToParam(next) || undefined }), replace: true });
  const setFileType = (next: string) => navigate({ search: (prev) => ({ ...prev, ext: filterToParam(next) || undefined }), replace: true });
  const [sort, setSort] = useState<string>(FILTER_DEFAULTS.sort);

  // A new query, filter or page size always starts over from page 1.
  useEffect(() => {
    setPage(1);
  }, [debouncedQ, language, perPage, contentType, fileType, sort]);

  // Fetch a full upstream results page at a time and paginate CLIENT-SIDE, so every
  // result is reachable (no upstream-page slicing). keepPreviousData avoids flashes.
  const {
    data: infiniteData,
    error: searchError,
    isLoading: isSearchLoading,
    isFetching: isSearchFetching,
    isPlaceholderData,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteBooksQuery({
    query: debouncedQ,
    lang: filterToParam(language) ?? "",
    content: filterToParam(contentType),
    ext: filterToParam(fileType),
    sort: filterToParam(sort),
  });

  // Dedupe by md5 across upstream pages: the backend only dedupes within a page, and
  // a repeat on page 2 would otherwise render twice (and warn about duplicate keys).
  const allResults = useMemo(() => {
    const seen = new Set<string>();
    return (infiniteData?.pages.flatMap((p) => p.results) ?? []).filter((b) => !seen.has(b.md5) && Boolean(seen.add(b.md5)));
  }, [infiniteData]);
  const pageResults = useMemo(() => allResults.slice((page - 1) * perPage, page * perPage), [allResults, page, perPage]);
  const hasNext = page * perPage < allResults.length || hasNextPage;

  const goToNextPage = async () => {
    // Pull another upstream page only if we don't already have enough loaded. If that
    // page comes back empty (the backend answers 404 for "no more"), stay put: paging
    // forward regardless used to land on a blank "Page N" with no list and no message.
    if ((page + 1) * perPage > allResults.length) {
      if (!hasNextPage) return;
      const { data } = await fetchNextPage();
      const last = data?.pages[data.pages.length - 1];
      if (!last?.results.length) return;
    }
    setPage((p) => p + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const goToPrevPage = () => {
    setPage((p) => Math.max(1, p - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Every download link now resolves multi-source through our Worker, so results go
  // straight to the UI — no per-book external-download probing needed.
  const displayBooks = pageResults;

  const downloadPage = () => bulkDownload(displayBooks);

  // Bestseller charts, live from Apple Books and resolved to real downloadable books.
  // keepPreviousData holds the current shelf on screen while another genre loads, so
  // switching a chip never blanks the page.
  const [chartGenre, setChartGenre] = useState("");
  const {
    data: trendingBooksData,
    isLoading: isChartLoading,
    isFetching: isChartFetching,
  } = useQuery({ ...trendingQueryOptions(chartGenre), placeholderData: keepPreviousData });

  const categories = useMemo(() => Object.keys(trendingBooksData ?? {}), [trendingBooksData]);
  const chartIsEmpty = !isChartLoading && categories.every((c) => (trendingBooksData?.[c]?.length ?? 0) === 0);

  // A second search used to show no loading state at all: keepPreviousData keeps the
  // old list on screen and `isLoading` is false whenever placeholder data exists, so
  // "harry potter" results sat there for the whole "dune" scrape — and if the previous
  // query had no results, "No results for dune" showed while dune was still loading.
  const isSearching = Boolean(q) && (isSearchLoading || isDebouncing || (isPlaceholderData && isSearchFetching));
  const searchErrorMessage =
    searchError && "status" in searchError && searchError.status === 429
      ? "You're searching a little too fast — give it a minute and try again."
      : searchError?.message;

  // A shared search should land the recipient on the same results, so the facets that
  // the route can restore (type + format) ride along with the query. Sort, language
  // and page size stay personal preferences.
  const shareTarget = useMemo(() => {
    if (!q.trim()) return null;
    const params = new URLSearchParams({ q });
    const content = filterToParam(contentType);
    const ext = filterToParam(fileType);
    if (content) params.set("content", content);
    if (ext) params.set("ext", ext);
    const origin = typeof window !== "undefined" ? window.location.origin : "https://bookracy.com";
    // Serialise through the router so the link reads back exactly as written: the
    // route JSON-parses search values, so a hand-built `?q=1e3` opened as "1000".
    const href = router.buildLocation({ to: "/", search: { q, content: params.get("content") || undefined, ext: params.get("ext") || undefined } }).href;
    return { url: `${origin}${href}`, title: `“${q}” on Bookracy`, text: `“${q}” on Bookracy` };
  }, [q, contentType, fileType, router]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <h1 className="text-4xl font-bold tracking-tight">
          Welcome to <span className="text-primary">Bookracy</span>
        </h1>
        <div className="text-muted-foreground flex flex-col gap-2">
          <p className="max-w-2xl text-base sm:text-lg">A free and open-source home for reading and downloading your favourite books, comics and manga. Search below, or explore using the sidebar.</p>
          <Button variant="outline" size="sm" asChild className="w-fit gap-2">
            <Link to="/about">
              <Info className="h-4 w-4" />
              About us
            </Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <SearchWithSuggestions
          value={q}
          onChange={setQuery}
          share={shareTarget}
          placeholder="Search for books, comics, or manga…"
          className="border-primary/25 bg-background/50 focus-visible:border-primary/50 h-14 rounded-2xl border text-base shadow-sm backdrop-blur-md transition-colors sm:text-lg"
        />

        {q && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <SearchFilters
                language={language}
                setLanguage={setLanguage}
                contentType={contentType}
                setContentType={setContentType}
                fileType={fileType}
                setFileType={setFileType}
                sort={sort}
                setSort={setSort}
              />
              <Filters perPage={perPage} setPerPage={setPerPage} />
            </div>

            {isSearching && (
              <div className={view === "grid" ? "grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 xl:grid-cols-4" : "flex flex-col gap-4"}>
                {Array.from({ length: perPage }).map((_, i) => (view === "grid" ? <SkeletonBookItemGrid key={i} /> : <SkeletonBookItem key={i} />))}
              </div>
            )}
            {searchError && <p className="text-destructive text-sm">Something went wrong: {searchErrorMessage}</p>}

            {!isSearching && !searchError && allResults.length === 0 && <p className="text-muted-foreground py-8 text-center">No results for “{debouncedQ}”. Try a different title or author.</p>}

            {!isSearching && pageResults.length > 0 && bulkDownloadEnabled && bulkActive && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-muted-foreground text-sm tabular-nums">
                  {allResults.length} result{allResults.length !== 1 ? "s" : ""} loaded
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => addSelection(displayBooks)}>
                    <ListChecks className="h-4 w-4" />
                    Select page
                  </Button>
                  <Button size="sm" className="gap-2" onClick={downloadPage}>
                    {bulkFormat === "zip" ? <FileArchive className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                    {bulkFormat === "zip" ? "Zip page" : "Download page"}
                  </Button>
                </div>
              </div>
            )}

            {!isSearching && pageResults.length > 0 && view === "list" && <BookList books={displayBooks} fallbackChain />}
            {!isSearching && pageResults.length > 0 && view === "grid" && <BookGallery books={displayBooks} fallbackChain />}

            {!isSearching && allResults.length > 0 && (
              <div className="flex items-center justify-center gap-3 pt-2">
                <Button variant="outline" size="sm" className="gap-1" disabled={page <= 1 || isFetchingNextPage} onClick={goToPrevPage}>
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <span className="text-muted-foreground flex items-center gap-2 text-sm tabular-nums">
                  {isFetchingNextPage && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Page {page}
                </span>
                <Button variant="outline" size="sm" className="gap-1" disabled={!hasNext || isFetchingNextPage} onClick={goToNextPage}>
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        )}

        {!q && <ContinueReading />}

        {!q && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                <TrendingUp className="text-primary h-6 w-6" />
                Trending now
                {isChartFetching && !isChartLoading && <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />}
              </div>
              <ChartGenres value={chartGenre} onChange={setChartGenre} />
            </div>

            {isChartLoading && (
              <div className={view === "grid" ? "grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 xl:grid-cols-4" : "flex flex-col gap-4"}>
                {Array.from({ length: view === "grid" ? 8 : 4 }).map((_, i) => (view === "grid" ? <SkeletonBookItemGrid key={i} /> : <SkeletonBookItem key={i} />))}
              </div>
            )}

            {chartIsEmpty && <p className="text-muted-foreground py-8 text-center">This chart isn’t available right now. Try another genre.</p>}

            {/* The backend keys each shelf by its label, but the active genre chip
                already names the chart — a heading here would just repeat it. */}
            {categories.map((category: string) => {
              const books = trendingBooksData?.[category] ?? [];
              if (books.length === 0) return null;
              return (
                <div key={category} className="animate-in fade-in-0 duration-200 ease-out">
                  {view === "grid" ? <BookGallery books={books} /> : <BookList books={books} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
