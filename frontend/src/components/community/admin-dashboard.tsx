import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SlidingTabs } from "@/components/ui/sliding-tabs";
import { cn, glassCard } from "@/lib/utils";
import { ArrowDownToLine, Ban, BookCopy, KeyRound, Loader2, Lock, LogOut, ShieldCheck, ShieldOff, Trash2, UserCheck } from "lucide-react";
import {
  adminBan,
  adminDeleteUpload,
  adminSuspend,
  adminUploadsQueryOptions,
  adminUsersQueryOptions,
  type AdminUpload,
  type AdminUser,
} from "@/api/backend/community/community";

const ADMIN_STORE = "BR::admin";
type Tab = "uploads" | "users";

function useAdminKey() {
  const [key, setKey] = useState<string>(() => (typeof localStorage !== "undefined" ? localStorage.getItem(ADMIN_STORE) || "" : ""));
  const save = (k: string) => {
    setKey(k);
    if (k) localStorage.setItem(ADMIN_STORE, k);
    else localStorage.removeItem(ADMIN_STORE);
  };
  return { key, save };
}

function KeyGate({ onUnlock }: { onUnlock: (key: string) => void }) {
  const [val, setVal] = useState("");
  return (
    <Card className={glassCard}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="text-primary h-5 w-5" />
          Admin access
        </CardTitle>
        <CardDescription>Enter the admin key to manage community uploads and contributors. It's stored only on this device.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row">
        <Input type="password" value={val} onChange={(e) => setVal(e.target.value)} placeholder="Admin key" className="sm:flex-1" iconLeft={<KeyRound className="h-4 w-4" />} onKeyDown={(e) => e.key === "Enter" && val && onUnlock(val)} />
        <Button onClick={() => val && onUnlock(val)} disabled={!val} className="gap-2">
          <Lock className="h-4 w-4" />
          Unlock
        </Button>
      </CardContent>
    </Card>
  );
}

function UploadRow({ u, adminKey, onChanged }: { u: AdminUpload; adminKey: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const del = async () => {
    if (!confirm(`Delete “${u.title}”? This removes it from storage and can't be undone.`)) return;
    setBusy(true);
    try {
      await adminDeleteUpload(adminKey, u.md5);
      toast.success("Upload deleted.", { position: "top-right" });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed.", { position: "top-right" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="glass flex items-center gap-3 rounded-xl p-2.5">
      <div className="bg-muted/40 h-14 w-10 shrink-0 overflow-hidden rounded">{u.book_image && <img src={u.book_image} alt="" className="h-full w-full object-cover" />}</div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium" title={u.title}>
          {u.title}
        </span>
        <span className="text-muted-foreground truncate text-xs">
          {u.author || "Unknown"} · {u.uploader ? `@${u.uploader}` : "Anonymous"}
          {u.banned && <span className="text-destructive"> · banned</span>}
        </span>
      </div>
      <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-xs tabular-nums">
        <ArrowDownToLine className="h-3.5 w-3.5" />
        {u.downloads.toLocaleString()}
      </span>
      <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive h-8 w-8 shrink-0" onClick={del} disabled={busy} aria-label="Delete upload">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      </Button>
    </div>
  );
}

function UserRow({ u, adminKey, onChanged }: { u: AdminUser; adminKey: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const suspended = Boolean(u.suspendedUntil && Date.parse(u.suspendedUntil) > Date.now());
  const act = async (fn: () => Promise<void>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(msg, { position: "top-right" });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed.", { position: "top-right" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={cn("glass flex flex-wrap items-center gap-3 rounded-xl p-3", u.banned && "ring-destructive/40 ring-1")}>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">
          {u.username ? `@${u.username}` : "Anonymous"}
          {u.banned && <span className="text-destructive text-xs"> · banned</span>}
          {!u.banned && suspended && <span className="text-xs text-amber-500"> · suspended</span>}
        </span>
        <span className="text-muted-foreground font-mono text-[11px]" title={u.uid}>
          {u.uid.slice(0, 16)}…
        </span>
      </div>
      <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-xs tabular-nums">
        <BookCopy className="h-3.5 w-3.5" />
        {u.books}
      </span>
      <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-xs tabular-nums">
        <ArrowDownToLine className="h-3.5 w-3.5" />
        {u.downloads.toLocaleString()}
      </span>
      <div className="flex shrink-0 gap-1.5">
        {suspended ? (
          <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => act(() => adminSuspend(adminKey, u.uid, null), "Suspension lifted.")}>
            <UserCheck className="h-3.5 w-3.5" /> Unsuspend
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="gap-1.5" disabled={busy || u.banned} onClick={() => act(() => adminSuspend(adminKey, u.uid, new Date(Date.now() + 7 * 864e5).toISOString()), "Suspended for 7 days.")}>
            <ShieldOff className="h-3.5 w-3.5" /> Suspend 7d
          </Button>
        )}
        {u.banned ? (
          <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => act(() => adminBan(adminKey, u.uid, false), "Unbanned.")}>
            <UserCheck className="h-3.5 w-3.5" /> Unban
          </Button>
        ) : (
          <Button size="sm" variant="destructive" className="gap-1.5" disabled={busy} onClick={() => act(() => adminBan(adminKey, u.uid, true), "Contributor banned.")}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />} Ban
          </Button>
        )}
      </div>
    </div>
  );
}

