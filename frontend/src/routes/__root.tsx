import * as React from "react";
import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { Sidebar } from "@/components/layout/sidebar";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/stores/layout";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { NotFound } from "@/components/layout/not-found";
import { useSeo } from "@/hooks/use-seo";
import { DownloadQueue } from "@/components/downloads/download-queue";
import { SelectionBar } from "@/components/downloads/selection-bar";

const TanStackRouterDevtools = import.meta.env.PROD
  ? () => null
  : React.lazy(() =>
      import("@tanstack/react-router-devtools").then((res) => ({
        default: res.TanStackRouterDevtools,
      })),
    );

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  component: Root,
  notFoundComponent: () => <NotFound />,
  pendingMinMs: 1,
  wrapInSuspense: true,
  pendingComponent: () => (
    <div className="flex h-screen items-center justify-center">
      <Loader2 className="animate-spin" />
    </div>
  ),
});

function Root() {
  const sidebar = useLayoutStore((state) => state.sidebar);
  useSeo();

  return (
    <>
      <a
        href="#main"
        className="bg-primary text-primary-foreground sr-only rounded-md px-4 py-2 text-sm font-medium shadow-lg focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100]"
      >
        Skip to content
      </a>
      <Sidebar />
      <main
        id="main"
        tabIndex={-1}
        className={cn("flex min-h-[calc(100vh-56px)] flex-col transition-[margin-left] duration-300 ease-in-out outline-none dark:bg-zinc-900", sidebar?.isOpen === false ? "lg:ml-[90px]" : "lg:ml-72")}
      >
        <Navbar />
        <div className="relative flex flex-1 p-4 sm:p-6 lg:p-8 *:w-full">
          <Outlet />
        </div>
      </main>
      <footer className={cn("transition-[margin-left] duration-300 ease-in-out", sidebar?.isOpen === false ? "lg:ml-[90px]" : "lg:ml-72")}>
        <Footer />
      </footer>
      <SelectionBar />
      <DownloadQueue />
      <TanStackRouterDevtools />
    </>
  );
}
