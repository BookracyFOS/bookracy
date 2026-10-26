import { useEffect, useRef, useState } from "react";

/**
 * A "Windows-update style" progress estimate for jobs whose true duration we
 * can't measure (parsing a big EPUB, generating page locations, …).
 *
 * We can't know real progress, so we fake a believable curve: quick off the
 * line, a deliberate slow-down in the middle (the "still working…" plateau),
 * then a long creep toward — but never reaching — a ceiling just under 100%.
 * When the caller signals the job actually finished (`active` → false) we snap
 * to 100. If a real signal IS available (e.g. bytes downloaded) it's used as a
 * floor so the bar can run ahead of the fake curve, never behind it.
 */

// [elapsedSeconds, percent] checkpoints, linearly interpolated between points.
// Tuned to feel like: shoot to ~45% in the first few seconds, loiter in the
// 50–75% "this is a big one" zone, then crawl up to the high 90s.
const CURVE: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.4, 8],
  [1.2, 24],
  [2.5, 42],
  [4, 52],
  [7, 64],
  [11, 74],
  [16, 83],
  [24, 90],
  [38, 95],
  [60, 98],
];

const CEILING = 99;

function curveAt(seconds: number): number {
  if (seconds <= 0) return 0;
  const last = CURVE[CURVE.length - 1];
  if (seconds >= last[0]) return Math.min(CEILING, last[1]);
  for (let i = 1; i < CURVE.length; i++) {
    const [t1, p1] = CURVE[i];
    if (seconds <= t1) {
      const [t0, p0] = CURVE[i - 1];
      const ratio = (seconds - t0) / (t1 - t0);
      return p0 + (p1 - p0) * ratio;
    }
  }
  return Math.min(CEILING, last[1]);
}

interface UseFakeProgressOptions {
  /** While true the fake curve advances. When it flips false we snap to 100%. */
  active: boolean;
  /** Optional real progress (0–100). Used only as a floor to run ahead. */
  real?: number;
  /** How often to update, ms. Bigger = fewer re-renders. */
  intervalMs?: number;
}

export function useFakeProgress({ active, real, intervalMs = 140 }: UseFakeProgressOptions) {
  const [percent, setPercent] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const realRef = useRef<number | undefined>(real);
  realRef.current = real;

  useEffect(() => {
    if (!active) {
      // Job finished — fill the bar so the overlay can fade out at 100%.
      setPercent(100);
      return;
    }

    setPercent(0);
    setElapsedMs(0);
    const start = performance.now();

    const id = window.setInterval(() => {
      const elapsed = performance.now() - start;
      setElapsedMs(elapsed);
      const fake = curveAt(elapsed / 1000);
      const floor = typeof realRef.current === "number" ? Math.min(CEILING, realRef.current) : 0;
      // Monotonic: never let the displayed value go backwards.
      setPercent((prev) => Math.max(prev, fake, floor));
    }, intervalMs);

    return () => window.clearInterval(id);
  }, [active, intervalMs]);

  return { percent, elapsedMs };
}
