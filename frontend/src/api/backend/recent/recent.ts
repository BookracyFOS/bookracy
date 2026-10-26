import { queryOptions } from "@tanstack/react-query";
import { client } from "../base";

export interface RecentDownload {
  md5: string;
  title: string;
}

// Live "recently downloaded" feed proxied from Anna's Archive.
const getRecentDownloads = async () => {
  return client<{ recent: RecentDownload[] }>("/recent");
};

export const getRecentDownloadsQueryOptions = queryOptions({
  queryKey: ["recent_downloads"],
  queryFn: getRecentDownloads,
  // Fetched when the Library opens; we deliberately DON'T auto-swap the carousel
  // while the user is looking at it. It just refreshes on the next visit.
  staleTime: 5 * 60_000,
});
