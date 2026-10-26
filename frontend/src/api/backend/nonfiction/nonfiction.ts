import { queryOptions } from "@tanstack/react-query";
import { client } from "../base";
import { useSettingsStore } from "@/stores/settings";

// Award-winning nonfiction from the Book Prize Index (CC-BY-4.0), served from a
// dataset bundled into the Worker. Entries are metadata-only — clicking one hands
// "Title Author" to the normal Bookracy search, same as the recommendation lists.

/** How a book placed in a given award. Ordered best-first by the backend. */
export type AwardStatus = "winner" | "co_winner" | "finalist" | "shortlist" | "longlist" | "honorable_mention";

export interface AwardCredit {
  program: string;
  programName: string;
  category: string;
  year: number;
  status: AwardStatus;
}

export interface AwardBook {
  id: number;
  title: string;
  authors: string[];
  year: number;
  subject: string;
  awards: AwardCredit[];
}

export interface AwardProgram {
  id: string;
  name: string;
  organization: string;
  geography: string;
  url: string;
  count: number;
}

export interface NonfictionFilters {
  program?: string;
  subject?: string;
  status?: string;
  decade?: string;
  q?: string;
  sort?: string;
  page?: number;
}

export const STATUS_LABELS: Record<AwardStatus, string> = {
  winner: "Winner",
  co_winner: "Co-winner",
  finalist: "Finalist",
  shortlist: "Shortlisted",
  longlist: "Longlisted",
  honorable_mention: "Honourable mention",
};

export const SORT_OPTIONS = [
  { value: "acclaimed", label: "Most acclaimed" },
  { value: "recent", label: "Most recent" },
  { value: "oldest", label: "Oldest first" },
  { value: "title", label: "A–Z" },
];

/** Decades offered as chips, newest first. Numbers so they serialise cleanly into the URL. */
export const DECADES = [2020, 2010, 2000, 1990, 1980, 1970];

export const PAGE_SIZE = 24;

const toParams = (f: NonfictionFilters) => {
  const params = new URLSearchParams();
  if (f.program) params.set("program", f.program);
  if (f.subject) params.set("subject", f.subject);
  if (f.status) params.set("status", f.status);
  if (f.decade) params.set("decade", f.decade);
  if (f.q?.trim()) params.set("q", f.q.trim());
  if (f.sort && f.sort !== "acclaimed") params.set("sort", f.sort);
  if (f.page && f.page > 1) params.set("page", String(f.page));
  params.set("limit", String(PAGE_SIZE));
  return params;
};

/** The award programmes and subjects available as filters. Effectively static. */
export const nonfictionMetaQueryOptions = queryOptions({
  queryKey: ["nonfiction_meta"],
  queryFn: () => client<{ version: string; programs: AwardProgram[]; subjects: string[] }>("/nonfiction/meta"),
  staleTime: 24 * 60 * 60 * 1000,
});

export const nonfictionQueryOptions = (filters: NonfictionFilters) =>
  queryOptions({
    queryKey: ["nonfiction", filters],
    queryFn: () => client<{ total: number; page: number; limit: number; books: AwardBook[] }>(`/nonfiction?${toParams(filters).toString()}`),
    staleTime: 60 * 60 * 1000,
  });

/**
 * A random award-winning book honouring the active filters. Deliberately not cached:
 * pressing the button again must give a different book. The backend races a few
 * candidates and returns one that has cover art, along with the resolved artwork URL
 * so the hero doesn't need a second round trip.
 */
export const randomNonfictionQueryOptions = (filters: NonfictionFilters) =>
  queryOptions({
    queryKey: ["nonfiction_random", filters],
    queryFn: () => {
      const params = toParams({ ...filters, page: 1 });
      params.delete("limit");
      return client<{ book: AwardBook | null; cover: string }>(`/nonfiction/random?${params.toString()}`);
    },
    staleTime: 0,
    gcTime: 0,
  });

/**
 * Cover art for a prize-index book. The dataset ships no images, so the backend looks
 * the title up on Apple Books and redirects to their CDN (404 when there's no match,
 * which BookCover renders as its "No cover" state).
 */
export const nonfictionCoverUrl = (id: number) => `${useSettingsStore.getState().backendURL}/api/nonfiction/${id}/cover.jpg`;

/** The single best accolade to lead a card with. */
export const topCredit = (book: AwardBook): AwardCredit | undefined => book.awards[0];
