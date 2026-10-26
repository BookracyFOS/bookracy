import { BookOpen } from "lucide-react";
import { Button } from "../ui/button";
import { inlinePdfLink } from "@/lib/download";

/**
 * "Open" for PDFs. The built-in reader is EPUB-only, but every browser has a PDF
 * viewer, so a PDF opens in a new tab through it — the backend serves it inline
 * when asked. Same place and look as the EPUB reader's Open button.
 */
export function OpenPdfButton({ link, title }: { link?: string; title: string }) {
  if (!link) return null;
  return (
    <Button asChild className="flex w-fit items-center gap-2">
      <a href={inlinePdfLink(link)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${title} in a new tab`}>
        <BookOpen className="text-lg" />
        <span className="hidden sm:inline">Open</span>
      </a>
    </Button>
  );
}
