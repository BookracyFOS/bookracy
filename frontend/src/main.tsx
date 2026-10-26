import { StrictMode, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { Toaster } from "@/components/ui/sonner";
import { useSettingsStore } from "./stores/settings";
import { useOfflineLibraryStore } from "./stores/offline-library";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Loader2 } from "lucide-react";
import { ScrollToTopButton } from "./components/layout/scroll-to-top-button";

import "./lib/sync";
import "./styles/global.css";

// 404 means "no results", and 429 means the server has explicitly asked us to back off —
// retrying either is pointless, and retrying a rate limit turns one throttled request
// into three and digs the hole deeper. Everything else gets two more attempts.
function shouldRetry(failureCount: number, error: Error): boolean {
  if ("status" in error && (error.status === 404 || error.status === 429)) return false;
  return failureCount < 2;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Without this TanStack defaults to 0, which (with refetchOnMount) re-hit the
      // API on every remount and every navigation back to a route. Explicit
      // invalidation after a mutation still refetches, so this only drops the
      // redundant reloads. Queries needing fresher data override it locally.
      staleTime: 60_000,
      retry: shouldRetry,
    },
    mutations: {
      retry: shouldRetry,
    },
  },
});

export const router = createRouter({
  routeTree,
  context: {
    queryClient: queryClient,
  },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  defaultErrorComponent: () => <div>404</div>,
  defaultPendingMinMs: 1,
  defaultPendingMs: 100,
  defaultPendingComponent: () => {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function App() {
  const theme = useSettingsStore((state) => state.theme);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
  }, [theme]);

  // Hydrate the offline library once on boot so downloaded-book indicators and the
  // Library route can render synchronously from an in-memory mirror instead of every
  // component race-condition-ing its own IDB query.
  useEffect(() => {
    void useOfflineLibraryStore.getState().hydrate();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {import.meta.env.DEV && (
        <div className="absolute top-14 right-5">
          <ReactQueryDevtools initialIsOpen={false} buttonPosition="relative" />
        </div>
      )}
      <RouterProvider router={router} />
      <Toaster />
      <ScrollToTopButton />
    </QueryClientProvider>
  );
}

// Render the app
const rootElement = document.getElementById("root")!;
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// After a deploy the fingerprinted chunks an open tab lazy-loads (the reader, a route)
// no longer exist, and the router's error component renders a bare "404". Vite reports
// that as `vite:preloadError`; one reload picks up the new index. Guarded so a genuinely
// broken deploy can't reload-loop.
window.addEventListener("vite:preloadError", (event) => {
  const key = "BR::reloaded-for-preload-error";
  let already = false;
  try {
    already = sessionStorage.getItem(key) === "1";
    if (!already) sessionStorage.setItem(key, "1");
  } catch {
    /* storage unavailable — fall through to a single reload */
  }
  if (already) return;
  event.preventDefault();
  window.location.reload();
});

// Register the PWA service worker (prod only — keeps dev free of stale caches).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* SW registration is best-effort; the app works fine without it. */
    });
  });
}
