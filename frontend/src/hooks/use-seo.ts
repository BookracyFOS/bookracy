import { useEffect } from "react";
import { useMatches } from "@tanstack/react-router";
import { PAGE_TITLES, ROUTE_DESCRIPTIONS, DEFAULT_DESCRIPTION, SITE_NAME, SITE_URL } from "@/constants";

function upsertMeta(name: string, content: string) {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute("name", name);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

function upsertMetaProperty(property: string, content: string) {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute("property", property);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

function upsertCanonical(href: string) {
  let tag = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!tag) {
    tag = document.createElement("link");
    tag.setAttribute("rel", "canonical");
    document.head.appendChild(tag);
  }
  tag.setAttribute("href", href);
}

/**
 * Keeps the document title, meta description, canonical URL and the social
 * (Open Graph / Twitter) tags in sync with the active route. Google renders the
 * SPA, so per-route metadata still matters for search.
 */
export function useSeo() {
  const matches = useMatches();
  const current = matches[matches.length - 1];
  const routeId = (current?.routeId ?? "")
    .replace(/\/__\w+/g, "")
    .replace(/\/_\w+/g, "")
    .replace(/\/$/, "");

  useEffect(() => {
    const pageTitle = PAGE_TITLES[routeId as keyof typeof PAGE_TITLES];
    const fullTitle = pageTitle && pageTitle !== "Home" ? `${pageTitle} — ${SITE_NAME}` : `${SITE_NAME} — Why Pay for Knowledge?`;
    document.title = fullTitle;

    const description = ROUTE_DESCRIPTIONS[routeId as keyof typeof ROUTE_DESCRIPTIONS] ?? DEFAULT_DESCRIPTION;
    upsertMeta("description", description);

    const path = typeof window !== "undefined" ? window.location.pathname : "/";
    const canonical = `${SITE_URL}${path === "/" ? "/" : path}`;
    upsertCanonical(canonical);

    // Keep the social cards consistent with the active route too.
    upsertMetaProperty("og:title", fullTitle);
    upsertMetaProperty("og:description", description);
    upsertMetaProperty("og:url", canonical);
    upsertMeta("twitter:title", fullTitle);
    upsertMeta("twitter:description", description);
  }, [routeId]);
}

/**
 * Marks the current view as non-indexable while mounted, restoring the previous
 * robots directive on unmount. Used by the 404 page so the SPA's 200-status
 * fallback for unknown URLs isn't indexed by Google as a "soft 404".
 */
export function useNoindex() {
  useEffect(() => {
    const tag = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const previous = tag?.getAttribute("content") ?? null;
    upsertMeta("robots", "noindex, follow");
    return () => {
      if (previous !== null) upsertMeta("robots", previous);
    };
  }, []);
}
