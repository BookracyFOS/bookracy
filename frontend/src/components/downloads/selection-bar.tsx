import { Download, FileArchive, X } from "lucide-react";
import { Button } from "../ui/button";
import { useSelectionStore } from "@/stores/selection";
import { useBulkDownload } from "@/hooks/use-bulk-download";

/** Floating action bar shown whenever one or more books are selected. */
export function SelectionBar() {
  const active = useSelectionStore((s) => s.active);
  const selected = useSelectionStore((s) => s.selected);
  const clear = useSelectionStore((s) => s.clear);
  const { download, format } = useBulkDownload();

  const count = Object.keys(selected).length;
  if (!active || count === 0) return null;

  const handleDownload = () => {
    download(Object.values(selected));
    clear();
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4">
      <div className="glass-strong pointer-events-auto flex items-center gap-2 rounded-2xl border-0 p-2 shadow-xl">
        <span className="px-2 text-sm font-medium tabular-nums">{count} selected</span>
        <Button size="sm" className="gap-2 rounded-xl" onClick={handleDownload}>
          {format === "zip" ? <FileArchive className="h-4 w-4" /> : <Download className="h-4 w-4" />}
          {format === "zip" ? `Download ZIP (${count})` : `Download ${count}`}
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8 rounded-xl" aria-label="Clear selection" onClick={clear}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
