import path from "node:path";

export const sourceMediaTypes = ["mixed", "movies", "tv", "anime", "manga", "ebooks", "pictures"] as const;
export type SourceMediaType = typeof sourceMediaTypes[number];
export const ebookExtensions = new Set([".pdf", ".epub", ".mobi", ".azw", ".azw3", ".fb2", ".txt", ".rtf", ".doc", ".docx", ".odt", ".wps", ".html", ".htm", ".djvu", ".djv"]);
export const pictureExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp", ".tif", ".tiff", ".heic", ".heif"]);

/** Preserve the original tree; only strip recognized season containers for a series. */
export function folderCollection(relativePath: string, filename: string, sourceType: SourceMediaType, rootTitle = "Series") {
  if (sourceType !== "tv" && sourceType !== "anime" && sourceType !== "manga") return null;
  const parts = relativePath.replace(/\\/g, "/").split("/");
  parts.pop();

  const seasonIndex = parts.findIndex((part) => /^(?:season|series|s)[ ._-]*\d+$/i.test(part));
  const containers = seasonIndex >= 0 ? parts.slice(0, seasonIndex) : parts.slice(0, 1);
  const season = seasonIndex >= 0 ? Number(parts[seasonIndex].match(/\d+/)?.[0] ?? 0) : Number(filename.match(/s(\d+)e\d+/i)?.[1] ?? 0);
  const episode = filename.match(/(?:s\d+e|episode[ ._-]*|ep[ ._-]*|chapter[ ._-]*|ch[ ._-]*)(\d+)/i)
    ?? path.basename(filename, path.extname(filename)).match(/(?:^|[ ._-])(\d{1,4})(?:[ ._-]|$)/);
  const extras = parts.some((part) => /^(?:extras?|specials?|bonus|ova|oad)$/i.test(part));
  return { title: containers.at(-1) ?? rootTitle, key: containers.length ? containers.join("/").toLowerCase() : "@root", order: (extras ? 1_000_000 : season * 10_000) + Number(episode?.[1] ?? 0) };
}
