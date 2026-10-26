import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_FOLDER_COLOR, FOLDER_COLORS, useBookmarksStore } from "@/stores/bookmarks";

interface FolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a folder id to edit it; omit to create a new folder. */
  editId?: string | null;
  /** Called with the new folder's id after a create. */
  onCreated?: (id: string) => void;
}

export function FolderDialog({ open, onOpenChange, editId, onCreated }: FolderDialogProps) {
  const folders = useBookmarksStore((s) => s.folders);
  const addFolder = useBookmarksStore((s) => s.addFolder);
  const renameFolder = useBookmarksStore((s) => s.renameFolder);
  const setFolderColor = useBookmarksStore((s) => s.setFolderColor);

  const editing = editId ? folders.find((f) => f.id === editId) : undefined;

  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(DEFAULT_FOLDER_COLOR);

  // Reset the form whenever the dialog opens (with the editing folder's values).
  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setColor(editing?.color ?? DEFAULT_FOLDER_COLOR);
  }, [open, editing?.name, editing?.color]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (editing) {
      renameFolder(editing.id, trimmed);
      setFolderColor(editing.id, color);
    } else {
      const id = addFolder(trimmed, color);
      onCreated?.(id);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit folder" : "New folder"}</DialogTitle>
          <DialogDescription>{editing ? "Rename this folder or change its colour." : "Group your saved books into a shelf of your own."}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="folder-name">Name</Label>
            <Input
              id="folder-name"
              value={name}
              autoFocus
              maxLength={40}
              placeholder="e.g. Sci-fi, To read, Favourites"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Colour</Label>
            <div className="flex flex-wrap gap-2">
              {FOLDER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Use colour ${c}`}
                  onClick={() => setColor(c)}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-background transition-transform hover:scale-110",
                    color === c ? "ring-foreground" : "ring-transparent",
                  )}
                  style={{ backgroundColor: c }}
                >
                  {color === c && <Check className="h-4 w-4 text-white" />}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name.trim()}>
            {editing ? "Save changes" : "Create folder"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
