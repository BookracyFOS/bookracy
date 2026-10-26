/// <reference lib="webworker" />
/**
 * EPUB -> PDF conversion, off the main thread. The converter (jsPDF + parsers) is
 * pure JavaScript with no DOM dependency, and a large book takes seconds of solid CPU
 * that used to freeze the page — scroll, taps, the progress toast, everything.
 */
import type { ConvertOptions } from "bookracy-convertor";

export type ConvertRequest = { id: number; source: string | ArrayBuffer; fontBase: string };
export type ConvertReply =
  | { id: number; type: "progress"; done: number; total: number }
  | { id: number; type: "done"; pdf: ArrayBuffer }
  | { id: number; type: "error"; message: string };

const controllers = new Map<number, AbortController>();

self.onmessage = async (event: MessageEvent<ConvertRequest | { id: number; type: "abort" }>) => {
  const msg = event.data;
  if ("type" in msg && msg.type === "abort") {
    controllers.get(msg.id)?.abort(new DOMException("Conversion cancelled", "AbortError"));
    return;
  }
  const { id, source, fontBase } = msg as ConvertRequest;
  const ctrl = new AbortController();
  controllers.set(id, ctrl);
  const post = (reply: ConvertReply, transfer?: Transferable[]) => (self as unknown as Worker).postMessage(reply, transfer ?? []);
  try {
    const { convertEpubToPdf } = await import("bookracy-convertor");
    const options: ConvertOptions = {
      signal: ctrl.signal,
      onProgress: (done, total) => post({ id, type: "progress", done, total }),
      // Noto Sans covers Latin, Greek and Cyrillic; fetched only for books that need it.
      fallbackFont: {
        family: "Noto Sans",
        sources: {
          normal: `${fontBase}/fonts/NotoSans-Regular.ttf`,
          bold: `${fontBase}/fonts/NotoSans-Bold.ttf`,
          italic: `${fontBase}/fonts/NotoSans-Italic.ttf`,
          bolditalic: `${fontBase}/fonts/NotoSans-BoldItalic.ttf`,
        },
      },
    };
    const pdf = await convertEpubToPdf(source, options);
    const bytes = pdf.output("arraybuffer") as ArrayBuffer;
    post({ id, type: "done", pdf: bytes }, [bytes]);
  } catch (e) {
    post({ id, type: "error", message: e instanceof Error ? e.message : String(e) });
  } finally {
    controllers.delete(id);
  }
};
