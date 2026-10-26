import type { NavItem } from "epubjs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "../ui/sheet";
import { TableOfContents, BookmarkCheck, X } from "lucide-react";
import { ScrollArea } from "../ui/scroll-area";
import { useState, type CSSProperties } from "react";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";
import type { ReaderBookmark } from "@/stores/reader-bookmarks";
import { READER_THEMES, type ReaderTheme } from "@/stores/reader";

type Palette = (typeof READER_THEMES)[ReaderTheme];

const stripFragment = (href?: string) => (href ?? "").split("#")[0];

type TocSheetProps = {
  toc: NavItem[];
  currentHref?: string;
  setLocation: (value: string) => void;
  bookmarks?: ReaderBookmark[];
  onRemoveBookmark?: (cfi: string) => void;
  /** The active reader theme palette, so the drawer matches the page (not the app). */
  palette: Palette;
};

type TocSheetItemProps = {
  data: NavItem;
  activeHref: string;
  setLocation: (value: string) => void;
  setIsOpen: (value: boolean) => void;
};

const TocSheetItem = ({ data, activeHref, setLocation, setIsOpen }: TocSheetItemProps) => {
  const isActive = !!activeHref && stripFragment(data.href) === activeHref;
  return (
    <div>
      <Button
        onClick={() => {
          setLocation(data.href);
          setIsOpen(false);
        }}
        variant="ghost"
        className={cn(
          "h-auto w-full justify-start py-2 text-left font-normal text-[var(--toc-fg)] hover:bg-[var(--toc-hover)] hover:text-[var(--toc-fg)]",
          isActive && "bg-[var(--toc-active)] font-semibold hover:bg-[var(--toc-active)]",
        )}
      >
        <span className="truncate">{data.label?.trim() || "Untitled"}</span>
      </Button>
      {data.subitems && data.subitems.length > 0 && (
        <div className="ml-3 border-l border-[var(--toc-border)] pl-2">
          {data.subitems.map((item, i) => (
            <TocSheetItem key={i} data={item} activeHref={activeHref} setLocation={setLocation} setIsOpen={setIsOpen} />
          ))}
        </div>
      )}
    </div>
  );
};

export const TocSheet = ({ toc, currentHref, setLocation, bookmarks = [], onRemoveBookmark, palette }: TocSheetProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const activeHref = stripFragment(currentHref);

  // Theme the whole drawer off the reader palette via cascading CSS variables, so
  // every child (items, dividers, hover, active) stays in sync with light/sepia/dark.
  const tocStyle = {
    background: palette.chrome,
    borderColor: palette.border,
    color: palette.fg,
    "--toc-fg": palette.fg,
    "--toc-muted": palette.muted,
    "--toc-border": palette.border,
    "--toc-active": palette.selection,
    "--toc-hover": `color-mix(in srgb, ${palette.fg} 9%, transparent)`,
  } as CSSProperties;

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="size-9 rounded-full" aria-label="Contents & bookmarks">
          <TableOfContents className="size-5" />
        </Button>
      </SheetTrigger>
      {/* Flush to the edge (full height, no floating inset) so it reads as part of the
          page, with a themed hairline + shadow on its right edge for depth. */}
      <SheetContent
        side="left"
        style={tocStyle}
        className="flex w-[min(88vw,21rem)] flex-col gap-0 rounded-r-2xl border-r px-0 pt-[env(safe-area-inset-top)] pb-0 shadow-2xl"
      >
        <SheetHeader className="px-4 pt-4 pb-2">
          <SheetTitle className="text-[var(--toc-fg)]">Contents</SheetTitle>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1 px-2 pb-6">
          {bookmarks.length > 0 && (
            <div className="mb-3">
              <div className="px-2 py-1 text-[0.7rem] font-medium tracking-wide text-[var(--toc-muted)] uppercase">Bookmarks</div>
              {[...bookmarks]
                .sort((a, b) => b.createdAt - a.createdAt)
                .map((bookmark) => (
                  <div key={bookmark.cfi} className="group flex items-center gap-1 rounded-md hover:bg-[var(--toc-hover)]">
                    <button
                      type="button"
                      onClick={() => {
                        setLocation(bookmark.cfi);
                        setIsOpen(false);
                      }}
                      className="flex min-w-0 grow cursor-pointer items-center gap-2 px-2 py-2 text-left"
                    >
                      <BookmarkCheck className="text-primary size-4 shrink-0" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-[var(--toc-fg)]">{bookmark.chapter || bookmark.label}</span>
                        {bookmark.chapter && <span className="block truncate text-xs text-[var(--toc-muted)]">{bookmark.label}</span>}
                      </span>
                    </button>
                    {onRemoveBookmark && (
                      <button
                        type="button"
                        onClick={() => onRemoveBookmark(bookmark.cfi)}
                        aria-label="Remove bookmark"
                        className="pointer-coarse:opacity-100 mr-1 shrink-0 cursor-pointer rounded-md p-2.5 text-[var(--toc-muted)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--toc-fg)] focus-visible:opacity-100"
                      >
                        <X className="size-4" />
                      </button>
                    )}
                  </div>
                ))}
              <div className="mx-2 my-2 h-px bg-[var(--toc-border)]" />
            </div>
          )}
          <div>
            {toc.map((item, i) => (
              <TocSheetItem key={i} data={item} activeHref={activeHref} setLocation={setLocation} setIsOpen={setIsOpen} />
            ))}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};
