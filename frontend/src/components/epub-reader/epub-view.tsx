import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import type { Book, NavItem, Rendition } from "epubjs";
import type { BookOptions } from "epubjs/types/book";
import { applyAppearance } from "./apply-appearance";
import type { ReaderAppearance } from "@/stores/reader";

export type ReaderFlow = "paginated" | "scrolled";

/** A structured relocation from epub.js's `relocated` event — everything the shell
 *  needs to drive the page counter, chapter label, scrubber and edge detection. */
export interface Relocation {
  cfi: string;
  href: string;
  atStart: boolean;
  atEnd: boolean;
}

export type IEpubViewProps = {
  url: string | ArrayBuffer;
  epubInitOptions?: Partial<BookOptions>;
  /** Position to show (CFI or href). Absent means "from the start". */
  location?: string | number;
  /**
   * "paginated" (default) flips page-by-page; "scrolled" is a single continuous
   * vertical scroll — much nicer on touch devices where swiping = scrolling.
   * Changing this should remount the component (e.g. via a `key`) so epub.js
   * re-renders with the new manager.
   */
  flow?: ReaderFlow;
  /** Reader appearance (theme/typeface/size/leading/justify) — applied live. */
  appearance: ReaderAppearance;
  onRelocated(info: Relocation): void;
  tocChanged?(value: NavItem[]): void;
  getRendition?(rendition: Rendition): void;
  onError?(message: string): void;
  /**
   * A plain tap/click on the book's own page (not on a link, not the end of a text
   * selection), with the horizontal position as a 0..1 ratio of the page width.
   * Delivered through epub.js's relayed iframe events, so the page stays a real,
   * selectable, clickable document instead of sitting under an invisible overlay.
   */
  onTap?(ratio: number): void;
};

/**
 * What to hand `rendition.display()`. A CFI or an href is a real position; anything
 * else ("1", 1, undefined) means "the start". `display("1")` is NOT the start — epub.js
 * reads a bare integer as a spine index, i.e. the second section.
 */
function displayTarget(location: string | number | undefined): string | undefined {
  if (location === undefined || location === null) return undefined;
  const s = String(location).trim();
  if (!s || /^\d+$/.test(s)) return undefined;
  return s;
}

export interface EpubViewInstance {
  nextPage: () => void;
  prevPage: () => void;
}

