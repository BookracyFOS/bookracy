import { useRef, useState } from "react";
import { DownloadAbortedError, useDownloadMutation } from "@/api/backend/downloads/external";
import { Button } from "../ui/button";
import { Download, Loader2 } from "lucide-react";
import { saveAs } from "@/lib/saveAs";
import { toast } from "sonner";
import { titleToSlug } from "@/lib/string";
import { funDownloadMessage, funReadyMessage } from "@/lib/fun";
import { formatBytes, type DownloadProgress } from "@/lib/download";
import { TOAST_DURATION_MS, TOAST_DURATION_LONG_MS } from "../ui/sonner";
import { BookItem } from "@/api/backend/types";
import { useSettingsStore } from "@/stores/settings";

interface BookDownloadButtonProps {
  title: string;
  extension: string;
  md5: string;
  author?: string;
  sourceSize?: string;
  primaryLink?: string;
  /** Community uploads live in our own storage — kept for API compatibility with callers. */
  community?: boolean;
  /** Ordered next candidates from the same search page. When the primary book fails
   *  to download, the button can walk through these as fallback sources — the user
   *  is prompted the first time, and can opt in to make it automatic. */
  siblings?: BookItem[];
}

// The backend's auto resolver already races every download source (libgenli +
// librarylol in parallel, then Standard Ebooks / Gutenberg / IA / libgensearch /
// IPFS / AA slow_download as fallbacks). A "try another source" dropdown used to
// live here, but every option it exposed is something auto already tried on the
// primary click — so if auto failed, the dropdown was guaranteed to fail too, just
// slower and with worse messaging. Kept a single button that hits the auto endpoint.
//
// The download mutation also persists the fetched blob to the offline library
// (IndexedDB) — so single-book downloads (the main path) light up the "Saved" chip
// and appear on the Library page, matching the behaviour of the bulk queue path.
//
// Cancellation: aa_slow / libgensearch chains can genuinely take 30–60s on the
// first hit for an obscure book. The loading toast now exposes a Cancel action
// wired to an AbortController so users don't have to sit through it.
//
// Search-result fallback: on the search page each button also receives the rest of
// the results as `siblings`. If the primary book errors out, we offer to hop to
// the next result (and remember that choice on request). A fallback that succeeds
// warns the user that the file might not be the exact book they asked for — the
// offline "Saved" chip lights up on the fallback book's card, not this one.
// Transfer readout for the loading toast. Two honest states, never a fake one:
// before the first byte arrives the backend is still racing download sources and we
// have nothing to report, so the toast keeps its plain spinner; once bytes flow we
// show a real determinate bar driven by Content-Length.
/** "2h 14m" / "33 min" / "< 1 min" from a seconds estimate. */
function formatEta(seconds: number): string {
  if (seconds < 60) return "< 1 min";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function TransferProgress({ progress, bytesPerSecond }: { progress: DownloadProgress; bytesPerSecond?: number }) {
  const { percent, receivedBytes, totalBytes } = progress;
  // Speed and time left only once the rate is measured, and only while it matters:
  // a first fetch of a niche book streams from the upstream mirror, which can crawl at
  // tens of KB/s. "1%" alone read as broken; "22 KB/s · ~33 min left" reads as slow.
  const eta = bytesPerSecond && totalBytes && totalBytes > receivedBytes ? (totalBytes - receivedBytes) / bytesPerSecond : undefined;
  return (
    <div className="mt-1 flex flex-col gap-1">
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={percent === undefined ? "h-full w-1/3 animate-pulse rounded-full bg-primary" : "h-full rounded-full bg-primary transition-[width] duration-200"}
          style={percent === undefined ? undefined : { width: `${percent}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">
        {formatBytes(receivedBytes)}
        {totalBytes ? ` of ${formatBytes(totalBytes)}` : ""}
        {percent === undefined ? "" : ` · ${Math.round(percent)}%`}
        {bytesPerSecond ? ` · ${formatBytes(bytesPerSecond)}/s` : ""}
        {eta !== undefined && eta > 5 ? ` · ~${formatEta(eta)} left` : ""}
      </span>
    </div>
  );
}

export function BookDownloadButton(props: BookDownloadButtonProps) {
  const { mutateAsync } = useDownloadMutation();
  // One controller per active download — kept in a ref so both the toast's Cancel
  // action and a fresh click on the button can reach it. Cleared in both success
  // and error paths so we never accidentally abort the next download with a stale one.
  const controllerRef = useRef<AbortController | null>(null);
  // Tracks the local "chain in progress" state so the button spinner + disabled
  // state stay put across an entire fallback chain (not just the current attempt).
  const [chainActive, setChainActive] = useState(false);
  const autoTryNext = useSettingsStore((s) => s.autoTryNextOnFail);
  const setAutoTryNext = useSettingsStore((s) => s.setAutoTryNextOnFail);
  if (!props.primaryLink) return null;

  // Descriptor for a single candidate in the chain. The primary book is the first
  // link, siblings supply the rest. We deliberately capture the settings snapshot
  // at click-time (not on each iteration) so mid-chain UI churn doesn't cause a
  // stale-closure bug.
  type Candidate = { link: string; md5: string; title: string; author?: string; sourceSize?: string; extension: string };
  const primary: Candidate = {
    link: props.primaryLink,
    md5: props.md5,
    title: props.title,
    author: props.author,
    sourceSize: props.sourceSize,
    extension: props.extension,
  };
  const chain: Candidate[] = [
    primary,
    ...(props.siblings ?? [])
      .filter((s) => s?.link && s.md5 && s.md5 !== props.md5)
      .map((s) => ({ link: s.link, md5: s.md5, title: s.title, author: s.author, sourceSize: s.book_size, extension: s.book_filetype })),
  ];

  // Attempt a single candidate. Returns true if it succeeded (and the chain should
  // stop), false if it failed and the caller may want to advance to the next one.
  // Cancellation short-circuits the whole chain — the user asked to stop.
  const attempt = async (
    candidate: Candidate,
    index: number,
    toastId: string | number,
  ): Promise<{ ok: true } | { ok: false; cancelled: boolean }> => {
    const controller = new AbortController();
    controllerRef.current = controller;
    const fallbackFilename = `${titleToSlug(candidate.title)}${candidate.extension ? `.${candidate.extension}` : ""}`;
    const loadingLabel = index === 0 ? funDownloadMessage(candidate.title) : `Trying result #${index + 1}: “${candidate.title}”…`;
    // Reuse the same toast id so the whole chain shows as a single evolving toast
    // rather than a stack. Cancel action re-anchors on each attempt's controller.
    const paint = (progress?: DownloadProgress, bytesPerSecond?: number) =>
      toast.loading(loadingLabel, {
        id: toastId,
        description: progress ? <TransferProgress progress={progress} bytesPerSecond={bytesPerSecond} /> : undefined,
        action: {
          label: "Cancel",
          onClick: () => controller.abort(),
        },
        // Explicitly clear so the "Auto" cancel slot from a prior askContinue()
        // doesn't linger next to the fresh Cancel button on the loading toast.
        cancel: undefined,
        duration: Infinity,
      });
    paint();
    // The body reader fires per chunk, which is far more often than anyone can read.
    // Repaint at ~5fps (always painting the final one so the bar lands on 100%).
    let lastPaint = 0;
    // Throughput: an exponential moving average of the rate between repaints, so the
    // readout settles instead of flickering with every chunk.
    let rateAt = 0;
    let rateBytes = 0;
    let rate: number | undefined;
    const onProgress = (p: DownloadProgress) => {
      const now = performance.now();
      const finished = p.totalBytes !== undefined && p.receivedBytes >= p.totalBytes;
      if (!finished && now - lastPaint < 200) return;
      if (rateAt) {
        const dt = (now - rateAt) / 1000;
        if (dt > 0) {
          const sample = (p.receivedBytes - rateBytes) / dt;
          rate = rate === undefined ? sample : rate * 0.7 + sample * 0.3;
        }
      }
      rateAt = now;
      rateBytes = p.receivedBytes;
      lastPaint = now;
      paint(p, rate);
    };
    try {
      const { url, filename } = await mutateAsync({
        link: candidate.link,
        md5: candidate.md5,
        title: candidate.title,
        author: candidate.author,
        sourceSize: candidate.sourceSize,
        fallbackFilename,
        signal: controller.signal,
        onProgress,
      });
      controllerRef.current = null;
      // Prefer the server's filename — if libgensearch redirected to an alternate
      // format, this is the real ext + name and matches what we saved offline.
      saveAs(url, filename);
      // The object URL pins the whole book in memory until revoked; mirror the queue path.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (index === 0) {
        // Clean happy path — same book the user asked for.
        toast.success(funReadyMessage(candidate.title), { id: toastId, duration: TOAST_DURATION_MS });
      } else {
        // Fallback path — grabbed a different result. Warn explicitly so the user
        // knows the file on disk may not be the exact book they clicked; the
        // "Saved" chip on that book's own card is the honest source of truth.
        toast.success(`Grabbed “${candidate.title}” instead — this may not be the exact book you asked for.`, {
          id: toastId,
          duration: TOAST_DURATION_LONG_MS,
        });
      }
      return { ok: true };
    } catch (error) {
      controllerRef.current = null;
      if (error instanceof DownloadAbortedError) {
        toast.dismiss(toastId);
        return { ok: false, cancelled: true };
      }
      return { ok: false, cancelled: false };
    }
  };

  // Presents the "try next result" prompt on failure. Returns a promise the caller
  // awaits — resolves to true if the user (or a persistent setting) chose to
  // continue the chain, false if they chose to give up. The prompt itself is a
  // toast with two actions so it feels lightweight compared to a modal.
  const askContinue = (nextTitle: string, toastId: string | number): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      let decided = false;
      const decide = (v: boolean) => {
        if (decided) return;
        decided = true;
        resolve(v);
      };
      toast.error(`Couldn't fetch that one. Try the next result — “${nextTitle}”?`, {
        id: toastId,
        // Duration matters: if the user ignores the prompt we must resolve() so the
        // outer chain unblocks and can dismiss the toast.
        duration: TOAST_DURATION_LONG_MS,
        onAutoClose: () => decide(false),
        onDismiss: () => decide(false),
        action: {
          label: "Try next",
          onClick: () => decide(true),
        },
        cancel: {
          label: "Auto",
          onClick: () => {
            setAutoTryNext(true);
            decide(true);
          },
        },
      });
    });

  const handleDownload = async () => {
    // Abort any prior in-flight download for this book before starting a new one —
    // matches the mental model of "click download again to retry", not "queue a
    // second copy of the same file".
    controllerRef.current?.abort();
    setChainActive(true);
    const toastId = `dl-${primary.md5}`;
    try {
      for (let i = 0; i < chain.length; i++) {
        const result = await attempt(chain[i], i, toastId);
        if (result.ok) return;
        if (result.cancelled) return;
        const next = chain[i + 1];
        if (!next) {
          // Ran out of candidates (or there were never any siblings). Land on a
          // clear terminal error toast so the toast id resolves out of loading.
          toast.error("Couldn't fetch this file — the book may not be available anywhere we can reach right now.", {
            id: toastId,
            duration: TOAST_DURATION_MS,
          });
          return;
        }
        // Auto-mode users skip the prompt; everyone else gets the small ask.
        const proceed = autoTryNext ? true : await askContinue(next.title, toastId);
        if (!proceed) {
          // User declined — leave the failure toast up (askContinue set it) but
          // don't advance. Nothing more to do here.
          return;
        }
      }
    } finally {
      setChainActive(false);
    }
  };

  return (
    <Button className="gap-2 rounded-xl" onClick={() => void handleDownload()} disabled={chainActive} aria-label="Download">
      {chainActive ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      <span className="hidden sm:inline">{chainActive ? "Downloading…" : "Download"}</span>
    </Button>
  );
}
