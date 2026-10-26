import { FileRouteTypes } from "@/routeTree.gen";

// Single source of truth for the curated recommendation lists, shared by the sidebar
// dropdown ([lib/layout.ts]) and the list pages (routes/recommendations.*.tsx). Each
// `href` must match a route file under routes/recommendations.<id>.tsx. Most ids map to
// a key in the backend's TGB_LISTS (thegreatestbooks.org); the "marvel"/"dc" ids instead
// map to the backend's reading-order endpoint and render ReadingOrderPage.
export interface RecommendationList {
  id: string;
  href: FileRouteTypes["fullPaths"];
  /** Short label for the sidebar submenu. */
  label: string;
  /** Page heading. */
  title: string;
  /** One-line description under the heading. */
  blurb: string;
}

export const RECOMMENDATION_LISTS: RecommendationList[] = [
  {
    id: "five-books",
    href: "/recommendations/five-books",
    label: "Five Books",
    title: "Five Books",
    blurb: "Expert-curated recommendations across every subject, from leading authorities and award-winners.",
  },
  {
    id: "tgb",
    href: "/recommendations/tgb",
    label: "The Greatest Books",
    title: "The Greatest Books",
    blurb: "The 100 greatest books of all time.",
  },
  {
    id: "since-2000",
    href: "/recommendations/since-2000",
    label: "Best Since 2000",
    title: "The Greatest Books Since 2000",
    blurb: "The finest literature of the 21st century so far.",
  },
  {
    id: "global-canon",
    href: "/recommendations/global-canon",
    label: "The Global Canon",
    title: "The Global Literary Canon",
    blurb: "A broad canon spanning cultures, languages and centuries.",
  },
  {
    id: "readers-favorites",
    href: "/recommendations/readers-favorites",
    label: "Readers’ Favourites",
    title: "Readers’ Favourite Books",
    blurb: "The community’s most-loved books, voted by readers.",
  },
  {
    id: "by-women",
    href: "/recommendations/by-women",
    label: "Written by Women",
    title: "The Greatest Books Written by Women",
    blurb: "The greatest books of all time written by women.",
  },
  {
    id: "african",
    href: "/recommendations/african",
    label: "African Literature",
    title: "The Greatest African Books",
    blurb: "The greatest African books of all time.",
  },
  {
    id: "marvel",
    href: "/recommendations/marvel",
    label: "Marvel Reading Order",
    title: "Marvel Master Reading Order",
    blurb: "The Marvel Universe in chronological reading order.",
  },
  {
    id: "dc",
    href: "/recommendations/dc",
    label: "DC Reading Order",
    title: "DC Master Reading Order",
    blurb: "The DC Universe in chronological reading order.",
  },
];

export const findRecommendationList = (id: string) => RECOMMENDATION_LISTS.find((l) => l.id === id);
