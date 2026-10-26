import { useQuery } from "@tanstack/react-query";
import { Star, BookOpen, Building2, Barcode, Library } from "lucide-react";
import { cn } from "@/lib/utils";
import { bookMetadataQueryOptions } from "@/api/backend/apple/apple";

/** Five stars with a partial fill for the fractional part, mirroring the store UI. */
function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        return (
          <span key={i} className="relative inline-block h-3.5 w-3.5">
            <Star className="text-muted-foreground/30 absolute inset-0 h-3.5 w-3.5" />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
            </span>
          </span>
        );
      })}
    </span>
  );
}

function EnrichChip({ icon: Icon, children }: { icon: typeof Star; children: React.ReactNode }) {
  return (
    <span className="glass-subtle text-muted-foreground inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs">
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{children}</span>
    </span>
  );
}

/**
 * Extra book detail sourced from Apple Books — star rating, publisher blurb, page
 * count, publisher and ISBN. Anna's Archive gives us none of that, and a good chunk
 * of results arrive with an empty description.
 *
 * Renders nothing at all when there's no match, so a book we can't enrich looks
 * exactly as it did before. Only mounts when the detail dialog is actually open.
 */
/**
 * Just the blurb, for the result card.
 *
 * Anna's Archive used to supply descriptions and can't any more, so a card with no
 * description of its own reads "No summary available" — which is now most of them.
 * Apple has one, and crucially the *cover* lookup for this same card already fetched
 * it: `appleCover` warms `/api/metadata/<md5>` with the full record on its way past.
 * So on a card whose cover resolved through Apple this is a cache hit, not a new call.
 *
 * Strictly additive — renders the original fallback text until (and unless) a blurb
 * arrives, so a book Apple doesn't know looks exactly as it did before.
 */
export function BookBlurb({ md5, title, author, className }: { md5: string; title: string; author: string; className?: string }) {
  const { data } = useQuery(bookMetadataQueryOptions(md5, title, author, Boolean(md5 && title)));
  // Apple's blurb is HTML (`<b>`, `<br />`); same stripping the dialog already does.
  const blurb = stripHtml(data?.metadata?.description ?? "").trim();
  if (!blurb) return <p className={cn(className, "italic")}>No summary available.</p>;
  return <p className={className}>{blurb}</p>;
}

export function BookEnrichment({ md5, title, author, hasDescription }: { md5: string; title: string; author: string; hasDescription: boolean }) {
  const { data } = useQuery(bookMetadataQueryOptions(md5, title, author, true));
  const meta = data?.metadata;
  if (!meta) return null;

  const showRating = meta.rating > 0 && meta.ratingCount > 0;
  // Anna's Archive descriptions win when present — they describe the actual file.
  // Apple's publisher blurb only fills the gap, and arrives as HTML.
  const blurb = !hasDescription && meta.description ? meta.description : "";
  // Series is the one Apple knows and libgen never does — "Book 1 of Mistborn" is the
  // single most useful thing on this panel for anyone reading in order.
  const series = meta.seriesName ? [meta.seriesPosition, meta.seriesName].filter(Boolean).join(" of ") : "";
  const extras = [
    series && <EnrichChip key="series" icon={Library}>{series}</EnrichChip>,
    meta.pageCount > 0 && <EnrichChip key="pages" icon={BookOpen}>{meta.pageCount} pages</EnrichChip>,
    meta.publisher && <EnrichChip key="pub" icon={Building2}>{meta.publisher}</EnrichChip>,
    meta.isbn && <EnrichChip key="isbn" icon={Barcode}>{meta.isbn}</EnrichChip>,
  ].filter(Boolean);

  if (!showRating && !blurb && extras.length === 0) return null;

  return (
    <div className={cn("border-border/50 animate-in fade-in-0 flex flex-col gap-3 border-t pt-3 duration-200 ease-out")}>
      {showRating && (
        <div className="flex items-center gap-2">
          <Stars value={meta.rating} />
          <span className="text-sm font-semibold tabular-nums">{meta.rating.toFixed(1)}</span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {meta.ratingCount.toLocaleString()} rating{meta.ratingCount === 1 ? "" : "s"}
          </span>
        </div>
      )}

      {blurb && <p className="text-muted-foreground text-sm leading-relaxed">{stripHtml(blurb)}</p>}

      {extras.length > 0 && <div className="flex flex-wrap gap-2">{extras}</div>}

      <p className="text-muted-foreground/70 text-[11px]">Rating and publisher details from Apple Books.</p>
    </div>
  );
}

// Apple's description is a publisher-supplied HTML fragment (<b>, <i>, <br />). We
// render it as plain text rather than dangerouslySetInnerHTML — untrusted third-party
// markup is not worth an XSS surface for some bold tags.
//
// The backend now flattens this at the source (`htmlToPlainText` in apple.ts), so on a
// fresh record this is a no-op. It stays as the last line of defence for anything the
// backend hasn't normalised — a cached pre-v3 metadata entry, a community upload, a
// future source — and it has to actually be correct to be worth keeping.
//
// It previously handled six *named* entities and no numeric ones, which is how
// "BESTSELLER&#xa0;*&#xa0;The multimillion-copy…" reached a live card: Apple separates
// blurb clauses with `&#xa0;`. Decoding is one pass over `&…;` — chaining .replace()
// lets `&amp;lt;` decode twice into `<`.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "\u2014", ndash: "\u2013", hellip: "\u2026", middot: "\u00b7", bull: "\u2022",
  lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201c", rdquo: "\u201d", trade: "\u2122",
  copy: "\u00a9", reg: "\u00ae", deg: "\u00b0", eacute: "\u00e9", laquo: "\u00ab", raquo: "\u00bb",
};

function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, ref: string) => {
      if (ref[0] === "#") {
        const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return match;
        if (code === 0xa0 || code === 0x2007 || code === 0x202f) return " ";
        return String.fromCodePoint(code);
      }
      return NAMED_ENTITIES[ref.toLowerCase()] ?? match;
    })
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
