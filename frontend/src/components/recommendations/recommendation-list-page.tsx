import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { recommendationListQueryOptions, type GreatestBook } from "@/api/backend/recommendations/greatest-books";
import { findRecommendationList } from "@/lib/recommendation-lists";
import { Card, CardContent } from "@/components/ui/card";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Skeleton } from "@/components/ui/skeleton";
import { BookCover } from "@/components/books/book-cover";
import { useViewStore } from "@/stores/view";
import { Search, Trophy } from "lucide-react";

/**
 * Renders one curated recommendation list (e.g. "The Greatest Books"). The list `id`
 * comes from the route file; title/blurb are looked up from the shared config. Cards
 * are intentionally light — clicking one hands "Title Author" to the existing Search.
 * Honors the global list/grid view preference (navbar ViewToggle) like every other
 * book collection in the app.
 */
export function RecommendationListPage({ id }: { id: string }) {
  const navigate = useNavigate();
  const meta = findRecommendationList(id);
  const view = useViewStore((s) => s.view);
  const { data, isLoading, error } = useQuery(recommendationListQueryOptions(id));

  const openBook = (book: GreatestBook) => navigate({ to: "/", search: { q: `${book.title} ${book.author}` } });
  const books = data?.recommendations ?? [];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-3 text-4xl font-bold tracking-tight">
          <Trophy className="text-primary h-8 w-8" />
          {meta?.title ?? "Recommendations"}
        </h1>
        <p className="text-muted-foreground max-w-2xl text-base sm:text-lg">
          {meta?.blurb} Ranked by{" "}
          <a href="https://thegreatestbooks.org" target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline">
            thegreatestbooks.org
          </a>
          . Click any title to find and download it on Bookracy.
        </p>
      </div>

      {error && <p className="text-destructive text-sm">Couldn’t load recommendations. Please try again later.</p>}

      {view === "grid" ? (
        <div className="grid grid-cols-2 gap-4 sm:gap-8 md:grid-cols-3 xl:grid-cols-4">
          {isLoading
            ? Array.from({ length: 16 }).map((_, i) => <SkeletonGridCard key={i} />)
            : books.map((book) => <RecommendationCard key={book.sourceId} book={book} onClick={() => openBook(book)} />)}
        </div>
      ) : (
        // Recommendation rows are intentionally light (just title/author/cover), so a
        // single full-width row leaves a sea of empty space. A dense 3-up layout of
        // compact glass cards fills it cleanly — without resolving every book upfront.
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {isLoading
            ? Array.from({ length: 12 }).map((_, i) => <SkeletonRow key={i} />)
            : books.map((book) => <RecommendationRow key={book.sourceId} book={book} onClick={() => openBook(book)} />)}
        </div>
      )}
    </div>
  );
}

function RankBadge({ rank, className }: { rank: number; className?: string }) {
  return <span className={`bg-primary rounded-full px-2 py-0.5 text-xs font-semibold text-white tabular-nums shadow ${className ?? ""}`}>#{rank}</span>;
}

function RecommendationCard({ book, onClick }: { book: GreatestBook; onClick: () => void }) {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick())}
      aria-label={`Search Bookracy for ${book.title} by ${book.author}`}
      className="glass glass-hover focus-visible:ring-primary/50 h-full cursor-pointer overflow-hidden rounded-2xl border-0 p-0 focus-visible:ring-2 focus-visible:outline-none"
    >
      <CardContent className="h-full p-3">
        <div className="flex h-full flex-col gap-3">
          <div className="relative">
            <AspectRatio ratio={10 / 16}>
              <BookCover src={book.cover} alt={book.title} interactive referrerPolicy="no-referrer" showCaption={false} />
            </AspectRatio>
            <RankBadge rank={book.rank} className="absolute top-2 left-2 z-10" />
          </div>
          <div className="flex flex-col gap-1 px-1">
            <h2 className="line-clamp-2 text-sm font-semibold sm:text-base" title={book.title}>
              {book.title}
            </h2>
            <p className="text-muted-foreground line-clamp-1 text-xs" title={book.author}>
              by {book.author}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RecommendationRow({ book, onClick }: { book: GreatestBook; onClick: () => void }) {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick())}
      aria-label={`Search Bookracy for ${book.title} by ${book.author}`}
      className="glass glass-hover focus-visible:ring-primary/50 group h-full cursor-pointer overflow-hidden rounded-2xl border-0 p-0 focus-visible:ring-2 focus-visible:outline-none"
    >
      <CardContent className="flex h-full items-center gap-3 p-3">
        <div className="relative h-16 w-11 shrink-0 overflow-hidden rounded-md">
          <BookCover src={book.cover} alt={book.title} referrerPolicy="no-referrer" showCaption={false} />
          <span className="bg-primary absolute top-1 left-1 z-10 rounded-full px-1.5 text-[10px] font-bold text-white tabular-nums shadow">{book.rank}</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="line-clamp-2 text-sm leading-snug font-semibold" title={book.title}>
            {book.title}
          </h2>
          <p className="text-muted-foreground line-clamp-1 text-xs" title={book.author}>
            by {book.author}
          </p>
        </div>
        <div className="text-primary group-hover:bg-primary/15 flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-2.5 py-1.5 transition-colors">
          <Search className="h-5 w-5" />
          <span className="text-[11px] font-semibold">Find it</span>
        </div>
      </CardContent>
    </Card>
  );
}

function SkeletonGridCard() {
  return (
    <Card className="glass overflow-hidden rounded-2xl border-0 p-0">
      <CardContent className="p-3">
        <div className="flex flex-col gap-3">
          <Skeleton className="skeleton-shimmer aspect-10/16 w-full rounded-xl" />
          <div className="flex flex-col gap-2 px-1">
            <Skeleton className="skeleton-shimmer h-5 w-3/4 rounded-md" />
            <Skeleton className="skeleton-shimmer h-3 w-1/2 rounded-md" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SkeletonRow() {
  return (
    <Card className="glass overflow-hidden rounded-2xl border-0 p-0">
      <CardContent className="flex items-center gap-3 p-3">
        <Skeleton className="skeleton-shimmer h-16 w-11 rounded-md" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="skeleton-shimmer h-4 w-4/5 rounded-md" />
          <Skeleton className="skeleton-shimmer h-3 w-2/5 rounded-md" />
        </div>
        <Skeleton className="skeleton-shimmer h-9 w-10 rounded-xl" />
      </CardContent>
    </Card>
  );
}
