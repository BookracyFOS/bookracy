import { BookItem, BookItemWithExternalDownloads } from "@/api/backend/types";
import { BookItemDialog, BookTileActions } from "./book-item";

interface BookGalleryProps {
  books: BookItemWithExternalDownloads[] | BookItem[];
  actions?: BookTileActions;
  /** When true, each book's download button will treat the rest of the list as
   *  ordered fallback candidates (search results only — not applicable to library
   *  or curated lists where "the next book" is a different book entirely). */
  fallbackChain?: boolean;
}

export function BookGallery({ books, actions, fallbackChain }: BookGalleryProps) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:gap-8 md:grid-cols-3 xl:grid-cols-4">
      {books.map((book, i) => (
        <BookItemDialog
          key={book.md5}
          {...book}
          actions={actions}
          siblings={fallbackChain ? books.slice(i + 1) : undefined}
        />
      ))}
    </div>
  );
}
