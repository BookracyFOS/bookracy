import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SearchField } from "@/components/search/search-field";
import { cn, glassPopover } from "@/lib/utils";
import { useDebounce } from "@/hooks/use-debounce";
import { suggestionsQueryOptions } from "@/api/backend/apple/apple";
import type { ShareTarget } from "@/lib/share";
import { CornerDownLeft, SearchIcon } from "lucide-react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  share?: ShareTarget | null;
}

/**
 * The homepage search box with a suggestions dropdown, backed by the Apple Books
 * store's own autocomplete.
 *
 * Suggestions are strictly additive: the input behaves exactly as it did before if
 * the endpoint is slow or down, and picking one just sets the query (which the page
 * already debounces into a search). Fully keyboard-driven — arrows move the active
 * row, Enter accepts it, Escape dismisses.
 */
export function SearchWithSuggestions({ value, onChange, placeholder, className, share }: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // Tracks the last value the user *typed* (vs. one we injected by accepting a
  // suggestion), so accepting a suggestion doesn't immediately reopen the dropdown.
  const [typed, setTyped] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);

  const debounced = useDebounce(typed, 250);
  const { data } = useQuery(suggestionsQueryOptions(debounced));

  // Apple echoes the query back as its first hint; that row would just re-submit what
  // the user already typed, so it earns no space in the list.
  const current = value.trim().toLowerCase();
  const suggestions = (data?.suggestions ?? []).filter((s) => s.toLowerCase() !== current).slice(0, 7);
  const visible = open && suggestions.length > 0;

  useEffect(() => setActiveIndex(-1), [debounced]);

  // Click-away closes the dropdown. Pointerdown (not click) so it fires before the
  // input's blur/focus dance on touch.
  useEffect(() => {
    if (!visible) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [visible]);

  const accept = (term: string) => {
    setTyped(term);
    onChange(term);
    setOpen(false);
    setActiveIndex(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (!visible) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      accept(suggestions[activeIndex]);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <SearchField
        placeholder={placeholder}
        value={value}
        onChange={(next) => {
          setTyped(next);
          onChange(next);
          setOpen(true);
        }}
        share={share}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={visible}
        aria-controls="search-suggestions"
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `search-suggestion-${activeIndex}` : undefined}
        autoComplete="off"
        className={className}
      />

      {visible && (
        <ul
          id="search-suggestions"
          role="listbox"
          aria-label="Search suggestions"
          className={cn(glassPopover, "animate-in fade-in-0 slide-in-from-top-1 absolute z-50 mt-2 flex w-full flex-col overflow-hidden rounded-2xl border p-1.5 shadow-xl duration-200 ease-out")}
        >
          {suggestions.map((term, i) => (
            <li key={term} id={`search-suggestion-${i}`} role="option" aria-selected={i === activeIndex}>
              <button
                type="button"
                // Mousedown beats the input's blur, so the click always lands.
                onMouseDown={(e) => {
                  e.preventDefault();
                  accept(term);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-colors duration-150 ease-out",
                  i === activeIndex ? "bg-primary/15 text-foreground" : "text-muted-foreground",
                )}
              >
                <SearchIcon className="h-3.5 w-3.5 shrink-0 opacity-60" />
                <span className="flex-1 truncate">{term}</span>
                {i === activeIndex && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 opacity-60" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
