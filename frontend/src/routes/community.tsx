import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { communityUploadsInfiniteOptions, type UploadSort } from "@/api/backend/community/community";
import { CommunityGrid, CommunityGridSkeleton } from "@/components/community/community-grid";
import { LeaderboardPanel } from "@/components/community/leaderboard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SlidingTabs } from "@/components/ui/sliding-tabs";
import { BookUp, Clock, Crown, Flame, LibraryBig, type LucideIcon, Users } from "lucide-react";

type Tab = "library" | "leaderboard";

export const Route = createFileRoute("/community")({
  component: Community,
  // Deep-linkable tab (e.g. /community?tab=leaderboard). Optional → links to
  // /community don't need to pass it; absent means the default "library" tab.
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => (search.tab === "leaderboard" ? { tab: "leaderboard" } : {}),
});

const TABS: { value: Tab; label: string; icon: LucideIcon }[] = [
  { value: "library", label: "Library", icon: LibraryBig },
  { value: "leaderboard", label: "Leaderboard", icon: Crown },
];

const SORTS: { value: UploadSort; label: string; icon: LucideIcon }[] = [
  { value: "recent", label: "Newest", icon: Clock },
  { value: "popular", label: "Most downloaded", icon: Flame },
];

function Community() {
  const { tab } = Route.useSearch();
  const activeTab: Tab = tab ?? "library";
  const navigate = useNavigate({ from: Route.fullPath });
  const [sort, setSort] = useState<UploadSort>("recent");
  const { data, isLoading, error, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteQuery(communityUploadsInfiniteOptions(sort));
  const books = data?.pages.flatMap((p) => p.uploads) ?? [];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="flex items-center gap-3 text-4xl font-bold tracking-tight">
            <Users className="text-primary h-8 w-8" />
            Community
          </h1>
          <p className="text-muted-foreground max-w-2xl text-base sm:text-lg">Books shared by readers — and the contributors behind them.</p>
        </div>
        <Button asChild className="gap-2">
          <Link to="/upload">
            <BookUp className="h-4 w-4" />
            Upload a book
          </Link>
        </Button>
      </div>

      <SlidingTabs
        value={activeTab}
        onValueChange={(t) => navigate({ search: t === "leaderboard" ? { tab: "leaderboard" } : {} })}
        options={TABS}
        className="glass w-fit rounded-2xl p-1"
        indicatorClassName="rounded-xl bg-primary shadow-sm"
        tabClassName="gap-2 rounded-xl px-4 py-2 text-sm"
        activeTabClassName="text-white"
      />

      {/* keyed so each tab switch replays a clean fade/rise instead of snapping */}
      <div key={activeTab} className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-out">
        {activeTab === "leaderboard" ? (
          <LeaderboardPanel />
        ) : (
          <div className="flex flex-col gap-5">
            <SlidingTabs
              value={sort}
              onValueChange={setSort}
              options={SORTS}
              className="bg-muted/50 w-fit rounded-lg p-0.5"
              indicatorClassName="rounded-md bg-background shadow-sm"
              tabClassName="gap-1.5 rounded-md px-3 py-1.5 text-sm"
              iconClassName="h-3.5 w-3.5"
            />

            {error && <p className="text-destructive text-sm">Couldn't load community uploads. Please try again later.</p>}

            {isLoading ? (
              <CommunityGridSkeleton />
            ) : books.length === 0 ? (
              <Card className="glass rounded-2xl border-dashed">
                <CardContent className="text-muted-foreground flex flex-col items-center gap-3 py-14 text-center text-sm">
                  <BookUp className="text-primary/50 h-10 w-10" />
                  <p>No community uploads yet. Be the first to share a book!</p>
                  <Button asChild variant="outline" size="sm" className="gap-2">
                    <Link to="/upload">
                      <BookUp className="h-4 w-4" />
                      Upload a book
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <>
                <CommunityGrid books={books} />
                {hasNextPage && (
                  <div className="flex justify-center pt-2">
                    <Button variant="outline" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage} className="gap-2">
                      {isFetchingNextPage ? "Loading…" : "Load more"}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
