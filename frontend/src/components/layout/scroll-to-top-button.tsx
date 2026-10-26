import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { ArrowUpIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDownloadQueueStore } from "@/stores/download-queue";
import { useSettingsStore } from "@/stores/settings";

export function ScrollToTopButton() {
  const [isVisible, setIsVisible] = useState(false);
  // Keep clear of the downloads launcher (same bottom-right corner) and get out
  // of the way entirely while the downloads panel is expanded. The launcher only
  // exists when the bulk-download feature is enabled.
  const launcherShown = useSettingsStore((s) => s.bulkDownload && s.floatingDownloads);
  const panelOpen = useDownloadQueueStore((s) => s.panelOpen) && launcherShown;
  const hasDownloads = useDownloadQueueStore((s) => s.items.length > 0 || s.zip != null) && launcherShown;

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  useEffect(() => {
    const toggleVisibility = () => {
      setIsVisible(window.scrollY > 300);
    };
    window.addEventListener("scroll", toggleVisibility);
    return () => window.removeEventListener("scroll", toggleVisibility);
  }, []);

  const show = isVisible && !panelOpen;

  return (
    <div
      className={cn(
        "fixed right-[calc(1.5rem_+_env(safe-area-inset-right))] z-50 transition-opacity duration-300",
        hasDownloads ? "bottom-[calc(5.75rem_+_env(safe-area-inset-bottom))]" : "bottom-[calc(3.5rem_+_env(safe-area-inset-bottom))]",
        {
          "opacity-100": show,
          "pointer-events-none z-0 opacity-0": !show,
        },
      )}
    >
      <Button
        onClick={scrollToTop}
        size="icon"
        variant="ghost"
        aria-label="Scroll to top"
        className="bg-primary/25 hover:bg-primary/40 border-primary/40 h-11 w-11 rounded-full border text-white shadow-lg backdrop-blur-md backdrop-saturate-150 transition-colors"
      >
        <ArrowUpIcon className="h-5 w-5" />
      </Button>
    </div>
  );
}
