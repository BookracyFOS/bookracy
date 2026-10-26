import { BookItem, BookItemWithExternalDownloads } from "@/api/backend/types";
import { BookItemCard, BookTileActions } from "./book-item";

interface BookListProps {
  books: BookItemWithExternalDownloads[] | BookItem[];
  actions?: BookTileActions;
  /** When true, each book's download button will treat the rest of the list as
   *  ordered fallback candidates (search results only — not applicable to library
   *  or curated lists where "the next book" is a different book entirely). */
  fallbackChain?: boolean;
}

export function BookList({ books, actions, fallbackChain }: BookListProps) {
  return (
    <div className="grid grid-cols-1 gap-4">
      {books.map((book, i) => (
        <BookItemCard
          key={book.md5}
          {...book}
          actions={actions}
          siblings={fallbackChain ? books.slice(i + 1) : undefined}
        />
      ))}
    </div>
  );
}
