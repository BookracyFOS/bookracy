import { createFileRoute } from "@tanstack/react-router";
import { RecentDownloadsSection } from "@/components/books/recent-downloads";
import { DownloadsView } from "@/components/downloads/downloads-view";
import { OfflineLibrary } from "@/components/downloads/offline-library";
import { useFileOpen } from "@/hooks/use-file-open";

export const Route = createFileRoute("/library")({
  component: Library,
  // The manifest's file_handlers and share_target both point here, and both append
  // `?open=…`. Accept it so the router doesn't strip the param before we read it.
  validateSearch: (search): { open?: string } => (typeof search.open === "string" ? { open: search.open } : {}),
});

function Library() {
  // Handles "Open with Bookracy" from the OS and files shared into the installed app.
  useFileOpen();

  return (
    <div className="flex flex-col gap-10">
      {/* Active downloads (in progress + finished-this-session queue). */}
      <DownloadsView />

      {/* Persistent offline library — every book stored on this device, survives reloads. */}
      <OfflineLibrary />

      {/* Live feed from upstream; renders nothing while the upstream is dark (see the component). */}
      <RecentDownloadsSection />
    </div>
  );
}
