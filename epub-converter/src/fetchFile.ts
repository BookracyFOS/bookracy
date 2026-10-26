// src/fetchFile.ts
import { debug } from './log';

export const fetchFile = async (url: string, signal?: AbortSignal): Promise<{ buffer: ArrayBuffer; mimeType: string }> => {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
  }
  const mimeType = (response.headers.get('content-type') || '').split(';')[0].trim();
  debug(`FETCHFILE_DEBUG - URL: ${url}, Content-Type: '${mimeType}'`);
  // Straight to bytes — the blob round-trip copied every book twice.
  const buffer = await response.arrayBuffer();
  return { buffer, mimeType };
};
