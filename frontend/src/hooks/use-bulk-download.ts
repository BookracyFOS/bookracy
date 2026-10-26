import { useCallback } from "react";
import { toast } from "sonner";
import { BookItem } from "@/api/backend/types";
import { useSettingsStore } from "@/stores/settings";
import { useDownloadQueueStore } from "@/stores/download-queue";

/**
 * Single entry point for "download these N books", honouring the user's chosen
 * delivery method (a per-file queue, or one ZIP archive). Used by the selection
 * bar, the search "Download page" action and the library "Download all" buttons.
 */
export function useBulkDownload() {
  const format = useSettingsStore((s) => s.bulkDownloadFormat);
  const enqueue = useDownloadQueueStore((s) => s.enqueue);
  const startZip = useDownloadQueueStore((s) => s.startZip);
  const setPanelOpen = useDownloadQueueStore((s) => s.setPanelOpen);

  const download = useCallback(
    (books: BookItem[]) => {
      const valid = books.filter((b) => b?.md5 && b?.link);
      if (valid.length === 0) return;

      if (format === "zip") {
        setPanelOpen(true);
        void startZip(valid);
        toast.success(`Zipping ${valid.length} book${valid.length !== 1 ? "s" : ""}…`);
        return;
      }

      const added = enqueue(valid);
      if (added > 0) {
        setPanelOpen(true);
        toast.success(`Added ${added} book${added !== 1 ? "s" : ""} to downloads.`);
      } else {
        toast.info("Those are already in your downloads.");
      }
    },
    [format, enqueue, startZip, setPanelOpen],
  );

  return { download, format };
}
