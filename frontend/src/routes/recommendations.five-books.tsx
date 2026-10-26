import { createFileRoute } from "@tanstack/react-router";
import { FiveBooksPage, type FiveBooksView } from "@/components/recommendations/five-books-page";

export const Route = createFileRoute("/recommendations/five-books")({
  component: RouteComponent,
  // Deep-linkable browse state: a category path, a best-of year, or an interview slug.
  validateSearch: (search: Record<string, unknown>): FiveBooksView => ({
    cat: typeof search.cat === "string" ? search.cat : undefined,
    best: typeof search.best === "string" ? search.best : undefined,
    interview: typeof search.interview === "string" ? search.interview : undefined,
  }),
});

function RouteComponent() {
  const search = Route.useSearch();
  return <FiveBooksPage {...search} />;
}
