import { queryOptions } from "@tanstack/react-query";
import { BookItem } from "../types";
import { client } from "../base";

// Trending is served by the backend off the live Apple Books bestseller charts, then
// resolved to real downloadable Bookracy results. The response is keyed by shelf label
// ("trending" for the overall chart, "Top in Mystery & Thriller" for a genre), so the
// heading travels with the data and the homepage just renders one shelf per key.
const getTrending = async (genreId: string) => {
  const suffix = genreId ? `?genre=${encodeURIComponent(genreId)}` : "";
  return client<Record<string, BookItem[]>>(`/trending${suffix}`);
};

export const trendingQueryOptions = (genreId: string = "") =>
  queryOptions({
    queryKey: ["trending_books", genreId],
    queryFn: () => getTrending(genreId),
    // The backend rebuilds a chart at most once every six hours (each miss costs a
    // burst of upstream searches), so anything shorter is a guaranteed-identical trip.
    staleTime: 6 * 60 * 60 * 1000,
  });
