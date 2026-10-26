import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Progress } from "../ui/progress";
import { cn } from "@/lib/utils";
import { TOAST_DURATION_MS } from "../ui/sonner";
import { FilePlus2, Loader2 } from "lucide-react";
import { LOCAL_BOOK_ACCEPT, LOCAL_BOOK_EXTS, ImportError, importLocalBook } from "@/lib/import-local-book";

/**
 * Drop zone for adding books the user already owns. Files never leave the device —
 * they're hashed in the browser and stored in the same IndexedDB library that holds
 * downloads, so an added EPUB opens in the in-app reader exactly like a downloaded one.
 *
 * Accepts multiple files at once and imports them one at a time, because hashing a
 * large book is CPU-bound and running several in parallel just makes every one slower
 * (and janks the UI on a phone).
 */
export function AddLocalBook() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentName, setCurrentName] = useState("");

  const importAll = async (files: File[]) => {
    if (!files.length || busy) return;
    setBusy(true);

    let added = 0;
    let refreshed = 0;
    const failures: string[] = [];

    for (const file of files) {
      setCurrentName(file.name);
      setProgress(0);
      try {
        const result = await importLocalBook(file, { onProgress: (f) => setProgress(Math.round(f * 100)) });
        if (result.duplicate) refreshed++;
        else added++;
      } catch (e) {
        failures.push(e instanceof ImportError ? `${file.name}: ${e.message}` : `${file.name}: couldn't be added.`);
      }
    }

    setBusy(false);
    setCurrentName("");
    setProgress(0);

    if (added) toast.success(added === 1 ? "Added to your device library." : `Added ${added} books to your device library.`, { duration: TOAST_DURATION_MS });
    if (refreshed) toast.info(refreshed === 1 ? "That book was already in your library — refreshed it." : `${refreshed} books were already saved — refreshed them.`);
    for (const message of failures.slice(0, 3)) toast.error(message);
    if (failures.length > 3) toast.error(`${failures.length - 3} more files couldn't be added.`);
  };

  const pick = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length) void importAll(files);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Add your own book files from this device"
      aria-busy={busy}
      onClick={() => !busy && inputRef.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !busy && (e.preventDefault(), inputRef.current?.click())}
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!busy) pick(e.dataTransfer.files);
      }}
      className={cn(
        "glass focus-visible:ring-primary/50 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-6 text-center transition-colors duration-200 ease-out focus-visible:ring-2 focus-visible:outline-none sm:p-8",
        dragging ? "border-primary bg-primary/5" : "border-border/70 hover:border-primary/50",
        busy && "pointer-events-none",
      )}
    >
      <span className="from-primary/25 to-primary/5 text-primary ring-primary/20 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ring-1">
        {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <FilePlus2 className="h-6 w-6" />}
      </span>

      {busy ? (
        <div className="flex w-full max-w-sm flex-col gap-2">
          <p className="truncate text-sm font-medium" title={currentName}>
            Adding {currentName}
          </p>
          <Progress value={progress} className="w-full" />
          <p className="text-muted-foreground text-xs tabular-nums">{progress}%</p>
        </div>
      ) : (
        <>
          <div className="flex max-w-md flex-col gap-1">
            <h3 className="font-semibold tracking-tight">Add your own books</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Drop files here or <span className="text-primary font-medium">browse your device</span>. EPUBs open in the built-in reader. Nothing is uploaded — your files stay on this device.
            </p>
          </div>
          <p className="text-muted-foreground/70 text-[11px] tracking-wide uppercase">{LOCAL_BOOK_EXTS.join(" · ")}</p>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.click();
            }}
          >
            Choose files
          </Button>
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={LOCAL_BOOK_ACCEPT}
        className="hidden"
        onChange={(e) => {
          void pick(e.target.files);
          // Reset so choosing the same file again (after a failure) fires onChange.
          e.target.value = "";
        }}
      />
    </div>
  );
}
