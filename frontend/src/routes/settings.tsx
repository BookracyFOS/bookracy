import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ClipBoardButton } from "@/components/layout/clipboard-button";
import { useSettingsStore, type SwipeAction } from "@/stores/settings";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { useRef, useState } from "react";
import { ArrowLeftToLine, ArrowRightToLine, Check, Download, FileArchive, Files, Hand, ListChecks, type LucideIcon, Moon, PictureInPicture2, Share, Shuffle, Smartphone, Sun, Tablet, Trash2, Upload } from "lucide-react";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import {
  applyBackup,
  clearLocalData,
  diffBackup,
  exportUserData,
  hasExistingData,
  parseBackupFile,
  type CategoryDiff,
  type CategoryMode,
  type ImportDiff,
  type ImportPlan,
  type ParsedBackup,
} from "@/lib/data-transfer";
import { cn, glassCard } from "@/lib/utils";
import { CloudSyncSettings } from "@/components/sync/cloud-sync-settings";
import { ProfileCard } from "@/components/community/profile-card";
import { deleteCloudData } from "@/lib/sync/cloud";
import { useSyncStore } from "@/stores/sync";
import { useSelectionStore } from "@/stores/selection";

export const Route = createFileRoute("/settings")({
  component: Settings,
});

const CATEGORY_OPTIONS: { value: CategoryMode; label: string }[] = [
  { value: "keep", label: "Keep mine" },
  { value: "merge", label: "Merge" },
  { value: "overwrite", label: "Overwrite" },
];

const PREF_OPTIONS: { value: "keep" | "overwrite"; label: string }[] = [
  { value: "keep", label: "Keep mine" },
  { value: "overwrite", label: "Overwrite" },
];

