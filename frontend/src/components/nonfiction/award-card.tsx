import { Card, CardContent } from "@/components/ui/card";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Skeleton } from "@/components/ui/skeleton";
import { BookCover } from "@/components/books/book-cover";
import { cn } from "@/lib/utils";
import { Medal, Search } from "lucide-react";
import { STATUS_LABELS, nonfictionCoverUrl, topCredit, type AwardBook, type AwardStatus } from "@/api/backend/nonfiction/nonfiction";

/**
 * Award placement pill. Outright wins get a gold treatment so the strongest
 * recommendations read at a glance; everything else stays neutral glass, which keeps
 * a wall of cards from turning into a wall of badges.
 */
export function AwardBadge({ status, label, className }: { status: AwardStatus; label: string; className?: string }) {
  const isWin = status === "winner" || status === "co_winner";
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        isWin ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "glass-subtle text-muted-foreground",
        className,
      )}
    >
      {isWin && <Medal className="h-3 w-3 shrink-0" />}
      <span className="truncate">{label}</span>
    </span>
  );
}

/** "Pulitzer Prize · 2019 · Winner" — the single line that justifies the recommendation. */
function creditLine(book: AwardBook): string {
  const credit = topCredit(book);
  if (!credit) return "";
  const parts = [credit.programName];
  if (credit.year) parts.push(String(credit.year));
  parts.push(STATUS_LABELS[credit.status] ?? credit.status);
  return parts.join(" · ");
}

interface CardProps {
  book: AwardBook;
  onSelect: (book: AwardBook) => void;
}

export function AwardGridCard({ book, onSelect }: CardProps) {
  const credit = topCredit(book);
  const byline = book.authors.join(", ");
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => onSelect(book)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(book))}
      aria-label={`Search Bookracy for ${book.title} by ${byline}`}
      className="glass glass-hover focus-visible:ring-primary/50 h-full cursor-pointer overflow-hidden rounded-2xl border-0 p-0 focus-visible:ring-2 focus-visible:outline-none"
    >
      <CardContent className="h-full p-3">
        <div className="flex h-full flex-col gap-3">
          <div className="relative">
            <AspectRatio ratio={10 / 16}>
              <BookCover src={nonfictionCoverUrl(book.id)} alt={book.title} interactive referrerPolicy="no-referrer" showCaption={false} />
            </AspectRatio>
            {credit && <AwardBadge status={credit.status} label={STATUS_LABELS[credit.status] ?? credit.status} className="absolute top-2 left-2 z-10 shadow" />}
          </div>
          <div className="flex min-w-0 flex-col gap-1 px-1">
            <h3 className="line-clamp-2 text-sm font-semibold sm:text-base" title={book.title}>
              {book.title}
            </h3>
            <p className="text-muted-foreground line-clamp-1 text-xs" title={byline}>
              by {byline}
            </p>
            <p className="text-primary/90 line-clamp-2 text-[11px] font-medium" title={creditLine(book)}>
              {creditLine(book)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function AwardRowCard({ book, onSelect }: CardProps) {
  const credit = topCredit(book);
  const byline = book.authors.join(", ");
  // Distinct prizes beyond the one on the badge — several categories of the same
  // award shouldn't read as several awards.
  const otherPrizes = new Set(book.awards.map((a) => a.program)).size - 1;
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => onSelect(book)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(book))}
      aria-label={`Search Bookracy for ${book.title} by ${byline}`}
      className="glass glass-hover focus-visible:ring-primary/50 group h-full cursor-pointer overflow-hidden rounded-2xl border-0 p-0 focus-visible:ring-2 focus-visible:outline-none"
    >
      <CardContent className="flex h-full items-center gap-3 p-3">
        <div className="h-20 w-14 shrink-0 overflow-hidden rounded-md">
          <BookCover src={nonfictionCoverUrl(book.id)} alt={book.title} referrerPolicy="no-referrer" showCaption={false} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="line-clamp-2 text-sm leading-snug font-semibold" title={book.title}>
            {book.title}
          </h3>
          <p className="text-muted-foreground line-clamp-1 text-xs" title={byline}>
            by {byline}
            {book.year ? ` · ${book.year}` : ""}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {credit && <AwardBadge status={credit.status} label={`${credit.programName}${credit.year ? ` ${credit.year}` : ""}`} />}
            {otherPrizes > 0 && <span className="text-muted-foreground text-[11px] whitespace-nowrap">+{otherPrizes} more</span>}
          </div>
        </div>
        <div className="text-primary group-hover:bg-primary/15 flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-2.5 py-1.5 transition-colors">
          <Search className="h-5 w-5" />
          <span className="text-[11px] font-semibold">Find it</span>
        </div>
      </CardContent>
    </Card>
  );
}

export function AwardGridSkeleton() {
  return (
    <Card className="glass overflow-hidden rounded-2xl border-0 p-0">
      <CardContent className="p-3">
        <div className="flex flex-col gap-3">
          <Skeleton className="skeleton-shimmer aspect-10/16 w-full rounded-xl" />
          <div className="flex flex-col gap-2 px-1">
            <Skeleton className="skeleton-shimmer h-5 w-3/4 rounded-md" />
            <Skeleton className="skeleton-shimmer h-3 w-1/2 rounded-md" />
            <Skeleton className="skeleton-shimmer h-3 w-2/3 rounded-md" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function AwardRowSkeleton() {
  return (
    <Card className="glass overflow-hidden rounded-2xl border-0 p-0">
      <CardContent className="flex items-center gap-3 p-3">
        <Skeleton className="skeleton-shimmer h-20 w-14 rounded-md" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="skeleton-shimmer h-4 w-4/5 rounded-md" />
          <Skeleton className="skeleton-shimmer h-3 w-2/5 rounded-md" />
          <Skeleton className="skeleton-shimmer h-4 w-1/3 rounded-full" />
        </div>
        <Skeleton className="skeleton-shimmer h-10 w-11 rounded-xl" />
      </CardContent>
    </Card>
  );
}
