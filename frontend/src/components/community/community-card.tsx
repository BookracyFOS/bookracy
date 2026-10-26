import { type ReactNode, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { BookCover } from "@/components/books/book-cover";
import { BookDownloadButton } from "@/components/books/download-button";
import { DownloadPdfButton } from "@/components/books/download-pdf-button";
import { OpenPdfButton } from "@/components/books/open-pdf-button";
import { EpubReader } from "@/components/epub-reader/epub-reader";
import { ArrowDownToLine, AtSign, FileType2, type LucideIcon, UserRound } from "lucide-react";
import type { CommunityBook } from "@/api/backend/community/community";

export type CommunityCardVariant = "grid" | "row";

function Chip({ icon: Icon, children, title }: { icon: LucideIcon; children: ReactNode; title?: string }) {
  return (
    <span title={title} className="glass-subtle text-muted-foreground inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs">
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{children}</span>
    </span>
  );
}

/**
 * A community book tile, in either a `grid` (vertical) or `row` (horizontal) layout —
 * driven by the global view toggle. Same actions search results get (download,
 * in-built reader + EPUB→PDF for epub). `manageMenu` is an overlay/cluster used by
 * "My uploads" for edit / cover / delete.
 */
export function CommunityBookCard({ book, manageMenu, variant = "grid" }: { book: CommunityBook; manageMenu?: ReactNode; variant?: CommunityCardVariant }) {
  const [readerOpen, setReaderOpen] = useState(false);
  const isEpub = book.book_filetype?.toLowerCase() === "epub" || book.link.toLowerCase().endsWith(".epub");
  const isPdf = !isEpub && (book.book_filetype?.toLowerCase() === "pdf" || book.link.toLowerCase().endsWith(".pdf"));

  const chips = (
    <>
      <Chip icon={book.uploader ? AtSign : UserRound} title={book.uploader ? `Uploaded by ${book.uploader}` : "Uploaded anonymously"}>
        {book.uploader ?? "Anonymous"}
      </Chip>
      <Chip icon={ArrowDownToLine} title={`${book.downloads} downloads`}>
        {book.downloads.toLocaleString()}
      </Chip>
      {book.book_filetype && (
        <Chip icon={FileType2} title="File type">
          {book.book_filetype.toUpperCase()}
        </Chip>
      )}
    </>
  );

  const actions = (
    <>
      <BookDownloadButton title={book.title} extension={book.book_filetype} md5={book.md5} author={book.author} sourceSize={book.book_size} primaryLink={book.link} />
      {isEpub && (
        <EpubReader title={book.title} author={book.author} md5={book.md5} link={book.link} coverImage={book.book_image} fileSize={book.book_size} open={readerOpen} setIsOpen={setReaderOpen} />
      )}
      {isEpub && <DownloadPdfButton title={book.title} link={book.link} />}
      {isPdf && <OpenPdfButton title={book.title} link={book.link} />}
    </>
  );

  if (variant === "row") {
    return (
      <Card className="glass glass-hover overflow-hidden rounded-2xl border-0 p-0">
        <CardContent className="flex items-center gap-3 p-3 sm:gap-4">
          <div className="bg-muted/40 h-24 w-16 shrink-0 overflow-hidden rounded-md">
            <BookCover src={book.book_image} alt={book.title} interactive={isEpub} showCaption={false} onClick={isEpub ? () => setReaderOpen(true) : undefined} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-col gap-0.5">
              <h2 className="line-clamp-1 text-sm font-semibold sm:text-base" title={book.title}>
                {book.title}
              </h2>
              {book.author && (
                <p className="text-muted-foreground line-clamp-1 text-xs" title={book.author}>
                  by {book.author}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">{chips}</div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {actions}
            {manageMenu}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass glass-hover flex h-full flex-col overflow-hidden rounded-2xl border-0 p-0">
      <CardContent className="flex h-full flex-col gap-3 p-3">
        <div className="relative">
          <AspectRatio ratio={10 / 16}>
            <BookCover src={book.book_image} alt={book.title} interactive={isEpub} showCaption={false} onClick={isEpub ? () => setReaderOpen(true) : undefined} />
          </AspectRatio>
          {manageMenu && <div className="absolute top-2 right-2 z-10">{manageMenu}</div>}
        </div>

        <div className="flex flex-1 flex-col gap-2 px-1">
          <div className="flex flex-col gap-0.5">
            <h2 className="line-clamp-2 text-sm font-semibold sm:text-base" title={book.title}>
              {book.title}
            </h2>
            {book.author && (
              <p className="text-muted-foreground line-clamp-1 text-xs" title={book.author}>
                by {book.author}
              </p>
            )}
          </div>
          <div className="mt-auto flex flex-wrap gap-1.5">{chips}</div>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-1 pb-1">{actions}</div>
      </CardContent>
    </Card>
  );
}
