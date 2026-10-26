import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { cn, glassCard } from "@/lib/utils";
import { AlertTriangle, BookUp, CheckCircle2, FileUp, ImageUp, Loader2, SearchCheck, ShieldCheck, UploadCloud, X } from "lucide-react";
import { checkAvailability, ensureAccountId, extractEpubCover, imageToJpegBlob, md5OfFile, uploadBook, uploadCover, UPLOAD_EXTS, type UploadMeta } from "@/api/backend/community/community";
import type { BookItem } from "@/api/backend/types";
import { useSyncStore } from "@/stores/sync";

const TURNSTILE_SITE_KEY: string = import.meta.env.VITE_TURNSTILE_SITE_KEY || "";

type Phase = "idle" | "verifying" | "hashing" | "uploading";

const extOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
const stripExt = (name: string) => name.replace(/\.[^.]+$/, "");

function prettySize(bytes: number) {
  if (bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 || v >= 10 ? 0 : 1)} ${units[i]}`;
}

export function UploadForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const turnstileRef = useRef<TurnstileInstance>(null);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [year, setYear] = useState("");
  const [lang, setLang] = useState("");
  const [description, setDescription] = useState("");
  const [dragging, setDragging] = useState(false);

  const [coverBlob, setCoverBlob] = useState<Blob | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);

  const [matches, setMatches] = useState<BookItem[] | null>(null);
  const [checking, setChecking] = useState(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);

  const working = phase !== "idle";
  const ext = file ? extOf(file.name) : "";
  const extOk = file ? UPLOAD_EXTS.includes(ext as (typeof UPLOAD_EXTS)[number]) : true;
  const canSubmit = Boolean(file) && extOk && title.trim().length > 0 && !working;

  // A fresh Turnstile token (managed/invisible widget). On localhost the widget can't
  // solve → resolves to "" and the backend (no TURNSTILE_SECRET in dev) lets it through.
  const getToken = async (reset = false): Promise<string> => {
    const w = turnstileRef.current;
    if (!w) return "";
    if (reset) w.reset();
    try {
      const t = await Promise.race([w.getResponsePromise(), new Promise<string | undefined>((res) => setTimeout(() => res(undefined), 8000))]);
      return t || "";
    } catch {
      return "";
    }
  };

  const setCover = async (source: Blob) => {
    setCoverBusy(true);
    try {
      const jpeg = await imageToJpegBlob(source);
      setCoverBlob(jpeg);
      setCoverPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(jpeg);
      });
    } catch {
      /* ignore a bad image */
    } finally {
      setCoverBusy(false);
    }
  };

  const pickFile = async (f: File | null) => {
    if (!f) return;
    setFile(f);
    setMatches(null);
    if (!title.trim()) setTitle(stripExt(f.name));
    if (extOf(f.name) === "epub") {
      setCoverBusy(true);
      const cover = await extractEpubCover(f).catch(() => null);
      if (cover) await setCover(cover);
      else setCoverBusy(false);
    }
  };

  const reset = () => {
    setFile(null);
    setTitle("");
    setAuthor("");
    setYear("");
    setLang("");
    setDescription("");
    setProgress(0);
    setPhase("idle");
    setMatches(null);
    setCoverBlob(null);
    setCoverPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    turnstileRef.current?.reset();
    if (inputRef.current) inputRef.current.value = "";
  };

  const runCheck = async () => {
    const q = `${title} ${author}`.trim();
    if (!q) return;
    setChecking(true);
    try {
      setMatches(await checkAvailability(q));
    } finally {
      setChecking(false);
    }
  };

  const meta = (): UploadMeta => ({ title: title.trim(), author: author.trim(), ext, lang: lang.trim(), year: year.trim(), description: description.trim() });

  const runUpload = async (accountId: string) => {
    if (!file) return;
    try {
      setPhase("hashing");
      setProgress(0);
      const md5 = await md5OfFile(file, setProgress);

      setPhase("uploading");
      setProgress(0);
      const token = await getToken();
      await uploadBook({ file, md5, accountId, meta: meta(), turnstileToken: token, onProgress: setProgress });

      if (coverBlob) await uploadCover(accountId, md5, coverBlob).catch(() => {});

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["community-uploads"] }),
        queryClient.invalidateQueries({ queryKey: ["leaderboard"] }),
        queryClient.invalidateQueries({ queryKey: ["profile"] }),
      ]);

      toast.success(`“${meta().title}” uploaded — thanks for contributing!`, { position: "top-right" });
      reset();
      navigate({ to: "/community" });
    } catch (e) {
      setPhase("idle");
      setProgress(0);
      // The backend verifies the token before it checks for duplicates or size, so any
      // failed attempt has spent it; without a reset the next try was "Verification failed".
      turnstileRef.current?.reset();
      const status = e && typeof e === "object" && "status" in e ? (e as { status?: number }).status : undefined;
      toast.error(status === 403 ? "Verification failed — please try again." : e instanceof Error ? e.message : "Upload failed.", { position: "top-right" });
    }
  };

  const handleSubmit = async () => {
    if (!file || !canSubmit) return;
    let accountId = useSyncStore.getState().accountId;
    if (!accountId) {
      setPhase("verifying");
      try {
        const t1 = await getToken();
        accountId = await ensureAccountId(t1);
        turnstileRef.current?.reset(); // invalidate the used token → fresh one for the upload
      } catch (e) {
        setPhase("idle");
        const status = e && typeof e === "object" && "status" in e ? (e as { status?: number }).status : undefined;
        toast.error(status === 403 ? "Verification failed — refresh the page and try again." : e instanceof Error ? e.message : "Couldn't create an account.", { position: "top-right" });
        return;
      }
    }
    await runUpload(accountId);
  };

  return (
    <Card className={glassCard}>
      <CardHeader>
        <CardTitle>Upload a book</CardTitle>
        <CardDescription>Share a book with the community. It's stored durably and added to the Community library — every download counts toward your contributor badge.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div
          role="button"
          tabIndex={0}
          onClick={() => !working && inputRef.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !working && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            if (!working) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!working) void pickFile(e.dataTransfer.files?.[0] ?? null);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-8 text-center transition-colors",
            dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
            working && "pointer-events-none opacity-60",
          )}
        >
          <span className="from-primary/20 to-primary/5 text-primary flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br">
            <UploadCloud className="h-6 w-6" />
          </span>
          {file ? (
            <div className="flex items-center gap-2">
              <FileUp className="text-primary h-4 w-4" />
              <span className="max-w-[60vw] truncate text-sm font-medium sm:max-w-xs">{file.name}</span>
              <span className="text-muted-foreground text-xs tabular-nums">{prettySize(file.size)}</span>
              {!working && (
                <button
                  type="button"
                  aria-label="Remove file"
                  onClick={(e) => {
                    e.stopPropagation();
                    reset();
                  }}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Drop a file here, or click to choose</span>
              <span className="text-muted-foreground text-xs">{UPLOAD_EXTS.join(", ")}</span>
            </div>
          )}
          <input ref={inputRef} type="file" accept={UPLOAD_EXTS.map((e) => `.${e}`).join(",")} className="hidden" onChange={(e) => void pickFile(e.target.files?.[0] ?? null)} />
        </div>

        {file && !extOk && <p className="text-destructive text-sm">“.{ext}” isn't a supported book format.</p>}

        {file && (
          <div className="flex gap-4">
            <div className="flex shrink-0 flex-col items-center gap-2">
              <div className="bg-muted/40 relative h-36 w-24 overflow-hidden rounded-lg border">
                {coverPreview ? (
                  <img src={coverPreview} alt="Cover preview" className="h-full w-full object-cover" />
                ) : (
                  <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-1 px-2 text-center text-[11px]">
                    {coverBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageUp className="h-4 w-4" />}
                    {coverBusy ? "Reading…" : "No cover"}
                  </div>
                )}
              </div>
              <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={working || coverBusy} onClick={() => coverInputRef.current?.click()}>
                <ImageUp className="h-3.5 w-3.5" />
                {coverPreview ? "Replace" : "Add cover"}
              </Button>
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void setCover(f);
                  e.target.value = "";
                }}
              />
            </div>

            <div className="flex flex-1 flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="up-title">Title</Label>
                <Input id="up-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Book title" maxLength={300} disabled={working} />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5 sm:col-span-1">
                  <Label htmlFor="up-author">Author</Label>
                  <Input id="up-author" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Author" maxLength={200} disabled={working} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="up-year">Year</Label>
                  <Input id="up-year" value={year} onChange={(e) => setYear(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))} placeholder="2024" inputMode="numeric" disabled={working} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="up-lang">Language</Label>
                  <Input id="up-lang" value={lang} onChange={(e) => setLang(e.target.value)} placeholder="en" maxLength={40} disabled={working} />
                </div>
              </div>
            </div>
          </div>
        )}

        {file && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="up-desc">Description</Label>
            <textarea
              id="up-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A short summary (optional)"
              maxLength={2000}
              rows={3}
              disabled={working}
              className="border-input bg-background placeholder:text-muted-foreground flex w-full resize-y rounded-md border px-3 py-2 text-sm focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
        )}

        {file && (
          <div className="flex flex-col gap-2">
            <Button type="button" variant="outline" size="sm" className="w-fit gap-2" onClick={runCheck} disabled={checking || !title.trim()}>
              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />}
              Check if it's already on Bookracy
            </Button>
            {matches !== null &&
              (matches.length === 0 ? (
                <p className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  No close matches found — looks like a fresh addition.
                </p>
              ) : (
                <div className="border-primary/30 bg-primary/5 flex flex-col gap-1.5 rounded-lg border p-3 text-xs">
                  <span className="text-foreground inline-flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    This might already be on Bookracy:
                  </span>
                  {matches.slice(0, 3).map((m) => (
                    <a key={m.md5} href={`/?q=${encodeURIComponent(m.title)}`} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary truncate underline-offset-4 hover:underline">
                      {m.title} {m.author ? `· ${m.author}` : ""}
                    </a>
                  ))}
                  <span className="text-muted-foreground">You can still upload it if yours is a different edition/format.</span>
                </div>
              ))}
          </div>
        )}

        {phase === "verifying" && (
          <p className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Verifying…
          </p>
        )}
        {(phase === "hashing" || phase === "uploading") && (
          <div className="flex flex-col gap-1.5">
            <div className="text-muted-foreground flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {phase === "hashing" ? "Preparing file…" : "Uploading…"}
              </span>
              <span className="tabular-nums">{Math.round(progress * 100)}%</span>
            </div>
            <Progress value={progress * 100} />
          </div>
        )}

        {/* Managed (mostly invisible) bot check — a token is attached to every upload. */}
        {file && TURNSTILE_SITE_KEY && (
          <Turnstile ref={turnstileRef} siteKey={TURNSTILE_SITE_KEY} options={{ theme: "auto", appearance: "interaction-only" }} onError={() => {}} onExpire={() => turnstileRef.current?.reset()} />
        )}

        <div className="flex items-center gap-3">
          <Button onClick={handleSubmit} disabled={!canSubmit} className="gap-2">
            {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookUp className="h-4 w-4" />}
            {working ? "Working…" : "Upload book"}
          </Button>
          <p className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
            <ShieldCheck className="h-3.5 w-3.5" />
            Protected by a bot check. We create an anonymous account on your first upload.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
