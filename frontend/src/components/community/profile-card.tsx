import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ArrowDownToLine, AtSign, BookCopy, BookUp, Loader2, type LucideIcon, Trash2 } from "lucide-react";
import { deleteAllUploads, profileQueryOptions, setUsername } from "@/api/backend/community/community";
import { ContributorBadge } from "./contributor-badge";
import { glassCard } from "@/lib/utils";
import { useSyncStore } from "@/stores/sync";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function Stat({ icon: Icon, value, label }: { icon: LucideIcon; value: number; label: string }) {
  return (
    <div className="glass-subtle flex items-center gap-3 rounded-xl px-4 py-3">
      <span className="bg-primary/10 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
        <Icon className="h-4 w-4" />
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="text-xl leading-none font-bold tabular-nums">{value.toLocaleString()}</span>
        <span className="text-muted-foreground text-xs">{label}</span>
      </div>
    </div>
  );
}

export function ProfileCard() {
  const accountId = useSyncStore((s) => s.accountId);
  const queryClient = useQueryClient();
  const { data: profile, isLoading, error } = useQuery(profileQueryOptions(accountId));

  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (profile) setName(profile.username ?? "");
  }, [profile]);

  const trimmed = name.trim();
  const validNew = trimmed === "" || USERNAME_RE.test(trimmed);
  const changed = (profile?.username ?? "") !== trimmed;

  const save = async () => {
    if (!accountId || !validNew || !changed) return;
    setSaving(true);
    try {
      const res = await setUsername(accountId, trimmed === "" ? null : trimmed);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["profile"] }), queryClient.invalidateQueries({ queryKey: ["leaderboard"] })]);
      toast.success(res.username ? `You're now @${res.username}.` : "You're anonymous again.", { position: "top-right" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update your username.", { position: "top-right" });
    } finally {
      setSaving(false);
    }
  };

  const removeAll = async () => {
    if (!accountId) return;
    setDeleting(true);
    try {
      const n = await deleteAllUploads(accountId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["profile"] }),
        queryClient.invalidateQueries({ queryKey: ["community-uploads"] }),
        queryClient.invalidateQueries({ queryKey: ["leaderboard"] }),
      ]);
      toast.success(n > 0 ? `Deleted ${n} upload${n === 1 ? "" : "s"}.` : "No uploads to delete.", { position: "top-right" });
      setDeleteOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete your uploads.", { position: "top-right" });
    } finally {
      setDeleting(false);
    }
  };

  const noProfile = !accountId || (!isLoading && error);

  return (
    <Card className={glassCard}>
      <CardHeader>
        <CardTitle>Contributor profile</CardTitle>
        <CardDescription>
          Pick a public username for the books you upload — or stay anonymous. Your uploads and downloads earn your badge on the{" "}
          <Link to="/community" search={{ tab: "leaderboard" }} className="text-primary underline-offset-4 hover:underline">
            leaderboard
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {noProfile ? (
          <div className="text-muted-foreground flex flex-col items-start gap-3 rounded-xl border border-dashed p-4 text-sm">
            <span className="flex items-center gap-2">
              <BookUp className="h-4 w-4" />
              You don't have a contributor profile yet.
            </span>
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link to="/upload">
                <BookUp className="h-4 w-4" />
                Upload your first book
              </Link>
            </Button>
          </div>
        ) : isLoading ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your profile…
          </div>
        ) : (
          <>
            {profile && (
              <div className="flex flex-col gap-3">
                <ContributorBadge badge={profile.badge} className="w-fit" />
                <div className="grid grid-cols-2 gap-3">
                  <Stat icon={BookCopy} value={profile.books} label="uploads" />
                  <Stat icon={ArrowDownToLine} value={profile.downloads} label="downloads" />
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="username">Username</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input id="username" value={name} onChange={(e) => setName(e.target.value)} placeholder="Anonymous" maxLength={20} iconLeft={<AtSign className="h-4 w-4" />} className="sm:flex-1" />
                <Button onClick={save} disabled={!validNew || !changed || saving} className="gap-2">
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save
                </Button>
              </div>
              {!validNew ? <p className="text-destructive text-xs">3–20 letters, numbers or underscores.</p> : <p className="text-muted-foreground text-xs">Leave empty to stay anonymous.</p>}
            </div>

            {profile && profile.books > 0 && (
              <div className="border-destructive/30 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-3">
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">Delete all my uploads</span>
                  <span className="text-muted-foreground text-xs">
                    Permanently remove all {profile.books} of your uploaded book{profile.books === 1 ? "" : "s"} from the community.
                  </span>
                </div>
                <Dialog open={deleteOpen} onOpenChange={(o) => !deleting && setDeleteOpen(o)}>
                  <DialogTrigger asChild>
                    <Button variant="destructive" size="sm" className="gap-2">
                      <Trash2 className="h-4 w-4" />
                      Delete all
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Delete all your uploads?</DialogTitle>
                      <DialogDescription>
                        This permanently removes all {profile.books} of your uploaded books from the Community library and storage. This can't be undone.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:justify-between">
                      <DialogClose asChild>
                        <Button variant="ghost" disabled={deleting}>
                          Cancel
                        </Button>
                      </DialogClose>
                      <Button variant="destructive" onClick={removeAll} disabled={deleting} className="gap-2">
                        {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        Delete all
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
