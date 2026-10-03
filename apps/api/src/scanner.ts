import { withAttributePatterns } from "./attribute-routes.js";
import { opendir, stat } from "node:fs/promises";
import path from "node:path";
import { database } from "./database.js";
import { FilenameMetadataMatcher } from "./filename-metadata.js";
import { clearThumbnailCache, getPdfThumbnail, getVideoThumbnail } from "./thumbnails.js";

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

interface ExistingItem extends ScannedItem {
  id: number;
  indexed: number;
  available: number;
}

const titleFromFilename = (filename: string) =>
  path.basename(filename, path.extname(filename)).replace(/[._]+/g, " ").trim();

const strictIdentity = (item: Pick<ScannedItem, "mediaType" | "sizeBytes" | "modifiedAtMs" | "fileCount">) =>
  `${item.mediaType}|${item.sizeBytes}|${item.modifiedAtMs}|${item.fileCount}`;
const looseIdentity = (item: Pick<ScannedItem, "mediaType" | "sizeBytes" | "fileCount">) =>
  `${item.mediaType}|${item.sizeBytes}|${item.fileCount}`;

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

  const scanDirectory = async (currentDirectory: string) => {
    const directory = await opendir(currentDirectory, { bufferSize: 128 });
    let imageCount = 0;
    let totalSize = 0;
    let latestModification = 0;
    let pending: Array<{ name: string; extension: string; absolutePath: string }> = [];
    const flush = async () => {
      const batch = pending;
      pending = [];
      // Bounded metadata reads avoid one round-trip per file without launching
      // thousands of simultaneous requests or retaining every comic page.
      const results = await Promise.all(batch.map(async (file) => ({ ...file, fileStat: await stat(file.absolutePath) })));
      for (const { name, extension, absolutePath, fileStat } of results) {
        if (imageExtensions.has(extension)) {
          imageCount++;
          totalSize += fileStat.size;
          latestModification = Math.max(latestModification, fileStat.mtimeMs);
        } else {
          items.push({
            mediaType: videoExtensions.has(extension) ? "video" : storyExtensions.has(extension) ? "story" : "comic",
            title: titleFromFilename(name), filename: name, fileExtension: extension.slice(1),
            relativePath: path.relative(rootPath, absolutePath), sizeBytes: fileStat.size,
            modifiedAtMs: Math.round(fileStat.mtimeMs), fileCount: 1,
          });
        }
      }
    };
    for await (const entry of directory) {
      const absolutePath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        directories.push(absolutePath);
      } else if (entry.isFile()) {
        const extension = path.extname(entry.name).toLowerCase();
        if (!videoExtensions.has(extension) && !storyExtensions.has(extension) && !comicArchiveExtensions.has(extension) && !imageExtensions.has(extension)) continue;
        pending.push({ name: entry.name, extension, absolutePath });
        if (pending.length === 8) await flush();
      }
    }
    await flush();

    if (imageCount > 0) {
      const relativeDirectory = path.relative(rootPath, currentDirectory) || ".";
      items.push({
        mediaType: "comic",
        title: currentDirectory === rootPath ? path.basename(rootPath) : path.basename(currentDirectory),
        filename: path.basename(currentDirectory),
        fileExtension: "",
        relativePath: relativeDirectory,
        sizeBytes: totalSize,
        modifiedAtMs: Math.round(latestModification),
        fileCount: imageCount,
      });
    }
  };
  while (directories.length > 0) {
    const batch = directories.splice(-4);
    // Wait for every open directory to finish before surfacing a failure.
    const results = await Promise.allSettled(batch.map(scanDirectory));
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }

  return items;
}

const scans = new Map<number, Promise<void>>();

