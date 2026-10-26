import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "../ui/button";
import { Bookmark, BookmarkCheck, BookOpen, ChevronLeft, ChevronRight, DownloadIcon, Library, Loader2, RotateCcw, X } from "lucide-react";
import { saveAs } from "@/lib/saveAs";
import type Rendition from "epubjs/types/rendition";
import { VisuallyHidden } from "radix-ui";
import { TocSheet } from "./toc-sheet";
import type { NavItem } from "epubjs";
import { EpubView, EpubViewInstance, type ReaderFlow, type Relocation } from "./epub-view";
import { cn } from "@/lib/utils";
import { useReadingProgressStore } from "@/stores/progress";
import { READER_THEMES, READER_WIDTH_PX, useReaderStore, type ReaderAppearance } from "@/stores/reader";
import { useReaderBookmarksStore } from "@/stores/reader-bookmarks";
import { useIsMobile } from "@/hooks/use-ismobile";
import { useSwipeable } from "react-swipeable";
import { useFakeProgress } from "@/hooks/use-fake-progress";
import { Progress } from "../ui/progress";
import { Slider } from "../ui/slider";
import { ReaderSettings } from "./reader-settings";
import { useReadingPace } from "@/hooks/use-reading-pace";
import { parsingMessageAt } from "@/lib/fun";
import { useOfflineLibraryStore } from "@/stores/offline-library";

interface EpubReaderProps {
  title: string;
  link: string;
  md5: string;
  open: boolean;
  setIsOpen: (isOpen: boolean) => void;
  /** Human-readable size from the book metadata, e.g. "12.4 MB". Drives the "big book" messaging. */
  fileSize?: string;
  /** Saved with the reading position so a "Continue reading" card on another device
   *  can render the book without re-resolving it from the search API. */
  author?: string;
  coverImage?: string;
  /** Hide the built-in "Open" trigger when the parent drives `open` itself. */
  hideTrigger?: boolean;
}

// Locations are generated at ~1600 chars/"page". The finish-time estimate starts
// from an average-reader guess and is then personalised from the reader's measured
// pace (see useReadingPace); ~5.2 chars/word converts chars/min into a familiar WPM.
const CHARS_PER_PAGE = 1600;
const CHARS_PER_WORD = 5.2;

/** Parse a human size string ("12.4 MB", "560 KB", "1.1 GB") into megabytes. */
function parseSizeToMb(size?: string): number | null {
  if (!size) return null;
  const match = size.match(/([\d.]+)\s*(tb|gb|mb|kb|b)?/i);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  switch ((match[2] || "mb").toLowerCase()) {
    case "tb":
      return value * 1024 * 1024;
    case "gb":
      return value * 1024;
    case "mb":
      return value;
    case "kb":
      return value / 1024;
    case "b":
      return value / (1024 * 1024);
    default:
      return value;
  }
}

