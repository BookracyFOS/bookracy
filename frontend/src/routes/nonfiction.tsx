import { createFileRoute } from "@tanstack/react-router";
import { NonfictionPage, type NonfictionSearch } from "@/components/nonfiction/nonfiction-page";

export const Route = createFileRoute("/nonfiction")({
  component: RouteComponent,
  // Every filter lives in the URL so a view like "Pulitzer winners of the 2010s" is a
  // shareable link. Values are re-validated server-side against the dataset, so an
  // edited param can only ever widen the result set, never break the page.
  validateSearch: (search): NonfictionSearch => {
    // TanStack JSON-parses each param, so a bare `?decade=2010` arrives as the NUMBER
    // 2010 while a value we wrote as a string round-trips as `%222010%22`. Coercing
    // both ways keeps hand-written links working and keeps the URL readable — decade
    // and page are therefore modelled as numbers.
    const str = (v: unknown): string | undefined => {
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
      return undefined;
    };
    const num = (v: unknown): number | undefined => {
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
      return Number.isFinite(n) ? Math.floor(n) : undefined;
    };

    const out: NonfictionSearch = {};
    const program = str(search.program);
    const subject = str(search.subject);
    const status = str(search.status);
    const decade = num(search.decade);
    const q = str(search.q);
    const sort = str(search.sort);
    const page = num(search.page);
    if (program) out.program = program;
    if (subject) out.subject = subject;
    if (status) out.status = status;
    if (decade) out.decade = decade;
    if (q) out.q = q;
    if (sort) out.sort = sort;
    if (page && page > 1) out.page = page;
    return out;
  },
});

function RouteComponent() {
  return <NonfictionPage search={Route.useSearch()} />;
}
