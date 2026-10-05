import { open } from "node:fs/promises";

export interface ComicMetadata { tags: string[]; artists: string[] }

const maxMetadataBytes = 1024 * 1024;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function names(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const name = typeof entry === "string" ? entry : record(entry)?.name;
    return typeof name === "string" && name.trim() ? [name.trim()] : [];
  });
}

export function parseComicMetadata(value: unknown): ComicMetadata | undefined {
  const data = record(value);
  if (!data) return undefined;
  const metadata = record(data.metadata);
  return {
    tags: [...new Set([...names(metadata?.tags), ...names(data.tags)])],
    artists: [...new Set([...names(metadata?.artists), ...names(data.artists)])],
  };
}

/** Optional sidecars must never stop a scan; bound reads even if a file grows. */
export async function readComicMetadata(filename: string, signal?: AbortSignal): Promise<ComicMetadata | undefined> {
  signal?.throwIfAborted();
  try {
    const file = await open(filename, "r");
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > maxMetadataBytes) return undefined;
      const buffer = Buffer.alloc(Math.min(info.size + 1, maxMetadataBytes + 1));
      let length = 0;
      while (length < buffer.length) {
        signal?.throwIfAborted();
        const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
        if (!bytesRead) break;
        length += bytesRead;
      }
      signal?.throwIfAborted();
      if (length > info.size || length > maxMetadataBytes) return undefined;
      return parseComicMetadata(JSON.parse(buffer.toString("utf8", 0, length).replace(/^\uFEFF/, "")));
    } finally { await file.close(); }
  } catch {
    signal?.throwIfAborted();
    return undefined;
  }
}
