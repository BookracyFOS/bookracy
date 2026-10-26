import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ArrowDownToLine, Award, BookCopy, Crown, Medal, Trophy, type LucideIcon } from "lucide-react";
import { leaderboardQueryOptions, uidForAccount, type LeaderboardEntry } from "@/api/backend/community/community";
import { ContributorBadge } from "./contributor-badge";
import { useSyncStore } from "@/stores/sync";

// Distinct medal per podium place; everyone else just shows their number.
const PODIUM: Record<number, { icon: LucideIcon; tint: string }> = {
  1: { icon: Trophy, tint: "text-amber-400" },
  2: { icon: Medal, tint: "text-zinc-300" },
  3: { icon: Award, tint: "text-amber-700" },
};

function Row({ entry, isYou }: { entry: LeaderboardEntry; isYou: boolean }) {
  const podium = PODIUM[entry.rank];
  const PodiumIcon = podium?.icon;
  return (
    <div className={cn("glass flex items-center gap-3 rounded-2xl p-3 transition-colors", isYou && "border-primary/50 ring-primary/30 ring-1")}>
      <div className={cn("flex w-9 shrink-0 items-center justify-center text-base font-bold tabular-nums", podium?.tint ?? "text-muted-foreground")}>
        {PodiumIcon ? <PodiumIcon className="h-5 w-5" /> : entry.rank}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold">{entry.name}</span>
          {isYou && <span className="text-primary text-[11px] font-semibold">(you)</span>}
        </div>
        <ContributorBadge badge={entry.badge} />
      </div>
      <div className="text-muted-foreground flex shrink-0 flex-col items-end gap-0.5 text-xs tabular-nums">
        <span className="text-foreground inline-flex items-center gap-1 font-semibold">
          <ArrowDownToLine className="h-3.5 w-3.5" />
          {entry.downloads.toLocaleString()}
        </span>
        <span className="inline-flex items-center gap-1">
          <BookCopy className="h-3 w-3" />
          {entry.books} {entry.books === 1 ? "book" : "books"}
        </span>
      </div>
    </div>
  );
}

/** The leaderboard content (no page chrome) — rendered inside the Community tabs. */
export function LeaderboardPanel() {
  const { data, isLoading, error } = useQuery(leaderboardQueryOptions());
  const accountId = useSyncStore((s) => s.accountId);
  const [myUid, setMyUid] = useState<string | null>(null);

  useEffect(() => {
    if (accountId) uidForAccount(accountId).then(setMyUid);
    else setMyUid(null);
  }, [accountId]);

  const entries = data?.leaderboard ?? [];

  if (error) return <p className="text-destructive text-sm">Couldn't load the leaderboard. Please try again later.</p>;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="skeleton-shimmer h-[68px] w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <Card className="glass rounded-2xl border-dashed">
        <CardContent className="text-muted-foreground flex flex-col items-center gap-3 py-12 text-center text-sm">
          <Crown className="text-primary/50 h-10 w-10" />
          No contributors yet — be the first to upload a book!
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry) => (
        <Row key={entry.uid} entry={entry} isYou={Boolean(myUid && myUid === entry.uid)} />
      ))}
    </div>
  );
}
