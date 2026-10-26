/**
 * A download body that survives an upstream dropping the connection partway through.
 *
 * libgen's file CDN (cdn3.booksdl.lc, the only source for most of its comics) closes slow
 * transfers early — and it does so CLEANLY, with a normal end of stream, not an error.
 * Measured 2026-09-15 on a 27.36 MB PDF: the Worker's response ended at 4.38 MB after
 * 180 s; a direct laptop pull of another file stopped on its own at 556 KB after 77 s.
 * The Worker used to pass that short body straight through, so the browser received a
 * truncated file, and the frontend's inherited mutation retry started over from byte
 * zero — the "4% then reset" users saw.
 *
 * The CDN honours `Range` (a 206 with `Content-Range: bytes N-M/TOTAL`), so when the
 * stream ends — or errors — before `total` bytes, this re-requests from the exact byte
 * offset and keeps going. If every resume fails, the stream ERRORS rather than closing:
 * a short body must never look like a finished download, to the client or to the R2
 * cache that consumes the other half of the tee.
 */

export interface ResumeOptions {
  /** Expected byte length (the upstream's Content-Length). */
  total: number;
  /** Fetch the rest of the file starting at `offset`. Must resolve to a 206 whose
   *  Content-Range starts at `offset`; anything else counts as a failed attempt. */
  refetch: (offset: number) => Promise<Response | null>;
  /** Resume attempts across the whole transfer. */
  maxResumes?: number;
  /** Pause before a retry after a failed attempt (grows linearly). */
  retryDelayMs?: number;
  onResume?: (offset: number, attempt: number) => void;
}

/** Parse `bytes START-END/TOTAL` (TOTAL may be `*`). */
export function parseContentRange(header: string | null | undefined): { start: number; end: number; total?: number } | null {
  const m = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec((header || "").trim());
  if (!m) return null;
  return { start: Number(m[1]), end: Number(m[2]), total: m[3] === "*" ? undefined : Number(m[3]) };
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

export function resumableBody(first: ReadableStream<Uint8Array>, opts: ResumeOptions): ReadableStream<Uint8Array> {
  const maxResumes = opts.maxResumes ?? 8;
  const retryDelayMs = opts.retryDelayMs ?? 1500;
  let reader = first.getReader();
  let received = 0;
  let resumes = 0;
  let failedInARow = 0;

  const resume = async (): Promise<boolean> => {
    while (resumes < maxResumes) {
      await sleep(failedInARow * retryDelayMs);
      resumes++;
      opts.onResume?.(received, resumes);
      let resp: Response | null = null;
      try {
        resp = await opts.refetch(received);
      } catch {
        resp = null;
      }
      const range = resp?.status === 206 ? parseContentRange(resp.headers.get("Content-Range")) : null;
      if (resp?.body && range && range.start === received && (range.total === undefined || range.total === opts.total)) {
        try {
          reader.releaseLock();
        } catch {
          /* the old reader may already be errored */
        }
        reader = resp.body.getReader();
        failedInARow = 0;
        return true;
      }
      failedInARow++;
      await resp?.body?.cancel().catch(() => {});
    }
    return false;
  };

  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        for (;;) {
          let result: ReadableStreamReadResult<Uint8Array> | null;
          try {
            result = await reader.read();
          } catch {
            result = null; // the upstream connection errored — same treatment as an early end
          }
          if (result && !result.done) {
            const chunk = result.value;
            if (!chunk || chunk.byteLength === 0) continue;
            if (received + chunk.byteLength > opts.total) {
              controller.error(new Error(`upstream sent more than its declared ${opts.total} bytes`));
              return;
            }
            received += chunk.byteLength;
            controller.enqueue(chunk);
            return;
          }
          if (received === opts.total) {
            controller.close();
            return;
          }
          if (!(await resume())) {
            controller.error(new Error(`upstream stream ended at ${received} of ${opts.total} bytes`));
            return;
          }
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    },
    // No read-ahead: pull only when a consumer asks, so the client's pace (and the
    // tee's R2 half) sets the rate rather than this wrapper buffering the file.
    { highWaterMark: 0 },
  );
}
