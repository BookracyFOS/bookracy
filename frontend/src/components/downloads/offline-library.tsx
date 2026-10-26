import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useOfflineLibraryStore } from "@/stores/offline-library";
import { useSettingsStore } from "@/stores/settings";
import { AddLocalBook } from "./add-local-book";
import { Button } from "../ui/button";
import { EpubReader } from "../epub-reader/epub-reader";
import { BookCover } from "../books/book-cover";
import { AspectRatio } from "../ui/aspect-ratio";
import { saveAs } from "@/lib/saveAs";
import { convertEpubToPdfBlob } from "@/lib/epub-to-pdf";
import { shareLink } from "@/lib/share";
import { titleToSlug } from "@/lib/string";
import { TOAST_DURATION_MS } from "../ui/sonner";
import { BookOpen, DownloadIcon, FileDown, FilePlus2, FileType2, HardDrive, Library, Loader2, Share2, Trash2 } from "lucide-react";
import type { OfflineBookMeta } from "@/lib/offline-books";
import type { LucideIcon } from "lucide-react";

/** Human-readable byte count, e.g. "12.3 MB". Mirrors lib/download's helper — keeps the
 *  library UI self-contained without importing from the download queue. */
function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const day = 24 * 3600 * 1000;
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < day) return `${Math.round(diff / 3600_000)}h ago`;
  if (diff < 30 * day) return `${Math.round(diff / day)}d ago`;
  return new Date(ms).toLocaleDateString();
}

/** Small pill matching the app's MetaChip pattern from book cards — kept local so we
 *  don't have to re-export MetaChip just for this. */
function Chip({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <span className="glass-subtle text-muted-foreground inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px]">
      <Icon className="h-3 w-3" />
      {children}
    </span>
  );
}

/** Grid of books saved to this device — the offline library. Replaces the previous
 *  "coming soon" placeholder on the /library route. Empty state renders when no books
 *  have been downloaded yet so the section still feels intentional. */
export function OfflineLibrary() {
  const books = useOfflineLibraryStore((s) => s.books);
  const hydrated = useOfflineLibraryStore((s) => s.hydrated);
  const usage = useOfflineLibraryStore((s) => s.usage);
  const quota = useOfflineLibraryStore((s) => s.quota);

  if (!hydrated) return null; // avoid an empty-state flash on first paint

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <div className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Library className="text-primary h-6 w-6" />
          On this device
        </div>
        {books.length > 0 && (
          <span className="text-muted-foreground text-sm">
            {books.length} {books.length === 1 ? "book" : "books"}
            {usage != null && ` · ${formatBytes(usage)}${quota ? ` of ${formatBytes(quota)}` : ""} used`}
          </span>
        )}
      </div>
      <p className="text-muted-foreground max-w-2xl text-sm sm:text-base">
        Books you've downloaded — plus any you add yourself — live on your device and are ready to open even without a connection. They stay saved across reloads.
      </p>

      <AddLocalBook />

      {books.length === 0 ? (
        <div className="glass flex flex-col items-center gap-4 rounded-2xl border-dashed px-6 py-12 text-center">
          <span className="from-primary/25 to-primary/5 text-primary ring-primary/20 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ring-1">
            <DownloadIcon className="h-7 w-7" />
          </span>
          <div className="flex max-w-md flex-col gap-1.5">
            <h3 className="text-lg font-semibold tracking-tight">Nothing saved yet</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">Books you download or add from this device will show up here — ready to read offline.</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {books.map((book) => (
            <OfflineBookRow key={book.md5} book={book} />
          ))}
        </div>
      )}
    </section>
  );
}

