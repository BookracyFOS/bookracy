import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { BookItem, BookItemWithExternalDownloads } from "@/api/backend/types";
import { Card, CardContent } from "../ui/card";
import { AspectRatio } from "../ui/aspect-ratio";
import { Skeleton } from "../ui/skeleton";
import { EpubReader } from "../epub-reader/epub-reader";
import { BookmarkButton } from "./bookmark";
import { BookDownloadButton } from "./download-button";
import { DownloadPdfButton } from "./download-pdf-button";
import { OpenPdfButton } from "./open-pdf-button";
import { inlinePdfLink } from "@/lib/download";
import { BookCover } from "./book-cover";
import { BookEnrichment, BookBlurb } from "./book-enrichment";
import { SelectCheckbox } from "./select-checkbox";
import { SwipeableTile, type SwipeActionDef } from "./swipeable-tile";
import { useSelectionStore } from "@/stores/selection";
import { useSettingsStore, type SwipeAction } from "@/stores/settings";
import { useIsMobile } from "@/hooks/use-ismobile";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog";
import { ScrollArea } from "../ui/scroll-area";
import { Progress } from "../ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { useReadingProgressStore } from "@/stores/progress";
import { HardDrive, FileType2, Fingerprint, CalendarDays, Languages, LucideIcon, CheckCheck, Trash2, BadgeCheck, Users, Check, DownloadIcon } from "lucide-react";
import { useIsOfflineBook } from "@/stores/offline-library";

type BookItemProps = BookItemWithExternalDownloads | BookItem;

/** Optional per-tile actions (e.g. on the bookshelf / reading-progress lists).
 *  On touch with gestures enabled these become swipe actions; otherwise they
 *  render as buttons in the tile's action row. */
export interface BookTileActions {
  onDelete?: (book: BookItem) => void;
  onComplete?: (book: BookItem) => void;
  deleteLabel?: string;
  completeLabel?: string;
  deleteIcon?: LucideIcon;
  completeIcon?: LucideIcon;
}

/** Small inline action buttons (desktop / gestures-off equivalent of swiping). */
function TileActionButtons({ book, actions }: { book: BookItem; actions: BookTileActions }) {
  const CompleteIcon = actions.completeIcon ?? CheckCheck;
  const DeleteIcon = actions.deleteIcon ?? Trash2;
  return (
    <>
      {actions.onComplete && (
        <Button size="sm" variant="outline" className="gap-1.5 rounded-xl" onClick={() => actions.onComplete?.(book)} aria-label={actions.completeLabel ?? "Mark complete"}>
          <CompleteIcon className="h-4 w-4" />
          <span className="hidden sm:inline">{actions.completeLabel ?? "Done"}</span>
        </Button>
      )}
      {actions.onDelete && (
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive gap-1.5 rounded-xl" onClick={() => actions.onDelete?.(book)} aria-label={actions.deleteLabel ?? "Remove"}>
          <DeleteIcon className="h-4 w-4" />
          <span className="hidden sm:inline">{actions.deleteLabel ?? "Remove"}</span>
        </Button>
      )}
    </>
  );
}

/** Builds the per-direction swipe descriptors from the user's Settings choices,
 *  mapping each configured action to the handler the page actually provided. */
function useSwipeConfig(book: BookItem, actions?: BookTileActions): { useSwipe: boolean; left?: SwipeActionDef; right?: SwipeActionDef } {
  const mobileGestures = useSettingsStore((s) => s.mobileGestures);
  const swipeLeftAction = useSettingsStore((s) => s.swipeLeftAction);
  const swipeRightAction = useSettingsStore((s) => s.swipeRightAction);
  const { isMobile } = useIsMobile();

  const build = (action: SwipeAction): SwipeActionDef | undefined => {
    if (!actions) return undefined;
    if (action === "remove" && actions.onDelete) return { label: actions.deleteLabel ?? "Remove", icon: actions.deleteIcon ?? Trash2, tone: "danger", onAction: () => actions.onDelete?.(book) };
    if (action === "complete" && actions.onComplete)
      return { label: actions.completeLabel ?? "Done", icon: actions.completeIcon ?? CheckCheck, tone: "success", onAction: () => actions.onComplete?.(book) };
    return undefined;
  };

  const left = build(swipeLeftAction);
  const right = build(swipeRightAction);
  return { useSwipe: Boolean(mobileGestures && isMobile && (left || right)), left, right };
}

