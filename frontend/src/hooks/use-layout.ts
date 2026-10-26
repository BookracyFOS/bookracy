import { PAGE_TITLES } from "@/constants";
import { useMatches } from "@tanstack/react-router";
import { useMemo } from "react";
import { getMenuList } from "../lib/layout";

export function useLayout() {
  const matches = useMatches();
  const currentMatch = matches[matches.length - 1];

  const routeId = useMemo(() => {
    // replace all routes that have double underscores, e.g. /orders/__orderId/update -> /orders/update
    // Also replace all routes with one underscore, e.g. /orders/_orderId/update -> /orders/update
    // Also remove trailing slash if it exists
    return currentMatch?.routeId
      .replace(/\/__\w+/g, "")
      .replace(/\/_\w+/g, "")
      .replace(/\/$/, "");
  }, [currentMatch]);

  const memoizedMenuList = useMemo(() => getMenuList(routeId ?? ""), [routeId]);

  const pageTitle = useMemo(() => {
    return PAGE_TITLES[routeId as keyof typeof PAGE_TITLES];
  }, [routeId]);

  return {
    menuList: memoizedMenuList,
    pageTitle,
  };
}
