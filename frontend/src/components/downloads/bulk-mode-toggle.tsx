import { ListChecks } from "lucide-react";
import { Button } from "../ui/button";
import { cn, glassControl } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings";
import { useSelectionStore } from "@/stores/selection";

/**
 * Navbar control that turns bulk-download (multi-select) mode on/off. Only
 * rendered when the user has enabled the feature in Settings.
 */
export function BulkModeToggle() {
  const enabled = useSettingsStore((s) => s.bulkDownload);
  const active = useSelectionStore((s) => s.active);
  const toggleActive = useSelectionStore((s) => s.toggleActive);
  const count = useSelectionStore((s) => Object.keys(s.selected).length);

  if (!enabled) return null;

  return (
    <Button
      size="icon"
      variant="outline"
      onClick={toggleActive}
      aria-label={active ? "Exit bulk download mode" : "Enter bulk download mode"}
      aria-pressed={active}
      title={active ? "Exit bulk download mode" : "Bulk download mode"}
      className={cn("relative h-8", active ? "bg-primary border-primary text-white hover:bg-primary/90 hover:text-white" : glassControl)}
    >
      <ListChecks className="h-4 w-4" />
      {active && count > 0 && (
        <span className="bg-background text-primary absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums shadow">
          {count}
        </span>
      )}
    </Button>
  );
}
