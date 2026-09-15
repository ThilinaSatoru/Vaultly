import { opendir, stat } from "node:fs/promises";
import path from "node:path";
import { database } from "./database.js";
import { FilenameMetadataMatcher } from "./filename-metadata.js";

const videoExtensions = new Set([
  ".mp4", ".m4v", ".mkv", ".webm", ".avi", ".mov", ".wmv", ".flv", ".mpeg", ".mpg",
]);
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);
const storyExtensions = new Set([".pdf"]);
const comicArchiveExtensions = new Set([".cbz", ".zip"]);

interface ScannedItem {
  mediaType: "comic" | "video" | "story";
  title: string;
  filename: string;
  fileExtension: string;
  relativePath: string;
  sizeBytes: number;
  modifiedAtMs: number;
  fileCount: number;
}

const titleFromFilename = (filename: string) =>
  path.basename(filename, path.extname(filename)).replace(/[._]+/g, " ").trim();

export function inferCollectionPattern(filename: string): { title: string; order: number } | null {
  const stem = path.basename(filename, path.extname(filename));
  const seasonEpisode = stem.match(/^(.*?)[\s._-]+(?:s(\d{1,2})e(\d{1,3})|(\d{1,2})x(\d{1,3}))(?:\b|[\s._-])/i);
  const explicit = stem.match(/^(.*?)[\s._-]+(?:part|pt|vol(?:ume)?|chapter|ch|episode|ep|issue|book|disc|disk|cd|no\.?|number|#|v)[\s._-]*(\d{1,4})(?:\b|[\s._-])/i);
  const parenthesized = stem.match(/^(.*?)\s*[[(](\d{1,3})[\])](?:\s|$)/);
  const padded = stem.match(/^(.*?)[\s._-]+(0\d{1,2})(?:\b|[\s._-])/);
  const simple = stem.match(/^(.*?)[\s._-]+(\d{1,3})(?:\s+of\s+\d{1,3})?$/i);
  const leading = stem.match(/^[[(]?(\d{1,3})[\])]?\s*[-._ ]+(.{2,})$/);
  const roman = stem.match(/^(.*?)[\s._-]+(I|II|III|IV|V|VI|VII|VIII|IX|X)$/i);
  const match = seasonEpisode ?? explicit ?? parenthesized ?? padded ?? simple ?? leading ?? roman;
  if (!match) return null;
  const rawTitle = leading ? leading[2] : match[1];
  const title = rawTitle.replace(/[._-]+/g, " ").replace(/\s+/g, " ").replace(/^\[|\]$/g, "").trim();
  if (title.length < 2) return null;
  const romanValues: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
  const order = seasonEpisode
    ? Number(seasonEpisode[2] ?? seasonEpisode[4]) * 10_000 + Number(seasonEpisode[3] ?? seasonEpisode[5])
    : leading ? Number(leading[1])
      : roman ? romanValues[roman[2].toUpperCase()]
        : Number(match[2]);
  return Number.isFinite(order) ? { title, order } : null;
}

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
        filename: entry.name,
        fileExtension: extension.slice(1),
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
        filename: path.basename(currentDirectory),
        fileExtension: "",
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
        const categories = database.prepare("SELECT id, name FROM categories").all() as Array<{ id: number; name: string }>;
        const tags = database.prepare("SELECT id, name FROM tags").all() as Array<{ id: number; name: string }>;
        const people = database.prepare(`
          SELECT p.id, p.name,
            MAX(CASE WHEN ip.role = 'cast' THEN 1 ELSE 0 END) AS is_cast,
            MAX(CASE WHEN ip.role = 'artist' THEN 1 ELSE 0 END) AS is_artist
          FROM people p LEFT JOIN item_people ip ON ip.person_id = p.id GROUP BY p.id
        `).all() as Array<{ id: number; name: string; is_cast: number; is_artist: number }>;
        const categoryMatcher = new FilenameMetadataMatcher(categories);
        const tagMatcher = new FilenameMetadataMatcher(tags);
        const peopleMatcher = new FilenameMetadataMatcher(people.filter((person) => person.is_cast || person.is_artist));
        const addCategory = database.prepare("INSERT OR IGNORE INTO item_categories(item_id, category_id) VALUES (?, ?)");
        const addTag = database.prepare("INSERT OR IGNORE INTO item_tags(item_id, tag_id) VALUES (?, ?)");
        const addPerson = database.prepare("INSERT OR IGNORE INTO item_people(item_id, person_id, role) VALUES (?, ?, ?)");
        const upsert = database.prepare(`
          INSERT INTO media_items (
            source_id, media_type, title, filename, file_extension, relative_path,
            size_bytes, modified_at_ms, file_count, available
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(source_id, media_type, relative_path) DO UPDATE SET
            filename = excluded.filename,
            file_extension = excluded.file_extension,
            size_bytes = excluded.size_bytes,
            modified_at_ms = excluded.modified_at_ms,
            file_count = excluded.file_count,
            available = 1,
            updated_at = CURRENT_TIMESTAMP
          RETURNING id
        `);
        const indexedItems: Array<{ id: number; item: ScannedItem }> = [];

        for (const item of items) {
          const row = upsert.get(
            sourceId,
            item.mediaType,
            item.title,
            item.filename,
            item.fileExtension,
            item.relativePath,
            item.sizeBytes,
            item.modifiedAtMs,
            item.fileCount,
          ) as { id: number };
          indexedItems.push({ id: row.id, item });
          for (const category of categoryMatcher.match(item.filename, item.fileExtension)) {
            addCategory.run(row.id, category.id);
          }
          for (const tag of tagMatcher.match(item.filename, item.fileExtension)) {
            addTag.run(row.id, tag.id);
          }
          for (const person of peopleMatcher.match(item.filename, item.fileExtension)) {
            if (person.is_cast) addPerson.run(row.id, person.id, "cast");
            if (person.is_artist) addPerson.run(row.id, person.id, "artist");
          }
        }

        const collectionGroups = new Map<string, { title: string; mediaType: ScannedItem["mediaType"]; entries: Array<{ id: number; order: number; path: string }> }>();
        for (const indexed of indexedItems) {
          const pattern = inferCollectionPattern(indexed.item.filename);
          if (!pattern) continue;
          // Image-folder comics must be sibling folders. Video/PDF sequels may span season or volume folders.
          const parent = indexed.item.mediaType === "comic" ? path.dirname(indexed.item.relativePath).replace(/\\/g, "/").toLocaleLowerCase() : "";
          const key = `${sourceId}|${indexed.item.mediaType}|${parent}|${pattern.title.toLocaleLowerCase()}`;
          const group = collectionGroups.get(key) ?? { title: pattern.title, mediaType: indexed.item.mediaType, entries: [] };
          group.entries.push({ id: indexed.id, order: pattern.order, path: indexed.item.relativePath });
          collectionGroups.set(key, group);
        }
        const findAutoSeries = database.prepare("SELECT id FROM series WHERE auto_key = ?");
        const createAutoSeries = database.prepare("INSERT OR IGNORE INTO series(title, preferred_type, auto_key) VALUES (?, ?, ?)");
        const addSeriesItem = database.prepare("INSERT OR IGNORE INTO series_items(series_id, item_id, position) VALUES (?, ?, ?)");
        for (const [autoKey, group] of collectionGroups) {
          let series = findAutoSeries.get(autoKey) as { id: number } | undefined;
          if (!series && group.entries.length < 2) continue;
          if (!series) {
            const placeholders = group.entries.map(() => "?").join(",");
            const alreadyGrouped = database.prepare(`SELECT 1 FROM series_items WHERE item_id IN (${placeholders}) LIMIT 1`)
              .get(...group.entries.map((entry) => entry.id));
            if (alreadyGrouped) continue;
            createAutoSeries.run(group.title, group.mediaType, autoKey);
            series = findAutoSeries.get(autoKey) as { id: number } | undefined;
          }
          if (!series) continue;
          group.entries.sort((a, b) => a.order - b.order || a.path.localeCompare(b.path));
          group.entries.forEach((entry, position) => addSeriesItem.run(series!.id, entry.id, position));
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
