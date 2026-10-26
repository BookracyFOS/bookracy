import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BookUp, ImageUp, Loader2, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { CommunityBookCard } from "./community-card";
import { profileQueryOptions, updateUpload, deleteUpload, uploadCover, imageToJpegBlob, type CommunityBook } from "@/api/backend/community/community";
import { useSyncStore } from "@/stores/sync";
import { useViewStore } from "@/stores/view";

type EditForm = { title: string; author: string; year: string; lang: string; description: string };

export function MyUploads() {
  const accountId = useSyncStore((s) => s.accountId);
  const view = useViewStore((s) => s.view);
  const queryClient = useQueryClient();
  const { data: profile, isLoading, error } = useQuery(profileQueryOptions(accountId));

  const [editing, setEditing] = useState<CommunityBook | null>(null);
  const [coverFor, setCoverFor] = useState<CommunityBook | null>(null);
  const [deleting, setDeleting] = useState<CommunityBook | null>(null);
  const [form, setForm] = useState<EditForm>({ title: "", author: "", year: "", lang: "", description: "" });
  const [busy, setBusy] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) setForm({ title: editing.title, author: editing.author === "Unknown Author" ? "" : editing.author, year: editing.year, lang: editing.book_lang, description: editing.description });
  }, [editing]);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["profile"] }),
      queryClient.invalidateQueries({ queryKey: ["community-uploads"] }),
      queryClient.invalidateQueries({ queryKey: ["leaderboard"] }),
    ]);

  const saveEdit = async () => {
    if (!accountId || !editing || !form.title.trim()) return;
    setBusy(true);
    try {
      await updateUpload(accountId, editing.md5, { title: form.title.trim(), author: form.author.trim(), year: form.year.trim(), lang: form.lang.trim(), description: form.description.trim() });
      await refresh();
      toast.success("Saved.", { position: "top-right" });
      setEditing(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save.", { position: "top-right" });
    } finally {
      setBusy(false);
    }
  };

  const pickCover = async (file: File | null) => {
    if (!accountId || !coverFor || !file) return;
    setBusy(true);
    try {
      const jpeg = await imageToJpegBlob(file);
      await uploadCover(accountId, coverFor.md5, jpeg);
      await refresh();
      toast.success("Cover updated.", { position: "top-right" });
      setCoverFor(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't set the cover.", { position: "top-right" });
    } finally {
      setBusy(false);
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
  };

  const confirmDelete = async () => {
    if (!accountId || !deleting) return;
    setBusy(true);
    try {
      await deleteUpload(accountId, deleting.md5);
      await refresh();
      toast.success("Upload deleted.", { position: "top-right" });
      setDeleting(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete.", { position: "top-right" });
    } finally {
      setBusy(false);
    }
  };

  if (!accountId || (error && !isLoading)) {
    return (
      <Card className="glass rounded-2xl border-dashed">
        <CardContent className="text-muted-foreground flex flex-col items-center gap-3 py-14 text-center text-sm">
          <BookUp className="text-primary/50 h-10 w-10" />
          <p>{error && accountId ? "Couldn't load your uploads right now. Please try again in a moment." : "You haven't uploaded anything yet."}</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="skeleton-shimmer aspect-[3/4] w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  const uploads = profile?.uploads ?? [];
  if (uploads.length === 0) {
    return (
      <Card className="glass rounded-2xl border-dashed">
        <CardContent className="text-muted-foreground flex flex-col items-center gap-3 py-14 text-center text-sm">
          <BookUp className="text-primary/50 h-10 w-10" />
          <p>You haven't uploaded anything yet.</p>
          <p className="text-xs">Switch to the Upload tab to share your first book.</p>
        </CardContent>
      </Card>
    );
  }

  const menuFor = (book: CommunityBook) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="glass-strong h-8 w-8 rounded-lg" aria-label="Manage this upload">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="glass-strong border-0">
        <DropdownMenuItem onClick={() => setEditing(book)} className="cursor-pointer gap-2">
          <Pencil className="h-4 w-4" /> Edit details
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setCoverFor(book)} className="cursor-pointer gap-2">
          <ImageUp className="h-4 w-4" /> Change cover
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setDeleting(book)} className="text-destructive focus:text-destructive cursor-pointer gap-2">
          <Trash2 className="h-4 w-4" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      {view === "list" ? (
        <div className="flex flex-col gap-3">
          {uploads.map((book) => (
            <CommunityBookCard key={book.md5} book={book} variant="row" manageMenu={menuFor(book)} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 xl:grid-cols-4">
          {uploads.map((book) => (
            <CommunityBookCard key={book.md5} book={book} manageMenu={menuFor(book)} />
          ))}
        </div>
      )}

      {/* Edit metadata */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && !busy && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit details</DialogTitle>
            <DialogDescription>Update the metadata for this upload. The file itself can't be changed — re-upload to replace it.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ed-title">Title</Label>
              <Input id="ed-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={300} disabled={busy} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5 sm:col-span-1">
                <Label htmlFor="ed-author">Author</Label>
                <Input id="ed-author" value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} maxLength={200} disabled={busy} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ed-year">Year</Label>
                <Input id="ed-year" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value.replace(/[^0-9]/g, "").slice(0, 4) })} inputMode="numeric" disabled={busy} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ed-lang">Language</Label>
                <Input id="ed-lang" value={form.lang} onChange={(e) => setForm({ ...form, lang: e.target.value })} maxLength={40} disabled={busy} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ed-desc">Description</Label>
              <textarea
                id="ed-desc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                maxLength={2000}
                rows={3}
                disabled={busy}
                className="border-input bg-background placeholder:text-muted-foreground flex w-full resize-y rounded-md border px-3 py-2 text-sm focus-visible:outline-none disabled:opacity-50"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <DialogClose asChild>
              <Button variant="ghost" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={saveEdit} disabled={busy || !form.title.trim()} className="gap-2">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change cover */}
      <Dialog open={!!coverFor} onOpenChange={(o) => !o && !busy && setCoverFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change cover</DialogTitle>
            <DialogDescription>Upload a cover image (we'll resize it). It shows on the book everywhere in the Community library.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-4">
            <div className="bg-muted/40 h-32 w-24 shrink-0 overflow-hidden rounded-lg border">
              {coverFor?.book_image ? <img src={coverFor.book_image} alt="" className="h-full w-full object-cover" /> : <div className="text-muted-foreground flex h-full items-center justify-center text-xs">No cover</div>}
            </div>
            <div className="flex flex-col gap-2">
              <Button variant="outline" onClick={() => coverInputRef.current?.click()} disabled={busy} className="gap-2">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageUp className="h-4 w-4" />}
                Choose image
              </Button>
              <p className="text-muted-foreground text-xs">JPG / PNG / WebP, up to 5 MB.</p>
            </div>
            <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void pickCover(e.target.files?.[0] ?? null)} />
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={!!deleting} onOpenChange={(o) => !o && !busy && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this upload?</DialogTitle>
            <DialogDescription>
              “{deleting?.title}” will be removed from the Community library and deleted from storage. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-between">
            <DialogClose asChild>
              <Button variant="ghost" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button variant="destructive" onClick={confirmDelete} disabled={busy} className="gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="text-muted-foreground flex items-center justify-end gap-2 text-xs">
        <Link to="/settings" className="hover:text-foreground underline-offset-4 hover:underline">
          Delete all my uploads in Settings
        </Link>
      </p>
    </>
  );
}
