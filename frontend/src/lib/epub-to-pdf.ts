import type { ConvertReply, ConvertRequest } from "./epub-to-pdf.worker";

export interface ConvertToPdfOptions {
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

let worker: Worker | null = null;
let nextId = 1;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./epub-to-pdf.worker.ts", import.meta.url), { type: "module" });
    // A crashed worker (out of memory on a huge book) must not poison later conversions.
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

/**
 * Convert an EPUB (a URL the Worker can fetch, or the raw bytes) to a PDF Blob in a
 * web worker, so the page stays responsive for the seconds a big book takes.
 */
export function convertEpubToPdfBlob(source: string | ArrayBuffer, opts: ConvertToPdfOptions = {}): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const w = getWorker();
    const onMessage = (event: MessageEvent<ConvertReply>) => {
      const msg = event.data;
      if (msg.id !== id) return;
      if (msg.type === "progress") {
        opts.onProgress?.(msg.done, msg.total);
        return;
      }
      cleanup();
      if (msg.type === "done") resolve(new Blob([msg.pdf], { type: "application/pdf" }));
      else reject(new Error(msg.message));
    };
    const onError = () => {
      cleanup();
      reject(new Error("The converter crashed — the book may be too large for this device."));
    };
    const onAbort = () => {
      w.postMessage({ id, type: "abort" });
    };
    const cleanup = () => {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
      opts.signal?.removeEventListener("abort", onAbort);
    };
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const req: ConvertRequest = { id, source, fontBase: window.location.origin };
    // Bytes are transferred, not copied; a URL string is just sent.
    w.postMessage(req, source instanceof ArrayBuffer ? [source] : []);
  });
}