export function AdminDashboard() {
  const { key, save } = useAdminKey();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("uploads");

  const uploadsQ = useQuery(adminUploadsQueryOptions(key));
  const usersQ = useQuery(adminUsersQueryOptions(key));

  // A bad key surfaces as a query error — make that obvious and let them re-enter.
  const authError = (uploadsQ.error || usersQ.error) as { status?: number } | null;
  useEffect(() => {
    if (authError && "status" in authError && (authError.status === 403 || authError.status === 401)) {
      toast.error("That admin key was rejected.", { position: "top-right" });
    }
  }, [authError]);

  if (!key) {
    return (
      <div className="mx-auto w-full max-w-lg">
        <KeyGate onUnlock={save} />
      </div>
    );
  }

  const refreshUploads = () => queryClient.invalidateQueries({ queryKey: ["admin-uploads"] });
  const refreshUsers = () => queryClient.invalidateQueries({ queryKey: ["admin-users"] });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="flex items-center gap-3 text-4xl font-bold tracking-tight">
            <ShieldCheck className="text-primary h-8 w-8" />
            Moderation
          </h1>
          <p className="text-muted-foreground text-base sm:text-lg">Remove books, and ban or suspend contributors.</p>
        </div>
        <Button variant="outline" className="gap-2" onClick={() => save("")}>
          <LogOut className="h-4 w-4" />
          Lock
        </Button>
      </div>

      <SlidingTabs
        value={tab}
        onValueChange={setTab}
        options={[
          { value: "uploads", label: "Uploads", icon: BookCopy },
          { value: "users", label: "Contributors", icon: ShieldCheck },
        ]}
        className="glass w-fit rounded-2xl p-1"
        indicatorClassName="rounded-xl bg-primary shadow-sm"
        tabClassName="gap-2 rounded-xl px-4 py-2 text-sm"
        activeTabClassName="text-white"
      />

      <div key={tab} className="animate-in fade-in-0 slide-in-from-bottom-1 flex flex-col gap-2 duration-200 ease-out">
        {tab === "uploads" ? (
          uploadsQ.isLoading ? (
            Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="skeleton-shimmer h-[76px] w-full rounded-xl" />)
          ) : (uploadsQ.data?.uploads.length ?? 0) === 0 ? (
            <p className="text-muted-foreground text-sm">No uploads.</p>
          ) : (
            uploadsQ.data?.uploads.map((u) => <UploadRow key={u.md5} u={u} adminKey={key} onChanged={refreshUploads} />)
          )
        ) : usersQ.isLoading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="skeleton-shimmer h-[64px] w-full rounded-xl" />)
        ) : (usersQ.data?.users.length ?? 0) === 0 ? (
          <p className="text-muted-foreground text-sm">No contributors yet.</p>
        ) : (
          usersQ.data?.users.map((u) => <UserRow key={u.uid} u={u} adminKey={key} onChanged={refreshUsers} />)
        )}
      </div>
    </div>
  );
}
