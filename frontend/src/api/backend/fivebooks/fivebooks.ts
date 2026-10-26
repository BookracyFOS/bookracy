import { queryOptions } from "@tanstack/react-query";
import { client } from "../base";

// One Five Books "interview" = an expert recommending a handful of books on a subject.
// Mirrors the backend shapes in parse.ts (kept in sync by hand, like the other sources).
export interface FiveBooksBook {
  title: string;
  author: string;
  cover: string;
}

export interface FiveBooksInterview {
  slug: string;
  title: string;
  subject: string;
  expert: string;
  books: FiveBooksBook[];
}

const fetchList = (query: Record<string, string>) => client<{ interviews: FiveBooksInterview[] }>("/fivebooks", { query });
const fetchInterview = (slug: string) => client<{ interview: FiveBooksInterview }>("/fivebooks", { query: { type: "interview", slug } });

// The backend caches for a day; keep it fresh in-app for an hour (these payloads are
// larger than a search page, so avoid needless refetches).
const STALE = 1000 * 60 * 60;

export const fiveBooksCategoryQueryOptions = (path: string) =>
  queryOptions({
    queryKey: ["fivebooks", "category", path],
    queryFn: () => fetchList({ type: "category", path }),
    staleTime: STALE,
    enabled: Boolean(path),
  });

export const fiveBooksBestQueryOptions = (year: string) =>
  queryOptions({
    queryKey: ["fivebooks", "best", year],
    queryFn: () => fetchList({ type: "best", year }),
    staleTime: STALE,
    enabled: Boolean(year),
  });

export const fiveBooksInterviewQueryOptions = (slug: string) =>
  queryOptions({
    queryKey: ["fivebooks", "interview", slug],
    queryFn: () => fetchInterview(slug),
    staleTime: STALE,
    enabled: Boolean(slug),
  });
