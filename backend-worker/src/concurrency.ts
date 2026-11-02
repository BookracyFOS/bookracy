// Yield the results of several promises in the order they SETTLE (fastest first),
// not the order they were passed in. We use this to take the fastest of several
// libgen mirror resolutions without waiting on the slow/hung ones.
//
// Rejections propagate, so callers that want "never stall on a bad input" should pass
// promises that resolve to a sentinel (e.g. null) instead of rejecting.
export async function* inCompletionOrder<T>(promises: Promise<T>[]): AsyncGenerator<T> {
  // Each promise reports into a settle queue exactly once, so a settled promise is consumed
  // once and dropped (re-racing the pending set with Promise.race would keep re-resolving the
  // already-settled winner and attach O(n) handlers per iteration, O(n^2) overall).
  const settled: ({ ok: true; value: T } | { ok: false; error: unknown })[] = [];
  let wake: (() => void) | null = null;
  const notify = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  for (const p of promises) {
    p.then(
      (value) => {
        settled.push({ ok: true, value });
        notify();
      },
      (error: unknown) => {
        settled.push({ ok: false, error });
        notify();
      },
    );
  }
  for (let head = 0; head < promises.length; head++) {
    while (head >= settled.length) await new Promise<void>((resolve) => (wake = resolve));
    const result = settled[head];
    settled[head] = undefined!;
    if (!result.ok) throw result.error;
    yield result.value;
  }
}