/** Human-readable remaining reading time. 403 -> "6h 43m left", 42 -> "42 min left". */
function formatMinutesLeft(minutes: number): string {
  if (minutes < 1) return "< 1 min left";
  if (minutes < 60) return `${minutes} min left`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m left` : `${h}h left`;
}

const stripFragment = (href?: string) => (href ?? "").split("#")[0];

function flattenToc(items: NavItem[], acc: NavItem[] = []): NavItem[] {
  for (const item of items) {
    acc.push(item);
    if (item.subitems?.length) flattenToc(item.subitems, acc);
  }
  return acc;
}

/** Map a section href (from the relocated event) back to its TOC chapter label. */
function findChapterLabel(toc: NavItem[], href?: string): string {
  const target = stripFragment(href);
  if (!target) return "";
  const flat = flattenToc(toc);
  let hit = flat.find((item) => stripFragment(item.href) === target);
  if (!hit) {
    const base = target.split("/").pop();
    hit = flat.find((item) => stripFragment(item.href).split("/").pop() === base);
  }
  return hit?.label?.trim() ?? "";
}

export function EpubReader(props: EpubReaderProps) {
  const readerRef = useRef<EpubViewInstance>(null);
  const renditionRef = useRef<Rendition | null>(null);
  // Single in-flight location-generation promise. epub.js's locations.generate() is
  // CPU-heavy and, until it resolves, total/locationFromCfi return half-built values —
  // which is exactly why the page counter used to jump (1 → 63 → 67 → 200). We kick it
  // off once per book and make every relocation await this same promise.
  const locationsPromiseRef = useRef<Promise<unknown> | null>(null);

  const findReadingProgress = useReadingProgressStore((state) => state.findReadingProgress);
  const setReadingProgress = useReadingProgressStore((state) => state.setReadingProgress);

  // Reader appearance — independent of the global app theme.
  const theme = useReaderStore((state) => state.theme);
  const font = useReaderStore((state) => state.font);
  const fontSize = useReaderStore((state) => state.fontSize);
  const lineHeight = useReaderStore((state) => state.lineHeight);
  const width = useReaderStore((state) => state.width);
  const justify = useReaderStore((state) => state.justify);
  const appearance = useMemo<ReaderAppearance>(() => ({ theme, font, fontSize, lineHeight, width, justify }), [theme, font, fontSize, lineHeight, width, justify]);
  const palette = READER_THEMES[theme];

  // Learns the reader's real reading speed and uses it to personalise "time left".
  const { charsPerMin, measured: paceMeasured, onProgress: trackPace, reset: resetPace } = useReadingPace();

  // In-reader position bookmarks (per book md5).
  const bookmarksByBook = useReaderBookmarksStore((state) => state.byBook);
  const addBookmark = useReaderBookmarksStore((state) => state.addBookmark);
  const removeBookmark = useReaderBookmarksStore((state) => state.removeBookmark);
  const bookmarks = useMemo(() => bookmarksByBook[props.md5] ?? [], [bookmarksByBook, props.md5]);

  // Offline-first URL: if the book is in the local library, epub.js loads directly from
  // a blob-backed object URL — instant open, works fully offline, no network hit. If it
  // isn't (or if IDB is unavailable), fall back to the same network URL we always used.
  // The object URL is created lazily and revoked when the reader unmounts / md5 changes,
  // so blob memory is released promptly. `offlineUrl === null` = still checking; `""` =
  // checked and not offline (use props.link); truthy string = the blob object URL.
  const [offlineUrl, setOfflineUrl] = useState<string | null>(null);
  const getOfflineRecord = useOfflineLibraryStore((s) => s.getRecord);
  useEffect(() => {
    if (!props.open) return; // don't touch IDB until the dialog actually opens
    let cancelled = false;
    let created: string | null = null;
    (async () => {
      try {
        const record = await getOfflineRecord(props.md5);
        if (cancelled) return;
        if (record?.blob) {
          created = URL.createObjectURL(record.blob);
          setOfflineUrl(created);
        } else {
          setOfflineUrl(""); // "checked, not offline"
        }
      } catch {
        if (!cancelled) setOfflineUrl(""); // IDB unavailable — fall back to network
      }
    })();
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
      setOfflineUrl(null);
    };
  }, [props.md5, props.open, getOfflineRecord]);
  const effectiveUrl = offlineUrl || props.link;
  // Until the library has been checked, don't mount the view at all: it used to start
  // a full network download of the book and only then discover the offline copy.
  const sourceReady = offlineUrl !== null;

  // epub.js sniffs the input type from the URL's file extension. A blob: URL has none,
  // so it guesses "directory" and quietly never opens the book — which silently broke
  // reading ANY offline copy. Telling it explicitly that this is a zipped EPUB is the
  // documented way out. Only forced for blob URLs; network links keep the sniffing that
  // lets a non-EPUB link fail with a proper error instead of a confusing unzip failure.
  const epubInitOptions = useMemo(() => (offlineUrl ? { openAs: "epub" as const } : undefined), [offlineUrl]);

  /**
   * Save the book to disk. `props.link` is a real download URL for a book that came
   * from Bookracy, but only a placeholder for one the user added from their own device
   * (that md5 doesn't exist server-side) — so prefer the local blob whenever we have it,
   * which also means an offline "download" works with no connection at all.
   */
  const saveCopy = async () => {
    try {
      const record = await getOfflineRecord(props.md5);
      if (record?.blob) {
        const url = URL.createObjectURL(record.blob);
        saveAs(url, record.filename);
        // Revoke on the next tick — immediate revocation races the download starting.
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return;
      }
    } catch {
      /* IDB unavailable — fall through to the network URL. */
    }
    saveAs(props.link);
  };

  const [toc, setToc] = useState<NavItem[]>([]);
  // The position the view is asked to show (resume / TOC jump / seek) — not the live
  // position, which is `currentCfi`. Undefined means "from the start".
  const [location, setLocation] = useState<string | undefined>(undefined);
  const [page, setPage] = useState({ current: 0, total: 0 });
  const [readPct, setReadPct] = useState(0);
  const [scrubPct, setScrubPct] = useState<number | null>(null);
  const [currentCfi, setCurrentCfi] = useState<string | null>(null);
  const [currentHref, setCurrentHref] = useState<string>("");
  const [edges, setEdges] = useState({ atStart: false, atEnd: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Chrome (top/bottom bars) auto-hides for an immersive read; tap the page to toggle.
  const [chromeVisible, setChromeVisible] = useState(true);
  // Keep the overlay up a beat after loading finishes so it can show 100% and fade out.
  const [overlayVisible, setOverlayVisible] = useState(true);

  const { isMobile } = useIsMobile();
  const flow: ReaderFlow = isMobile ? "scrolled" : "paginated";

  const chapterLabel = useMemo(() => findChapterLabel(toc, currentHref), [toc, currentHref]);
  // epub.js binds the `relocated` listener once, at init, so the handler below is
  // frozen with the TOC as it was then (empty). Read it through a ref instead so the
  // saved position can carry a real chapter label.
  const tocRef = useRef<NavItem[]>([]);
  tocRef.current = toc;
  const minutesLeft = useMemo(() => {
    if (!page.total || page.current <= 0) return null;
    const remaining = Math.max(0, page.total - page.current);
    return Math.max(0, Math.ceil((remaining * CHARS_PER_PAGE) / charsPerMin));
  }, [page, charsPerMin]);

  // Detected reading speed in WPM (once we've actually measured it) + the finish
  // estimate, surfaced in the reading-settings panel.
  const paceWpm = paceMeasured ? Math.round(charsPerMin / CHARS_PER_WORD) : null;
  const etaLabel = minutesLeft != null ? formatMinutesLeft(minutesLeft) : null;

  const isCurrentBookmarked = useMemo(() => !!currentCfi && bookmarks.some((b) => b.cfi === currentCfi), [bookmarks, currentCfi]);

  const previewPage = useMemo(() => {
    const pct = scrubPct ?? readPct;
    if (!page.total) return null;
    return Math.max(1, Math.min(page.total, Math.round((pct / 100) * page.total)));
  }, [scrubPct, readPct, page.total]);

  // Radix unmounts the dialog body on close, so every (re)open re-parses the book —
  // reset transient state each time it opens so we never flash a stale position.
  useEffect(() => {
    if (props.open) {
      setLoading(true);
      setError(null);
      setChromeVisible(true);
      setScrubPct(null);
      setPage({ current: 0, total: 0 });
      setReadPct(0);
      resetPace();
    }
  }, [props.open, resetPace]);

  useEffect(() => {
    if (loading) {
      setOverlayVisible(true);
      return;
    }
    const id = window.setTimeout(() => setOverlayVisible(false), 350);
    return () => window.clearTimeout(id);
  }, [loading]);

  // Believable progress for the (unmeasurable) parse. Big books linger near the top.
  const { percent, elapsedMs } = useFakeProgress({ active: loading });
  const sizeMb = useMemo(() => parseSizeToMb(props.fileSize), [props.fileSize]);
  const isBigBook = (sizeMb != null && sizeMb >= 6) || elapsedMs > 3500;

  // Rotate the playful sub-message while we parse.
  const [msgIndex, setMsgIndex] = useState(0);
  useEffect(() => {
    if (!loading) return;
    setMsgIndex(0);
    const id = window.setInterval(() => setMsgIndex((i) => i + 1), 2800);
    return () => window.clearInterval(id);
  }, [loading]);

  // Generate the location map exactly once per book; concurrent relocations all
  // await this same promise instead of each kicking off a fresh (conflicting) build.
  const ensureLocations = useCallback(() => {
    const book = renditionRef.current?.book;
    if (!book) return Promise.resolve();
    if (!locationsPromiseRef.current) {
      locationsPromiseRef.current = book.ready.then(() => book.locations.generate(CHARS_PER_PAGE));
    }
    return locationsPromiseRef.current;
  }, []);

  const handleRelocated = useCallback(
    async (info: Relocation) => {
      setCurrentCfi(info.cfi);
      setCurrentHref(info.href);
      setEdges({ atStart: info.atStart, atEnd: info.atEnd });

      const book = renditionRef.current?.book;
      if (!book) return;
      // Save the position itself right away. Generating the page map can take many
      // seconds on a phone (and fail on a broken book); closing before it finished
      // used to save nothing at all. Page counts are filled in below once known.
      const previous = findReadingProgress(props.md5);
      setReadingProgress({
        md5: props.md5,
        currentPage: previous?.currentPage ?? 0,
        totalPages: previous?.totalPages ?? 0,
        location: info.cfi,
        chapter: findChapterLabel(tocRef.current, info.href) || undefined,
        title: props.title,
        author: props.author,
        image: props.coverImage,
        link: props.link,
        size: props.fileSize,
      });
      try {
        await ensureLocations();
      } catch {
        return; // generation failed (rare) — leave the last good readout in place
      }
      // The dialog may have closed / remounted (new book) during the await.
      if (renditionRef.current?.book !== book) return;

      /* @ts-expect-error missing epub types */
      const totalPages = book.locations.total as number;
      if (!totalPages || totalPages <= 0) return;
      /* @ts-expect-error missing epub types */
      const currentPage = book.locations.locationFromCfi(info.cfi) + 1;
      const pct = Math.max(0, Math.min(100, (book.locations.percentageFromCfi(info.cfi) ?? 0) * 100));

      setPage({ current: currentPage, total: totalPages });
      setReadPct(pct);
      setReadingProgress({
        md5: props.md5,
        currentPage,
        totalPages,
        location: info.cfi,
        chapter: findChapterLabel(tocRef.current, info.href) || undefined,
        title: props.title,
        author: props.author,
        image: props.coverImage,
        link: props.link,
        size: props.fileSize,
      });
      trackPace(currentPage, totalPages, CHARS_PER_PAGE);
    },
    [props.md5, props.title, props.author, props.coverImage, props.link, props.fileSize, setReadingProgress, findReadingProgress, ensureLocations, trackPace],
  );

  const handleRendition = useCallback((rendition: Rendition) => {
    renditionRef.current = rendition;
    locationsPromiseRef.current = null; // fresh book → rebuild locations once
    const eventsToStopLoading = ["rendered", "relocated", "displayed", "layout", "started"];
    eventsToStopLoading.forEach((event) => {
      rendition.on(event, () => setLoading(false));
    });
  }, []);

  // Re-read the saved position every time the reader opens. Radix unmounts the view on
  // close, so each open re-parses the book, and it has to resume from where the LAST
  // session ended — not from where the first one started.
  useEffect(() => {
    if (!props.open) return;
    setLocation(findReadingProgress(props.md5)?.location);
  }, [props.open, findReadingProgress, props.md5]);

  // The view is keyed on `flow`, so crossing the tablet breakpoint (a rotation) remounts
  // it; hand the remount the live position rather than the one this session opened at.
  const currentCfiRef = useRef<string | null>(null);
  currentCfiRef.current = currentCfi;
  useEffect(() => {
    if (currentCfiRef.current) setLocation(currentCfiRef.current);
  }, [flow]);

  // Seek to a percentage of the book (scrubber release, Home/End keys).
  const seekToPercent = useCallback(
    async (pct: number) => {
      const book = renditionRef.current?.book;
      if (!book) return;
      try {
        await ensureLocations();
      } catch {
        return;
      }
      if (renditionRef.current?.book !== book) return;
      const cfi = book.locations.cfiFromPercentage(Math.max(0, Math.min(1, pct / 100)));
      if (cfi) setLocation(cfi);
    },
    [ensureLocations],
  );

  const toggleChrome = useCallback(() => setChromeVisible((v) => !v), []);

  const toggleBookmark = useCallback(() => {
    if (!currentCfi) return;
    if (isCurrentBookmarked) {
      removeBookmark(props.md5, currentCfi);
    } else {
      addBookmark(props.md5, {
        cfi: currentCfi,
        label: page.total ? `Page ${page.current} of ${page.total}` : "Saved position",
        chapter: chapterLabel || undefined,
        createdAt: Date.now(),
      });
    }
  }, [currentCfi, isCurrentBookmarked, removeBookmark, addBookmark, props.md5, page, chapterLabel]);

  const jumpTo = useCallback((value: string) => setLocation(value), []);

  // Reader-wide keyboard shortcuts that complement the in-view paging keys.
  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Home") {
        e.preventDefault();
        void seekToPercent(0);
      } else if (e.key === "End") {
        e.preventDefault();
        void seekToPercent(100);
      } else if (e.key.toLowerCase() === "b") {
        toggleBookmark();
      }
    };
    document.addEventListener("keyup", onKey);
    return () => document.removeEventListener("keyup", onKey);
  }, [props.open, seekToPercent, toggleBookmark]);

  // Taps on the page itself (relayed from the book's iframe — see EpubView.onTap).
  // Paginated: outer ~25% turns the page, the centre toggles the chrome. Scrolled
  // (phones): any tap toggles the chrome, which used to be unreachable on a full-bleed
  // page. Text selection, footnotes and links keep working because nothing sits on top.
  const handleContentTap = useCallback(
    (ratio: number) => {
      if (flow === "paginated" && ratio < 0.25) readerRef.current?.prevPage();
      else if (flow === "paginated" && ratio > 0.75) readerRef.current?.nextPage();
      else toggleChrome();
    },
    [flow, toggleChrome],
  );

  // Touch + paginated (tablets): WebKit does not relay the iframe's tap/touch events
  // reliably, so those devices keep the transparent swipe/tap surface over the page.
  // Fine-pointer devices never get it, which is what makes selection and links work.
  const coarsePointer = useMemo(() => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches, []);
  const touchSurface = flow === "paginated" && coarsePointer && !error;
  const lastSwipeRef = useRef(0);
  const swipeHandlers = useSwipeable({
    onSwipedRight: () => {
      lastSwipeRef.current = Date.now();
      readerRef.current?.prevPage();
    },
    onSwipedLeft: () => {
      lastSwipeRef.current = Date.now();
      readerRef.current?.nextPage();
    },
    preventScrollOnSwipe: true,
  });
  const handleSurfaceClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (Date.now() - lastSwipeRef.current < 350) return;
      const rect = e.currentTarget.getBoundingClientRect();
      handleContentTap((e.clientX - rect.left) / rect.width);
    },
    [handleContentTap],
  );

  // Bumping this remounts <EpubView> (fresh Epub()) — used by the error "Try again".
  const [retryKey, setRetryKey] = useState(0);
  const handleRetry = useCallback(() => {
    setError(null);
    setLoading(true);
    setRetryKey((k) => k + 1);
  }, []);

  const pageMaxWidth = !isMobile && READER_WIDTH_PX[width] ? `${READER_WIDTH_PX[width]}px` : undefined;
  const sliderValue = scrubPct ?? readPct;

  return (
    <Dialog open={props.open} onOpenChange={props.setIsOpen}>
      {!props.hideTrigger && (
        <DialogTrigger asChild>
          {/* The label is hidden on phones, so the name has to come from aria-label. */}
          <Button className="flex w-fit items-center gap-2" aria-label="Open in reader">
            <BookOpen className="text-lg" />
            <span className="hidden sm:inline">Open</span>
          </Button>
        </DialogTrigger>
      )}
      <VisuallyHidden.Root>
        <DialogTitle>{props.title}</DialogTitle>
        <DialogDescription>Read {props.title} in an interactive reader</DialogDescription>
      </VisuallyHidden.Root>
      <DialogContent
        className="h-dvh max-w-screen min-w-screen gap-0 overflow-hidden rounded-none border-0 p-0 backdrop-blur-none"
        showCloseButton={false}
        style={{ background: palette.canvas, color: palette.fg }}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="relative h-full w-full overflow-hidden">
          {/* Reading surface — a centred page on desktop, full-bleed on mobile.
              Clicks that land here (the letterbox margins around the page, not the
              page itself) toggle the chrome, so tapping the dead space works too. */}
          <div className="absolute inset-0 flex justify-center" onClick={(e) => e.target === e.currentTarget && toggleChrome()}>
            <div
              className={cn("relative h-full w-full overflow-hidden transition-[max-width,box-shadow] duration-300", !isMobile && "lg:my-4 lg:h-[calc(100%-2rem)] lg:rounded-[1.25rem]")}
              style={{
                background: palette.bg,
                maxWidth: pageMaxWidth,
                boxShadow: !isMobile
                  ? theme === "dark"
                    ? "0 28px 70px -36px rgba(0,0,0,0.9)"
                    : theme === "sepia"
                      ? "0 24px 60px -36px rgba(91,70,54,0.22)"
                      : "0 24px 60px -36px rgba(0,0,0,0.14)"
                  : undefined,
              }}
            >
              <div className="h-full w-full px-5 pt-[calc(3.5rem+env(safe-area-inset-top))] pb-[calc(4rem+env(safe-area-inset-bottom))] sm:px-8 lg:px-12">
                {sourceReady && (
                  <EpubView
                    key={`${flow}-${retryKey}-${offlineUrl ? "offline" : "online"}`}
                    ref={readerRef}
                    url={effectiveUrl}
                    epubInitOptions={epubInitOptions}
                    flow={flow}
                    appearance={appearance}
                    location={location}
                    tocChanged={setToc}
                    onRelocated={handleRelocated}
                    getRendition={handleRendition}
                    onError={setError}
                    onTap={handleContentTap}
                  />
                )}
              </div>
              {touchSurface && <div {...swipeHandlers} onClick={handleSurfaceClick} className="absolute inset-0 z-10 bg-transparent" />}
            </div>
          </div>

          {/* Top chrome — slides away in immersive mode. */}
          <header
            className={cn(
              "absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 border-b px-3 pt-[calc(0.625rem+env(safe-area-inset-top))] pr-[calc(0.75rem+env(safe-area-inset-right))] pb-2.5 pl-[calc(0.75rem+env(safe-area-inset-left))] backdrop-blur-md backdrop-saturate-150 transition-transform duration-300",
              !chromeVisible && "-translate-y-full",
            )}
            style={{ background: palette.chrome, borderColor: palette.border, color: palette.fg }}
          >
            <div className="flex min-w-0 items-center gap-2">
              <TocSheet toc={toc} currentHref={currentHref} setLocation={jumpTo} bookmarks={bookmarks} onRemoveBookmark={(cfi) => removeBookmark(props.md5, cfi)} palette={palette} />
              <h2 className="line-clamp-1 text-sm font-semibold sm:text-base">{props.title}</h2>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                onClick={toggleBookmark}
                variant="ghost"
                size="icon"
                className="relative size-9 rounded-full"
                aria-label={isCurrentBookmarked ? "Remove bookmark" : "Add bookmark"}
                disabled={!currentCfi}
              >
                <BookmarkCheck className={cn("text-primary size-5 transition-transform duration-500 ease-in-out", isCurrentBookmarked ? "scale-100 rotate-0" : "absolute scale-0 rotate-90")} />
                <Bookmark className={cn("size-5 transition-transform duration-500 ease-in-out", isCurrentBookmarked ? "absolute scale-0 -rotate-90" : "scale-100 rotate-0")} />
              </Button>
              <ReaderSettings link={props.link} isMobile={isMobile} paceWpm={paceWpm} etaLabel={etaLabel} />
              <Button onClick={() => void saveCopy()} variant="ghost" size="icon" className="size-9 rounded-full" aria-label="Download book">
                <DownloadIcon className="size-5" />
              </Button>
              <Button onClick={() => props.setIsOpen(false)} variant="ghost" size="icon" className="size-9 rounded-full" aria-label="Close reader">
                <X className="size-5" />
              </Button>
            </div>
          </header>

          {/* Bottom chrome — compact pill on mobile, full-width bar on desktop. */}
          <footer
            className={cn(
              "absolute inset-x-0 bottom-0 z-20 transition-all duration-300",
              !chromeVisible && "pointer-events-none translate-y-full opacity-0",
              isMobile ? "flex justify-center px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]" : "border-t pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur-md backdrop-saturate-150",
            )}
            style={!isMobile ? { background: palette.chrome, borderColor: palette.border } : undefined}
          >
            {isMobile ? (
              <div
                className="w-full max-w-xl rounded-2xl border px-3 py-2.5 shadow-lg backdrop-blur-md backdrop-saturate-150 sm:px-4"
                style={{ background: palette.chrome, borderColor: palette.border }}
              >
                <div className="flex items-center gap-3">
                  <span className="w-9 text-right text-[0.7rem] tabular-nums" style={{ color: palette.muted }}>
                    {Math.round(sliderValue)}%
                  </span>
                  <div className="relative grow">
                    <Slider
                      aria-label="Reading position"
                      value={[sliderValue]}
                      min={0}
                      max={100}
                      step={0.1}
                      onValueChange={(v) => setScrubPct(v[0])}
                      onValueCommit={(v) => {
                        setScrubPct(null);
                        void seekToPercent(v[0]);
                      }}
                    />
                    {scrubPct != null && previewPage != null && (
                      <div
                        className="pointer-events-none absolute -top-8 z-10 -translate-x-1/2 rounded-md px-2 py-0.5 text-[0.7rem] font-medium tabular-nums shadow-sm"
                        style={{ left: `${sliderValue}%`, background: palette.bg, color: palette.fg, border: `1px solid ${palette.border}` }}
                      >
                        Page {previewPage}
                      </div>
                    )}
                  </div>
                  <span className="w-[4.5rem] text-left text-[0.65rem] leading-tight tabular-nums" style={{ color: palette.muted }}>
                    {minutesLeft != null ? formatMinutesLeft(minutesLeft) : ""}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <Button variant="ghost" size="icon" className="size-9 rounded-full" onClick={() => readerRef.current?.prevPage()} disabled={edges.atStart} aria-label="Previous page">
                    <ChevronLeft className="size-5" />
                  </Button>
                  <div className="min-w-0 text-center">
                    <div className="line-clamp-1 text-xs font-medium">{chapterLabel || props.title}</div>
                    <div className="text-[0.7rem] tabular-nums" style={{ color: palette.muted }}>
                      {page.current === 0 || page.total === 0 ? <Loader2 className="mx-auto size-3 animate-spin" /> : `${page.current} / ${page.total}`}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="size-9 rounded-full" onClick={() => readerRef.current?.nextPage()} disabled={edges.atEnd} aria-label="Next page">
                    <ChevronRight className="size-5" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mx-auto flex w-full max-w-5xl items-center gap-4 px-6 py-3">
                <Button variant="ghost" size="icon" className="size-9 shrink-0 rounded-full" onClick={() => readerRef.current?.prevPage()} disabled={edges.atStart} aria-label="Previous page">
                  <ChevronLeft className="size-5" />
                </Button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <span className="w-10 shrink-0 text-right text-xs tabular-nums" style={{ color: palette.muted }}>
                      {Math.round(sliderValue)}%
                    </span>
                    <div className="relative min-w-0 grow">
                      <Slider
                        aria-label="Reading position"
                        value={[sliderValue]}
                        min={0}
                        max={100}
                        step={0.1}
                        onValueChange={(v) => setScrubPct(v[0])}
                        onValueCommit={(v) => {
                          setScrubPct(null);
                          void seekToPercent(v[0]);
                        }}
                      />
                      {scrubPct != null && previewPage != null && (
                        <div
                          className="pointer-events-none absolute -top-9 z-10 -translate-x-1/2 rounded-md px-2.5 py-1 text-xs font-medium tabular-nums shadow-md"
                          style={{ left: `${sliderValue}%`, background: palette.bg, color: palette.fg, border: `1px solid ${palette.border}` }}
                        >
                          Page {previewPage}
                        </div>
                      )}
                    </div>
                    <span className="hidden w-28 shrink-0 text-left text-xs tabular-nums sm:block" style={{ color: palette.muted }}>
                      {minutesLeft != null ? formatMinutesLeft(minutesLeft) : ""}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-4 px-10">
                    <span className="line-clamp-1 min-w-0 text-xs font-medium">{chapterLabel || props.title}</span>
                    <span className="shrink-0 text-xs tabular-nums" style={{ color: palette.muted }}>
                      {page.current === 0 || page.total === 0 ? "..." : `${page.current} / ${page.total}`}
                    </span>
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="size-9 shrink-0 rounded-full" onClick={() => readerRef.current?.nextPage()} disabled={edges.atEnd} aria-label="Next page">
                  <ChevronRight className="size-5" />
                </Button>
              </div>
            )}
          </footer>

          {error && <ReaderErrorState palette={palette} message={error} onRetry={handleRetry} onClose={() => props.setIsOpen(false)} />}
          {overlayVisible && !error && (
            <ReaderLoadingOverlay percent={percent} isBigBook={isBigBook} fileSize={props.fileSize} messageIndex={msgIndex} palette={palette} onClose={() => props.setIsOpen(false)} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Palette = (typeof READER_THEMES)[keyof typeof READER_THEMES];

function ReaderLoadingOverlay({
  percent,
  isBigBook,
  fileSize,
  messageIndex,
  palette,
  onClose,
}: {
  percent: number;
  isBigBook: boolean;
  fileSize?: string;
  messageIndex: number;
  palette: Palette;
  onClose: () => void;
}) {
  const rounded = Math.round(percent);
  const headline = isBigBook ? "This book's a big one" : "Opening your book";
  const subline = isBigBook ? `${fileSize ? `All ${fileSize} of it — ` : ""}please give us a moment to parse every page.` : "Getting the pages ready for you…";

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 px-6 text-center backdrop-blur-sm transition-opacity" style={{ background: palette.canvas }}>
      {/* Close affordance for the stuck-at-98% case — matches the size-9 rounded-full
          ghost pattern used by the reader's own header/footer icon buttons. */}
      <Button variant="ghost" size="icon" className="absolute top-4 right-4 size-9 rounded-full" onClick={onClose} aria-label="Close reader" style={{ color: palette.muted }}>
        <X className="size-5" />
      </Button>

      <div className="relative flex h-16 w-16 items-center justify-center">
        <Library className="text-primary h-9 w-9" />
        <Loader2 className="text-primary/60 absolute inset-0 h-16 w-16 animate-spin" strokeWidth={1} />
      </div>

      <div className="flex max-w-md flex-col gap-1.5">
        <h3 className="text-xl font-semibold tracking-tight" style={{ color: palette.fg }}>
          {headline}
        </h3>
        <p className="text-sm leading-relaxed" style={{ color: palette.muted }}>
          {subline}
        </p>
      </div>

      <div className="flex w-full max-w-sm flex-col gap-2">
        <Progress value={percent} className="h-2.5" />
        <div className="flex items-center justify-between gap-3 text-xs" style={{ color: palette.muted }}>
          <span className="truncate">{parsingMessageAt(messageIndex)}</span>
          <span className="tabular-nums">{rounded}%</span>
        </div>
      </div>
    </div>
  );
}

function ReaderErrorState({ palette, message, onRetry, onClose }: { palette: Palette; message: string; onRetry: () => void; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-6 px-6 text-center" style={{ background: palette.canvas }}>
      <div className="liquid-orb flex h-20 w-20 items-center justify-center rounded-3xl">
        <BookOpen className="text-primary h-9 w-9" />
      </div>
      <div className="flex max-w-md flex-col gap-1.5">
        <h3 className="text-xl font-semibold tracking-tight" style={{ color: palette.fg }}>
          This book wouldn't open
        </h3>
        <p className="text-sm leading-relaxed" style={{ color: palette.muted }}>
          {message}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={onRetry} className="gap-2">
          <RotateCcw className="size-4" /> Try again
        </Button>
        <Button onClick={onClose} variant="outline" className="gap-2">
          <X className="size-4" /> Close
        </Button>
      </div>
    </div>
  );
}
