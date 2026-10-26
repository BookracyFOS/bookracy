import { AlertCircle, Check, Download, Loader2, RotateCcw, Trash2, X } from "lucide-react";
import { Button } from "../ui/button";
import { Progress } from "../ui/progress";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/download";
import { DownloadItem, ZipJob, useDownloadQueueStore } from "@/stores/download-queue";

function StatusIcon({ status }: { status: DownloadItem["status"] }) {
  switch (status) {
    case "done":
      return <Check className="h-4 w-4 shrink-0 text-green-500" />;
    case "error":
      return <AlertCircle className="text-destructive h-4 w-4 shrink-0" />;
    case "downloading":
      return <Loader2 className="text-primary h-4 w-4 shrink-0 animate-spin" />;
    case "canceled":
      return <X className="text-muted-foreground h-4 w-4 shrink-0" />;
    default:
      return <Download className="text-muted-foreground h-4 w-4 shrink-0" />;
  }
}

function subline(item: DownloadItem): string {
  switch (item.status) {
    case "downloading":
      if (item.percent != null) return `${Math.round(item.percent)}% · ${formatBytes(item.receivedBytes)}${item.totalBytes ? ` / ${formatBytes(item.totalBytes)}` : ""}`;
      return `${formatBytes(item.receivedBytes)} downloaded…`;
    case "done":
      return "Saved";
    case "error":
      return item.error || "Failed";
    case "canceled":
      return "Canceled";
    default:
      return "Queued";
  }
}

export function QueueRow({ item }: { item: DownloadItem }) {
  const remove = useDownloadQueueStore((s) => s.remove);
  const retry = useDownloadQueueStore((s) => s.retry);
  const cancel = useDownloadQueueStore((s) => s.cancel);

  const isActive = item.status === "queued" || item.status === "downloading";
  const canRetry = item.status === "error" || item.status === "canceled";

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <StatusIcon status={item.status} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={item.title}>
            {item.title}
          </p>
          <p className={cn("truncate text-xs", item.status === "error" ? "text-destructive" : "text-muted-foreground")}>{subline(item)}</p>
        </div>
        {canRetry && (
          <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label="Retry download" onClick={() => retry(item.md5)}>
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
        {isActive ? (
          <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label="Cancel download" onClick={() => cancel(item.md5)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button size="icon" variant="ghost" className="text-muted-foreground h-7 w-7 shrink-0" aria-label="Remove from list" onClick={() => remove(item.md5)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {item.status === "downloading" && <Progress value={item.percent ?? 0} className={cn("h-1", item.percent == null && "animate-pulse")} />}
    </div>
  );
}

function zipSubline(zip: ZipJob): string {
  switch (zip.status) {
    case "downloading":
      return `Downloading ${Math.min(zip.done + 1, zip.total)} of ${zip.total}${zip.currentTitle ? ` · ${zip.currentTitle}` : ""}`;
    case "zipping":
      return "Compressing…";
    case "done":
      return `Saved · ${zip.done} file${zip.done !== 1 ? "s" : ""}${zip.failed ? `, ${zip.failed} failed` : ""}`;
    case "error":
      return zip.error || "Failed";
  }
}

export function ZipRow({ zip }: { zip: ZipJob }) {
  const cancelZip = useDownloadQueueStore((s) => s.cancelZip);
  const clearZip = useDownloadQueueStore((s) => s.clearZip);
  const busy = zip.status === "downloading" || zip.status === "zipping";

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        {zip.status === "done" ? (
          <Check className="h-4 w-4 shrink-0 text-green-500" />
        ) : zip.status === "error" ? (
          <AlertCircle className="text-destructive h-4 w-4 shrink-0" />
        ) : (
          <Loader2 className="text-primary h-4 w-4 shrink-0 animate-spin" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            ZIP archive · {zip.total} book{zip.total !== 1 ? "s" : ""}
          </p>
          <p className={cn("truncate text-xs", zip.status === "error" ? "text-destructive" : "text-muted-foreground")}>{zipSubline(zip)}</p>
        </div>
        {busy ? (
          <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label="Cancel zip" onClick={cancelZip}>
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button size="icon" variant="ghost" className="text-muted-foreground h-7 w-7 shrink-0" aria-label="Dismiss zip" onClick={clearZip}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {busy && <Progress value={zip.percent} className="h-1" />}
    </div>
  );
}
