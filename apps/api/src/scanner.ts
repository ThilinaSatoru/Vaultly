import { withAttributePatterns } from "./attribute-routes.js";
import { lstat, opendir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { setImmediate as yieldToRequests } from "node:timers/promises";
import { database } from "./database.js";
import { AttributeNameMatcher, FilenameMetadataMatcher, normalizeMetadataFilename, normalizeMetadataPhrase } from "./filename-metadata.js";
import { readComicMetadata, type ComicMetadata } from "./comic-metadata.js";
import { clearThumbnailCache, getPdfThumbnail, getVideoMetadata, getVideoThumbnail } from "./thumbnails.js";

const videoExtensions = new Set([
  ".mp4", ".m4v", ".mkv", ".webm", ".avi", ".mov", ".wmv", ".flv", ".mpeg", ".mpg", ".ts",
  ".mts", ".m2ts", ".vob", ".ogv", ".3gp", ".3g2", ".asf", ".mxf",
]);
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);
const storyExtensions = new Set([".pdf"]);
const comicArchiveExtensions = new Set([".cbz", ".zip"]);

export const isVideoFile = (filename: string) => videoExtensions.has(path.extname(filename).toLowerCase());

interface ScannedItem {
  mediaType: "comic" | "video" | "story";
  title: string;
  filename: string;
  fileExtension: string;
  relativePath: string;
  sizeBytes: number;
  modifiedAtMs: number;
  fileCount: number;
  comicMetadata?: ComicMetadata;
}

interface ExistingItem extends ScannedItem {
  id: number;
  indexed: number;
  available: number;
}

export interface ScanProgress {
  phase: "discovering" | "indexing" | "collections" | "metadata" | "thumbnails";
  startedAt: number;
  directoriesScanned: number;
  directoriesFound: number;
  filesChecked: number;
  comicPages: number;
  comicsFound: number;
  videosFound: number;
  pdfsFound: number;
  itemsProcessed: number;
  itemsTotal: number;
  collectionsProcessed: number;
  collectionsTotal: number;
  thumbnailsProcessed: number;
  thumbnailsTotal: number;
  thumbnailErrors: number;
  videoMetadataProcessed: number;
  videoMetadataTotal: number;
  currentPath: string;
}

const newProgress = (): ScanProgress => ({
  phase: "discovering", startedAt: Date.now(), directoriesScanned: 0, directoriesFound: 1,
  filesChecked: 0, comicPages: 0, comicsFound: 0, videosFound: 0, pdfsFound: 0,
  itemsProcessed: 0, itemsTotal: 0, collectionsProcessed: 0, collectionsTotal: 0,
  thumbnailsProcessed: 0, thumbnailsTotal: 0, thumbnailErrors: 0, currentPath: ".",
  videoMetadataProcessed: 0, videoMetadataTotal: 0,
});

const titleFromFilename = (filename: string) =>
  path.basename(filename, path.extname(filename)).replace(/[._]+/g, " ").trim();

const strictIdentity = (item: Pick<ScannedItem, "mediaType" | "sizeBytes" | "modifiedAtMs" | "fileCount">) =>
  `${item.mediaType}|${item.sizeBytes}|${item.modifiedAtMs}|${item.fileCount}`;
const looseIdentity = (item: Pick<ScannedItem, "mediaType" | "sizeBytes" | "fileCount">) =>
  `${item.mediaType}|${item.sizeBytes}|${item.fileCount}`;

