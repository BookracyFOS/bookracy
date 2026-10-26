import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BookCover } from "@/components/books/book-cover";
import { AwardBadge } from "./award-card";
import { Dices, RefreshCw, Search, Sparkles } from "lucide-react";
import { STATUS_LABELS, nonfictionCoverUrl, randomNonfictionQueryOptions, type AwardBook, type NonfictionFilters } from "@/api/backend/nonfiction/nonfiction";

/**
 * The "just tell me what to read" answer: one random prize-winning book, honouring
 * whatever filters are active. This is the whole point of the page — browsing 9,500
 * books is a research task, being handed one great book is a recommendation.
 */
export function SurprisePick({ filters, onSelect }: { filters: NonfictionFilters; onSelect: (book: AwardBook) => void }) {
  const { data, isFetching, isError, refetch } = useQuery(randomNonfictionQueryOptions(filters));
  const book = data?.book ?? null;
  // The backend already resolved the artwork while picking; fall back to the per-book
  // cover route only if it somehow came back empty.
  const cover = data?.cover || (book ? nonfictionCoverUrl(book.id) : "");

  return (
    <Card className="glass-strong relative overflow-hidden rounded-2xl border-0 p-0">
      {/* ambient wash so the hero reads as a distinct surface from the result grid */}
      <div aria-hidden className="bg-primary/20 pointer-events-none absolute -top-24 -right-16 h-56 w-56 rounded-full blur-3xl" />

      <CardContent className="relative p-4 sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <Sparkles className="text-primary h-4 w-4 shrink-0" />
          <h2 className="text-sm font-semibold tracking-wide uppercase">Your next read</h2>
        </div>

        {!book && isFetching ? (
          <SurpriseSkeleton />
        ) : isError ? (
          // "No winners match" would blame the reader's filters for what is really a
          // failed request — the difference matters most when they're simply offline.
          <div className="flex flex-col items-start gap-3 py-4">
            <p className="text-muted-foreground text-sm">We couldn’t reach the prize index. Check your connection and try again.</p>
            <Button variant="outline" className="gap-2 rounded-xl" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              Try again
            </Button>
          </div>
        ) : !book ? (
          <p className="text-muted-foreground py-6 text-sm">No award winners match these filters. Try widening them.</p>
        ) : (
          <div className="flex flex-col gap-5 sm:flex-row sm:gap-6">
            <button
              type="button"
              onClick={() => onSelect(book)}
              aria-label={`Search Bookracy for ${book.title}`}
              className="focus-visible:ring-primary/50 mx-auto h-44 w-30 shrink-0 cursor-pointer overflow-hidden rounded-xl shadow-lg transition-transform duration-200 ease-out hover:scale-[1.03] focus-visible:ring-2 focus-visible:outline-none sm:mx-0 sm:h-52 sm:w-35"
            >
              <BookCover src={cover} alt={book.title} referrerPolicy="no-referrer" showCaption={false} />
            </button>

            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <h3 className="text-xl leading-tight font-bold tracking-tight sm:text-2xl">{book.title}</h3>
                <p className="text-muted-foreground text-sm">
                  by {book.authors.join(", ")}
                  {book.year ? ` · ${book.year}` : ""}
                  {book.subject ? ` · ${book.subject}` : ""}
                </p>
              </div>

              {/* Every accolade, not just the top one — the case for reading it. */}
              <div className="flex flex-wrap gap-1.5">
                {book.awards.slice(0, 4).map((credit, i) => (
                  <AwardBadge
                    key={`${credit.program}-${credit.year}-${i}`}
                    status={credit.status}
                    label={`${credit.programName}${credit.year ? ` ${credit.year}` : ""} · ${STATUS_LABELS[credit.status] ?? credit.status}`}
                  />
                ))}
                {book.awards.length > 4 && <span className="text-muted-foreground self-center text-[11px]">+{book.awards.length - 4} more</span>}
              </div>

              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                <Button className="gap-2 rounded-xl" onClick={() => onSelect(book)}>
                  <Search className="h-4 w-4" />
                  Find it on Bookracy
                </Button>
                <Button variant="outline" className="gap-2 rounded-xl" onClick={() => refetch()} disabled={isFetching}>
                  <Dices className={`h-4 w-4 transition-transform duration-500 ease-out ${isFetching ? "rotate-180" : ""}`} />
                  Shuffle
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SurpriseSkeleton() {
  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:gap-6">
      <Skeleton className="skeleton-shimmer mx-auto h-44 w-30 shrink-0 rounded-xl sm:mx-0 sm:h-52 sm:w-35" />
      <div className="flex flex-1 flex-col gap-3">
        <Skeleton className="skeleton-shimmer h-7 w-3/4 rounded-md" />
        <Skeleton className="skeleton-shimmer h-4 w-1/2 rounded-md" />
        <div className="flex gap-1.5">
          <Skeleton className="skeleton-shimmer h-5 w-32 rounded-full" />
          <Skeleton className="skeleton-shimmer h-5 w-28 rounded-full" />
        </div>
        <div className="mt-auto flex gap-2 pt-1">
          <Skeleton className="skeleton-shimmer h-9 w-40 rounded-xl" />
          <Skeleton className="skeleton-shimmer h-9 w-28 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
