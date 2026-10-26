import { FileRouteTypes } from "./routeTree.gen";

export const SITE_NAME = "Bookracy";
export const SITE_URL = "https://bookracy.com";
export const DEFAULT_DESCRIPTION =
  "Bookracy is a free, open-source library of millions of books, comics, manga, articles and publications. Read online or download instantly — no paywalls.";

export const PAGE_TITLES: Partial<Record<FileRouteTypes["fullPaths"], string>> = {
  "/": "Home",
  "/about": "About",
  "/lists": "Bookshelf",
  "/library": "Library",
  "/settings": "Settings",
  "/community": "Community",
  "/upload": "Upload a book",
  "/nonfiction": "Find your next great nonfiction",
};

export const ROUTE_DESCRIPTIONS: Partial<Record<FileRouteTypes["fullPaths"], string>> = {
  "/": DEFAULT_DESCRIPTION,
  "/about": "About Bookracy — a free, open-source, community-built library where knowledge isn't locked behind a paywall.",
  "/lists": "Your bookshelf — saved books and reading progress on Bookracy.",
  "/settings": "Manage your Bookracy preferences, theme, language and data.",
  "/community": "Books uploaded by the Bookracy community — download anything, support contributors, and climb the leaderboard.",
  "/upload": "Upload a book to the Bookracy community library.",
  "/nonfiction":
    "Browse thousands of award-winning nonfiction books — Pulitzer, Baillie Gifford, Bancroft, Wolfson, National Book Award winners and more — then read or download them free on Bookracy.",
};
