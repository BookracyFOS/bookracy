import { Loader2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useSyncStore } from "@/stores/sync";
import { syncNow } from "@/lib/sync/cloud";
import { cn } from "@/lib/utils";

function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function CloudSyncButton() {
  const enabled = useSyncStore((s) => s.enabled);
  const accountId = useSyncStore((s) => s.accountId);
  const status = useSyncStore((s) => s.status);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);

  // Only relevant once the user has opted in.
  if (!enabled || !accountId) return null;

  const label =
    status === "syncing"
      ? "Syncing to cloud…"
      : status === "error"
        ? "Sync failed — tap to retry"
        : lastSyncedAt
          ? `Synced ${timeAgo(lastSyncedAt)} — tap to sync now`
          : "Tap to sync to cloud";

  return (
    <TooltipProvider disableHoverableContent>
      <Tooltip delayDuration={100}>
        <TooltipTrigger asChild>
          <Button
            onClick={() => void syncNow()}
            disabled={status === "syncing"}
            size="icon"
            aria-label="Sync to cloud"
            className={cn(
              "bg-primary text-primary-foreground hover:bg-primary/90 h-8 w-8 rounded-full",
              status === "error" && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
            )}
          >
            {status === "syncing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
