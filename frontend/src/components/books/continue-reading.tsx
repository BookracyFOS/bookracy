import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { BookOpen, Cloud, Laptop, Play, X } from "lucide-react";
import { AspectRatio } from "../ui/aspect-ratio";
import { Button } from "../ui/button";
import { Progress } from "../ui/progress";
import { BookCover } from "./book-cover";
import { EpubReader } from "../epub-reader/epub-reader";
import { bookByMd5QueryOptions } from "@/api/backend/search/search";
import { selectInProgress, useReadingProgressStore } from "@/stores/progress";
import { useResumeCardStore } from "@/stores/resume-card";
import { useSyncStore } from "@/stores/sync";
import { getDeviceId } from "@/lib/device";
import { resolveResumeTarget, resumePercent, type ResumeTarget } from "@/lib/resume";

/** "just now" / "2h ago" / "yesterday" / "3 Mar" — short enough for an eyebrow line. */
function timeAgo(ts?: number): string | null {
  if (!ts) return null;
  const diff = Date.now() - ts;
  if (diff < 0) return "just now";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * "Pick up where you left off" — the single most recently read book, resumed in one tap.
 *
 * Positions are per-md5 and sync through the account blob, so this card is the
 * cross-device payoff: read three chapters on a laptop, open the phone, and the same
 * book is sitting here at the same page (with a note saying where you left it).
 * Everything else in progress lives on the bookshelf, one click away — this stays a
 * single book on purpose, so the home page has one obvious thing to do.
 *
 * Renders nothing when there's nothing in progress, or when the card is dismissed.
 */
export function ContinueReading() {
  const readingProgress = useReadingProgressStore((state) => state.readingProgress);
  const syncEnabled = useSyncStore((state) => state.enabled);
  const dismissedMd5 = useResumeCardStore((state) => state.dismissedMd5);
  const dismissedAt = useResumeCardStore((state) => state.dismissedAt);
  const dismiss = useResumeCardStore((state) => state.dismiss);
  const restore = useResumeCardStore((state) => state.restore);
  const [target, setTarget] = useState<ResumeTarget | null>(null);
  const [readerOpen, setReaderOpen] = useState(false);

  const hero = useMemo(() => selectInProgress(readingProgress)[0], [readingProgress]);

  // Positions saved before the reader started recording book metadata carry only an
  // md5. That's one lookup for one book, so resolve it rather than showing a nameless
  // card — and once it's opened, the reader records the real metadata for next time.
  const needsLookup = Boolean(hero && !hero.title);
  const { data: resolvedBook } = useQuery({ ...bookByMd5QueryOptions(hero?.md5 ?? ""), enabled: needsLookup && Boolean(hero?.md5) });

  // Write what we learned back onto the position (without restamping it), so the
  // lookup happens once for the life of the book instead of on every page load.
  const annotate = useReadingProgressStore((state) => state.annotateReadingProgress);
  useEffect(() => {
    if (!hero || !resolvedBook) return;
    annotate(hero.md5, {
      title: resolvedBook.title,
      author: resolvedBook.author,
      image: resolvedBook.book_image,
      link: resolvedBook.link,
      size: resolvedBook.book_size,
    });
  }, [hero, resolvedBook, annotate]);

  const heroTarget = useMemo(() => {
    if (!hero) return null;
    const base = resolveResumeTarget(hero);
    if (!resolvedBook) return base;
    // What the position itself remembers always wins; the lookup only fills gaps.
    return {
      ...base,
      title: hero.title?.trim() || resolvedBook.title || base.title,
      author: hero.author || resolvedBook.author,
      link: hero.link || resolvedBook.link || base.link,
      image: hero.image || resolvedBook.book_image || base.image,
      size: hero.size || resolvedBook.book_size,
    };
  }, [hero, resolvedBook]);

  // Only worth naming the device when the position actually came from a different one.
  const fromElsewhere = hero?.device && hero.deviceId && hero.deviceId !== getDeviceId() ? hero.device : null;

  // Dismissal is pinned to this book at this position, so reading it further — or
  // picking up something else — brings the card back without any hunting for a setting.
  const isDismissed = Boolean(hero && hero.md5 === dismissedMd5 && (hero.updatedAt ?? 0) <= dismissedAt);

  const resume = () => {
    if (!heroTarget) return;
    setTarget(heroTarget);
    setReaderOpen(true);
  };

  const hide = () => {
    if (!hero) return;
    dismiss(hero.md5, hero.updatedAt ?? 0);
    toast("Hidden until you read it again.", { action: { label: "Undo", onClick: restore } });
  };

  // Mounted only once a book has been chosen, and driven entirely from this card —
  // the reader's own "Open" trigger stays out of the layout. It lives outside the
  // section below on purpose: reaching the last page drops the book out of the
  // in-progress list, and that must not tear the open reader out of the tree.
  const reader = target && (
    <EpubReader
      key={target.md5}
      title={target.title}
      author={target.author}
      md5={target.md5}
      link={target.link}
      coverImage={target.image}
      fileSize={target.size}
      open={readerOpen}
      setIsOpen={setReaderOpen}
      hideTrigger
    />
  );

  if (!hero || !heroTarget || isDismissed) return reader || null;

  const pct = resumePercent(hero);
  const when = timeAgo(hero.updatedAt);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <BookOpen className="text-primary h-6 w-6 shrink-0" />
          Continue reading
        </h2>
        <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-foreground shrink-0">
          <Link to="/lists">View bookshelf</Link>
        </Button>
      </div>

      <div className="glass glass-hover relative overflow-hidden rounded-2xl">
        {/* The cover, blown up and blurred, tints the card with the book's own palette. */}
        {heroTarget.image && (
          <div aria-hidden className="pointer-events-none absolute inset-0 scale-125 bg-cover bg-center opacity-20 blur-3xl" style={{ backgroundImage: `url("${heroTarget.image}")` }} />
        )}
        <div aria-hidden className="from-background/60 pointer-events-none absolute inset-0 bg-gradient-to-r via-transparent to-transparent" />

        <Button
          size="icon"
          variant="ghost"
          onClick={hide}
          aria-label="Hide this card"
          title="Hide until you read it again"
          className="text-muted-foreground hover:text-foreground absolute top-2 right-2 z-10 size-8 rounded-full"
        >
          <X className="size-4" />
        </Button>

        <div className="relative flex gap-4 p-4 sm:gap-6 sm:p-5">
          <div className="w-20 shrink-0 sm:w-28">
            <AspectRatio ratio={5 / 8} className="w-full">
              <BookCover src={heroTarget.image} alt={heroTarget.title} onClick={resume} showCaption={false} className="shadow-lg" />
            </AspectRatio>
          </div>

          <div className="flex min-w-0 flex-1 flex-col justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1 pr-8">
              <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium tracking-wide uppercase">
                <span className="text-primary">Pick up where you left off</span>
                {when && <span className="opacity-60">· {when}</span>}
                {fromElsewhere && (
                  <span className="glass-subtle text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] normal-case">
                    <Laptop className="h-3 w-3" />
                    from {fromElsewhere}
                  </span>
                )}
              </div>
              <h3 className="line-clamp-2 text-lg font-bold tracking-tight sm:text-xl">{heroTarget.title}</h3>
              {heroTarget.author && <p className="text-muted-foreground truncate text-xs sm:text-sm">by {heroTarget.author}</p>}
              {hero.chapter && <p className="text-muted-foreground/80 mt-0.5 truncate text-xs italic">{hero.chapter}</p>}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <Progress value={pct} className="h-1.5 flex-1" />
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{Math.round(pct)}%</span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs tabular-nums">
                  {hero.totalPages > 0 ? `Page ${hero.currentPage} of ${hero.totalPages}` : "Just started"}
                </span>
                <Button size="sm" className="gap-2 rounded-xl" onClick={resume}>
                  <Play className="h-4 w-4 fill-current" />
                  Continue
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {!syncEnabled && (
        <p className="text-muted-foreground text-xs">
          <Cloud className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
          Reading on more than one device?{" "}
          <Link to="/settings" className="text-primary underline-offset-4 hover:underline">
            Turn on sync
          </Link>{" "}
          and your place in every book follows you.
        </p>
      )}

      {reader}
    </section>
  );
}
