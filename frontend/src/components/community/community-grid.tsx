import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CommunityBookCard } from "./community-card";
import { useViewStore } from "@/stores/view";
import type { CommunityBook } from "@/api/backend/community/community";

export function CommunityGrid({ books }: { books: CommunityBook[] }) {
  const view = useViewStore((s) => s.view);

  if (view === "list") {
    return (
      <div className="flex flex-col gap-3">
        {books.map((book) => (
          <CommunityBookCard key={book.md5} book={book} variant="row" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 xl:grid-cols-4">
      {books.map((book) => (
        <CommunityBookCard key={book.md5} book={book} />
      ))}
    </div>
  );
}

export function CommunityGridSkeleton({ count = 8 }: { count?: number }) {
  const view = useViewStore((s) => s.view);

  if (view === "list") {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: count }).map((_, i) => (
          <Skeleton key={i} className="skeleton-shimmer h-[112px] w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="glass overflow-hidden rounded-2xl border-0 p-0">
          <CardContent className="flex flex-col gap-3 p-3">
            <Skeleton className="skeleton-shimmer aspect-10/16 w-full rounded-xl" />
            <Skeleton className="skeleton-shimmer h-5 w-3/4 rounded-md" />
            <Skeleton className="skeleton-shimmer h-3 w-1/2 rounded-md" />
            <div className="flex gap-1.5">
              <Skeleton className="skeleton-shimmer h-6 w-16 rounded-full" />
              <Skeleton className="skeleton-shimmer h-6 w-12 rounded-full" />
            </div>
            <Skeleton className="skeleton-shimmer h-9 w-full rounded-xl" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
