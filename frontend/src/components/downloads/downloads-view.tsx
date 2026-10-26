import { DownloadCloud, Pause, Play, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { useDownloadQueueStore } from "@/stores/download-queue";
import { useSettingsStore } from "@/stores/settings";
import { QueueRow, ZipRow } from "./queue-rows";

/** Full, in-page downloads list for the Library — mirrors the floating panel. */
export function DownloadsView() {
  const enabled = useSettingsStore((s) => s.bulkDownload);
  const items = useDownloadQueueStore((s) => s.items);
  const zip = useDownloadQueueStore((s) => s.zip);
  const isPaused = useDownloadQueueStore((s) => s.isPaused);
  const pause = useDownloadQueueStore((s) => s.pause);
  const resume = useDownloadQueueStore((s) => s.resume);
  const clearFinished = useDownloadQueueStore((s) => s.clearFinished);
  const clearAll = useDownloadQueueStore((s) => s.clearAll);

  if (!enabled) return null;

  const total = items.length;
  const done = items.filter((i) => i.status === "done").length;
  const hasPending = items.some((i) => i.status === "queued" || i.status === "downloading");
  const hasFinished = items.some((i) => i.status === "done" || i.status === "error" || i.status === "canceled");
  const hasAnything = items.length > 0 || Boolean(zip);

  return (
    <section className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <DownloadCloud className="text-primary h-6 w-6 shrink-0" />
        <h1 className="text-2xl font-bold tracking-tight">Your downloads</h1>
        {total > 0 && <span className="glass-subtle text-muted-foreground rounded-full px-2 py-0.5 text-xs tabular-nums">{done}/{total}</span>}
        {hasAnything && (
          <div className="ml-auto flex items-center gap-2">
            {hasPending &&
              (isPaused ? (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={resume}>
                  <Play className="h-3.5 w-3.5" />
                  Resume
                </Button>
              ) : (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={pause}>
                  <Pause className="h-3.5 w-3.5" />
                  Pause
                </Button>
              ))}
            {hasFinished && (
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={clearFinished}>
                Clear finished
              </Button>
            )}
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive gap-1.5" onClick={clearAll}>
              <Trash2 className="h-3.5 w-3.5" />
              Clear all
            </Button>
          </div>
        )}
      </div>

      {!hasAnything ? (
        <p className="text-muted-foreground glass-subtle rounded-xl p-4 text-sm">
          No downloads yet. Turn on bulk mode from the top bar, pick some books, and they'll queue up right here.
        </p>
      ) : (
        <div className="glass divide-border/50 flex flex-col divide-y overflow-hidden rounded-2xl border-0">
          {zip && <ZipRow zip={zip} />}
          {items.map((item) => (
            <QueueRow key={item.md5} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
