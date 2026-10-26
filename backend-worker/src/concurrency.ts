// Yield the results of several promises in the order they SETTLE (fastest first),
// not the order they were passed in. We use this to take the fastest of several
// libgen mirror resolutions without waiting on the slow/hung ones.
//
// Rejections propagate, so callers that want "never stall on a bad input" should pass
// promises that resolve to a sentinel (e.g. null) instead of rejecting.
export async function* inCompletionOrder<T>(promises: Promise<T>[]): AsyncGenerator<T> {
  // Tag each promise with its index so we can drop it from the pending set once it
  // settles (Promise.race otherwise keeps re-resolving the already-settled winner).
  const remaining = new Map<number, Promise<readonly [number, T]>>(promises.map((p, i) => [i, p.then((v) => [i, v] as const)]));
  while (remaining.size) {
    const [i, value] = await Promise.race(remaining.values());
    remaining.delete(i);
    yield value;
  }
}
