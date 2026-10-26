import { Check } from "lucide-react";
import { BookItem } from "@/api/backend/types";
import { useSelectionStore } from "@/stores/selection";
import { useSettingsStore } from "@/stores/settings";
import { cn } from "@/lib/utils";

/** A small corner control for multi-selecting a book into the bulk downloader. */
export function SelectCheckbox({ book, className }: { book: BookItem; className?: string }) {
  const enabled = useSettingsStore((s) => s.bulkDownload);
  const active = useSelectionStore((s) => s.active);
  const selected = useSelectionStore((s) => Boolean(s.selected[book.md5]));
  const toggle = useSelectionStore((s) => s.toggle);

  // Only available once the feature is enabled and the user is in select mode.
  if (!enabled || !active || !book.link) return null;

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={selected ? `Deselect ${book.title}` : `Select ${book.title}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(book);
      }}
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-md border shadow-sm transition-colors",
        selected ? "bg-primary border-primary text-white" : "glass-strong border-border/60 text-transparent hover:border-primary/70 hover:text-primary/50",
        className,
      )}
    >
      <Check className="h-3.5 w-3.5" strokeWidth={3} />
    </button>
  );
}