const stripHashes = (value: string) => value.replace(/#/g, "").replace(/\s+/g, " ").trim();
const scanPathKey = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;

/** Commit each rename with its index update before honoring cancellation again. */
async function normalizeHashMarkers(sourceId: number, rootPath: string, items: ScannedItem[], signal: AbortSignal) {
  const existing = database.prepare(`SELECT id, media_type AS mediaType, title, filename,
    file_extension AS fileExtension, relative_path AS relativePath, size_bytes AS sizeBytes,
    modified_at_ms AS modifiedAtMs, file_count AS fileCount, indexed, available
    FROM media_items WHERE source_id = ?`).all(sourceId) as unknown as ExistingItem[];
  if (!items.some((item) => item.filename.includes("#")) && !existing.some((item) => item.title.includes("#"))) return;
  const byPath = new Map(existing.map((item) => [`${item.mediaType}|${scanPathKey(item.relativePath)}`, item]));
  const incomingPaths = new Set(items.map((item) => `${item.mediaType}|${scanPathKey(item.relativePath)}`));
  const strictMatches = new Map<string, ExistingItem[]>();
  for (const item of existing) {
    if (incomingPaths.has(`${item.mediaType}|${scanPathKey(item.relativePath)}`)) continue;
    const matches = strictMatches.get(strictIdentity(item)) ?? [];
    matches.push(item);
    strictMatches.set(strictIdentity(item), matches);
  }
  const incomingCounts = new Map<string, number>();
  for (const item of items) incomingCounts.set(strictIdentity(item), (incomingCounts.get(strictIdentity(item)) ?? 0) + 1);
  const consumedIds = new Set<number>();
  const update = database.prepare(`UPDATE media_items SET title = ?, filename = ?, relative_path = ?,
    favorite = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
  const insert = database.prepare(`INSERT INTO media_items(source_id, media_type, title, filename, file_extension,
    relative_path, size_bytes, modified_at_ms, file_count, favorite) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`);
  const updateChild = database.prepare("UPDATE media_items SET relative_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
  const indexedPath = database.prepare("SELECT id FROM media_items WHERE source_id = ? AND relative_path = ? COLLATE NOCASE");
  let lastYield = performance.now();

  // Children are normalized first so later folder moves carry their final filenames.
  for (const item of [...items].sort((a, b) => b.relativePath.split(path.sep).length - a.relativePath.split(path.sep).length)) {
    if (performance.now() - lastYield >= 25) {
      await yieldToRequests();
      lastYield = performance.now();
    }
    signal.throwIfAborted();
    let previous = byPath.get(`${item.mediaType}|${scanPathKey(item.relativePath)}`);
    if (!previous) {
      const candidates = strictMatches.get(strictIdentity(item))?.filter((entry) => !consumedIds.has(entry.id));
      if (candidates?.length === 1 && incomingCounts.get(strictIdentity(item)) === 1) previous = candidates[0];
    }
    const rootMarkerHandled = item.relativePath === "." && previous && !previous.title.includes("#");
    if ((!item.filename.includes("#") || rootMarkerHandled) && !previous?.title.includes("#")) continue;
    const oldRelativePath = item.relativePath;
    const oldPath = path.resolve(rootPath, oldRelativePath);
    const isFolder = !item.fileExtension;
    const extension = isFolder ? "" : path.extname(item.filename);
    const rawStem = extension ? item.filename.slice(0, -extension.length) : item.filename;
    const stem = stripHashes(rawStem).replace(/[. ]+$/g, "") || "Untitled";
    let filename = item.filename;
    let relativePath = oldRelativePath;
    if (item.filename.includes("#") && oldRelativePath !== ".") {
      for (let suffix = 0; ; suffix++) {
        signal.throwIfAborted();
        filename = `${stem}${suffix ? ` (${suffix + 1})` : ""}${extension}`;
        relativePath = path.join(path.dirname(oldRelativePath), filename);
        if (indexedPath.get(sourceId, relativePath)) continue;
        try { await lstat(path.resolve(rootPath, relativePath)); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
          throw error;
        }
      }
    }
    signal.throwIfAborted();
    const nextPath = path.resolve(rootPath, relativePath);
    const changedPath = relativePath !== oldRelativePath;
    const previousDefaultTitle = previous && (previous.fileExtension ? titleFromFilename(previous.filename) : previous.filename);
    const title = stripHashes(previous && previous.title !== previousDefaultTitle ? previous.title : item.title) || "Untitled";
    const descendants = isFolder && changedPath ? existing.filter((child) => {
      const suffix = path.relative(oldPath, path.resolve(rootPath, child.relativePath));
      return suffix && suffix !== ".." && !suffix.startsWith(`..${path.sep}`) && !path.isAbsolute(suffix);
    }) : [];
    if (changedPath) await rename(oldPath, nextPath);
    try {
      database.exec("BEGIN IMMEDIATE");
      try {
        if (previous) {
          update.run(title, filename, relativePath, previous.id);
          consumedIds.add(previous.id);
        } else {
          const id = Number(insert.run(sourceId, item.mediaType, title, filename, item.fileExtension,
            relativePath, item.sizeBytes, item.modifiedAtMs, item.fileCount).lastInsertRowid);
          previous = { ...item, id, indexed: 1, available: 1 };
          existing.push(previous);
        }
        for (const child of descendants) updateChild.run(path.join(relativePath, path.relative(oldPath, path.resolve(rootPath, child.relativePath))), child.id);
        database.exec("COMMIT");
      } catch (error) { database.exec("ROLLBACK"); throw error; }
    } catch (error) {
      if (changedPath) await rename(nextPath, oldPath);
      throw error;
    }
    if (isFolder && changedPath) {
      for (const child of [...items, ...descendants]) {
        if (child === item) continue;
        const suffix = path.relative(oldPath, path.resolve(rootPath, child.relativePath));
        if (suffix && suffix !== ".." && !suffix.startsWith(`..${path.sep}`) && !path.isAbsolute(suffix)) {
          child.relativePath = path.join(relativePath, suffix);
        }
      }
    }
    if (previous) byPath.delete(`${item.mediaType}|${scanPathKey(previous.relativePath)}`);
    item.filename = filename;
    item.relativePath = relativePath;
    item.title = title;
    Object.assign(previous, { filename, relativePath, title });
    // Rebuild path keys after folder moves; the underlying IDs stay unchanged.
    if (isFolder && changedPath) {
      byPath.clear();
      for (const entry of existing) byPath.set(`${entry.mediaType}|${scanPathKey(entry.relativePath)}`, entry);
    } else {
      byPath.set(`${item.mediaType}|${scanPathKey(relativePath)}`, previous!);
    }
  }
}

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

export async function collectItems(rootPath: string, signal?: AbortSignal, progress?: ScanProgress): Promise<ScannedItem[]> {
  signal?.throwIfAborted();
  const items: ScannedItem[] = [];
  const directories = [rootPath];

  const scanDirectory = async (currentDirectory: string) => {
    signal?.throwIfAborted();
    const directory = await opendir(currentDirectory, { bufferSize: 128 });
    if (progress) progress.currentPath = path.relative(rootPath, currentDirectory) || ".";
    let imageCount = 0;
    let totalSize = 0;
    let latestModification = 0;
    let metadataPath: string | undefined;
    let pending: Array<{ name: string; extension: string; absolutePath: string }> = [];
    const flush = async () => {
      signal?.throwIfAborted();
      const batch = pending;
      pending = [];
      // Bounded metadata reads avoid one round-trip per file without launching
      // thousands of simultaneous requests or retaining every comic page.
      const results = await Promise.all(batch.map(async (file) => ({ ...file, fileStat: await stat(file.absolutePath) })));
      signal?.throwIfAborted();
      for (const { name, extension, absolutePath, fileStat } of results) {
        if (progress) {
          progress.filesChecked++;
          progress.currentPath = path.relative(rootPath, absolutePath);
        }
        if (imageExtensions.has(extension)) {
          if (progress) progress.comicPages++;
          imageCount++;
          totalSize += fileStat.size;
          latestModification = Math.max(latestModification, fileStat.mtimeMs);
        } else {
          if (progress) {
            if (videoExtensions.has(extension)) progress.videosFound++;
            else if (storyExtensions.has(extension)) progress.pdfsFound++;
            else progress.comicsFound++;
            progress.itemsTotal++;
          }
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
      signal?.throwIfAborted();
      const absolutePath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        directories.push(absolutePath);
        if (progress) progress.directoriesFound++;
      } else if (entry.isFile()) {
        if (entry.name.toLowerCase() === "meta.json") metadataPath = absolutePath;
        const extension = path.extname(entry.name).toLowerCase();
        if (!videoExtensions.has(extension) && !storyExtensions.has(extension) && !comicArchiveExtensions.has(extension) && !imageExtensions.has(extension)) {
          if (progress) progress.filesChecked++;
          continue;
        }
        pending.push({ name: entry.name, extension, absolutePath });
        if (pending.length === 8) await flush();
      }
    }
    await flush();

    if (imageCount > 0) {
      const comicMetadata = metadataPath ? await readComicMetadata(metadataPath, signal) : undefined;
      if (progress) { progress.comicsFound++; progress.itemsTotal++; }
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
        ...(comicMetadata ? { comicMetadata } : {}),
      });
    }
    if (progress) progress.directoriesScanned++;
  };
  while (directories.length > 0) {
    signal?.throwIfAborted();
    const batch = directories.splice(-4);
    // Wait for every open directory to finish before surfacing a failure.
    const results = await Promise.allSettled(batch.map(scanDirectory));
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }

  signal?.throwIfAborted();
  return items;
}

const scans = new Map<number, { promise: Promise<void>; controller: AbortController; progress: ScanProgress }>();

export function getScanProgress(sourceId: number): (ScanProgress & { elapsedMs: number }) | null {
  const progress = scans.get(sourceId)?.progress;
  return progress ? { ...progress, elapsedMs: Date.now() - progress.startedAt } : null;
}

export async function cancelSourceScan(sourceId: number): Promise<boolean> {
  const scan = scans.get(sourceId);
  if (!scan) return false;
  scan.controller.abort();
  await scan.promise;
  return true;
}

export async function cancelAllSourceScans(): Promise<number> {
  const active = [...scans.values()];
  for (const scan of active) scan.controller.abort();
  await Promise.all(active.map((scan) => scan.promise));
  return active.length;
}

export function scanSource(sourceId: number, rootPath: string, options: { generateThumbnails?: boolean; regenerateThumbnails?: boolean } = {}): Promise<void> {
  const existingScan = scans.get(sourceId);
  if (existingScan) return existingScan.promise;

  const controller = new AbortController();
  const { signal } = controller;
  const progress = newProgress();
  const previousSource = database.prepare("SELECT status, last_error FROM sources WHERE id = ?")
    .get(sourceId) as { status: string; last_error: string | null } | undefined;

  const scan = (async () => {
    database.prepare(
      "UPDATE sources SET status = 'scanning', last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(sourceId);

    try {
      const items = await collectItems(rootPath, signal, progress);
      progress.phase = "indexing";
      await normalizeHashMarkers(sourceId, rootPath, items, signal);
      const previousItems = (database.prepare(`SELECT id, media_type AS mediaType, title, filename,
        file_extension AS fileExtension, relative_path AS relativePath, size_bytes AS sizeBytes,
        modified_at_ms AS modifiedAtMs, file_count AS fileCount, indexed, available
        FROM media_items WHERE source_id = ?`).all(sourceId) as unknown as ExistingItem[]);
      const previousItemIds = previousItems.map((row) => row.id);
      signal.throwIfAborted();
      progress.phase = "indexing";
      progress.itemsTotal = items.length;
      await yieldToRequests();
      signal.throwIfAborted();
      const indexedItems: Array<{ id: number; item: ScannedItem }> = [];
      database.exec("BEGIN IMMEDIATE");
      let transactionOpen = true;
      let lastYield = performance.now();
      const yieldBetweenBatches = async () => {
        database.exec("COMMIT");
        transactionOpen = false;
        // Requests may read progress, cancel, or edit the library only after this transaction ends.
        await yieldToRequests();
        signal.throwIfAborted();
        database.exec("BEGIN IMMEDIATE");
        transactionOpen = true;
        lastYield = performance.now();
      };
      try {
        const categories = database.prepare("SELECT id, name FROM categories").all() as Array<{ id: number; name: string }>;
        const tags = database.prepare("SELECT id, name FROM tags").all() as Array<{ id: number; name: string }>;
        const people = database.prepare("SELECT id, name FROM people").all() as Array<{ id: number; name: string }>;
        const categoryMatcher = new FilenameMetadataMatcher(withAttributePatterns("categories", categories));
        const patternedTags = withAttributePatterns("tags", tags);
        const patternedPeople = withAttributePatterns("people", people);
        const tagMatcher = new FilenameMetadataMatcher(patternedTags);
        const peopleMatcher = new FilenameMetadataMatcher(patternedPeople);
        const metadataTagMatcher = new AttributeNameMatcher(patternedTags);
        const metadataArtistMatcher = new AttributeNameMatcher(patternedPeople);
        const createArtist = database.prepare("INSERT OR IGNORE INTO people(name) VALUES (?)");
        const findArtist = database.prepare("SELECT id, name FROM people WHERE name = ? COLLATE NOCASE");
        const addCategory = database.prepare("INSERT OR IGNORE INTO item_categories(item_id, category_id) SELECT ?, id FROM categories WHERE id = ?");
        const addTag = database.prepare("INSERT OR IGNORE INTO item_tags(item_id, tag_id) SELECT ?, id FROM tags WHERE id = ?");
        const addPerson = database.prepare("INSERT OR IGNORE INTO item_people(item_id, person_id, role) SELECT ?, id, ? FROM people WHERE id = ?");
        const pathKey = (item: ScannedItem) => `${item.mediaType}|${process.platform === "win32" ? item.relativePath.toLowerCase() : item.relativePath}`;
        const previousByPath = new Map(previousItems.map((item) => [pathKey(item), item]));
        const incomingPaths = new Set(items.map(pathKey));
        // Only missing paths are candidates for a move, so identical files that
        // still exist never donate their identity to a newly discovered file.
        const availablePrevious = previousItems.filter((item) => item.indexed === 1 && !incomingPaths.has(pathKey(item)));
        const strictMatches = new Map<string, Set<ExistingItem>>();
        const looseMatches = new Map<string, Set<ExistingItem>>();
        for (const existing of availablePrevious) {
          const strict = strictMatches.get(strictIdentity(existing)) ?? new Set<ExistingItem>();
          strict.add(existing);
          strictMatches.set(strictIdentity(existing), strict);
          const loose = looseMatches.get(looseIdentity(existing)) ?? new Set<ExistingItem>();
          loose.add(existing);
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
        const invalidateVideoMetadata = database.prepare(`UPDATE media_items SET video_width = NULL, video_height = NULL,
          video_metadata_signature = NULL WHERE id = ? AND video_metadata_signature IS NOT NULL AND video_metadata_signature <> ?`);
        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
          const item = items[itemIndex];
          const previous = previousByPath.get(pathKey(item));
          let row: { id: number };
          if (!previous) {
            const strict = strictMatches.get(strictIdentity(item));
            const loose = looseMatches.get(looseIdentity(item));
            // Bucket sizes make ambiguity checks constant-time even when thousands of PDFs share a size.
            const match = strict?.size === 1 ? strict.values().next().value
              : !strict?.size && loose?.size === 1 && looseIncomingCounts.get(looseIdentity(item)) === 1 ? loose.values().next().value : undefined;
            if (match) {
              const nextTitle = match.title === titleFromFilename(match.filename) ? item.title : match.title;
              reconcileMoved.run(nextTitle, item.filename, item.fileExtension, item.relativePath, item.sizeBytes,
                item.modifiedAtMs, item.fileCount, item.sizeBytes, item.modifiedAtMs, match.id);
              reconciledIds.add(match.id);
              strictMatches.get(strictIdentity(match))?.delete(match);
              looseMatches.get(looseIdentity(match))?.delete(match);
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
          if (item.mediaType === "video") invalidateVideoMetadata.run(row.id, `${item.sizeBytes}:${item.modifiedAtMs}`);
          indexedItems.push({ id: row.id, item });
          const normalizedFilename = normalizeMetadataFilename(item.filename, item.fileExtension);
          for (const category of categoryMatcher.matchNormalized(normalizedFilename)) {
            addCategory.run(row.id, category.id);
          }
          for (const tag of tagMatcher.matchNormalized(normalizedFilename)) {
            addTag.run(row.id, tag.id);
          }
          for (const person of peopleMatcher.matchNormalized(normalizedFilename)) {
            addPerson.run(row.id, item.mediaType === "video" ? "cast" : "artist", person.id);
          }
          if (item.comicMetadata) {
            for (const name of item.comicMetadata.tags) {
              for (const tag of metadataTagMatcher.match(name)) addTag.run(row.id, tag.id);
            }
            for (const name of item.comicMetadata.artists) {
              if (name.length > 100 || !normalizeMetadataPhrase(name)) continue;
              let artists = metadataArtistMatcher.match(name);
              if (!artists.length) {
                createArtist.run(name);
                const artist = findArtist.get(name) as { id: number; name: string };
                metadataArtistMatcher.add({ ...artist, patterns: [] });
                artists = [{ ...artist, patterns: [] }];
              }
              for (const artist of artists) addPerson.run(row.id, "artist", artist.id);
            }
          }
          progress.itemsProcessed = itemIndex + 1;
          progress.currentPath = item.relativePath;
          if ((itemIndex + 1) % 128 === 0 || performance.now() - lastYield >= 25) await yieldBetweenBatches();
        }

        progress.phase = "collections";
        progress.currentPath = "";
        await yieldBetweenBatches();

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
        const groupedItemIds = new Set((database.prepare(`SELECT si.item_id FROM series_items si
          JOIN media_items m ON m.id = si.item_id WHERE m.source_id = ?`).all(sourceId) as Array<{ item_id: number }>).map((row) => row.item_id));
        progress.collectionsTotal = collectionGroups.size;
        for (const [autoKey, group] of collectionGroups) {
          if (progress.collectionsProcessed % 128 === 0 || performance.now() - lastYield >= 25) await yieldBetweenBatches();
          progress.currentPath = group.title;
          let series = findAutoSeries.get(autoKey) as { id: number } | undefined;
          if (!series && group.entries.length < 2) { progress.collectionsProcessed++; continue; }
          if (!series) {
            const alreadyGrouped = group.entries.some((entry) => groupedItemIds.has(entry.id));
            if (alreadyGrouped) { progress.collectionsProcessed++; continue; }
            createAutoSeries.run(group.title, group.mediaType, autoKey);
            series = findAutoSeries.get(autoKey) as { id: number } | undefined;
          }
          if (!series) { progress.collectionsProcessed++; continue; }
          group.entries.sort((a, b) => a.order - b.order || a.path.localeCompare(b.path));
          for (let position = 0; position < group.entries.length; position++) {
            const entry = group.entries[position];
            addSeriesItem.run(series.id, entry.id, position);
            groupedItemIds.add(entry.id);
            if ((position + 1) % 128 === 0 && performance.now() - lastYield >= 25) await yieldBetweenBatches();
          }
          progress.collectionsProcessed++;
        }

        // Only a fully indexed source may mark previously known files as missing.
        const markMissing = database.prepare("UPDATE media_items SET indexed = 0, available = 0 WHERE id = ? AND (indexed <> 0 OR available <> 0)");
        for (const previous of previousItems) if (!reconciledIds.has(previous.id)) markMissing.run(previous.id);
        database.exec("COMMIT");
        transactionOpen = false;
      } catch (transactionError) {
        if (transactionOpen) database.exec("ROLLBACK");
        throw transactionError;
      }
      // Probe outside indexing transactions so library requests and cancellation stay responsive.
      const videoSignatures = new Map((database.prepare("SELECT id, video_metadata_signature AS signature FROM media_items WHERE source_id = ? AND media_type = 'video'")
        .all(sourceId) as Array<{ id: number; signature: string | null }>).map((row) => [row.id, row.signature]));
      const videos = indexedItems.filter(({ id, item }) => item.mediaType === "video"
        && videoSignatures.get(id) !== `${item.sizeBytes}:${item.modifiedAtMs}`);
      if (videos.length) {
        signal.throwIfAborted();
        progress.phase = "metadata";
        progress.videoMetadataTotal = videos.length;
        const saveMetadata = database.prepare(`UPDATE media_items SET video_width = ?, video_height = ?,
          duration_seconds = COALESCE(?, duration_seconds), video_metadata_signature = ?
          WHERE id = ? AND size_bytes = ? AND modified_at_ms = ?`);
        let nextVideo = 0;
        const results = await Promise.allSettled(Array.from({ length: Math.min(2, videos.length) }, async () => {
          while (nextVideo < videos.length) {
            signal.throwIfAborted();
            const { id, item } = videos[nextVideo++];
            progress.currentPath = item.relativePath;
            const metadata = await getVideoMetadata(path.resolve(rootPath, item.relativePath), signal);
            signal.throwIfAborted();
            saveMetadata.run(metadata.width, metadata.height, metadata.durationSeconds, `${item.sizeBytes}:${item.modifiedAtMs}`,
              id, item.sizeBytes, item.modifiedAtMs);
            progress.videoMetadataProcessed++;
          }
        }));
        for (const result of results) if (result.status === "rejected") throw result.reason;
      }
      if (options.generateThumbnails || options.regenerateThumbnails) {
        signal.throwIfAborted();
        progress.phase = "thumbnails";
        progress.currentPath = "";
        if (options.regenerateThumbnails) await clearThumbnailCache([...new Set([...previousItemIds, ...indexedItems.map((entry) => entry.id)])]);
        signal.throwIfAborted();
        const thumbnails = indexedItems.filter((entry) => entry.item.mediaType === "video" || entry.item.mediaType === "story");
        progress.thumbnailsTotal = thumbnails.length;
        let nextThumbnail = 0;
        // Schedule only two at a time so cancellation never leaves a library-sized queue.
        await Promise.allSettled(Array.from({ length: 2 }, async () => {
          while (nextThumbnail < thumbnails.length) {
            signal.throwIfAborted();
            const entry = thumbnails[nextThumbnail++];
            progress.currentPath = entry.item.relativePath;
            const inputPath = path.resolve(rootPath, entry.item.relativePath);
            try {
              if (entry.item.mediaType === "video") {
                await getVideoThumbnail(entry.id, inputPath, entry.item.sizeBytes, entry.item.modifiedAtMs, signal);
              } else {
                await getPdfThumbnail(entry.id, inputPath, entry.item.sizeBytes, entry.item.modifiedAtMs, signal);
              }
            } catch { signal.throwIfAborted(); progress.thumbnailErrors++; }
            progress.thumbnailsProcessed++;
          }
        }));
      }
      signal.throwIfAborted();
      database.prepare(`
        UPDATE sources
        SET status = 'ready', connected = 1, last_error = NULL, last_scanned_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(sourceId);
    } catch (error) {
      if (signal.aborted) {
        database.prepare("UPDATE sources SET status = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .run(previousSource?.status === "scanning" ? "idle" : previousSource?.status ?? "idle", previousSource?.last_error ?? null, sourceId);
        return;
      }
      const message = error instanceof Error ? error.message : "The folder could not be scanned.";
      database.prepare(`
        UPDATE sources SET status = 'error', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(message, sourceId);
    }
  })().finally(() => scans.delete(sourceId));

  scans.set(sourceId, { promise: scan, controller, progress });
  return scan;
}
