import { useMemo, useState } from "react";
import { BookItem } from "@/api/backend/types";
import { Bookmark, BookmarkFolder, useBookmarksStore } from "@/stores/bookmarks";
import { BookList } from "./book-list";
import { BookGallery } from "./book-gallery";
import { SkeletonBookItem, SkeletonBookItemGrid, BookTileActions } from "./book-item";
import { FolderDialog } from "./folder-dialog";
import { Button } from "../ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Download, FileArchive, FolderPlus, Library, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { useViewStore, type ResultView } from "@/stores/view";
import { useSettingsStore } from "@/stores/settings";
import { useSelectionStore } from "@/stores/selection";
import { useBulkDownload } from "@/hooks/use-bulk-download";

interface BookshelfProps {
  bookmarks: Bookmark[];
  folders: BookmarkFolder[];
  booksByMd5: Map<string, BookItem>;
  isLoading: boolean;
}

/** Renders a set of books as rows or a grid, with matching loading skeletons. */
export function BookCollection({
  books,
  view,
  isLoading,
  expectedCount,
  tileActions,
}: {
  books: BookItem[];
  view: ResultView;
  isLoading: boolean;
  expectedCount: number;
  tileActions?: BookTileActions;
}) {
  if (isLoading && expectedCount > 0) {
    if (view === "grid") {
      return (
        <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: Math.min(expectedCount, 8) }).map((_, i) => (
            <SkeletonBookItemGrid key={i} />
          ))}
        </div>
      );
    }
    return (
      <div className="grid grid-cols-1 gap-4">
        {Array.from({ length: Math.min(expectedCount, 3) }).map((_, i) => (
          <SkeletonBookItem key={i} />
        ))}
      </div>
    );
  }
  return view === "grid" ? <BookGallery books={books} actions={tileActions} /> : <BookList books={books} actions={tileActions} />;
}

function resolveBooks(groupBookmarks: Bookmark[], booksByMd5: Map<string, BookItem>): BookItem[] {
  return groupBookmarks.map((b) => booksByMd5.get(b.md5)).filter((b): b is BookItem => Boolean(b));
}

function Section({
  title,
  count,
  color,
  isLoading,
  books,
  expectedCount,
  view,
  actions,
  emptyHint,
}: {
  title: string;
  count: number;
  color?: string;
  isLoading: boolean;
  books: BookItem[];
  expectedCount: number;
  view: ResultView;
  actions?: React.ReactNode;
  emptyHint?: string;
}) {
  const bulkEnabled = useSettingsStore((s) => s.bulkDownload);
  const bulkActive = useSelectionStore((s) => s.active);
  const removeBookmark = useBookmarksStore((s) => s.removeBookmark);
  const { download: bulkDownload, format: bulkFormat } = useBulkDownload();

  const downloadAll = () => bulkDownload(books);
  const tileActions: BookTileActions = { onDelete: (b) => removeBookmark(b.md5), deleteLabel: "Remove" };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {color ? <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: color }} /> : <Library className="text-primary h-5 w-5 shrink-0" />}
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <span className="glass-subtle text-muted-foreground rounded-full px-2 py-0.5 text-xs tabular-nums">{count}</span>
        <div className="ml-auto flex items-center gap-1">
          {bulkEnabled && bulkActive && books.length > 0 && (
            <Button variant="ghost" size="sm" className="gap-1.5" aria-label={`Download all in ${title}`} onClick={downloadAll}>
              {bulkFormat === "zip" ? <FileArchive className="h-4 w-4" /> : <Download className="h-4 w-4" />}
              <span className="hidden sm:inline">{bulkFormat === "zip" ? "Zip all" : "Download all"}</span>
            </Button>
          )}
          {actions}
        </div>
      </div>

      {count === 0 && !(isLoading && expectedCount > 0) ? (
        <p className="text-muted-foreground glass-subtle rounded-xl p-4 text-sm">{emptyHint ?? "Nothing here yet."}</p>
      ) : (
        <BookCollection books={books} view={view} isLoading={isLoading} expectedCount={expectedCount} tileActions={tileActions} />
      )}
    </section>
  );
}

function FolderSection({ folder, bookmarks, booksByMd5, isLoading, view }: { folder: BookmarkFolder; bookmarks: Bookmark[]; booksByMd5: Map<string, BookItem>; isLoading: boolean; view: ResultView }) {
  const removeFolder = useBookmarksStore((s) => s.removeFolder);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const groupBookmarks = useMemo(() => bookmarks.filter((b) => b.folderId === folder.id), [bookmarks, folder.id]);
  const books = useMemo(() => resolveBooks(groupBookmarks, booksByMd5), [groupBookmarks, booksByMd5]);

  return (
    <>
      <Section
        title={folder.name}
        color={folder.color}
        count={groupBookmarks.length}
        expectedCount={groupBookmarks.length}
        isLoading={isLoading}
        books={books}
        view={view}
        emptyHint="This folder is empty — save a book here from any bookmark menu."
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Manage folder ${folder.name}`}>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditOpen(true)} className="gap-2">
                <Pencil className="h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)} className="gap-2">
                <Trash2 className="h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <FolderDialog open={editOpen} onOpenChange={setEditOpen} editId={folder.id} />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{folder.name}”?</DialogTitle>
            <DialogDescription>The folder will be removed. Any books inside it stay saved and move back to General — nothing is lost.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                removeFolder(folder.id);
                setConfirmOpen(false);
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function Bookshelf({ bookmarks, folders, booksByMd5, isLoading }: BookshelfProps) {
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const view = useViewStore((s) => s.view);

  const generalBookmarks = useMemo(() => bookmarks.filter((b) => b.folderId == null), [bookmarks]);
  const generalBooks = useMemo(() => resolveBooks(generalBookmarks, booksByMd5), [generalBookmarks, booksByMd5]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-end gap-3">
        <Button variant="outline" size="sm" className="gap-2" onClick={() => setNewFolderOpen(true)}>
          <FolderPlus className="h-4 w-4" />
          New folder
        </Button>
      </div>

      {folders.map((folder) => (
        <FolderSection key={folder.id} folder={folder} bookmarks={bookmarks} booksByMd5={booksByMd5} isLoading={isLoading} view={view} />
      ))}

      <Section
        title="General"
        count={generalBookmarks.length}
        expectedCount={generalBookmarks.length}
        isLoading={isLoading}
        books={generalBooks}
        view={view}
        emptyHint={folders.length > 0 ? "No loose books — everything's tucked into a folder." : "No bookmarks yet. Tap the bookmark button on any book and it'll show up here."}
      />

      <FolderDialog open={newFolderOpen} onOpenChange={setNewFolderOpen} />
    </div>
  );
}
