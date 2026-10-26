import { Sprout, Rocket, Flame, Star, Gem, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Badge } from "@/api/backend/community/community";

// One distinct icon + tint per badge tier (Contributor → Legend), shared by the
// leaderboard and the profile card so the vanity ladder reads consistently.
const TIERS: { icon: LucideIcon; tint: string }[] = [
  { icon: Sprout, tint: "bg-emerald-500/15 text-emerald-400" },
  { icon: Rocket, tint: "bg-sky-500/15 text-sky-400" },
  { icon: Flame, tint: "bg-orange-500/15 text-orange-400" },
  { icon: Star, tint: "bg-amber-500/15 text-amber-400" },
  { icon: Gem, tint: "bg-fuchsia-500/15 text-fuchsia-400" },
];

export function ContributorBadge({ badge, className }: { badge: Badge; className?: string }) {
  const tier = TIERS[badge.tier] ?? TIERS[0];
  const Icon = tier.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold", tier.tint, className)}>
      <Icon className="h-3.5 w-3.5" />
      {badge.label}
    </span>
  );
}
