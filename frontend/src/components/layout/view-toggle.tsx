import { LayoutGrid, LayoutList } from "lucide-react";
import { useLocation } from "@tanstack/react-router";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { cn, glassControl } from "@/lib/utils";
import { useViewStore } from "@/stores/view";

// Routes that actually render book collections — the only places a list/grid
// switch is meaningful. Keeps the control out of Settings/About/reader, etc.
function showsCollections(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/lists" ||
    pathname === "/library" ||
    pathname === "/community" ||
    pathname === "/upload" ||
    pathname === "/nonfiction" ||
    pathname.startsWith("/recommendations")
  );
}

/**
 * Single global list/grid switch that lives in the navbar and drives the shared
 * view preference used everywhere (search, trending, bookshelf, reading lists,
 * recommendations) so the whole app stays consistent.
 */
export function ViewToggle() {
  const view = useViewStore((s) => s.view);
  const setView = useViewStore((s) => s.setView);
  const pathname = useLocation({ select: (l) => l.pathname });

  if (!showsCollections(pathname)) return null;

  const next = view === "grid" ? "list" : "grid";
  const label = next === "grid" ? "Switch to grid view" : "Switch to list view";

  return (
    <TooltipProvider disableHoverableContent>
      <Tooltip delayDuration={100}>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="outline"
            onClick={() => setView(next)}
            aria-label={label}
            title={label}
            className={cn("h-8 w-8 rounded-full", glassControl)}
          >
            {view === "grid" ? <LayoutGrid className="h-4 w-4" /> : <LayoutList className="h-4 w-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
