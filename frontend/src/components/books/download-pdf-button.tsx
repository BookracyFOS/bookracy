import { useState } from "react";
import { Button } from "../ui/button";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { titleToSlug } from "@/lib/string";
import { saveAs } from "@/lib/saveAs";
import { convertEpubToPdfBlob } from "@/lib/epub-to-pdf";
import { TOAST_DURATION_MS } from "../ui/sonner";

interface DownloadPdfButtonProps {
  title: string;
  link?: string;
}

/** Converts an EPUB to PDF in the browser (via bookracy-convertor) and downloads it. */
export function DownloadPdfButton({ title, link }: DownloadPdfButtonProps) {
  const [converting, setConverting] = useState(false);

  if (!link) return null;

  const handleConvert = async () => {
    setConverting(true);
    const toastId = toast.loading("Converting to PDF\u2026 this can take a moment for large books.");
    try {
      // Runs in a web worker (see lib/epub-to-pdf): the page stays responsive and the
      // toast can report real progress instead of freezing until the file appears.
      const blob = await convertEpubToPdfBlob(link, {
        onProgress: (done, total) => toast.loading(`Converting to PDF\u2026 chapter ${done} of ${total}`, { id: toastId }),
      });
      const url = URL.createObjectURL(blob);
      saveAs(url, `${titleToSlug(title)}.pdf`);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      // Explicit duration — the loading toast's implicit "no auto-dismiss" behaviour
      // would otherwise carry through when we swap it for the success state.
      toast.success("PDF ready.", { id: toastId, duration: TOAST_DURATION_MS });
    } catch {
      toast.error("Couldn't convert this book to PDF.", { id: toastId, duration: TOAST_DURATION_MS });
    } finally {
      setConverting(false);
    }
  };

  return (
    <Button variant="outline" onClick={handleConvert} disabled={converting} className="glass-subtle flex w-fit items-center gap-2 rounded-xl border-0" aria-label="Download as PDF">
      {converting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
      <span className="hidden sm:inline">{converting ? "Converting\u2026" : "PDF"}</span>
    </Button>
  );
}