function MetaChip({ icon: Icon, children, copyValue, copyLabel }: { icon: LucideIcon; children: ReactNode; copyValue?: string; copyLabel?: string }) {
  const [copied, setCopied] = useState(false);

  if (!copyValue) {
    return (
      <span className="glass-subtle text-muted-foreground inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs">
        <Icon className="h-3 w-3 shrink-0" />
        <span className="truncate">{children}</span>
      </span>
    );
  }

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(copyValue);
    } catch {
      toast.error("Couldn't copy to clipboard.", { position: "top-right" });
      return;
    }
    setCopied(true);
    toast.success(copyLabel ? `Copied ${copyLabel}` : "Copied", { position: "top-right" });
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copyValue}
      aria-label={copyLabel ? `Copy ${copyLabel}` : "Copy"}
      className={cn(
        "inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-all duration-300 ease-out active:scale-95",
        copied ? "bg-primary text-primary-foreground border-primary ring-primary/40 ring-2" : "glass-subtle text-muted-foreground hover:text-foreground hover:border-primary/50",
      )}
    >
      {copied ? <Check className="h-3 w-3 shrink-0" /> : <Icon className="h-3 w-3 shrink-0" />}
      <span className="truncate">{copied ? "Copied" : children}</span>
    </button>
  );
}

/** Marks a search result that came from a community upload (vs. scraped). */
function CommunityBadge() {
  return (
    <span className="bg-primary/15 text-primary inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold">
      <Users className="h-3 w-3" />
      User upload
    </span>
  );
}

/** Marks a book that's been saved to the offline library on this device. Emerald-tinted
 *  so it's visually distinct from CommunityBadge (primary/purple) at a glance. */
function OfflineBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
      <DownloadIcon className="h-3 w-3" />
      Saved
    </span>
  );
}

function DownloadSlot({ props, siblings }: { props: BookItemProps; siblings?: BookItem[] }) {
  return (
    <BookDownloadButton
      title={props.title}
      extension={props.book_filetype}
      md5={props.md5}
      author={props.author}
      sourceSize={props.book_size}
      primaryLink={props.link}
      community={props.community}
      siblings={siblings}
    />
  );
}

