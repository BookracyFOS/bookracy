import { useState } from "react";
import { toast } from "sonner";
import { Turnstile } from "@marsidev/react-turnstile";
import { Check, Cloud, CloudOff, Copy, KeyRound, Loader2, RefreshCw, Trash2, UploadCloud } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSyncStore } from "@/stores/sync";
import { deleteCloudData, disableSync, enableSync, manualSyncNow, manualSyncRemaining, restoreSync, resumeSync } from "@/lib/sync/cloud";
import { cn, glassCard } from "@/lib/utils";

// Public Turnstile site key (domain-locked, safe to ship). Unset = no bot check on enable.
const TURNSTILE_SITE_KEY: string = import.meta.env.VITE_TURNSTILE_SITE_KEY || "";

function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function CloudSyncSettings() {
  const enabled = useSyncStore((s) => s.enabled);
  const accountId = useSyncStore((s) => s.accountId);
  const status = useSyncStore((s) => s.status);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);

  const [busy, setBusy] = useState(false);
  const [keyToShow, setKeyToShow] = useState<string | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreInput, setRestoreInput] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pendingEnable, setPendingEnable] = useState(false);
  const [widgetError, setWidgetError] = useState(false);

  const doEnable = async (turnstileToken?: string) => {
    setBusy(true);
    try {
      const id = await enableSync(turnstileToken);
      setPendingEnable(false);
      setWidgetError(false);
      setKeyToShow(id);
      toast.success("Cloud sync enabled — save your recovery key!", { position: "top-right" });
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error ? (error as { status?: number }).status : undefined;
      toast.error(status === 403 ? "Verification failed — refresh the page and try again." : "Couldn't enable sync. Check your connection and try again.", { position: "top-right" });
    } finally {
      setBusy(false);
    }
  };

  const handleEnableClick = () => {
    if (!TURNSTILE_SITE_KEY) {
      void doEnable();
      return;
    }
    setWidgetError(false);
    setPendingEnable(true);
  };

  const handleSyncNow = async () => {
    setBusy(true);
    try {
      await manualSyncNow();
      if (useSyncStore.getState().status === "error") toast.error("Sync failed — try again.", { position: "top-right" });
      else toast.success(`Synced. ${manualSyncRemaining()} manual syncs left today.`, { position: "top-right" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed.", { position: "top-right" });
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    setBusy(true);
    try {
      await restoreSync(restoreInput);
      setRestoreOpen(false);
      setRestoreInput("");
      toast.success("Restored and merged from your sync key.", { position: "top-right" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Restore failed.", { position: "top-right" });
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = () => {
    disableSync();
    toast.success("Cloud sync turned off on this device.", { position: "top-right" });
  };

  const handleDeleteCloud = async () => {
    setBusy(true);
    await deleteCloudData();
    setBusy(false);
    setDeleteOpen(false);
    toast.success("Cloud copy deleted and sync turned off.", { position: "top-right" });
  };

  const handleResume = async () => {
    setBusy(true);
    await resumeSync();
    setBusy(false);
    if (useSyncStore.getState().status === "error") toast.error("Couldn't reach the cloud copy — sync is on and will retry.", { position: "top-right" });
    else toast.success("Cloud sync resumed.", { position: "top-right" });
  };

  const copyKey = () => {
    if (!keyToShow) return;
    navigator.clipboard.writeText(keyToShow);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className={glassCard}>
      <CardHeader>
        <CardTitle>Cloud sync</CardTitle>
        <CardDescription>
          Back up your bookmarks, folders, reading progress and preferences (theme, language, reading font size and list/grid view) and sync them across devices &mdash; no email or password, just a
          recovery key you save. Off by default; nothing leaves your device until you turn it on.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {enabled ? (
          <>
            <div className="flex items-center gap-3 rounded-lg border p-4">
              <span className="bg-primary/15 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                {status === "syncing" ? <Loader2 className="h-5 w-5 animate-spin" /> : status === "error" ? <CloudOff className="h-5 w-5" /> : <Cloud className="h-5 w-5" />}
              </span>
              <div className="flex flex-col">
                <span className="text-sm font-medium">{status === "syncing" ? "Syncing…" : status === "error" ? "Sync failed" : "Sync is on"}</span>
                <span className="text-muted-foreground text-xs">{lastSyncedAt ? `Last synced ${timeAgo(lastSyncedAt)}` : "Not synced yet"}</span>
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button onClick={handleSyncNow} disabled={busy} className="flex-1">
                <RefreshCw className={cn("mr-2 h-4 w-4", busy && "animate-spin")} />
                Sync now
              </Button>
              <Button variant="outline" onClick={() => accountId && setKeyToShow(accountId)} className="flex-1">
                <KeyRound className="mr-2 h-4 w-4" />
                Show recovery key
              </Button>
              <Button variant="outline" onClick={handleDisable} className="flex-1">
                <CloudOff className="mr-2 h-4 w-4" />
                Turn off
              </Button>
            </div>
            <button type="button" onClick={() => setDeleteOpen(true)} className="text-destructive/80 hover:text-destructive w-fit cursor-pointer text-xs font-medium">
              Delete cloud copy
            </button>
          </>
        ) : accountId ? (
          <>
            <div className="flex items-center gap-3 rounded-lg border p-4">
              <span className="bg-muted text-muted-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                <CloudOff className="h-5 w-5" />
              </span>
              <div className="flex flex-col">
                <span className="text-sm font-medium">Sync is off</span>
                <span className="text-muted-foreground text-xs">Your key is saved on this device — turn it back on to resume.</span>
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button onClick={handleResume} disabled={busy} className="flex-1">
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
                Turn sync on
              </Button>
              <Button variant="outline" onClick={() => accountId && setKeyToShow(accountId)} className="flex-1">
                <KeyRound className="mr-2 h-4 w-4" />
                Show recovery key
              </Button>
            </div>
            <button type="button" onClick={() => setDeleteOpen(true)} className="text-destructive/80 hover:text-destructive w-fit cursor-pointer text-xs font-medium">
              Delete cloud copy
            </button>
          </>
        ) : pendingEnable ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border p-4">
            <p className="text-muted-foreground text-center text-sm">Quick check to keep bots out — your account is created right after.</p>
            <Turnstile siteKey={TURNSTILE_SITE_KEY} options={{ theme: "auto" }} onSuccess={(t) => void doEnable(t)} onError={() => setWidgetError(true)} onExpire={() => setWidgetError(true)} />
            {busy && <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />}
            {widgetError && (
              <div className="flex flex-col items-center gap-2">
                <p className="text-destructive text-center text-xs">{import.meta.env.DEV ? "Verification couldn't load (expected on localhost)." : "Verification couldn't load. Refresh the page and try again."}</p>
                {import.meta.env.DEV && (
                  <Button variant="outline" size="sm" onClick={() => void doEnable()}>
                    Continue without check (dev)
                  </Button>
                )}
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPendingEnable(false);
                setWidgetError(false);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button onClick={handleEnableClick} disabled={busy} className="flex-1">
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
              Enable cloud sync
            </Button>
            <Button variant="outline" onClick={() => setRestoreOpen(true)} className="flex-1">
              <KeyRound className="mr-2 h-4 w-4" />
              Restore with a key
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog open={!!keyToShow} onOpenChange={(o) => !o && setKeyToShow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your recovery key</DialogTitle>
            <DialogDescription>This is the only way to reach your synced data on another device. Save it somewhere safe — we can&apos;t recover it for you.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="bg-muted/50 rounded-lg border p-3">
              <code className="text-foreground font-mono text-sm leading-relaxed break-all select-all">{keyToShow}</code>
            </div>
            <Button variant="outline" onClick={copyKey} className="w-full gap-2">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied!" : "Copy key"}
            </Button>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button>Done</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={restoreOpen}
        onOpenChange={(o) => {
          if (!o) {
            setRestoreOpen(false);
            setRestoreInput("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore from a key</DialogTitle>
            <DialogDescription>Paste the recovery key from your other device. We&apos;ll pull your data down and merge it with anything already here.</DialogDescription>
          </DialogHeader>
          <Input value={restoreInput} onChange={(e) => setRestoreInput(e.target.value)} placeholder="Your 64-character sync key" className="font-mono text-xs" />
          <DialogFooter className="gap-2 sm:justify-between">
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button onClick={handleRestore} disabled={busy || restoreInput.trim().length === 0}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
              Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={(o) => !o && setDeleteOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your cloud copy?</DialogTitle>
            <DialogDescription>
              This permanently removes your synced data from the cloud and turns sync off on this device. Your local bookmarks, folders and progress stay put. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-between">
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={() => void handleDeleteCloud()} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Delete cloud copy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
