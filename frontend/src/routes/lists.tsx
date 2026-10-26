import { useBooksByMd5s } from "@/api/backend/search/search";
import { Bookshelf, BookCollection } from "@/components/books/bookshelf";
import { BookTileActions } from "@/components/books/book-item";
import { Button } from "@/components/ui/button";
import { useBookmarksStore } from "@/stores/bookmarks";
import { selectInProgress, useReadingProgressStore } from "@/stores/progress";
import { bookItemFromProgress } from "@/lib/resume";
import { useViewStore } from "@/stores/view";
import { BookItem } from "@/api/backend/types";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BadgeCheck, BookMarked, BookOpen, RotateCcw, Search } from "lucide-react";
import { useMemo } from "react";

export const Route = createFileRoute("/lists")({
  component: Lists,
});

function Lists() {
  const bookmarks = useBookmarksStore((state) => state.bookmarks);
  const folders = useBookmarksStore((state) => state.folders);
  const view = useViewStore((state) => state.view);
  const removeReadingProgress = useReadingProgressStore((state) => state.removeReadingProgress);
  const setReadingProgress = useReadingProgressStore((state) => state.setReadingProgress);
  const findReadingProgress = useReadingProgressStore((state) => state.findReadingProgress);
  const readingProgress = useReadingProgressStore((state) => state.readingProgress);
  // Memoised: a fresh array from `.filter()` on every render defeated every memo below.
  const allProgress = useMemo(() => readingProgress.filter((p) => p.totalPages > 0 || Boolean(p.location)), [readingProgress]);

  // Split saved reading into "still reading" vs "finished" — finished books used to
  // just vanish; now they get their own shelf with a "Read again" reset. Both shelves
  // lead with the most recently touched book, so what you're actually reading is first.
  const inProgress = useMemo(() => selectInProgress(allProgress), [allProgress]);
  const completed = useMemo(() => allProgress.filter((p) => p.totalPages > 0 && p.currentPage >= p.totalPages).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)), [allProgress]);

  const continueActions: BookTileActions = {
    onDelete: (b) => removeReadingProgress(b.md5),
    onComplete: (b) => {
      const p = findReadingProgress(b.md5);
      if (p) setReadingProgress({ ...p, currentPage: p.totalPages });
    },
    deleteLabel: "Remove",
    completeLabel: "Done",
  };

  const finishedActions: BookTileActions = {
    onDelete: (b) => removeReadingProgress(b.md5),
    // "Read again" rewinds to the start, so the book hops back to "Continue reading".
    onComplete: (b) => {
      const p = findReadingProgress(b.md5);
      if (p) setReadingProgress({ ...p, currentPage: 1, location: "1" });
    },
    deleteLabel: "Remove",
    completeLabel: "Read again",
    completeIcon: RotateCcw,
  };

  const bookmarkMd5s = useMemo(() => bookmarks.map((b) => b.md5), [bookmarks]);
  const progressMd5s = useMemo(() => allProgress.map((p) => p.md5), [allProgress]);
  const { data: bookmarksData, isLoading: bookmarksLoading } = useBooksByMd5s(bookmarkMd5s);
  const { data: progressData, isLoading: progressLoading } = useBooksByMd5s(progressMd5s);

  const booksByMd5 = useMemo(() => {
    const map = new Map<string, BookItem>();
    (bookmarksData ?? []).forEach((book) => map.set(book.md5, book));
    return map;
  }, [bookmarksData]);

  const progressByMd5 = useMemo(() => {
    const map = new Map<string, BookItem>();
    (progressData ?? []).forEach((book) => map.set(book.md5, book));
    return map;
  }, [progressData]);

  // Prefer the freshly-resolved book, but never drop a saved position just because the
  // md5 lookup came back empty (offline, rate-limited, or de-listed upstream) — the
  // position itself remembers enough to render a card and reopen the book.
  const inProgressBooks = useMemo(() => inProgress.map((p) => progressByMd5.get(p.md5) ?? bookItemFromProgress(p)), [inProgress, progressByMd5]);
  const completedBooks = useMemo(() => completed.map((p) => progressByMd5.get(p.md5) ?? bookItemFromProgress(p)), [completed, progressByMd5]);

  return (
    <div className="flex flex-1 flex-col gap-10">
      <section className="flex w-full flex-col gap-4">
        <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight">
          <BookMarked className="text-primary h-6 w-6 shrink-0" />
          Bookmarks
        </h1>

        {bookmarks.length === 0 && folders.length === 0 && (
          <div className="glass-subtle text-muted-foreground flex flex-col items-start gap-3 rounded-xl p-5">
            <p className="text-sm">No bookmarks yet. Tap the bookmark button on any book to save it — then organize your shelves into folders.</p>
            <Button asChild className="gap-2">
              <Link to="/" search={{ q: "" }}>
                <Search className="h-4 w-4" />
                Browse books
              </Link>
            </Button>
          </div>
        )}

        <Bookshelf bookmarks={bookmarks} folders={folders} booksByMd5={booksByMd5} isLoading={bookmarksLoading} />
      </section>

      <section className="flex w-full flex-col gap-4">
        <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight">
          <BookOpen className="text-primary h-6 w-6 shrink-0" />
          Continue reading
        </h1>
        {inProgress.length === 0 ? (
          <div className="glass-subtle text-muted-foreground rounded-xl p-5 text-sm">Start reading a book and your progress will pick up right here.</div>
        ) : (
          <BookCollection books={inProgressBooks} view={view} isLoading={progressLoading} expectedCount={inProgress.length} tileActions={continueActions} />
        )}
      </section>

      {completed.length > 0 && (
        <section className="flex w-full flex-col gap-4">
          <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight">
            <BadgeCheck className="text-primary h-6 w-6 shrink-0" />
            Finished
          </h1>
          <BookCollection books={completedBooks} view={view} isLoading={progressLoading} expectedCount={completed.length} tileActions={finishedActions} />
        </section>
      )}
    </div>
  );
}
