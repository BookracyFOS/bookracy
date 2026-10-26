// Chunking + reassembly helpers shared by the Telegram and Discord backup providers.
//
// Books routinely exceed a single provider's per-message limit (Telegram caps
// getFile downloads at 20 MB; Discord at 10-100 MB by boost level), so a file is
// split into a fixed number of sequential byte ranges. The SAME ranges are used
// for both providers, so a manifest's chunk[i] always covers identical bytes and
// reassembly logic is provider-agnostic.

export interface ChunkRange {
  /** Zero-based position in the ordered chunk list. */
  i: number;
  /** Byte offset into the whole file. */
  offset: number;
  /** Number of bytes in this chunk (the last one may be shorter). */
  length: number;
}

/** Split a file of `size` bytes into sequential ranges of at most `chunkBytes`. */
export function chunkRanges(size: number, chunkBytes: number): ChunkRange[] {
  if (size <= 0) return [];
  if (chunkBytes <= 0) throw new Error("chunkBytes must be > 0");
  const ranges: ChunkRange[] = [];
  let offset = 0;
  let i = 0;
  while (offset < size) {
    const length = Math.min(chunkBytes, size - offset);
    ranges.push({ i, offset, length });
    offset += length;
    i += 1;
  }
  return ranges;
}

/**
 * Concatenate a list of lazily-opened streams into one, in order, pulling each
 * source only when the previous one is exhausted. Lazy factories matter because
 * provider download URLs expire (Telegram getFile ~1h, Discord CDN signatures) —
 * we must not open chunk N's stream until we're actually ready to read it.
 *
 * Memory stays bounded to roughly one queued value: we never buffer the whole
 * file, only pump the current chunk through.
 */
export function streamConcat(factories: Array<() => Promise<ReadableStream<Uint8Array>>>): ReadableStream<Uint8Array> {
  let index = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      // Loop so that an empty/exhausted chunk transparently advances to the next
      // one within a single pull, rather than enqueuing nothing.
      for (;;) {
        if (!reader) {
          if (index >= factories.length) {
            controller.close();
            return;
          }
          const stream = await factories[index]();
          reader = stream.getReader();
        }
        const { done, value } = await reader.read();
        if (done) {
          reader = null;
          index += 1;
          continue;
        }
        if (value && value.byteLength > 0) {
          controller.enqueue(value);
          return;
        }
        // zero-length read — keep pulling from the same reader
      }
    },
    async cancel(reason) {
      if (reader) await reader.cancel(reason).catch(() => {});
    },
  });
}