export function scanSource(sourceId: number, rootPath: string, options: { regenerateThumbnails?: boolean } = {}): Promise<void> {
  const existingScan = scans.get(sourceId);
  if (existingScan) return existingScan;

  const scan = (async () => {
    database.prepare(
      "UPDATE sources SET status = 'scanning', last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(sourceId);

    try {
      const previousItems = (database.prepare(`SELECT id, media_type AS mediaType, title, filename,
        file_extension AS fileExtension, relative_path AS relativePath, size_bytes AS sizeBytes,
        modified_at_ms AS modifiedAtMs, file_count AS fileCount, indexed, available
        FROM media_items WHERE source_id = ?`).all(sourceId) as unknown as ExistingItem[]);
      const previousItemIds = previousItems.map((row) => row.id);
      const items = await collectItems(rootPath);
      const indexedItems: Array<{ id: number; item: ScannedItem }> = [];
      database.exec("BEGIN IMMEDIATE");
      try {
        const categories = database.prepare("SELECT id, name FROM categories").all() as Array<{ id: number; name: string }>;
        const tags = database.prepare("SELECT id, name FROM tags").all() as Array<{ id: number; name: string }>;
        const people = database.prepare(`
          SELECT p.id, p.name,
            MAX(CASE WHEN ip.role = 'cast' THEN 1 ELSE 0 END) AS is_cast,
            MAX(CASE WHEN ip.role = 'artist' THEN 1 ELSE 0 END) AS is_artist
          FROM people p LEFT JOIN item_people ip ON ip.person_id = p.id GROUP BY p.id
        `).all() as Array<{ id: number; name: string; is_cast: number; is_artist: number }>;
        const categoryMatcher = new FilenameMetadataMatcher(withAttributePatterns("categories", categories));
        const tagMatcher = new FilenameMetadataMatcher(withAttributePatterns("tags", tags));
        const peopleMatcher = new FilenameMetadataMatcher(withAttributePatterns("people", people.filter((person) => person.is_cast || person.is_artist)));
        const addCategory = database.prepare("INSERT OR IGNORE INTO item_categories(item_id, category_id) VALUES (?, ?)");
        const addTag = database.prepare("INSERT OR IGNORE INTO item_tags(item_id, tag_id) VALUES (?, ?)");
        const addPerson = database.prepare("INSERT OR IGNORE INTO item_people(item_id, person_id, role) VALUES (?, ?, ?)");
        const pathKey = (item: ScannedItem) => `${item.mediaType}|${process.platform === "win32" ? item.relativePath.toLowerCase() : item.relativePath}`;
        const previousByPath = new Map(previousItems.map((item) => [pathKey(item), item]));
        const incomingPaths = new Set(items.map(pathKey));
        // Only missing paths are candidates for a move, so identical files that
        // still exist never donate their identity to a newly discovered file.
        const availablePrevious = previousItems.filter((item) => item.indexed === 1 && !incomingPaths.has(pathKey(item)));
        const strictMatches = new Map<string, ExistingItem[]>();
        const looseMatches = new Map<string, ExistingItem[]>();
        for (const existing of availablePrevious) {
          const strict = strictMatches.get(strictIdentity(existing)) ?? [];
          strict.push(existing);
          strictMatches.set(strictIdentity(existing), strict);
          const loose = looseMatches.get(looseIdentity(existing)) ?? [];
          loose.push(existing);
          looseMatches.set(looseIdentity(existing), loose);
        }
        const looseIncomingCounts = new Map<string, number>();
        for (const item of items) looseIncomingCounts.set(looseIdentity(item), (looseIncomingCounts.get(looseIdentity(item)) ?? 0) + 1);
        const reconciledIds = new Set<number>();
        const reconcileMoved = database.prepare(`UPDATE media_items SET title = ?, filename = ?, file_extension = ?,
          relative_path = ?, size_bytes = ?, modified_at_ms = ?, file_count = ?, indexed = 1, available = 1,
          duration_seconds = CASE WHEN size_bytes != ? OR modified_at_ms != ? THEN NULL ELSE duration_seconds END,
          updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
        const upsert = database.prepare(`
          INSERT INTO media_items (
            source_id, media_type, title, filename, file_extension, relative_path,
            size_bytes, modified_at_ms, file_count, indexed, available
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
          ON CONFLICT(source_id, media_type, relative_path) DO UPDATE SET
            filename = excluded.filename,
            file_extension = excluded.file_extension,
            duration_seconds = CASE
              WHEN media_items.size_bytes != excluded.size_bytes OR media_items.modified_at_ms != excluded.modified_at_ms THEN NULL
              ELSE media_items.duration_seconds
            END,
            size_bytes = excluded.size_bytes,
            modified_at_ms = excluded.modified_at_ms,
            file_count = excluded.file_count,
            indexed = 1,
            available = 1,
            updated_at = CURRENT_TIMESTAMP
          RETURNING id
        `);
        for (const item of items) {
          const previous = previousByPath.get(pathKey(item));
          let row: { id: number };
          if (!previous) {
            const strict = (strictMatches.get(strictIdentity(item)) ?? []).filter((entry) => !reconciledIds.has(entry.id));
            const loose = (looseMatches.get(looseIdentity(item)) ?? []).filter((entry) => !reconciledIds.has(entry.id));
            const match = strict.length === 1 ? strict[0]
              : strict.length === 0 && loose.length === 1 && looseIncomingCounts.get(looseIdentity(item)) === 1 ? loose[0] : undefined;
            if (match) {
              const nextTitle = match.title === titleFromFilename(match.filename) ? item.title : match.title;
              reconcileMoved.run(nextTitle, item.filename, item.fileExtension, item.relativePath, item.sizeBytes,
                item.modifiedAtMs, item.fileCount, item.sizeBytes, item.modifiedAtMs, match.id);
              reconciledIds.add(match.id);
              row = { id: match.id };
            } else {
              row = upsert.get(sourceId, item.mediaType, item.title, item.filename, item.fileExtension,
                item.relativePath, item.sizeBytes, item.modifiedAtMs, item.fileCount) as { id: number };
            }
          } else if (previous.indexed === 1 && previous.available === 1 && previous.filename === item.filename
            && previous.fileExtension === item.fileExtension && previous.relativePath === item.relativePath
            && previous.sizeBytes === item.sizeBytes && previous.modifiedAtMs === item.modifiedAtMs && previous.fileCount === item.fileCount) {
            row = { id: previous.id };
          } else if (previous.relativePath !== item.relativePath) {
            // A Windows case-only rename resolves to the same path key, but
            // SQLite's path uniqueness is case-sensitive. Update the same row.
            const nextTitle = previous.title === titleFromFilename(previous.filename) ? item.title : previous.title;
            reconcileMoved.run(nextTitle, item.filename, item.fileExtension, item.relativePath, item.sizeBytes,
              item.modifiedAtMs, item.fileCount, item.sizeBytes, item.modifiedAtMs, previous.id);
            row = { id: previous.id };
          } else {
            row = upsert.get(sourceId, item.mediaType, item.title, item.filename, item.fileExtension,
              item.relativePath, item.sizeBytes, item.modifiedAtMs, item.fileCount) as { id: number };
          }
          reconciledIds.add(row.id);
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

        const markMissing = database.prepare("UPDATE media_items SET indexed = 0, available = 0 WHERE id = ? AND (indexed <> 0 OR available <> 0)");
        for (const previous of previousItems) if (!reconciledIds.has(previous.id)) markMissing.run(previous.id);

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

        database.exec("COMMIT");
      } catch (transactionError) {
        database.exec("ROLLBACK");
        throw transactionError;
      }
      if (options.regenerateThumbnails) {
        await clearThumbnailCache([...new Set([...previousItemIds, ...indexedItems.map((entry) => entry.id)])]);
        await Promise.allSettled(indexedItems.filter((entry) => entry.item.mediaType === "video" || entry.item.mediaType === "story").map((entry) => {
          const inputPath = path.resolve(rootPath, entry.item.relativePath);
          return entry.item.mediaType === "video"
            ? getVideoThumbnail(entry.id, inputPath, entry.item.sizeBytes, entry.item.modifiedAtMs)
            : getPdfThumbnail(entry.id, inputPath, entry.item.sizeBytes, entry.item.modifiedAtMs);
        }));
      }
      database.prepare(`
        UPDATE sources
        SET status = 'ready', connected = 1, last_error = NULL, last_scanned_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(sourceId);
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
