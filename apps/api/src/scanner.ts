import { opendir, stat } from "node:fs/promises";
import path from "node:path";
import { database } from "./database.js";

const videoExtensions = new Set([
  ".mp4", ".m4v", ".mkv", ".webm", ".avi", ".mov", ".wmv", ".flv", ".mpeg", ".mpg",
]);
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);
const storyExtensions = new Set([".pdf"]);
const comicArchiveExtensions = new Set([".cbz", ".zip"]);

interface ScannedItem {
  mediaType: "comic" | "video" | "story";
  title: string;
  relativePath: string;
  sizeBytes: number;
  modifiedAtMs: number;
  fileCount: number;
}

const titleFromFilename = (filename: string) =>
  path.basename(filename, path.extname(filename)).replace(/[._]+/g, " ").trim();

export async function collectItems(rootPath: string): Promise<ScannedItem[]> {
  const items: ScannedItem[] = [];
  const directories = [rootPath];

  while (directories.length > 0) {
    const currentDirectory = directories.pop()!;
    const directory = await opendir(currentDirectory);
    const imageFiles: Array<{ size: number; modifiedAtMs: number }> = [];

    for await (const entry of directory) {
      const absolutePath = path.join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        directories.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;

      const extension = path.extname(entry.name).toLowerCase();
      if (
        !videoExtensions.has(extension) &&
        !storyExtensions.has(extension) &&
        !comicArchiveExtensions.has(extension) &&
        !imageExtensions.has(extension)
      ) {
        continue;
      }

      const fileStat = await stat(absolutePath);
      if (imageExtensions.has(extension)) {
        imageFiles.push({ size: fileStat.size, modifiedAtMs: fileStat.mtimeMs });
        continue;
      }

      const mediaType = videoExtensions.has(extension)
        ? "video"
        : storyExtensions.has(extension)
          ? "story"
          : "comic";

      items.push({
        mediaType,
        title: titleFromFilename(entry.name),
        relativePath: path.relative(rootPath, absolutePath),
        sizeBytes: fileStat.size,
        modifiedAtMs: Math.round(fileStat.mtimeMs),
        fileCount: 1,
      });
    }

    if (imageFiles.length > 0) {
      const relativeDirectory = path.relative(rootPath, currentDirectory) || ".";
      let totalSize = 0;
      let latestModification = 0;
      for (const file of imageFiles) {
        totalSize += file.size;
        latestModification = Math.max(latestModification, file.modifiedAtMs);
      }
      items.push({
        mediaType: "comic",
        title: currentDirectory === rootPath ? path.basename(rootPath) : path.basename(currentDirectory),
        relativePath: relativeDirectory,
        sizeBytes: totalSize,
        modifiedAtMs: Math.round(latestModification),
        fileCount: imageFiles.length,
      });
    }
  }

  return items;
}

const scans = new Map<number, Promise<void>>();

export function scanSource(sourceId: number, rootPath: string): Promise<void> {
  const existingScan = scans.get(sourceId);
  if (existingScan) return existingScan;

  const scan = (async () => {
    database.prepare(
      "UPDATE sources SET status = 'scanning', last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(sourceId);

    try {
      const items = await collectItems(rootPath);
      database.exec("BEGIN IMMEDIATE");
      try {
        database.prepare("UPDATE media_items SET available = 0 WHERE source_id = ?").run(sourceId);
        const upsert = database.prepare(`
          INSERT INTO media_items (
            source_id, media_type, title, relative_path, size_bytes, modified_at_ms, file_count, available
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(source_id, media_type, relative_path) DO UPDATE SET
            size_bytes = excluded.size_bytes,
            modified_at_ms = excluded.modified_at_ms,
            file_count = excluded.file_count,
            available = 1,
            updated_at = CURRENT_TIMESTAMP
        `);

        for (const item of items) {
          upsert.run(
            sourceId,
            item.mediaType,
            item.title,
            item.relativePath,
            item.sizeBytes,
            item.modifiedAtMs,
            item.fileCount,
          );
        }

        database.prepare(`
          UPDATE sources
          SET status = 'ready', last_error = NULL, last_scanned_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(sourceId);
        database.exec("COMMIT");
      } catch (transactionError) {
        database.exec("ROLLBACK");
        throw transactionError;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "The folder could not be scanned.";
      database.prepare(`
        UPDATE sources SET status = 'error', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(message, sourceId);
    }
  })().finally(() => scans.delete(sourceId));

  scans.set(sourceId, scan);
  return scan;
}
