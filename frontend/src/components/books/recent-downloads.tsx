import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { BookOpen, ChevronLeft, ChevronRight, Clock, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { getRecentDownloadsQueryOptions, type RecentDownload } from "@/api/backend/recent/recent";
import { useSettingsStore } from "@/stores/settings";
import { cn } from "@/lib/utils";

function RecentCard({ item, backendURL }: { item: RecentDownload; backendURL: string }) {
  const navigate = useNavigate();
  const [imgOk, setImgOk] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const cover = `${backendURL}/cover/${item.md5}/thumbnail.jpg`;

  return (
    <button
      type="button"
      title={item.title}
      aria-label={`Search for ${item.title}`}
      onClick={() => navigate({ to: "/", search: { q: item.title } })}
      className="glass glass-hover group flex w-full cursor-pointer flex-col gap-2 rounded-xl p-2 text-left"
    >
      <div className="bg-muted/40 relative aspect-[2/3] w-full overflow-hidden rounded-lg">
        {imgOk ? (
          <>
            {!loaded && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
              </div>
            )}
            <img
              src={cover}
              alt={item.title}
              loading="lazy"
              onLoad={() => setLoaded(true)}
              onError={() => setImgOk(false)}
              className={cn("h-full w-full object-cover transition-all duration-300 group-hover:scale-105", loaded ? "opacity-100" : "opacity-0")}
            />
          </>
        ) : (
          <div className="text-muted-foreground flex h-full w-full items-center justify-center">
            <BookOpen className="h-8 w-8 opacity-40" />
          </div>
        )}
      </div>
      <span className="line-clamp-2 min-h-[2.5rem] text-sm leading-snug font-medium">{item.title}</span>
    </button>
  );
}

/**
 * The "Recently downloaded" section of the Library page — heading and carousel together,
 * so the whole thing can disappear as one unit.
 *
 * The feed is proxied from Anna's Archive, which has been unreachable from the backend
 * since 2026-08-13 (DDoS-Guard on every datacenter egress, and its new domains refuse
 * Worker fetches outright). Until then this rendered a heading, a "live look at what
 * people are grabbing" blurb and a "check back in a bit" line — for a month. An empty
 * feed now renders nothing at all; the section comes back by itself the moment the
 * backend has something to show.
 */
export function RecentDownloadsSection() {
  const { data, isLoading } = useQuery(getRecentDownloadsQueryOptions);
  const items = data?.recent ?? [];
  if (!isLoading && items.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Clock className="text-primary h-6 w-6" />
          Recently downloaded
        </div>
        <p className="text-muted-foreground max-w-2xl text-sm sm:text-base">
          A live look at what people are grabbing across the network. Tap any cover to find it.
        </p>
      </div>
      <RecentDownloadsCarousel items={items} isLoading={isLoading} />
    </div>
  );
}

function RecentDownloadsCarousel({ items, isLoading }: { items: RecentDownload[]; isLoading: boolean }) {
  const backendURL = useSettingsStore((s) => s.backendURL);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const scrollByPage = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (el) el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.85), behavior: "smooth" });
  };

  if (isLoading) {
    return (
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="glass flex w-[140px] shrink-0 flex-col gap-2 rounded-xl p-2 sm:w-[160px]">
            <div className="skeleton-shimmer bg-muted/40 aspect-[2/3] w-full rounded-lg" />
            <div className="bg-muted/40 h-4 w-3/4 rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="group/carousel relative">
      <button
        type="button"
        aria-label="Scroll left"
        onClick={() => scrollByPage(-1)}
        className="glass glass-hover absolute top-1/2 left-0 z-10 hidden h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full opacity-0 transition-opacity group-hover/carousel:opacity-100 sm:flex"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button
        type="button"
        aria-label="Scroll right"
        onClick={() => scrollByPage(1)}
        className="glass glass-hover absolute top-1/2 right-0 z-10 hidden h-10 w-10 translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full opacity-0 transition-opacity group-hover/carousel:opacity-100 sm:flex"
      >
        <ChevronRight className="h-5 w-5" />
      </button>

      <div
        ref={scrollerRef}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => (
          <div key={item.md5} className="w-[140px] shrink-0 snap-start sm:w-[160px]">
            <RecentCard item={item} backendURL={backendURL} />
          </div>
        ))}
      </div>
    </div>
  );
}
