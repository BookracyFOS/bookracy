import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, ChevronDown, ExternalLink, Search } from "lucide-react";
import { readingOrderQueryOptions, type ReadingOrderEra, type ReadingOrderFranchise, type ReadingOrderIssue } from "@/api/backend/reading-order/reading-order";
import { findRecommendationList } from "@/lib/recommendation-lists";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Franchise identity accent (H S L triplet, consumed via `hsl(var(--ro-accent) / …)`),
// used for hero/era chrome and hover states. Series-type meaning is carried by the dots.
const ACCENTS: Record<ReadingOrderFranchise, string> = {
  marvel: "356 84% 54%",
  dc: "214 90% 52%",
};

const TYPE_DOT: Record<NonNullable<ReadingOrderIssue["type"]> | "ongoing", string> = {
  ongoing: "bg-muted-foreground/40",
  limited: "bg-amber-400",
  oneshot: "bg-rose-400",
};

/**
 * Renders a full comic reading order (Marvel/DC) scraped from comicbookreadingorders.com.
 * Eras are an accordion — a closed era doesn't mount its (hundreds of) issues, keeping a
 * ~10k-issue page snappy. Clicking an issue hands its title to the existing Search. Summary
 * eras (no issue list on the source) surface their sub-event links + a link out instead.
 */
export function ReadingOrderPage({ franchise }: { franchise: ReadingOrderFranchise }) {
  const meta = findRecommendationList(franchise);
  const { data, isLoading, error } = useQuery(readingOrderQueryOptions(franchise));
  const eras = useMemo(() => data?.readingOrder.eras ?? [], [data]);

  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (!initialized && eras.length) {
      const first = eras.find((e) => e.issues.length) ?? eras[0];
      setOpenIds(new Set(first ? [first.id] : []));
      setInitialized(true);
    }
  }, [eras, initialized]);

  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const totalIssues = useMemo(() => eras.reduce((sum, e) => sum + e.issues.length, 0), [eras]);
  const rootStyle = { "--ro-accent": ACCENTS[franchise] } as CSSProperties;

  return (
    <div className="flex flex-col gap-6" style={rootStyle}>
      {/* Hero */}
      <div className="glass relative overflow-hidden rounded-3xl p-6 sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full blur-3xl" style={{ background: "radial-gradient(closest-side, hsl(var(--ro-accent) / 0.35), transparent)" }} />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl"
            style={{
              background: "linear-gradient(135deg, hsl(var(--ro-accent) / 0.95), hsl(var(--ro-accent) / 0.55))",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,.35), 0 18px 40px -18px hsl(var(--ro-accent) / 0.85)",
            }}
          >
            <BookOpen className="h-7 w-7 text-white" />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="from-foreground to-foreground/60 bg-gradient-to-br bg-clip-text text-3xl font-bold tracking-tight text-transparent sm:text-4xl">
              {data?.readingOrder.title ?? meta?.title ?? "Reading Order"}
            </h1>
            <p className="text-muted-foreground max-w-2xl text-sm sm:text-base">
              {meta?.blurb} Sourced from{" "}
              <a href={data?.readingOrder.source ?? "https://comicbookreadingorders.com"} target="_blank" rel="noopener noreferrer" className="font-medium underline-offset-4 hover:underline" style={{ color: "hsl(var(--ro-accent))" }}>
                comicbookreadingorders.com
              </a>
              . Tap any comic to find it on Bookracy.
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
              {totalIssues > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: "hsl(var(--ro-accent) / 0.14)", color: "hsl(var(--ro-accent))" }}>
                  {totalIssues.toLocaleString()} issues · {eras.length} eras
                </span>
              )}
              <Legend />
            </div>
          </div>
        </div>
      </div>

      {error && <p className="text-destructive text-sm">Couldn’t load this reading order. Please try again later.</p>}

      <div className="flex flex-col gap-3">
        {isLoading
          ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="skeleton-shimmer h-[68px] w-full rounded-2xl" />)
          : eras.map((era, i) => <EraSection key={era.id} index={i + 1} era={era} open={openIds.has(era.id)} onToggle={() => toggle(era.id)} />)}
      </div>
    </div>
  );
}

function Legend() {
  const items: [string, string][] = [
    [TYPE_DOT.ongoing, "Ongoing"],
    [TYPE_DOT.limited, "Limited series"],
    [TYPE_DOT.oneshot, "One-shot"],
  ];
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs">
      {items.map(([dot, label]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className={cn("h-2 w-2 rounded-full", dot)} />
          {label}
        </span>
      ))}
    </div>
  );
}

