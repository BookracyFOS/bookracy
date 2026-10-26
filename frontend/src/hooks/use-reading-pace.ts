import { useCallback, useRef, useState } from "react";

const STORAGE_KEY = "BR::reading-pace";

// Until we've watched the reader turn a few pages we fall back to an average-adult
// estimate (~220 wpm × ~5.2 chars/word ≈ 1144 chars/min).
const DEFAULT_CHARS_PER_MIN = 1144;

// Only treat a relocation as genuine reading when it's a small FORWARD step taken
// over a human-plausible interval. This filters out scrubbing, chapter jumps,
// re-reading (backwards) and walking-away pauses so the measured pace stays honest.
const MAX_PAGES_PER_STEP = 3;
const MIN_INTERVAL_MS = 1_500;
const MAX_INTERVAL_MS = 4 * 60_000;

// Clamp any single sample to a sane human range (~38–1150 wpm) so one odd interval
// can't blow up the estimate.
const MIN_CHARS_PER_MIN = 200;
const MAX_CHARS_PER_MIN = 6_000;

// A stored personal pace is treated as this many samples of history, so a fresh
// session refines it gradually instead of discarding it on the first page turn.
const SEED_WEIGHT = 5;
const MIN_ALPHA = 0.15;

function readPersisted(): { cpm: number; existed: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= MIN_CHARS_PER_MIN && n <= MAX_CHARS_PER_MIN) return { cpm: n, existed: true };
  } catch {
    /* ignore unavailable storage */
  }
  return { cpm: DEFAULT_CHARS_PER_MIN, existed: false };
}

export interface ReadingPace {
  /** Current best estimate of the reader's speed, in characters per minute. */
  charsPerMin: number;
  /** True once we've recorded at least one real reading interval this session. */
  measured: boolean;
  /** Feed every relocation: the absolute current page, the total, and chars/page. */
  onProgress: (page: number, total: number, charsPerPage: number) => void;
  /** Drop the timing anchor (call when a new book opens) so the cross-book gap
   *  isn't mistaken for one very slow page. */
  reset: () => void;
}

/**
 * Learns how fast you actually read by timing how quickly you move through the
 * book's pages, exposed as a chars/min pace (persisted across books). It's a
 * confidence-weighted moving average: noisy early on, steadier as you read, and it
 * ignores jumps, re-reads and pauses so the number reflects real reading.
 */
export function useReadingPace(): ReadingPace {
  const [seed] = useState(readPersisted);
  const [charsPerMin, setCharsPerMin] = useState(seed.cpm);
  const [measured, setMeasured] = useState(false);

  const lastRef = useRef<{ page: number; at: number } | null>(null);
  const samplesRef = useRef(0);
  const seededRef = useRef(seed.existed);

  const onProgress = useCallback((page: number, total: number, charsPerPage: number) => {
    const now = Date.now();
    const last = lastRef.current;
    lastRef.current = { page, at: now };
    if (!last || total <= 0) return;

    const pagesDelta = page - last.page;
    const ms = now - last.at;
    if (pagesDelta <= 0 || pagesDelta > MAX_PAGES_PER_STEP) return;
    if (ms < MIN_INTERVAL_MS || ms > MAX_INTERVAL_MS) return;

    const sample = (pagesDelta * charsPerPage) / (ms / 60_000);
    if (sample < MIN_CHARS_PER_MIN || sample > MAX_CHARS_PER_MIN) return;

    // Weight history by how much we've already learned (plus the persisted seed),
    // so the average converges quickly then settles.
    const prior = (seededRef.current ? SEED_WEIGHT : 0) + samplesRef.current;
    samplesRef.current += 1;
    const alpha = Math.max(MIN_ALPHA, 1 / (prior + 1));

    setCharsPerMin((prev) => {
      const next = Math.round(prev * (1 - alpha) + sample * alpha);
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        /* ignore unavailable storage */
      }
      return next;
    });
    setMeasured(true);
  }, []);

  const reset = useCallback(() => {
    lastRef.current = null;
  }, []);

  return { charsPerMin, measured, onProgress, reset };
}
