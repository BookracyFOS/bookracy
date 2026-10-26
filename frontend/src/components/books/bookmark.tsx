import { BookItem } from "@/api/backend/types";
import { useBookmarksStore } from "@/stores/bookmarks";
import { Button } from "../ui/button";
import { useMemo, useState } from "react";
import { BookmarkCheck, BookmarkPlus, Check, FolderPlus, Library, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { FolderDialog } from "./folder-dialog";

export function BookmarkButton({ book }: { book: BookItem }) {
  const bookmarks = useBookmarksStore((state) => state.bookmarks);
  const folders = useBookmarksStore((state) => state.folders);
  const addBookmark = useBookmarksStore((state) => state.addBookmark);
  const removeBookmark = useBookmarksStore((state) => state.removeBookmark);

  const [menuOpen, setMenuOpen] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);

  const current = useMemo(() => bookmarks.find((b) => b.md5 === book.md5), [bookmarks, book.md5]);
  const isBookmarked = Boolean(current);
  const activeFolder = current?.folderId ? folders.find((f) => f.id === current.folderId) : undefined;
  const triggerColor = isBookmarked ? (activeFolder?.color ?? "var(--primary)") : undefined;

  const saveTo = (folderId: string | null) => addBookmark(book.md5, folderId);

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
          <Button size="icon" aria-label={isBookmarked ? "Edit bookmark" : "Add bookmark"} className="flex items-center gap-2">
            {isBookmarked ? <BookmarkCheck className="h-5 w-5" style={triggerColor ? { color: triggerColor } : undefined} /> : <BookmarkPlus className="h-5 w-5" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuLabel>{isBookmarked ? "Move to" : "Save to"}</DropdownMenuLabel>

          <DropdownMenuItem onSelect={() => saveTo(null)} className="gap-2">
            <Library className="h-4 w-4" />
            <span className="flex-1">General</span>
            {isBookmarked && current?.folderId == null && <Check className="h-4 w-4" />}
          </DropdownMenuItem>

          {folders.map((folder) => (
            <DropdownMenuItem key={folder.id} onSelect={() => saveTo(folder.id)} className="gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: folder.color }} />
              <span className="flex-1 truncate">{folder.name}</span>
              {current?.folderId === folder.id && <Check className="h-4 w-4" />}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setMenuOpen(false);
              setFolderDialogOpen(true);
            }}
            className="gap-2"
          >
            <FolderPlus className="h-4 w-4" />
            New folder…
          </DropdownMenuItem>

          {isBookmarked && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => removeBookmark(book.md5)} className="gap-2">
                <Trash2 className="h-4 w-4" />
                Remove bookmark
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <FolderDialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen} onCreated={(id) => saveTo(id)} />
    </>
  );
}