export const EpubView = forwardRef<EpubViewInstance, IEpubViewProps>(
  ({ url, epubInitOptions = {}, location, flow = "paginated", appearance, onRelocated, tocChanged, getRendition, onError, onTap }, ref) => {
    const viewerRef = useRef<HTMLDivElement>(null);
    const bookRef = useRef<Book | null>(null);
    const renditionRef = useRef<Rendition | null>(null);
    // Read the latest appearance at init time without making initBook depend on it.
    const appearanceRef = useRef(appearance);
    appearanceRef.current = appearance;
    // Same for the requested position. `initReader` used to close over the `location`
    // of the render that created it, and the mount effect held on to the FIRST
    // `initReader` forever — so every (re)open displayed whatever position the reader
    // had when it first mounted (typically "1"), and the relocation that followed
    // overwrote the saved progress with it.
    const locationRef = useRef(location);
    locationRef.current = location;

    const handleRelocated = useCallback(
      (loc: { start?: { cfi?: string; href?: string }; atStart?: boolean; atEnd?: boolean }) => {
        if (!loc?.start?.cfi) return;
        onRelocated({ cfi: loc.start.cfi, href: loc.start.href ?? "", atStart: !!loc.atStart, atEnd: !!loc.atEnd });
      },
      [onRelocated],
    );

    const prevPage = useCallback(() => {
      renditionRef.current?.prev();
    }, []);

    const nextPage = useCallback(() => {
      renditionRef.current?.next();
    }, []);

    const handleKeys = useCallback(
      (event: KeyboardEvent) => {
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.key === "ArrowRight" || event.key === "PageDown") {
          nextPage();
        } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
          prevPage();
        } else if (event.key === " " && flow === "paginated") {
          event.preventDefault();
          nextPage();
        }
      },
      [prevPage, nextPage, flow],
    );

    const onTapRef = useRef(onTap);
    onTapRef.current = onTap;

    const initReader = useCallback(
      async (book: Book) => {
        if (!viewerRef.current) return;

        const rendition = book.renderTo(viewerRef.current, {
          width: "100%",
          height: "100%",
          // Continuous vertical scroll on touch; classic pagination on desktop.
          ...(flow === "scrolled" ? { flow: "scrolled", manager: "continuous" } : { flow: "paginated" }),
          allowScriptedContent: false,
        });
        renditionRef.current = rendition;
        applyAppearance(rendition, appearanceRef.current);
        rendition.on("relocated", handleRelocated);

        // Interaction with the page itself. epub.js re-emits the iframe's DOM events
        // (click / touchstart / touchend), so tap zones and swipes can be read off the
        // real document — which leaves text selection, footnotes and links working.
        type Relayed = MouseEvent & { view?: (Window & typeof globalThis) | null };
        const isPlainTap = (e: Relayed) => {
          const target = e.target as Element | null;
          if (target?.closest?.("a, button, input, textarea, select, video, audio")) return false;
          const sel = e.view?.getSelection?.();
          return !(sel && sel.toString().length > 0);
        };
        let touchStart: { x: number; y: number; t: number } | null = null;
        let swipedAt = 0;
        // A click that ends far from where the mouse went down is the tail of a
        // drag-select, not a tap — the selection may already be collapsed by then.
        let mouseDownAt: { x: number; y: number } | null = null;
        rendition.on("mousedown", (e: MouseEvent) => {
          mouseDownAt = { x: e.clientX, y: e.clientY };
        });
        const touches = (e: TouchEvent) => e.changedTouches?.[0] ?? e.touches?.[0];
        rendition.on("touchstart", (e: TouchEvent) => {
          const t = touches(e);
          touchStart = t ? { x: t.clientX, y: t.clientY, t: Date.now() } : null;
        });
        rendition.on("touchend", (e: TouchEvent) => {
          const t = touches(e);
          if (!touchStart || !t) return;
          const dx = t.clientX - touchStart.x;
          const dy = t.clientY - touchStart.y;
          touchStart = null;
          // A horizontal flick in paginated mode turns the page; scrolled mode scrolls.
          if (flow === "paginated" && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            swipedAt = Date.now();
            if (dx < 0) rendition.next();
            else rendition.prev();
          }
        });
        rendition.on("click", (e: Relayed) => {
          if (Date.now() - swipedAt < 400) return; // the tail of a swipe, not a tap
          if (mouseDownAt && Math.hypot(e.clientX - mouseDownAt.x, e.clientY - mouseDownAt.y) > 6) return;
          if (!isPlainTap(e)) return;
          const width = e.view?.innerWidth || 0;
          onTapRef.current?.(width > 0 ? e.clientX / width : 0.5);
        });
        // Two-finger horizontal trackpad scroll flips pages on desktop. The wheel
        // event fires inside the iframe, so it has to be attached to each chapter's
        // document as it renders.
        if (flow === "paginated") {
          rendition.hooks.content.register((contents: { document: Document }) => {
            contents.document.addEventListener(
              "wheel",
              (ev: WheelEvent) => {
                if (Math.abs(ev.deltaX) <= Math.abs(ev.deltaY) || Math.abs(ev.deltaX) < 8) return;
                ev.preventDefault();
                if (ev.deltaX > 0) rendition.next();
                else rendition.prev();
              },
              { passive: false },
            );
          });
        }

        try {
          const { toc } = await book.loaded.navigation;
          // The book may have been destroyed/replaced while loading (e.g. React
          // StrictMode's double-mount in dev); bail before rendering a dead book.
          if (bookRef.current !== book) return;
          tocChanged?.(toc);
        } catch {
          /* navigation is optional — keep going even if it fails */
        }

        if (bookRef.current !== book) return;
        rendition.display(displayTarget(locationRef.current));

        getRendition?.(rendition);
      },
      [tocChanged, getRendition, flow, handleRelocated],
    );
    const initReaderRef = useRef(initReader);
    initReaderRef.current = initReader;

    useEffect(() => {
      let cancelled = false;
      let raf = 0;

      const initBook = async () => {
        // epub.js is ~340 KB and only needed once a book is actually opened, so it is
        // fetched here rather than shipped with every page load.
        const { default: Epub } = await import("epubjs");
        if (cancelled) return;
        if (bookRef.current) bookRef.current.destroy();

        const book = Epub(url, epubInitOptions);
        bookRef.current = book;
        // Surface a clean error if the file can't be opened (corrupt / not an EPUB /
        // network failure) instead of leaving the loading spinner up forever. epub.js
        // never rejects `book.opened` — it swallows the failure and emits `openFailed`.
        (book as unknown as { on: (event: string, fn: () => void) => void }).on("openFailed", () => {
          if (bookRef.current === book) onError?.("We couldn't open this book — the file may be corrupt or unavailable.");
        });
        void initReaderRef.current(book);
      };

      // epub.js paginates against the container's measured size. If renderTo runs
      // while the reader dialog is still animating open (0x0), it never lays out
      // and stays stuck at 0%. Wait until the viewer actually has dimensions.
      const startWhenSized = () => {
        if (cancelled) return;
        const el = viewerRef.current;
        if (el && el.clientWidth > 0 && el.clientHeight > 0) {
          void initBook();
        } else {
          raf = requestAnimationFrame(startWhenSized);
        }
      };

      startWhenSized();
      document.addEventListener("keyup", handleKeys);

      // Reflow when the reading column is resized (page-width change, window /
      // orientation change). The container size is layout-driven, not content-driven,
      // so this can't loop. Debounced to coalesce rapid changes.
      let lastW = 0;
      let lastH = 0;
      let resizeTimer = 0;
      const observer = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect;
        if (!rect) return;
        const w = Math.round(rect.width);
        const h = Math.round(rect.height);
        if (w <= 0 || h <= 0 || (w === lastW && h === lastH)) return;
        const first = lastW === 0;
        lastW = w;
        lastH = h;
        if (first) return; // initial measure is handled by startWhenSized()
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => {
          try {
            renditionRef.current?.resize(w, h);
          } catch {
            /* a resize during teardown is harmless */
          }
        }, 150);
      });
      if (viewerRef.current) observer.observe(viewerRef.current);

      return () => {
        cancelled = true;
        cancelAnimationFrame(raf);
        window.clearTimeout(resizeTimer);
        observer.disconnect();
        bookRef.current?.destroy();
        bookRef.current = null;
        renditionRef.current = null;
        document.removeEventListener("keyup", handleKeys);
      };
      // url/epubInitOptions are fixed for the life of a mount (the parent keys on them).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [handleKeys]);

    // Live appearance changes (theme / font / size / leading / justify).
    useEffect(() => {
      if (renditionRef.current) applyAppearance(renditionRef.current, appearance);
    }, [appearance]);

    // External location changes (resume position, TOC jump, scrubber seek).
    useEffect(() => {
      if (renditionRef.current && location) {
        renditionRef.current.display(displayTarget(location));
      }
    }, [location]);

    useImperativeHandle(ref, () => ({
      nextPage,
      prevPage,
    }));

    return (
      <div className="h-full w-full">
        <div className="h-full w-full" ref={viewerRef} />
      </div>
    );
  },
);
