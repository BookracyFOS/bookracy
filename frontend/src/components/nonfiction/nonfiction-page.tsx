import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/search/search-field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useViewStore } from "@/stores/view";
import { useDebounce } from "@/hooks/use-debounce";
import { cn } from "@/lib/utils";
import { shareLink } from "@/lib/share";
import { AwardGridCard, AwardGridSkeleton, AwardRowCard, AwardRowSkeleton } from "./award-card";
import { SurprisePick } from "./surprise-pick";
import { Award, ChevronLeft, ChevronRight, SearchIcon, Share2, X } from "lucide-react";
import {
  DECADES,
  PAGE_SIZE,
  SORT_OPTIONS,
  STATUS_LABELS,
  nonfictionMetaQueryOptions,
  nonfictionQueryOptions,
  type AwardBook,
  type AwardStatus,
  type NonfictionFilters,
} from "@/api/backend/nonfiction/nonfiction";

// Radix Select can't hold an empty string, so "no filter" needs a sentinel.
const ANY = "all";
const fromAny = (v: string) => (v === ANY ? undefined : v);
const toAny = (v?: string) => v || ANY;

const STATUS_ORDER: AwardStatus[] = ["winner", "finalist", "shortlist", "longlist"];

export interface NonfictionSearch {
  program?: string;
  subject?: string;
  status?: string;
  /** Decade start year. A number so the URL reads `?decade=2010`, not `?decade="2010"`. */
  decade?: number;
  q?: string;
  sort?: string;
  page?: number;
}

/**
 * "Find your next great nonfiction" — a browsable index of prize-winning nonfiction.
 *
 * Entries are metadata-only (the source dataset has no files and no covers of its
 * own), so selecting one hands "Title Author" to the normal Bookracy search, exactly
 * like the curated recommendation lists. Every filter lives in the URL so a shelf like
 * "Pulitzer winners of the 2010s" is a shareable link.
 */
