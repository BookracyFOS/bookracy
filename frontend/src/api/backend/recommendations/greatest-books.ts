import { queryOptions } from "@tanstack/react-query";
import { client } from "../base";

// A single entry from a thegreatestbooks.org ranked list. Intentionally light:
// clicking one runs a normal Bookracy search to resolve it to real, downloadable
// results, so we never resolve a whole list upfront.
export interface GreatestBook {
  rank: number;
  title: string;
  author: string;
  cover: string;
  sourceId: string;
}

const fetchRecommendationList = (id: string) => client<{ recommendations: GreatestBook[] }>(`/recommendations/${id}`);

export const recommendationListQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["recommendations", id],
    queryFn: () => fetchRecommendationList(id),
    // The backend already caches for a day; keep it fresh in-app for an hour.
    staleTime: 1000 * 60 * 60,
  });