export function BookItemCard({ actions, siblings, ...props }: BookItemProps & { actions?: BookTileActions; siblings?: BookItem[] }) {
  const [isReaderOpen, setIsReaderOpen] = useState(false);
  // Subscribe to this book's row, so the bar moves when the reader closes. Reading it
  // through the (stable) `findReadingProgress` action never re-rendered the card.
  const saved = useReadingProgressStore((state) => state.readingProgress.find((p) => p.md5 === props.md5));
  const selected = useSelectionStore((s) => Boolean(s.selected[props.md5]));
  const { useSwipe, left, right } = useSwipeConfig(props, actions);
  const isSaved = useIsOfflineBook(props.md5);

  const isEpub = props.book_filetype?.toLowerCase() === "epub" || Boolean(props.link?.toLowerCase().endsWith(".epub"));
  const isPdf = !isEpub && (props.book_filetype?.toLowerCase() === "pdf" || Boolean(props.link?.toLowerCase().endsWith(".pdf")));
  const openPdf = () => props.link && window.open(inlinePdfLink(props.link), "_blank", "noopener,noreferrer");

  const progress = saved && saved.totalPages > 0 ? Math.min(100, (saved.currentPage / saved.totalPages) * 100) : undefined;
  const isCompleted = progress != null && progress >= 100;

  const card = (
    <Card className={cn("glass glass-hover overflow-hidden rounded-2xl border-0 p-0", selected && "ring-primary ring-2")}>
      <CardContent className="relative flex h-full w-full items-stretch p-4 md:p-5">
        <div className="absolute top-3 left-3 z-10">
          <SelectCheckbox book={props} />
        </div>
        <div className="absolute top-3 right-3 z-10">
          <BookmarkButton book={props} />
        </div>

        <div className="flex w-full gap-4 sm:gap-6">
          <div className="flex w-24 shrink-0 flex-col items-center gap-2 sm:w-[150px]">
            <AspectRatio ratio={5 / 8} className="w-full">
              {/* Only an EPUB can open in the reader; for anything else the cover is just a cover
                  (it used to be a pointer-cursor "button" that did nothing). */}
              <BookCover src={props.book_image} alt={props.title} onClick={isEpub ? () => setIsReaderOpen(true) : isPdf ? openPdf : undefined} showCaption={false} />
            </AspectRatio>
            {progress != null && (
              <div className="mt-1 flex w-full flex-col items-center gap-1">
                <TooltipProvider delayDuration={0}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Progress value={progress} className="w-full" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">{isCompleted ? "Finished" : `Progress: ${progress!.toFixed(0)}%`}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {isCompleted && (
                  <span className="text-primary inline-flex items-center gap-1 text-[11px] font-semibold">
                    <BadgeCheck className="h-3.5 w-3.5" />
                    Completed
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-1 flex-col justify-between gap-3 sm:gap-4">
            <div className="flex flex-col gap-1.5 pr-8 sm:gap-2">
              <h2 className="line-clamp-2 text-lg font-bold tracking-tight sm:text-xl md:text-2xl">{props.title}</h2>
              <p className="text-muted-foreground text-xs sm:text-sm">by {props.author}</p>
              {props.description ? (
                <p className="text-muted-foreground line-clamp-2 text-sm sm:line-clamp-3">{props.description}</p>
              ) : (
                <BookBlurb md5={props.md5} title={props.title} author={props.author} className="text-muted-foreground line-clamp-2 text-sm sm:line-clamp-3" />
              )}
              <div className="mt-0.5 flex flex-wrap gap-1.5 sm:mt-1 sm:gap-2">
                {props.community && <CommunityBadge />}
                {isSaved && <OfflineBadge />}
                {props.book_size && <MetaChip icon={HardDrive}>{props.book_size}</MetaChip>}
                {props.book_filetype && <MetaChip icon={FileType2}>{props.book_filetype.toUpperCase()}</MetaChip>}
                {props.year && <MetaChip icon={CalendarDays}>{props.year}</MetaChip>}
                {props.book_lang && props.book_lang !== "Unknown Language" && <MetaChip icon={Languages}>{props.book_lang}</MetaChip>}
                {props.md5 && (
                  <MetaChip icon={Fingerprint} copyValue={props.md5} copyLabel="MD5">
                    {props.md5.slice(0, 12)}…
                  </MetaChip>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <DownloadSlot props={props} siblings={siblings} />
              {isEpub && (
                <EpubReader
                  title={props.title}
                  author={props.author}
                  md5={props.md5}
                  link={props.link}
                  coverImage={props.book_image}
                  fileSize={props.book_size}
                  open={isReaderOpen}
                  setIsOpen={setIsReaderOpen}
                />
              )}
              {isEpub && <DownloadPdfButton title={props.title} link={props.link} />}
              {isPdf && <OpenPdfButton title={props.title} link={props.link} />}
              {actions && !useSwipe && <TileActionButtons book={props} actions={actions} />}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (useSwipe) {
    return (
      <SwipeableTile left={left} right={right}>
        {card}
      </SwipeableTile>
    );
  }
  return card;
}

export function SkeletonBookItem() {
  return (
    <Card className="glass overflow-hidden rounded-2xl border-0 p-0">
      <CardContent className="p-4 md:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
          <Skeleton className="skeleton-shimmer aspect-5/8 w-full max-w-[150px] rounded-xl" />
          <div className="flex flex-1 flex-col justify-between gap-4">
            <div className="flex flex-col gap-2">
              <Skeleton className="skeleton-shimmer h-7 w-3/4 rounded-md" />
              <Skeleton className="skeleton-shimmer h-4 w-1/3 rounded-md" />
              <Skeleton className="skeleton-shimmer mt-1 h-4 w-full rounded-md" />
              <Skeleton className="skeleton-shimmer h-4 w-5/6 rounded-md" />
              <div className="mt-1 flex gap-2">
                <Skeleton className="skeleton-shimmer h-6 w-20 rounded-full" />
                <Skeleton className="skeleton-shimmer h-6 w-16 rounded-full" />
              </div>
            </div>
            <Skeleton className="skeleton-shimmer h-10 w-36 rounded-xl" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function SkeletonBookItemGrid() {
  return (
    <Card className="glass overflow-hidden rounded-2xl border-0 p-0">
      <CardContent className="p-3">
        <div className="flex flex-col gap-3">
          <Skeleton className="skeleton-shimmer aspect-10/16 w-full rounded-xl" />
          <div className="flex flex-col gap-2">
            <Skeleton className="skeleton-shimmer h-5 w-3/4 rounded-md" />
            <Skeleton className="skeleton-shimmer h-3 w-1/2 rounded-md" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function BookItemDialog({ actions, siblings, ...props }: BookItemProps & { actions?: BookTileActions; siblings?: BookItem[] }) {
  const [isReaderOpen, setIsReaderOpen] = useState(false);
  const selected = useSelectionStore((s) => Boolean(s.selected[props.md5]));
  const saved = useReadingProgressStore((s) => s.readingProgress.find((p) => p.md5 === props.md5));
  const { useSwipe, left, right } = useSwipeConfig(props, actions);
  const isSaved = useIsOfflineBook(props.md5);

  const isEpub = props.book_filetype?.toLowerCase() === "epub" || Boolean(props.link?.toLowerCase().endsWith(".epub"));
  const isPdf = !isEpub && (props.book_filetype?.toLowerCase() === "pdf" || Boolean(props.link?.toLowerCase().endsWith(".pdf")));
  const isCompleted = Boolean(saved && saved.totalPages > 0 && saved.currentPage >= saved.totalPages);

  const tile = (
    <Card className={cn("glass glass-hover h-full overflow-hidden rounded-2xl border-0 p-0", selected && "ring-primary ring-2")}>
      <CardContent className="h-full p-3">
        <div className="relative flex h-full flex-col gap-3">
          {/* A real button, so the tile opens from the keyboard and reads as one to
              screen readers — Radix's AspectRatio div took the trigger props before. */}
          <AspectRatio ratio={10 / 16}>
            <DialogTrigger asChild>
              <button type="button" className="focus-visible:ring-ring block h-full w-full rounded-xl text-left focus-visible:ring-2 focus-visible:outline-none" aria-label={`Details for ${props.title}`}>
                <BookCover src={props.book_image} alt={props.title} interactive />
              </button>
            </DialogTrigger>
          </AspectRatio>
          <div className="absolute top-2 left-2 z-10">
            <SelectCheckbox book={props} />
          </div>
          <div className="absolute top-2 right-2 z-10">
            <BookmarkButton book={props} />
          </div>
          <div className="flex flex-col gap-1 px-1">
            <h2 className="line-clamp-2 text-sm font-semibold sm:text-base">{props.title}</h2>
            <p className="text-muted-foreground line-clamp-1 text-xs">by {props.author}</p>
            {(props.community || isSaved) && (
              <div className="mt-0.5 flex flex-wrap gap-1">
                {props.community && <CommunityBadge />}
                {isSaved && <OfflineBadge />}
              </div>
            )}
            {isCompleted ? (
              <span className="text-primary mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold">
                <BadgeCheck className="h-3.5 w-3.5" />
                Completed
              </span>
            ) : (
              (props.book_filetype || props.year) && (
                <span className="text-primary/90 mt-0.5 text-[11px] font-medium tracking-wide uppercase">{[props.book_filetype, props.year].filter(Boolean).join(" · ")}</span>
              )
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <Dialog>
      {useSwipe ? (
        <SwipeableTile left={left} right={right}>
          {tile}
        </SwipeableTile>
      ) : (
        tile
      )}
      {/* Bounded to the small viewport and scrollable as a whole, so the footer's Download
          button can't be clipped off-screen on a short phone or in landscape. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">{props.title}</DialogTitle>
          <DialogDescription>by {props.author}</DialogDescription>
        </DialogHeader>
        <ScrollArea>
          <div className="flex flex-col gap-4 pr-3">
            <div className="flex flex-wrap gap-2">
              {props.community && <CommunityBadge />}
              {isSaved && <OfflineBadge />}
              {props.book_size && <MetaChip icon={HardDrive}>{props.book_size}</MetaChip>}
              {props.book_filetype && <MetaChip icon={FileType2}>{props.book_filetype.toUpperCase()}</MetaChip>}
              {props.year && <MetaChip icon={CalendarDays}>{props.year}</MetaChip>}
              {props.book_lang && props.book_lang !== "Unknown Language" && <MetaChip icon={Languages}>{props.book_lang}</MetaChip>}
              {props.md5 && (
                <MetaChip icon={Fingerprint} copyValue={props.md5} copyLabel="MD5">
                  {props.md5.slice(0, 16)}…
                </MetaChip>
              )}
            </div>
            <p className={cn("text-muted-foreground text-sm leading-relaxed", !props.description && "italic")}>{props.description || "No summary available."}</p>
            {/* Only mounts with the dialog, so opening a tile is what triggers the lookup. */}
            <BookEnrichment md5={props.md5} title={props.title} author={props.author} hasDescription={Boolean(props.description)} />
          </div>
        </ScrollArea>
        <DialogFooter className="flex flex-row flex-wrap justify-end gap-3">
          {actions && !useSwipe && <TileActionButtons book={props} actions={actions} />}
          <DownloadSlot props={props} siblings={siblings} />
          {isEpub && (
            <EpubReader
              title={props.title}
              author={props.author}
              md5={props.md5}
              link={props.link}
              coverImage={props.book_image}
              fileSize={props.book_size}
              open={isReaderOpen}
              setIsOpen={setIsReaderOpen}
            />
          )}
          {isEpub && <DownloadPdfButton title={props.title} link={props.link} />}
          {isPdf && <OpenPdfButton title={props.title} link={props.link} />}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