function EraSection({ index, era, open, onToggle }: { index: number; era: ReadingOrderEra; open: boolean; onToggle: () => void }) {
  const count = era.issues.length;
  const panelId = `era-panel-${era.id}`;

  // Smooth expand/collapse without giving up lazy rendering: the body is only mounted
  // while open (or briefly during the collapse animation). We animate `grid-template-rows`
  // 0fr↔1fr (works with unknown content height); on open we mount collapsed, then flip to
  // expanded on the next frame so the transition actually runs.
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setExpanded(true));
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }
    setExpanded(false);
    const t = setTimeout(() => setMounted(false), 320);
    return () => clearTimeout(t);
  }, [open]);

  return (
    <div className="glass overflow-hidden rounded-2xl transition-shadow duration-300" style={open ? { boxShadow: "inset 3px 0 0 hsl(var(--ro-accent)), inset 0 1px 0 var(--glass-sheen), 0 10px 30px -18px rgba(0,0,0,.55)" } : undefined}>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={panelId} className="glass-hover flex w-full items-center gap-3 p-3 text-left focus-visible:outline-none sm:gap-4 sm:p-4">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold tabular-nums text-white shadow-sm transition-all duration-300"
          style={{ background: open ? "linear-gradient(135deg, hsl(var(--ro-accent) / 0.95), hsl(var(--ro-accent) / 0.6))" : "hsl(var(--ro-accent) / 0.85)" }}
        >
          {index}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="truncate text-base font-semibold tracking-tight sm:text-lg" title={era.name}>
            {era.name}
          </h2>
          {(era.years || era.issuesLabel) && (
            <p className="text-muted-foreground truncate text-xs" title={[era.years, era.issuesLabel].filter(Boolean).join(" · ")}>
              {era.years}
              {era.years && era.issuesLabel && " · "}
              {era.issuesLabel}
            </p>
          )}
        </div>
        <span
          className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums"
          style={count > 0 ? { background: "hsl(var(--ro-accent) / 0.14)", color: "hsl(var(--ro-accent))" } : undefined}
        >
          {count > 0 ? `${count.toLocaleString()}` : "Overview"}
        </span>
        <ChevronDown className={cn("text-muted-foreground h-5 w-5 shrink-0 transition-transform duration-300", open && "rotate-180")} />
      </button>

      <div className="grid transition-[grid-template-rows] duration-300 ease-out" style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}>
        <div className="overflow-hidden">
          {mounted && (
            <div id={panelId} className={cn("border-t border-black/5 px-3 pt-4 pb-4 transition-opacity duration-300 sm:px-4 dark:border-white/10", expanded ? "opacity-100" : "opacity-0")}>
              <EraBody era={era} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EraBody({ era }: { era: ReadingOrderEra }) {
  const navigate = useNavigate();
  // Pre-apply the "Comics" content filter — a reading-order click is always for a comic
  // issue, and defaulting to all content-types buries the actual comics under paperback
  // novelisations and adaptations. Ext stays wide open so both cbr and cbz uploads
  // (and the occasional PDF scan) still surface.
  const search = (title: string) =>
    navigate({ to: "/", search: { q: title, content: "book_comic" } });

  return (
    <div className="flex flex-col gap-4">
      {(era.description || era.events || era.firstAppearances) && (
        <div className="glass-subtle flex flex-col gap-2 rounded-xl p-3.5 text-sm">
          {era.description && <p className="text-muted-foreground leading-relaxed whitespace-pre-line">{era.description}</p>}
          {era.events && (
            <p className="text-muted-foreground text-xs">
              <span className="text-foreground font-semibold">Events:</span> {era.events}
            </p>
          )}
          {era.firstAppearances && (
            <p className="text-muted-foreground line-clamp-2 text-xs" title={era.firstAppearances}>
              <span className="text-foreground font-semibold">First appearances:</span> {era.firstAppearances}
            </p>
          )}
        </div>
      )}

      {era.issues.length > 0 ? (
        <ol className="grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-2 xl:grid-cols-3">
          {era.issues.map((issue, i) => (
            <IssueRow key={i} n={i + 1} issue={issue} onClick={() => search(issue.title)} />
          ))}
        </ol>
      ) : (
        <SummaryEra era={era} />
      )}
    </div>
  );
}

function IssueRow({ n, issue, onClick }: { n: number; issue: ReadingOrderIssue; onClick: () => void }) {
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onClick}
        title={`Search Bookracy for ${issue.title}${issue.note ? ` — ${issue.note}` : ""}`}
        className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[hsl(var(--ro-accent)/0.1)] focus-visible:bg-[hsl(var(--ro-accent)/0.1)] focus-visible:outline-none"
      >
        <span className="text-muted-foreground/70 w-6 shrink-0 text-right text-[11px] tabular-nums">{n}</span>
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TYPE_DOT[issue.type ?? "ongoing"])} />
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="group-hover:text-[hsl(var(--ro-accent))]">{issue.title}</span>
          {issue.year && <span className="text-muted-foreground ml-1 text-xs">({issue.year})</span>}
          {issue.note && <span className="text-muted-foreground/80 ml-1.5 text-xs italic">· {issue.note}</span>}
        </span>
        <Search className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" style={{ color: "hsl(var(--ro-accent))" }} />
      </button>
    </li>
  );
}

function SummaryEra({ era }: { era: ReadingOrderEra }) {
  return (
    <div className="flex flex-col gap-3">
      {era.subEvents && era.subEvents.length > 0 && (
        <>
          <p className="text-muted-foreground text-sm">This era’s issue-by-issue order is split into sub-events on the source:</p>
          <div className="flex flex-wrap gap-2">
            {era.subEvents.map((sub) => (
              <a key={sub.url} href={sub.url} target="_blank" rel="noopener noreferrer" className="glass glass-hover inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium">
                {sub.name}
                <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
            ))}
          </div>
        </>
      )}
      <a href={era.url} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline" style={{ color: "hsl(var(--ro-accent))" }}>
        View the full order on comicbookreadingorders.com
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}