function OfflineBookRow({ book }: { book: OfflineBookMeta }) {
  const remove = useOfflineLibraryStore((s) => s.remove);
  const getRecord = useOfflineLibraryStore((s) => s.getRecord);
  const add = useOfflineLibraryStore((s) => s.add);
  const [isReaderOpen, setIsReaderOpen] = useState(false);
  const [converting, setConverting] = useState(false);
  const isEpub = book.ext === ".epub" || book.mime.startsWith("application/epub");
  const isPdf = !isEpub && (book.ext === ".pdf" || book.mime === "application/pdf");

  // Saved PDFs open in the browser's own viewer from the local bytes — no network.
  // The tab is opened before the async read so popup blockers treat it as user-initiated.
  const openPdf = async () => {
    const tab = window.open("", "_blank", "noopener,noreferrer");
    try {
      const record = await getRecord(book.md5);
      if (!record?.blob) throw new Error("offline blob unavailable");
      const url = URL.createObjectURL(record.blob.type === "application/pdf" ? record.blob : new Blob([record.blob], { type: "application/pdf" }));
      if (tab) tab.location.href = url;
      else window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      tab?.close();
      toast.error("Couldn't open this PDF.", { duration: TOAST_DURATION_MS });
    }
  };

  // Cover source depends on where the book came from. A downloaded book's md5 is known
  // to the backend, so its cover can be reconstructed from the API. A book the user
  // added from their own device has a locally-computed md5 the server has never seen —
  // its cover (extracted from the EPUB at import time) is stored alongside the blob.
  // BookCover falls back to a "No cover" tile either way, so a miss degrades gracefully.
  const backendURL = useSettingsStore((s) => s.backendURL);
  const remoteCover = book.local ? "" : `${backendURL}/cover/${book.md5}/thumbnail.jpg`;
  const [localCover, setLocalCover] = useState("");

  // Minting the object URL inside the effect (rather than a useMemo) is what keeps it
  // alive: the URL and the revoke that tears it down have to share a lifecycle, or a
  // re-run of the cleanup leaves the render holding a revoked URL and the image dies.
  useEffect(() => {
    if (!book.cover) return setLocalCover("");
    const url = URL.createObjectURL(book.cover);
    setLocalCover(url);
    return () => URL.revokeObjectURL(url);
  }, [book.cover]);

  const coverUrl = book.local ? localCover : remoteCover;

  // Reader takes a URL, not a Blob — the reader has its own offline-lookup by md5
  // already, so passing a placeholder link is fine when the local blob wins the race.
  const placeholderLink = useMemo(() => `/download/${book.md5}/${encodeURIComponent(book.filename)}`, [book.md5, book.filename]);

  const handleSaveToDisk = async () => {
    const record = await getRecord(book.md5);
    if (!record) return;
    const url = URL.createObjectURL(record.blob);
    try {
      saveAs(url, book.filename);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  };

  // Convert an offline EPUB to PDF via the in-browser converter, then save the PDF
  // itself into the offline library under a fresh md5 — so the converted copy is
  // browseable, reader-openable, and deletable just like any other book. Falls back
  // to a bare Save if the record's blob is gone (evicted / corrupted IDB).
  const handleConvertToPdf = async () => {
    if (converting) return;
    setConverting(true);
    const toastId = toast.loading("Converting to PDF… this can take a moment for large books.");
    try {
      const record = await getRecord(book.md5);
      if (!record) throw new Error("offline blob unavailable");
      // convertEpubToPdf accepts an ArrayBuffer directly — hand it the offline bytes
      // so nothing goes over the network. Result is a jsPDF instance whose
      // .output("blob") gives us the file to both persist and save-as in one pass.
      const buffer = await record.blob.arrayBuffer();
      // Off the main thread (lib/epub-to-pdf); the bytes are transferred, not copied.
      const pdfBlob = await convertEpubToPdfBlob(buffer, {
        onProgress: (done, total) => toast.loading(`Converting to PDF… chapter ${done} of ${total}`, { id: toastId }),
      });
      const pdfFilename = `${titleToSlug(book.title)}.pdf`;
      // Store the PDF alongside the EPUB. Reuse md5 as a stable-ish key by suffixing —
      // the converted PDF isn't the same file so it deserves its own record. We take
      // the first 24 chars of the source md5 + "-pdf" to stay in the 32-hex-char
      // convention IDB is keyed by; collisions across users don't matter (per-device DB).
      const derivedMd5 = `${book.md5.slice(0, 28)}pdf1`;
      await add({
        md5: derivedMd5,
        title: `${book.title} (PDF)`,
        author: book.author,
        filename: pdfFilename,
        ext: ".pdf",
        mime: "application/pdf",
        size: pdfBlob.size,
        downloadedAt: Date.now(),
        sourceSize: book.sourceSize,
        blob: pdfBlob,
      });
      // Also drop the PDF into the browser's Downloads folder, matching the search-
      // card "PDF" button's UX so users get the file in the place they expect it.
      const outUrl = URL.createObjectURL(pdfBlob);
      try {
        saveAs(outUrl, pdfFilename);
      } finally {
        setTimeout(() => URL.revokeObjectURL(outUrl), 60_000);
      }
      // Explicit duration — the loading toast's implicit "no auto-dismiss" behaviour
      // would otherwise carry through when we swap it for the success state.
      toast.success("PDF ready — added to your library.", { id: toastId, duration: TOAST_DURATION_MS });
    } catch {
      toast.error("Couldn't convert this book to PDF.", { id: toastId, duration: TOAST_DURATION_MS });
    } finally {
      setConverting(false);
    }
  };

  // Share a link to the SEARCH for this book's title — recipients land on Bookracy's
  // search results for the same book and can grab / read their own copy. Deliberately
  // NOT sharing the local file (Web Share with files is desktop-hostile and would
  // dump the raw epub/pdf on the recipient without context). URL Share is universally
  // supported, so no feature-detection is needed for the button to render — worst
  // case we fall back to a clipboard copy with a toast.
  const handleShare = () => {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://bookracy.com";
    return shareLink({
      url: `${origin}/?q=${encodeURIComponent(book.title)}`,
      title: book.title,
      text: `${book.title} — on Bookracy`,
    });
  };

  return (
    <div className="glass glass-hover group/card flex gap-3 rounded-2xl p-3">
      {/* Cover — real thumbnail from the backend, "No cover" tile if it's missing.
          Click opens the reader for EPUBs, saves to disk for anything else. */}
      <button
        type="button"
        onClick={isEpub ? () => setIsReaderOpen(true) : isPdf ? () => void openPdf() : handleSaveToDisk}
        className="focus-visible:ring-primary/50 relative w-[72px] shrink-0 overflow-hidden rounded-xl focus-visible:ring-2 focus-visible:outline-none sm:w-20"
        aria-label={isEpub || isPdf ? `Open ${book.title}` : `Save copy of ${book.title}`}
      >
        <AspectRatio ratio={10 / 16}>
          <BookCover src={coverUrl} alt={book.title} interactive showCaption={false} />
        </AspectRatio>
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="line-clamp-2 text-sm leading-snug font-semibold sm:text-base">{book.title}</h3>
          {book.author && book.author !== "Unknown Author" && <p className="text-muted-foreground line-clamp-1 text-xs">by {book.author}</p>}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {/* Distinguishes a file the user brought themselves from one Bookracy fetched —
              it's the difference between "I can re-download this" and "this is my only copy". */}
          {book.local && (
            <span className="bg-primary/15 text-primary inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold">
              <FilePlus2 className="h-3 w-3" />
              Yours
            </span>
          )}
          <Chip icon={HardDrive}>{formatBytes(book.size)}</Chip>
          {book.ext && <Chip icon={FileType2}>{book.ext.replace(/^\./, "").toUpperCase()}</Chip>}
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <span className="text-muted-foreground text-[11px]">Saved {relativeTime(book.downloadedAt)}</span>
          <div className="flex items-center gap-0.5">
            {/* Reader takes priority for EPUBs — even though the cover click also
                opens it, an explicit "read" icon makes the action discoverable on
                touch devices where hover affordance doesn't exist. */}
            {isEpub && (
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setIsReaderOpen(true)}
                className="text-muted-foreground hover:text-foreground size-8 rounded-full"
                aria-label={`Read ${book.title}`}
                title="Read"
              >
                <BookOpen className="size-4" />
              </Button>
            )}
            {isPdf && (
              <Button size="icon" variant="ghost" onClick={() => void openPdf()} className="text-muted-foreground hover:text-foreground size-8 rounded-full" aria-label={`Open ${book.title}`} title="Open">
                <BookOpen className="size-4" />
              </Button>
            )}
            {/* EPUB → PDF conversion (client-side). Replaces the redundant "download an
                already-downloaded book" icon with something users actually want. */}
            {isEpub && (
              <Button
                size="icon"
                variant="ghost"
                onClick={handleConvertToPdf}
                disabled={converting}
                className="text-muted-foreground hover:text-foreground size-8 rounded-full"
                aria-label="Convert this book to PDF"
                title="Convert to PDF"
              >
                {converting ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
              </Button>
            )}
            {/* Share the SEARCH URL (not the file bytes) — for non-EPUB formats where
                we have no in-app reader, this is the most useful action beyond
                Save-copy: friends land on Bookracy's search for the same title and
                can grab or read their own copy. Uses navigator.share when available
                (mobile + some desktops), falls back to clipboard on the rest. */}
            {!isEpub && (
              <Button size="icon" variant="ghost" onClick={handleShare} className="text-muted-foreground hover:text-foreground size-8 rounded-full" aria-label={`Share ${book.title}`} title="Share">
                <Share2 className="size-4" />
              </Button>
            )}
            {/* Save copy — only offered for non-EPUB, where the file is likely a PDF
                or comic that the user still wants a fresh disk copy of. For EPUBs,
                the original Downloads copy is fine and PDF-convert is the more
                interesting action. */}
            {!isEpub && (
              <Button
                size="icon"
                variant="ghost"
                onClick={handleSaveToDisk}
                className="text-muted-foreground hover:text-foreground size-8 rounded-full"
                aria-label={`Save a copy of ${book.title} to disk`}
                title="Save a copy to disk"
              >
                <DownloadIcon className="size-4" />
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              onClick={() => remove(book.md5)}
              className="text-muted-foreground hover:text-destructive size-8 rounded-full"
              aria-label={`Remove ${book.title} from the offline library`}
              title="Remove from library"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* The library card drives the reader purely from the cover click above, so the
          reader's own "Open" trigger is suppressed — it still has to be mounted for
          the Dialog to open. */}
      {isEpub && <EpubReader title={book.title} author={book.author} md5={book.md5} link={placeholderLink} fileSize={book.sourceSize} open={isReaderOpen} setIsOpen={setIsReaderOpen} hideTrigger />}
    </div>
  );
}
