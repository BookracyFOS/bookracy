import { useEffect } from "react";
import { SheetMenu } from "./sheet-menu";
import { useLayout } from "@/hooks/use-layout";
import { useLayoutStore } from "@/stores/layout";
import { ThemeToggle } from "./theme-toggle";
import { ViewToggle } from "./view-toggle";
import { CloudSyncButton } from "@/components/sync/cloud-sync-button";
import { BulkModeToggle } from "@/components/downloads/bulk-mode-toggle";

export function Navbar() {
  const { pageTitle } = useLayout();
  const pageTitleFromStore = useLayoutStore((state) => state.page.title);
  const setPageTitle = useLayoutStore((state) => state.page.setTitle);

  useEffect(() => {
    setPageTitle(pageTitle ?? "");
  }, [pageTitle, setPageTitle]);

  return (
    <header className="supports-[backdrop-filter]:bg-background/55 bg-background/80 border-border/60 sticky top-0 z-30 w-full rounded-b-2xl border-b pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] backdrop-blur-xl backdrop-saturate-150 sm:rounded-b-lg">
      <div className="mx-4 flex h-14 items-center sm:mx-8">
        <div className="flex items-center space-x-4 lg:space-x-0">
          <SheetMenu />
          <h1 className="text-lg font-bold tracking-tight">{pageTitle ?? pageTitleFromStore}</h1>
        </div>
        <div className="flex flex-1 items-center justify-end space-x-2">
          <ViewToggle />
          <BulkModeToggle />
          <CloudSyncButton />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
