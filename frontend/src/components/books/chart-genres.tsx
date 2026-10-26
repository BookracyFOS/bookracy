import { cn } from "@/lib/utils";
import { CHART_GENRES } from "@/api/backend/apple/apple";

/**
 * Genre switcher for the homepage bestseller charts, modelled on the row of pills at
 * the top of the Apple Books charts page. Scrolls horizontally on narrow screens
 * rather than wrapping into a three-line block.
 */
export function ChartGenres({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Bestseller chart genre"
      className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {CHART_GENRES.map((genre) => {
        const active = genre.id === value;
        return (
          <button
            key={genre.id || "all"}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(genre.id)}
            className={cn(
              "shrink-0 snap-start rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors duration-200 ease-out",
              "focus-visible:ring-primary/50 focus-visible:ring-2 focus-visible:outline-none",
              active ? "bg-primary text-white" : "glass-subtle text-muted-foreground hover:text-foreground",
            )}
          >
            {genre.label}
          </button>
        );
      })}
    </div>
  );
}