export function NonfictionPage({ search }: { search: NonfictionSearch }) {
  const navigate = useNavigate();
  const view = useViewStore((s) => s.view);

  const { data: meta } = useQuery(nonfictionMetaQueryOptions);
  const debouncedQ = useDebounce(search.q ?? "", 400);

  const filters: NonfictionFilters = useMemo(
    () => ({
      program: search.program,
      subject: search.subject,
      status: search.status,
      decade: search.decade ? String(search.decade) : undefined,
      q: debouncedQ,
      sort: search.sort,
      page: search.page ?? 1,
    }),
    [search.program, search.subject, search.status, search.decade, search.sort, search.page, debouncedQ],
  );

  const { data, isLoading, isFetching, error } = useQuery({
    ...nonfictionQueryOptions(filters),
    // Keeps the previous page on screen while the next one loads instead of blanking
    // the grid — the same no-jarring-reload rule the search results follow.
    placeholderData: keepPreviousData,
  });

  // Any filter change resets to page 1; only the pager itself sets a page.
  const update = (patch: Partial<NonfictionSearch>, keepPage = false) =>
    navigate({
      to: "/nonfiction",
      search: (prev: NonfictionSearch) => {
        const next: NonfictionSearch = { ...prev, ...patch };
        if (!keepPage) delete next.page;
        for (const key of Object.keys(next) as (keyof NonfictionSearch)[]) {
          if (!next[key]) delete next[key];
        }
        return next;
      },
    });

  const openBook = (book: AwardBook) => navigate({ to: "/", search: { q: `${book.title} ${book.authors[0] ?? ""}`.trim() } });

  const books = data?.books ?? [];
  const total = data?.total ?? 0;
  const page = search.page ?? 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(search.program || search.subject || search.status || search.decade || search.q);

  const goToPage = (next: number) => {
    update({ page: next > 1 ? next : undefined }, true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="liquid-orb relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl sm:h-14 sm:w-14">
            <Award className="text-primary relative z-10 h-6 w-6 sm:h-7 sm:w-7" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Find your next great nonfiction</h1>
        </div>
        <p className="text-muted-foreground max-w-3xl text-base sm:text-lg">
          Every book here won or placed in a major nonfiction prize — the Pulitzer, Baillie Gifford, Bancroft, Wolfson, National Book Award and{" "}
          {meta ? `${meta.programs.length - 5} more` : "dozens more"}. Shuffle for a recommendation, or filter down to exactly the kind of book you're in the mood for.
        </p>
      </header>

      <SurprisePick filters={filters} onSelect={openBook} />

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2 sm:gap-3">
            <Select value={toAny(search.program)} onValueChange={(v) => update({ program: fromAny(v) })}>
              <SelectTrigger className="h-11 min-w-[150px]" aria-label="Prize">
                <SelectValue placeholder="Any prize" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Prize</SelectLabel>
                  <SelectItem value={ANY}>Any prize</SelectItem>
                  {(meta?.programs ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.count})
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>

            <Select value={toAny(search.subject)} onValueChange={(v) => update({ subject: fromAny(v) })}>
              <SelectTrigger className="h-11 min-w-[140px]" aria-label="Subject">
                <SelectValue placeholder="Any subject" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Subject</SelectLabel>
                  <SelectItem value={ANY}>Any subject</SelectItem>
                  {(meta?.subjects ?? []).map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>

            <Select value={toAny(search.status)} onValueChange={(v) => update({ status: fromAny(v) })}>
              <SelectTrigger className="h-11 min-w-[130px]" aria-label="Placement">
                <SelectValue placeholder="Any placement" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Placement</SelectLabel>
                  <SelectItem value={ANY}>Any placement</SelectItem>
                  {STATUS_ORDER.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>

            <Select value={search.sort || "acclaimed"} onValueChange={(v) => update({ sort: v === "acclaimed" ? undefined : v })}>
              <SelectTrigger className="h-11 min-w-[140px]" aria-label="Sort">
                <SelectValue placeholder="Most acclaimed" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Sort</SelectLabel>
                  {SORT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="lg:w-72">
            <SearchField
              icon={<SearchIcon className="h-4 w-4" />}
              placeholder="Filter by title or author…"
              value={search.q ?? ""}
              onChange={(next) => update({ q: next || undefined })}
              aria-label="Filter these books by title or author"
              className="border-primary/25 focus-visible:border-primary/50 h-11 rounded-xl"
            />
          </div>
        </div>

        {/* Decades read better as chips than a dropdown — they're the filter people
            actually browse with, and they fit on one line. */}
        <div className="flex flex-wrap items-center gap-2">
          {DECADES.map((d) => {
            const active = search.decade === d;
            return (
              <button
                key={d}
                type="button"
                onClick={() => update({ decade: active ? undefined : d })}
                aria-label={`Books honoured in the ${d}s`}
                aria-pressed={active}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-200 ease-out",
                  active ? "bg-primary text-white" : "glass-subtle text-muted-foreground hover:text-foreground",
                )}
              >
                {d}s
              </button>
            );
          })}
          {hasFilters && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground h-8 gap-1.5 rounded-full px-3 text-xs"
                onClick={() => navigate({ to: "/nonfiction", search: {} })}
              >
                <X className="h-3.5 w-3.5" />
                Clear filters
              </Button>
              {/* Every filter lives in the URL, so "share these" is literally the
                  address bar — worth a button because nobody thinks to copy it. */}
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground h-8 gap-1.5 rounded-full px-3 text-xs"
                onClick={() => shareLink({ url: window.location.href, title: "Prize-winning nonfiction on Bookracy" })}
              >
                <Share2 className="h-3.5 w-3.5" />
                Share these
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm tabular-nums">
          {isLoading ? "Searching…" : `${total.toLocaleString()} book${total === 1 ? "" : "s"}`}
          {isFetching && !isLoading && " · updating"}
        </p>
      </div>

      {error && <p className="text-destructive text-sm">Couldn’t load the prize index. Please try again later.</p>}

      {!isLoading && !error && books.length === 0 && (
        <p className="text-muted-foreground py-10 text-center">No books match these filters. Try clearing one of them.</p>
      )}

      <div
        key={`${view}-${page}`}
        className={cn(
          "animate-in fade-in-0 slide-in-from-bottom-1 gap-4 duration-200 ease-out",
          view === "grid" ? "grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 xl:grid-cols-4" : "grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3",
        )}
      >
        {isLoading
          ? Array.from({ length: 12 }).map((_, i) => (view === "grid" ? <AwardGridSkeleton key={i} /> : <AwardRowSkeleton key={i} />))
          : books.map((book) => (view === "grid" ? <AwardGridCard key={book.id} book={book} onSelect={openBook} /> : <AwardRowCard key={book.id} book={book} onSelect={openBook} />))}
      </div>

      {!isLoading && totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button variant="outline" size="sm" className="gap-1" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <span className="text-muted-foreground text-sm tabular-nums">
            Page {page} of {totalPages.toLocaleString()}
          </span>
          <Button variant="outline" size="sm" className="gap-1" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      <p className="text-muted-foreground border-border/50 border-t pt-4 text-xs">
        Prize data from the{" "}
        <a href="https://book-prize-index.vercel.app" target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline">
          Book Prize Index
        </a>{" "}
        (CC BY 4.0){meta?.version ? `, dataset ${meta.version}` : ""}. Cover art from Apple Books.
      </p>
    </div>
  );
}
