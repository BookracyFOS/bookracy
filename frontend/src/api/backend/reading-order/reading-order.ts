import { queryOptions } from "@tanstack/react-query";
import { client } from "../base";

// A single comic in a reading order. Intentionally light: clicking one runs a normal
// Bookracy search to try to resolve it to a downloadable result.
export interface ReadingOrderIssue {
  title: string;
  year?: string;
  /** Series type from the source's colour legend; omitted for the default (ongoing). */
  type?: "limited" | "oneshot";
  /** Inline annotation, e.g. "First appearance of Valkyrie". */
  note?: string;
}

// One era/part of the reading order (e.g. "Part 1", "Marvel NOW!"). Summary/event
// landing pages carry no `issues` — just `subEvents` links to sub-orders on the source.
export interface ReadingOrderEra {
  id: string;
  name: string;
  url: string;
  issuesLabel?: string;
  years?: string;
  events?: string;
  firstAppearances?: string;
  description?: string;
  issues: ReadingOrderIssue[];
  subEvents?: { name: string; url: string }[];
}

export interface ReadingOrder {
  title: string;
  source: string;
  eras: ReadingOrderEra[];
}

export type ReadingOrderFranchise = "marvel" | "dc";

const fetchReadingOrder = (franchise: ReadingOrderFranchise) => client<{ readingOrder: ReadingOrder }>(`/reading-order/${franchise}`);

export const readingOrderQueryOptions = (franchise: ReadingOrderFranchise) =>
  queryOptions({
    queryKey: ["reading-order", franchise],
    queryFn: () => fetchReadingOrder(franchise),
    // The backend already caches for a day; keep it fresh in-app for an hour. The
    // payload is large (~10k issues), so avoid needless refetches.
    staleTime: 1000 * 60 * 60,
  });
