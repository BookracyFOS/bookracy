import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, Download, GripVertical, Loader2, Pause, PictureInPicture2, Play, Trash2 } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "../ui/button";
import { Progress } from "../ui/progress";
import { ScrollArea } from "../ui/scroll-area";
import { cn } from "@/lib/utils";
import { useDownloadQueueStore } from "@/stores/download-queue";
import { useSettingsStore } from "@/stores/settings";
import { QueueRow, ZipRow } from "./queue-rows";

const FAB_POSITION = "fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-[calc(1.5rem+env(safe-area-inset-right))] z-50";

export function DownloadQueue() {
  const enabled = useSettingsStore((s) => s.bulkDownload);
  const floating = useSettingsStore((s) => s.floatingDownloads);
  const items = useDownloadQueueStore((s) => s.items);
  const zip = useDownloadQueueStore((s) => s.zip);
  const isPaused = useDownloadQueueStore((s) => s.isPaused);
  const panelOpen = useDownloadQueueStore((s) => s.panelOpen);
  const setPanelOpen = useDownloadQueueStore((s) => s.setPanelOpen);
  const pause = useDownloadQueueStore((s) => s.pause);
  const resume = useDownloadQueueStore((s) => s.resume);
  const clearFinished = useDownloadQueueStore((s) => s.clearFinished);
  const clearAll = useDownloadQueueStore((s) => s.clearAll);
  const navigate = useNavigate();

  // Drag-to-reposition. Offset is from the default bottom-right anchor; it lives
  // on a positioned wrapper so it never fights the open/collapse zoom animation.
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  if (!enabled || !floating || (items.length === 0 && !zip)) return null;

  const total = items.length;
  const done = items.filter((i) => i.status === "done").length;
  const zipBusy = zip ? zip.status === "downloading" || zip.status === "zipping" : false;
  const active = items.some((i) => i.status === "downloading") || zipBusy;
  const hasPending = items.some((i) => i.status === "queued" || i.status === "downloading");
  const hasFinished = items.some((i) => i.status === "done" || i.status === "error" || i.status === "canceled");
  const overall = total > 0 ? (done / total) * 100 : 0;
  const badge = total > 0 ? `${done}/${total}` : zip ? `${Math.round(zip.percent)}%` : "";

  const openLibrary = () => {
    setPanelOpen(false);
    navigate({ to: "/library" });
  };

  const onDragStart = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return; // let header buttons work
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    let nx = d.baseX + (e.clientX - d.startX);
    let ny = d.baseY + (e.clientY - d.startY);
    const rect = wrapperRef.current?.getBoundingClientRect();
    const margin = 8;
    if (rect) {
      nx = Math.max(-(window.innerWidth - rect.width - margin * 2), Math.min(0, nx));
      ny = Math.max(-(window.innerHeight - rect.height - margin * 2), Math.min(0, ny));
    }
    setOffset({ x: nx, y: ny });
  };
  const onDragEnd = (e: ReactPointerEvent) => {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const dragStyle = { transform: `translate(${offset.x}px, ${offset.y}px)` };

  // Collapsed launcher.
  if (!panelOpen) {
    return (
      <div ref={wrapperRef} className={FAB_POSITION} style={dragStyle}>
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          aria-label="Open downloads"
          className={cn(
            "glass-strong flex origin-bottom-right items-center gap-2 rounded-2xl border-0 py-2.5 pr-3 pl-3.5 shadow-xl transition-transform duration-200 ease-out hover:scale-105",
            "animate-in fade-in-0 zoom-in-95",
          )}
        >
          {active ? <Loader2 className="text-primary h-5 w-5 animate-spin" /> : <Download className="text-primary h-5 w-5" />}
          <span className="text-sm font-semibold">Downloads</span>
          {badge && <span className="bg-primary/15 text-primary rounded-full px-2 py-0.5 text-xs font-medium tabular-nums">{badge}</span>}
        </button>
      </div>
    );
  }

  // Expanded panel.
  return (
    <div ref={wrapperRef} className={FAB_POSITION} style={dragStyle}>
      <div
        className={cn(
          "glass-strong flex max-h-[min(70vh,34rem)] w-[min(360px,calc(100vw-2rem))] origin-bottom-right flex-col overflow-hidden rounded-2xl border-0 shadow-2xl",
          "animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-200 ease-out",
        )}
      >
        <div
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          className="flex touch-none cursor-grab items-center gap-2 border-b border-white/5 px-3 py-2.5 select-none active:cursor-grabbing"
        >
          <GripVertical className="text-muted-foreground h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold leading-none">Downloads</p>
            <p className="text-muted-foreground mt-1 text-xs tabular-nums">
              {total > 0 ? `${done} of ${total} done${isPaused && hasPending ? " · paused" : ""}` : zip ? "ZIP archive" : ""}
            </p>
          </div>
          {hasPending &&
            (isPaused ? (
              <Button size="sm" variant="ghost" className="h-8 gap-1.5" onClick={resume}>
                <Play className="h-3.5 w-3.5" />
                Resume
              </Button>
            ) : (
              <Button size="sm" variant="ghost" className="h-8 gap-1.5" onClick={pause}>
                <Pause className="h-3.5 w-3.5" />
                Pause
              </Button>
            ))}
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Open in Library" title="Open in Library" onClick={openLibrary}>
            <PictureInPicture2 className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Collapse downloads" onClick={() => setPanelOpen(false)}>
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>

        {total > 0 && <Progress value={overall} className="h-1 rounded-none" />}

        <ScrollArea className="min-h-0 flex-1">
          <div className="divide-y divide-white/5">
            {zip && <ZipRow zip={zip} />}
            {items.map((item) => (
              <QueueRow key={item.md5} item={item} />
            ))}
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between gap-2 border-t border-white/5 px-3 py-2">
          <Button size="sm" variant="ghost" className="text-muted-foreground h-8 gap-1.5" disabled={!hasFinished} onClick={clearFinished}>
            Clear finished
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive h-8 gap-1.5" onClick={clearAll}>
            <Trash2 className="h-3.5 w-3.5" />
            Clear all
          </Button>
        </div>
      </div>
    </div>
  );
}