function ModeChooser<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; icon?: LucideIcon }[] }) {
  return (
    <div className="bg-muted/50 inline-flex shrink-0 rounded-lg p-0.5">
      {options.map((o) => {
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              value === o.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function countsLabel(d: CategoryDiff) {
  return `${d.incoming} in file · ${d.current} saved${d.overlap > 0 ? ` · ${d.overlap} overlap` : ""}`;
}

function ConflictRow({ title, diff, value, onChange }: { title: string; diff: CategoryDiff; value: CategoryMode; onChange: (v: CategoryMode) => void }) {
  if (diff.incoming === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
      <div className="flex flex-col">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-muted-foreground text-xs">{countsLabel(diff)}</span>
      </div>
      <ModeChooser value={value} onChange={onChange} options={CATEGORY_OPTIONS} />
    </div>
  );
}

function defaultPlan(diff: ImportDiff): ImportPlan {
  // Merge is the safe default — it never destroys local data.
  const cat = (d: CategoryDiff): CategoryMode => (d.incoming === 0 ? "keep" : "merge");
  return {
    bookmarks: cat(diff.bookmarks),
    folders: cat(diff.folders),
    readingProgress: cat(diff.readingProgress),
    preferences: "keep",
  };
}

// Swipe-action options. "remove" / "complete" / "none" work today; the rest are shown
// as disabled "coming soon" choices so the menu hints at what's on the way.
const SWIPE_OPTIONS: { value: SwipeAction; label: string }[] = [
  { value: "complete", label: "Mark complete" },
  { value: "remove", label: "Remove" },
  { value: "none", label: "Do nothing" },
];
const SWIPE_COMING_SOON = ["Add to folder", "Toggle bookmark", "Download", "Share"];

function SwipeActionSelect({ value, onChange }: { value: SwipeAction; onChange: (v: SwipeAction) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SwipeAction)}>
      <SelectTrigger className="h-9 w-[170px] shrink-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {SWIPE_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectGroup>
          <SelectLabel className="text-muted-foreground/70 text-xs">More coming soon</SelectLabel>
          {SWIPE_COMING_SOON.map((label) => (
            <SelectItem key={label} value={`soon-${label}`} disabled>
              {label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function Settings() {
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const bulkDownload = useSettingsStore((state) => state.bulkDownload);
  const setBulkDownload = useSettingsStore((state) => state.setBulkDownload);
  const bulkDownloadFormat = useSettingsStore((state) => state.bulkDownloadFormat);
  const setBulkDownloadFormat = useSettingsStore((state) => state.setBulkDownloadFormat);
  const floatingDownloads = useSettingsStore((state) => state.floatingDownloads);
  const setFloatingDownloads = useSettingsStore((state) => state.setFloatingDownloads);
  const autoTryNextOnFail = useSettingsStore((state) => state.autoTryNextOnFail);
  const setAutoTryNextOnFail = useSettingsStore((state) => state.setAutoTryNextOnFail);
  const mobileGestures = useSettingsStore((state) => state.mobileGestures);
  const setMobileGestures = useSettingsStore((state) => state.setMobileGestures);
  const swipeRightAction = useSettingsStore((state) => state.swipeRightAction);
  const setSwipeRightAction = useSettingsStore((state) => state.setSwipeRightAction);
  const swipeLeftAction = useSettingsStore((state) => state.swipeLeftAction);
  const setSwipeLeftAction = useSettingsStore((state) => state.setSwipeLeftAction);
  const backendURL = useSettingsStore((state) => state.backendURL);
  const setBulkActive = useSelectionStore((state) => state.setActive);
  const kindleInstallCommand = `curl ${backendURL}/kindle/install.sh | sh`;
  const { canInstall, installed, isIOS, promptInstall } = usePwaInstall();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [conflict, setConflict] = useState<{ parsed: ParsedBackup; diff: ImportDiff } | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [alsoDeleteCloud, setAlsoDeleteCloud] = useState(true);
  const syncAccountId = useSyncStore((s) => s.accountId);

  const runApply = (parsed: ParsedBackup, importPlan: ImportPlan) => {
    const summary = applyBackup(parsed, importPlan);
    toast.success(`Imported ${summary.bookmarks} bookmarks, ${summary.folders} folders and ${summary.progress} reading entries.`, { position: "top-right" });
    setConflict(null);
    setPlan(null);
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;

    let parsed: ParsedBackup;
    try {
      parsed = await parseBackupFile(file);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed.", { position: "top-right" });
      return;
    }

    const diff = diffBackup(parsed);
    const nothingToImport = diff.bookmarks.incoming === 0 && diff.folders.incoming === 0 && diff.readingProgress.incoming === 0 && !diff.preferences.incoming;
    if (nothingToImport) {
      toast.info("That backup is empty — nothing to import.", { position: "top-right" });
      return;
    }

    // Nothing here to clobber → just import everything.
    if (!hasExistingData()) {
      runApply(parsed, { bookmarks: "overwrite", folders: "overwrite", readingProgress: "overwrite", preferences: "overwrite" });
      return;
    }

    setConflict({ parsed, diff });
    setPlan(defaultPlan(diff));
  };

  const handleClearData = async () => {
    // Optionally wipe the cloud copy too (before the local key is cleared).
    if (alsoDeleteCloud) await deleteCloudData();
    await clearLocalData();
    toast.success("All local data deleted. Reloading…", { position: "top-right" });
    setTimeout(() => window.location.assign("/"), 700);
  };

  return (
    <div className="flex flex-1 justify-center">
      <div className="flex w-full flex-col gap-8 md:w-1/2">
        <Card className={glassCard}>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>Customize how Bookracy looks.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="flex min-w-0 items-center gap-3">
                {theme === "dark" ? <Moon className="h-5 w-5 shrink-0" /> : <Sun className="h-5 w-5 shrink-0" />}
                <div className="flex min-w-0 flex-col">
                  <Label htmlFor="dark-mode" className="text-base">
                    Dark mode
                  </Label>
                  <span className="text-muted-foreground text-sm">Switch between the light and dark theme.</span>
                </div>
              </div>
              <Switch id="dark-mode" className="shrink-0" checked={theme === "dark"} onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")} />
            </div>
          </CardContent>
        </Card>

        <Card className={glassCard}>
          <CardHeader>
            <CardTitle>Bulk downloads</CardTitle>
            <CardDescription>Grab lots of books at once instead of one by one.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="flex min-w-0 items-center gap-3">
                <ListChecks className="h-5 w-5 shrink-0" />
                <div className="flex min-w-0 flex-col">
                  <Label htmlFor="bulk-download" className="text-base">
                    Bulk download mode
                  </Label>
                  <span className="text-muted-foreground text-sm">
                    Adds a toggle in the top bar. Turn it on to select multiple books, then download them together.
                  </span>
                </div>
              </div>
              <Switch
                id="bulk-download"
                className="shrink-0"
                checked={bulkDownload}
                onCheckedChange={(checked) => {
                  setBulkDownload(checked);
                  if (!checked) setBulkActive(false);
                }}
              />
            </div>

            {bulkDownload && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">Deliver as</span>
                  <span className="text-muted-foreground text-sm">
                    {bulkDownloadFormat === "zip"
                      ? "One ZIP archive — best on iPhone/Safari, which blocks lots of separate downloads. Built in memory, so go easy on huge batches."
                      : "Separate files, downloaded one at a time in a queue."}
                  </span>
                </div>
                <ModeChooser
                  value={bulkDownloadFormat}
                  onChange={setBulkDownloadFormat}
                  options={[
                    { value: "queue", label: "Separate files", icon: Files },
                    { value: "zip", label: "Single ZIP", icon: FileArchive },
                  ]}
                />
              </div>
            )}

            {bulkDownload && (
              <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <PictureInPicture2 className="h-5 w-5 shrink-0" />
                  <div className="flex min-w-0 flex-col">
                    <Label htmlFor="floating-downloads" className="text-base">
                      Floating panel
                    </Label>
                    <span className="text-muted-foreground text-sm">Show the mini downloads panel in the corner. Turn it off to keep things tidy — your downloads still live in the Library.</span>
                  </div>
                </div>
                <Switch id="floating-downloads" className="shrink-0" checked={floatingDownloads} onCheckedChange={setFloatingDownloads} />
              </div>
            )}

            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="flex min-w-0 items-center gap-3">
                <Shuffle className="h-5 w-5 shrink-0" />
                <div className="flex min-w-0 flex-col">
                  <Label htmlFor="auto-try-next" className="text-base">
                    Auto-try next result on failure
                  </Label>
                  <span className="text-muted-foreground text-sm">
                    When a search-result download errors out, silently try the next result — and keep going until one works. You'll still get a warning that it may not be the exact book.
                  </span>
                </div>
              </div>
              <Switch id="auto-try-next" className="shrink-0" checked={autoTryNextOnFail} onCheckedChange={setAutoTryNextOnFail} />
            </div>
          </CardContent>
        </Card>

        <Card className={glassCard}>
          <CardHeader>
            <CardTitle>Touch gestures</CardTitle>
            <CardDescription>Native-style swipe actions on touch devices — pick what each direction does.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="flex min-w-0 items-center gap-3">
                <Hand className="h-5 w-5 shrink-0" />
                <div className="flex min-w-0 flex-col">
                  <Label htmlFor="mobile-gestures" className="text-base">
                    Swipe actions
                  </Label>
                  <span className="text-muted-foreground text-sm">On phones, swipe a saved book to trigger an action. On desktop these show as buttons.</span>
                </div>
              </div>
              <Switch id="mobile-gestures" className="shrink-0" checked={mobileGestures} onCheckedChange={setMobileGestures} />
            </div>

            {mobileGestures && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <ArrowRightToLine className="h-5 w-5 shrink-0" />
                    <div className="flex min-w-0 flex-col">
                      <span className="text-sm font-medium">Swipe right</span>
                      <span className="text-muted-foreground text-sm">What a right swipe does on a saved book.</span>
                    </div>
                  </div>
                  <SwipeActionSelect value={swipeRightAction} onChange={setSwipeRightAction} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <ArrowLeftToLine className="h-5 w-5 shrink-0" />
                    <div className="flex min-w-0 flex-col">
                      <span className="text-sm font-medium">Swipe left</span>
                      <span className="text-muted-foreground text-sm">What a left swipe does on a saved book.</span>
                    </div>
                  </div>
                  <SwipeActionSelect value={swipeLeftAction} onChange={setSwipeLeftAction} />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className={glassCard}>
          <CardHeader>
            <CardTitle>Install app</CardTitle>
            <CardDescription>Get Bookracy as an app — full-screen, on your home screen or dock, and ready offline.</CardDescription>
          </CardHeader>
          <CardContent>
            {installed ? (
              <div className="text-muted-foreground flex items-center gap-2 rounded-lg border p-4 text-sm">
                <Check className="text-primary h-5 w-5" />
                Bookracy is installed on this device.
              </div>
            ) : canInstall ? (
              <Button onClick={promptInstall} className="w-full sm:w-auto">
                <Smartphone className="mr-2 h-4 w-4" />
                Install Bookracy
              </Button>
            ) : isIOS ? (
              <div className="text-muted-foreground flex items-center gap-2 rounded-lg border p-4 text-sm">
                <Share className="h-5 w-5 shrink-0" />
                Tap the Share button in Safari, then “Add to Home Screen”.
              </div>
            ) : (
              <div className="text-muted-foreground flex items-center gap-2 rounded-lg border p-4 text-sm">
                <Smartphone className="h-5 w-5 shrink-0" />
                Open your browser menu and choose “Install app” / “Add to Home Screen”.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className={glassCard}>
          <CardHeader>
            <CardTitle>Read on your Kindle</CardTitle>
            <CardDescription>Turn a jailbroken Kindle into a Bookracy reader — search and download books right on the device.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center gap-3 rounded-lg border p-4">
              <Tablet className="h-5 w-5 shrink-0" />
              <p className="text-muted-foreground text-sm">
                In your Kindle's terminal (KUAL → kterm), run this one-liner. It drops a <span className="text-foreground font-medium">Bookracy</span> entry into the KUAL launcher.
              </p>
            </div>
            <div className="bg-muted/40 flex items-center justify-between gap-2 rounded-lg border p-3">
              <code className="text-foreground min-w-0 flex-1 truncate font-mono text-xs sm:text-sm">{kindleInstallCommand}</code>
              <ClipBoardButton content={kindleInstallCommand} />
            </div>
            <p className="text-muted-foreground text-xs">Requires a jailbroken Kindle with KUAL + kterm. Everything runs through Bookracy — no other setup needed.</p>
          </CardContent>
        </Card>

        <Card className={glassCard}>
          <CardHeader>
            <CardTitle>Your data</CardTitle>
            <CardDescription>
              Your bookmarks, folders, reading progress and preferences live on <span className="text-foreground font-medium">this device</span>. Export a backup to keep it safe or move it by hand.
              (Cloud sync, below, keeps an automatic copy across your devices.)
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row">
            <Button onClick={exportUserData} className="flex-1">
              <Download className="mr-2 h-4 w-4" />
              Export data
            </Button>
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="flex-1">
              <Upload className="mr-2 h-4 w-4" />
              Import data
            </Button>
            <input ref={fileInputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleImport} />
          </CardContent>
        </Card>

        <ProfileCard />

        <CloudSyncSettings />

        <Card className={`${glassCard} border-destructive/40`}>
          <CardHeader>
            <CardTitle className="text-destructive">Delete your cookies and data</CardTitle>
            <CardDescription>Permanently remove all bookmarks, folders, reading progress, preferences and cookies stored on this device. This can't be undone.</CardDescription>
          </CardHeader>
          <CardContent>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="destructive" className="w-full sm:w-auto">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete your cookies and data
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete everything?</DialogTitle>
                  <DialogDescription>
                    This permanently deletes all your bookmarks, folders, reading progress, preferences and cookies stored on <span className="text-foreground font-medium">this device</span>. This can't be
                    undone — consider exporting a backup first.
                  </DialogDescription>
                </DialogHeader>
                {syncAccountId && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div className="flex flex-col">
                      <Label htmlFor="also-delete-cloud" className="text-sm font-medium">
                        Also delete my cloud copy
                      </Label>
                      <span className="text-muted-foreground text-xs">
                        {alsoDeleteCloud ? "Wipes your synced data from the cloud too." : "Cloud copy stays — you'll need your recovery key to get it back."}
                      </span>
                    </div>
                    <Switch id="also-delete-cloud" checked={alsoDeleteCloud} onCheckedChange={setAlsoDeleteCloud} />
                  </div>
                )}
                <DialogFooter className="gap-2">
                  <DialogClose asChild>
                    <Button variant="outline">Cancel</Button>
                  </DialogClose>
                  <Button variant="destructive" onClick={() => void handleClearData()}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Yes, delete everything
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>

        <Dialog
          open={!!conflict}
          onOpenChange={(open) => {
            if (!open) {
              setConflict(null);
              setPlan(null);
            }
          }}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>You already have data</DialogTitle>
              <DialogDescription>Choose what happens for each type. Keep mine leaves yours untouched, Merge adds anything new (yours wins on overlap), Overwrite replaces yours with the file's.</DialogDescription>
            </DialogHeader>

            {conflict && plan && (
              <div className="flex flex-col gap-2">
                <ConflictRow title="Bookmarks" diff={conflict.diff.bookmarks} value={plan.bookmarks} onChange={(v) => setPlan({ ...plan, bookmarks: v })} />
                <ConflictRow title="Folders" diff={conflict.diff.folders} value={plan.folders} onChange={(v) => setPlan({ ...plan, folders: v })} />
                <ConflictRow title="Reading progress" diff={conflict.diff.readingProgress} value={plan.readingProgress} onChange={(v) => setPlan({ ...plan, readingProgress: v })} />

                {conflict.diff.preferences.incoming && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">Preferences</span>
                      <span className="text-muted-foreground text-xs">{conflict.diff.preferences.conflict ? "Theme / language differ from yours" : "Theme & language"}</span>
                    </div>
                    <ModeChooser value={plan.preferences} onChange={(v) => setPlan({ ...plan, preferences: v })} options={PREF_OPTIONS} />
                  </div>
                )}
              </div>
            )}

            <DialogFooter className="gap-2 sm:justify-between">
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button
                onClick={() => {
                  if (conflict && plan) runApply(conflict.parsed, plan);
                }}
              >
                Import
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
