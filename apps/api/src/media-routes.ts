import { getVideoTracks, getAudioTrack, getEmbeddedSubtitle } from "./video-tracks.js";
import { findVideoCover, normalizeVideoCover } from "./video-covers.js";
import { itemAssignmentIds, sourceAttributes, withAttributePatterns } from "./attribute-routes.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, lstat, opendir, realpath, rename as renamePath, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { database } from "./database.js";
import { substringFilter } from "./search-index.js";
import { gallerySearchFilters } from "./gallery-search.js";
import { expandSearchTerms, rankedMatch } from "./advanced-search.js";
import { englishSearchFilters } from "./english-search.js";
import { englishMatch } from "./english-matching.js";
import { videoSubtitles, readSubtitle } from "./subtitles.js";
import { browseFolders } from "./folder-browse.js";
import { openBookArchive, epubChapters } from "./book-archive.js";
import { ebookExtensions, sourceMediaTypes, pictureExtensions } from "./source-media.js";
import { getScanProgress, isVideoFile } from "./scanner.js";
import { getPdfThumbnail, getVideoDuration, getVideoThumbnail } from "./thumbnails.js";
import { openVideoInDefaultPlayer } from "./open-video.js";

const idInput = z.object({ id: z.coerce.number().int().positive() });
const pageInput = z.object({
  id: z.coerce.number().int().positive(),
  page: z.coerce.number().int().nonnegative(),
});
const idListInput = z.string().regex(/^\d+(,\d+)*$/).max(500)
  .refine((value) => value.split(",").length <= 50);
const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00`).getTime()));
const listInput = z.object({
  type: z.enum(["comic", "video", "story"]).optional(),
  sourceType: z.enum(sourceMediaTypes).optional(),
  q: z.string().trim().max(200).optional(),
  searchMode: z.enum(["literal", "fuzzy", "english"]).default("literal"),
  filename: z.string().trim().max(200).optional(),
  path: z.string().trim().max(200).optional(),
  source: z.coerce.number().int().positive().optional(),
  extension: z.union([z.literal("folder"), z.string().regex(/^[a-z0-9]{1,10}$/)]).optional(),
  minMb: z.coerce.number().finite().nonnegative().max(1_000_000).optional(),
  maxMb: z.coerce.number().finite().nonnegative().max(1_000_000).optional(),
  modifiedFrom: dateInput.optional(),
  modifiedTo: dateInput.optional(),
  series: z.string().regex(/^(grouped|ungrouped|[1-9]\d*)$/).optional(),
  circle: z.coerce.number().int().positive().optional(),
  uncategorized: z.enum(["1"]).optional(),
  untagged: z.enum(["1"]).optional(),
  category: z.coerce.number().int().positive().optional(),
  categories: idListInput.optional(),
  tags: idListInput.optional(),
  cast: idListInput.optional(),
  artists: idListInput.optional(),
  people: idListInput.optional(),
  favorite: z.enum(["1"]).optional(),
  groupSeries: z.enum(["1"]).optional(),
  folder: z.string().max(2000).default(""),
  sort: z.enum(["folders", "relevance", "title", "filename", "recent", "oldest", "size", "smallest"]).default("title"),
  page: z.coerce.number().int().nonnegative().default(0),
}).refine((value) => value.minMb === undefined || value.maxMb === undefined || value.minMb <= value.maxMb,
  { message: "Minimum size must not exceed maximum size." });

interface MediaPathRow {
  id: number;
  source_id: number;
  media_type: "comic" | "video" | "story";
  title: string;
  root_path: string;
  relative_path: string;
  file_count: number;
  size_bytes: number;
  modified_at_ms: number;
}

const imageExtensions = pictureExtensions;
const mimeTypes: Record<string, string> = {
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".mkv": "video/x-matroska",
  ".webm": "video/webm", ".avi": "video/x-msvideo", ".mov": "video/quicktime",
  ".wmv": "video/x-ms-wmv", ".flv": "video/x-flv", ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg", ".ts": "video/mp2t", ".pdf": "application/pdf", ".jpg": "image/jpeg",
  ".mts": "video/mp2t", ".m2ts": "video/mp2t", ".vob": "video/mpeg", ".ogv": "video/ogg",
  ".3gp": "video/3gpp", ".3g2": "video/3gpp2", ".asf": "video/x-ms-asf", ".mxf": "application/mxf",
  ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".gif": "image/gif", ".avif": "image/avif", ".cbz": "application/zip",
  ".zip": "application/zip", ".m4a": "audio/mp4",
};

function mediaRow(id: number): MediaPathRow | undefined {
  return database.prepare(`
    SELECT m.id, m.source_id, m.media_type, m.title, m.relative_path, m.file_count,
      m.size_bytes, m.modified_at_ms, s.root_path
    FROM media_items m JOIN sources s ON s.id = m.source_id
    WHERE m.id = ? AND m.available = 1
  `).get(id) as MediaPathRow | undefined;
}

function withinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function resolveItemPath(item: MediaPathRow): Promise<string> {
  const root = await realpath(item.root_path);
  const file = await realpath(path.resolve(root, item.relative_path));
  if (!withinRoot(root, file)) throw new Error("Media path escapes its library source.");
  return file;
}

function invalidFileNameMessage(fileName: string): string | null {
  if (fileName === "." || fileName === ".." || /[\\/\0]/.test(fileName)) {
    return "Enter a file or folder name, not a path.";
  }
  if (process.platform === "win32") {
    if (/[<>:"|?*\x00-\x1f]/.test(fileName) || /[ .]$/.test(fileName)) return "That name contains characters Windows does not allow.";
    const stem = fileName.split(".", 1)[0].toUpperCase();
    if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)) return "That name is reserved by Windows.";
  }
  return null;
}

async function comicPages(item: MediaPathRow): Promise<string[]> {
  const directoryPath = await resolveItemPath(item);
  if (!(await stat(directoryPath)).isDirectory()) {
    const extension = path.extname(directoryPath).toLowerCase();
    if (imageExtensions.has(extension)) return [path.basename(directoryPath)];
    if (extension === ".cbz" || extension === ".zip") return [...(await openBookArchive(directoryPath)).entries.keys()].filter((name) => imageExtensions.has(path.extname(name).toLowerCase())).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return [];
  }
  const directory = await opendir(directoryPath);
  const pages: string[] = [];
  for await (const entry of directory) {
    if (entry.isFile() && imageExtensions.has(path.extname(entry.name).toLowerCase())) {
      pages.push(entry.name);
    }
  }
  return pages.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

async function sendLocalFile(
  reply: FastifyReply,
  filePath: string,
  rangeHeader: string | undefined,
) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) return reply.code(400).send({ message: "This item is a folder, not a file." });
  const size = fileStat.size;
  const mimeType = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  reply.header("Content-Type", mimeType);
  reply.header("Accept-Ranges", "bytes");
  reply.header("Cache-Control", "private, max-age=3600");
  reply.header("Content-Disposition", "inline");

  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (!match || (!match[1] && !match[2])) {
      return reply.code(416).header("Content-Range", `bytes */${size}`).send();
    }
    const suffixLength = match[1] ? null : Number(match[2]);
    const start = suffixLength === null ? Number(match[1]) : Math.max(0, size - suffixLength);
    const end = match[1] && match[2] ? Number(match[2]) : size - 1;
    if (start >= size || end < start || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      return reply.code(416).header("Content-Range", `bytes */${size}`).send();
    }
    const boundedEnd = Math.min(end, size - 1);
    reply.code(206);
    reply.header("Content-Range", `bytes ${start}-${boundedEnd}/${size}`);
    reply.header("Content-Length", boundedEnd - start + 1);
    return reply.send(createReadStream(filePath, { start, end: boundedEnd }));
  }

  reply.header("Content-Length", size);
  return reply.send(createReadStream(filePath));
}

const itemSelect = (indexedSearch = false) => `
  SELECT m.id, m.source_id, m.media_type, m.title, m.filename, m.file_extension, m.relative_path, m.size_bytes, m.favorite, m.duration_seconds,
    m.modified_at_ms, m.file_count, m.video_width, m.video_height, m.cover_width, m.cover_height, m.cover_signature,
    (m.cover_data IS NOT NULL) AS custom_cover, (m.cover_data IS NOT NULL OR m.cover_path IS NOT NULL) AS has_cover, s.name AS source_name, s.root_path AS source_path,
    COALESCE((SELECT group_concat(c.name, ', ')
      FROM effective_item_categories ic JOIN categories c ON c.id = ic.category_id
      WHERE ic.item_id = m.id), '') AS category_names
  FROM media_items m ${indexedSearch ? "NOT INDEXED" : ""} JOIN sources s ON s.id = m.source_id
`;

interface TagRow { item_id: number; id: number; name: string }

function categoriesByItem(itemIds: number[]): Map<number, Array<{ id: number; name: string }>> {
  const result = new Map<number, Array<{ id: number; name: string }>>();
  if (!itemIds.length) return result;
  const rows = database.prepare(`
    SELECT ic.item_id, c.id, c.name FROM effective_item_categories ic
    JOIN categories c ON c.id = ic.category_id
    WHERE ic.item_id IN (${itemIds.map(() => "?").join(",")}) ORDER BY c.name COLLATE NOCASE
  `).all(...itemIds) as unknown as Array<{ item_id: number; id: number; name: string }>;
  for (const row of rows) {
    const categories = result.get(row.item_id) ?? [];
    categories.push({ id: row.id, name: row.name });
    result.set(row.item_id, categories);
  }
  return result;
}

function seriesByItem(itemIds: number[]): Map<number, number[]> {
  const result = new Map<number, number[]>();
  if (!itemIds.length) return result;
  const rows = database.prepare(`SELECT item_id, series_id FROM series_items
    WHERE item_id IN (${itemIds.map(() => "?").join(",")}) ORDER BY series_id`).all(...itemIds) as Array<{ item_id: number; series_id: number }>;
  for (const row of rows) result.set(row.item_id, [...(result.get(row.item_id) ?? []), row.series_id]);
  return result;
}

function tagsByItem(itemIds: number[]): Map<number, Array<{ id: number; name: string }>> {
  const result = new Map<number, Array<{ id: number; name: string }>>();
  if (itemIds.length === 0) return result;
  const placeholders = itemIds.map(() => "?").join(", ");
  const rows = database.prepare(`
    SELECT it.item_id, t.id, t.name FROM effective_item_tags it
    JOIN tags t ON t.id = it.tag_id
    WHERE it.item_id IN (${placeholders}) ORDER BY t.name COLLATE NOCASE
  `).all(...itemIds) as unknown as TagRow[];
  for (const row of rows) {
    const tags = result.get(row.item_id) ?? [];
    tags.push({ id: row.id, name: row.name });
    result.set(row.item_id, tags);
  }
  return result;
}

function creditsByItem(itemIds: number[]) {
  const result = new Map<number, { cast: Array<{ id: number; name: string }>; artists: Array<{ id: number; name: string }> }>();
  if (!itemIds.length) return result;
  const rows = database.prepare(`
    SELECT ip.item_id, ip.role, p.id, p.name FROM effective_item_people ip JOIN people p ON p.id = ip.person_id
    WHERE ip.item_id IN (${itemIds.map(() => "?").join(",")}) ORDER BY p.name COLLATE NOCASE
  `).all(...itemIds) as unknown as Array<{ item_id: number; role: "cast" | "artist"; id: number; name: string }>;
  for (const row of rows) {
    const credits = result.get(row.item_id) ?? { cast: [], artists: [] };
    credits[row.role === "cast" ? "cast" : "artists"].push({ id: row.id, name: row.name });
    result.set(row.item_id, credits);
  }
  return result;
}

export async function registerMediaRoutes(
  app: FastifyInstance,
  options: { revealPath?: (itemPath: string) => Promise<void>; openVideo?: (itemPath: string) => Promise<void> } = {},
) {
  app.get("/api/items/formats", async (request) => {
    const { type } = z.object({ type: z.enum(["comic", "video", "story"]).optional() }).parse(request.query);
    return database.prepare(`
      SELECT file_extension AS extension, COUNT(*) AS item_count FROM media_items
      WHERE available = 1 ${type ? "AND media_type = ?" : ""}
      GROUP BY file_extension ORDER BY file_extension
    `).all(...(type ? [type] : []));
  });

  app.get("/api/items", async (request) => {
    const input = listInput.parse(request.query);
    if (!(request.query as Record<string, unknown>).sort && (input.q || input.filename || input.path)) input.sort = "relevance";
    const conditions = ["m.available = 1"];
    const values: Array<string | number> = [];
    let indexedSearch = false;

    if (input.type) {
      conditions.push("m.media_type = ?");
      values.push(input.type);
    }
    if (input.sourceType) { conditions.push("m.source_id IN (SELECT id FROM sources WHERE media_type = ?)"); values.push(input.sourceType); }
    if (input.favorite) conditions.push("m.favorite = 1");
    if (input.source) {
      conditions.push("m.source_id = ?");
      values.push(input.source);
    }
    if (input.filename) {
      const filters = input.searchMode === "english" ? englishSearchFilters(input.filename, ["filename"])
        : [substringFilter(input.filename, ["filename"])];
      for (const filter of filters) {
        indexedSearch ||= filter.indexed;
        conditions.push(filter.sql);
        values.push(...filter.values);
      }
    }
    if (input.path) {
      const filter = substringFilter(input.path, ["relative_path"]);
      indexedSearch ||= filter.indexed;
      conditions.push(filter.sql);
      values.push(...filter.values);
    }
    if (input.extension) {
      conditions.push("m.file_extension = ?");
      values.push(input.extension === "folder" ? "" : input.extension);
    }
    if (input.minMb !== undefined) {
      conditions.push("m.size_bytes >= ?");
      values.push(Math.round(input.minMb * 1024 * 1024));
    }
    if (input.maxMb !== undefined) {
      conditions.push("m.size_bytes <= ?");
      values.push(Math.round(input.maxMb * 1024 * 1024));
    }
    if (input.modifiedFrom) {
      conditions.push("m.modified_at_ms >= ?");
      values.push(new Date(`${input.modifiedFrom}T00:00:00`).getTime());
    }
    if (input.modifiedTo) {
      conditions.push("m.modified_at_ms <= ?");
      values.push(new Date(`${input.modifiedTo}T23:59:59.999`).getTime());
    }
    if (input.series === "ungrouped") {
      conditions.push("NOT EXISTS (SELECT 1 FROM series_items si WHERE si.item_id = m.id)");
    } else if (input.series === "grouped") {
      conditions.push("EXISTS (SELECT 1 FROM series_items si WHERE si.item_id = m.id)");
    } else if (input.series) {
      conditions.push("EXISTS (SELECT 1 FROM series_items si WHERE si.item_id = m.id AND si.series_id = ?)");
      values.push(Number(input.series));
    }
    if (input.circle) {
      conditions.push("EXISTS (SELECT 1 FROM series_items si JOIN circle_series cs ON cs.series_id = si.series_id WHERE si.item_id = m.id AND cs.circle_id = ?)");
      values.push(input.circle);
    }
    if (input.uncategorized) conditions.push("NOT EXISTS (SELECT 1 FROM effective_item_categories ic WHERE ic.item_id = m.id)");
    if (input.untagged) conditions.push("NOT EXISTS (SELECT 1 FROM effective_item_tags it WHERE it.item_id = m.id)");
    for (const categoryId of new Set([
      ...(input.category ? [input.category] : []),
      ...(input.categories?.split(",").map(Number) ?? []),
    ])) {
      conditions.push("EXISTS (SELECT 1 FROM effective_item_categories ic WHERE ic.item_id = m.id AND ic.category_id = ?)");
      values.push(categoryId);
    }
    const searchGroups = input.q ? expandSearchTerms(database, input.q, input.searchMode === "fuzzy") : [];
    if (input.q) {
      const filters = input.searchMode === "english" ? englishSearchFilters(input.q)
        : gallerySearchFilters(input.q, input.searchMode === "fuzzy", searchGroups);
      for (const filter of filters) {
        indexedSearch ||= filter.indexed;
        conditions.push(filter.sql);
        values.push(...filter.values);
      }
    }
    for (const tagId of new Set(input.tags?.split(",").map(Number) ?? [])) {
      conditions.push("EXISTS (SELECT 1 FROM effective_item_tags it WHERE it.item_id = m.id AND it.tag_id = ?)");
      values.push(tagId);
    }
    for (const personId of new Set(input.people?.split(",").map(Number) ?? [])) {
      conditions.push("EXISTS (SELECT 1 FROM effective_item_people ip WHERE ip.item_id = m.id AND ip.person_id = ?)");
      values.push(personId);
    }
    for (const personId of new Set(input.cast?.split(",").map(Number) ?? [])) {
      conditions.push("EXISTS (SELECT 1 FROM effective_item_people ip WHERE ip.item_id = m.id AND ip.role = 'cast' AND ip.person_id = ?)");
      values.push(personId);
    }
    for (const personId of new Set(input.artists?.split(",").map(Number) ?? [])) {
      conditions.push("EXISTS (SELECT 1 FROM effective_item_people ip WHERE ip.item_id = m.id AND ip.role = 'artist' AND ip.person_id = ?)");
      values.push(personId);
    }

    let folders: ReturnType<typeof browseFolders> | undefined;
    if (input.sort === "folders") {
      const paths = database.prepare(`SELECT m.source_id, s.name AS source_name, m.relative_path
        FROM media_items m JOIN sources s ON s.id = m.source_id WHERE ${conditions.join(" AND ")}`).all(...values) as Array<{ source_id: number; source_name: string; relative_path: string }>;
      folders = browseFolders(paths, input.source, input.folder);
      if (input.source === undefined) conditions.push("0");
      else {
        const normalized = "replace(m.relative_path, char(92), '/')";
        const prefix = input.folder ? `${input.folder}/` : "";
        conditions.push(`substr(${normalized}, 1, ?) = ? AND instr(substr(${normalized}, ?), '/') = 0`);
        values.push(prefix.length, prefix, prefix.length + 1);
      }
    }
    const where = conditions.join(" AND ");
    const wordMatch = rankedMatch(searchGroups);
    const match = wordMatch && input.searchMode === "english" ? `{title filename} : (${wordMatch})` : wordMatch;
    const normalizedMatch = input.searchMode === "english" ? englishMatch(input.q || input.filename || "", input.q ? ["title", "filename"] : ["filename"]) : "";
    const relevanceQuery = input.q || input.filename || input.path || "";
    const relevance = input.sort === "relevance" && Boolean(relevanceQuery.trim());
    const rankValues = relevance ? [relevanceQuery, ...(match ? [match] : []), ...(normalizedMatch ? [normalizedMatch] : [])] : [];
    const rankSql = [
      ...(match ? ["COALESCE((SELECT bm25(media_words, 8.0, 3.0, 1.0) FROM media_words WHERE rowid = m.id AND media_words MATCH ?), 0)"] : []),
      ...(normalizedMatch ? ["COALESCE((SELECT bm25(media_english, 8.0, 3.0) FROM media_english WHERE rowid = m.id AND media_english MATCH ?), 0)"] : []),
    ].join(" + ") || "CAST(0 AS REAL)";
    const exactRank = `media_search_relevance(?, ${input.q ? "m.title" : "''"}, ${input.q || input.filename ? "m.filename" : "''"}, ${input.q || input.path ? "m.relative_path" : "''"})`;
    const order = relevance ? `${exactRank} ASC, (${rankSql}) ASC, m.title COLLATE NOCASE ASC, m.id ASC`
      : input.sort === "recent" ? "m.modified_at_ms DESC, m.id DESC"
      : input.sort === "oldest" ? "m.modified_at_ms ASC, m.id ASC"
        : input.sort === "size" ? "m.size_bytes DESC, m.id DESC"
          : input.sort === "smallest" ? "m.size_bytes ASC, m.id ASC"
            : input.sort === "filename" ? "m.filename COLLATE NOCASE ASC, m.id ASC"
              : "m.title COLLATE NOCASE ASC, m.id ASC";
    // Indexed searches must start with candidate rowids. Otherwise SQLite can
    // choose the title/source index and visit the whole library to satisfy sort.
    // NOT INDEXED still permits INTEGER PRIMARY KEY lookups for the IN set.
    const total = database.prepare(`
      SELECT COUNT(*) AS count FROM media_items m ${indexedSearch ? "NOT INDEXED" : ""} WHERE ${where}
    `).get(...values) as { count: number };
    let cards: Array<{ kind: "item" | "series"; id: number }> | undefined;
    let cardTotal = total.count;
    let rows: Array<{ id: number } & Record<string, unknown>>;
    if (input.groupSeries) {
      // Group the complete filtered result before taking a page. Collapsing only
      // 48 fetched files repeats collections across pages and leaves sparse grids.
      const members = `card_members AS (
        SELECT 'item' AS kind, m.id AS card_id, m.id AS item_id FROM matching m
          WHERE NOT EXISTS (SELECT 1 FROM series_items si WHERE si.item_id = m.id)
        UNION ALL
        SELECT 'series' AS kind, si.series_id AS card_id, m.id AS item_id
          FROM matching m JOIN series_items si ON si.item_id = m.id
      )`;
      cardTotal = (database.prepare(`WITH matching AS (
        SELECT m.id FROM media_items m ${indexedSearch ? "NOT INDEXED" : ""} WHERE ${where}
      ), ${members} SELECT COUNT(*) AS count FROM (
        SELECT kind, card_id FROM card_members GROUP BY kind, card_id
      )`).get(...values) as { count: number }).count;
      cards = database.prepare(`WITH matching AS (
        SELECT m.id, ROW_NUMBER() OVER (ORDER BY ${order}) AS position
          FROM media_items m ${indexedSearch ? "NOT INDEXED" : ""} WHERE ${where}
      ), ${members}
      SELECT cm.kind, cm.card_id AS id FROM card_members cm JOIN matching m ON m.id = cm.item_id
        GROUP BY cm.kind, cm.card_id ORDER BY MIN(m.position), cm.kind, cm.card_id
        LIMIT 48 OFFSET ?`).all(...rankValues, ...values, input.page * 48) as typeof cards;
      const ids = cards!.filter((card) => card.kind === "item").map((card) => card.id);
      const byId = new Map((database.prepare(`${itemSelect()} WHERE m.id IN (SELECT value FROM json_each(?))`)
        .all(JSON.stringify(ids)) as Array<{ id: number } & Record<string, unknown>>).map((row) => [row.id, row]));
      rows = ids.map((id) => byId.get(id)!);
    } else {
      rows = database.prepare(`
        ${itemSelect(indexedSearch)} WHERE ${where} ORDER BY ${order} LIMIT 48 OFFSET ?
      `).all(...values, ...rankValues, input.page * 48) as Array<{ id: number } & Record<string, unknown>>;
    }
    const tags = tagsByItem(rows.map((row) => row.id));
    const categories = categoriesByItem(rows.map((row) => row.id));
    const memberships = seriesByItem(rows.map((row) => row.id));
    const credits = creditsByItem(rows.map((row) => row.id));
    const items = rows.map((row) => ({ ...row, series_ids: memberships.get(row.id) ?? [], categories: categories.get(row.id) ?? [], tags: tags.get(row.id) ?? [],
      cast: credits.get(row.id)?.cast ?? [], artists: credits.get(row.id)?.artists ?? [] }));
    return { items, folders, total: cardTotal, page: input.page, pageSize: 48, ...(cards ? { cards, mediaTotal: total.count } : {}) };
  });

  app.get("/api/items/:id/similar", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const target = database.prepare("SELECT id FROM media_items WHERE id = ? AND media_type = 'video' AND available = 1").get(id);
    if (!target) return reply.code(404).send({ message: "Video not found." });
    return database.prepare(`
      SELECT m.id, m.title, m.filename, m.duration_seconds, m.modified_at_ms, s.name AS source_name,
        (CASE WHEN m.source_id = target.source_id THEN 1 ELSE 0 END
          + 12 * (SELECT COUNT(*) FROM series_items candidate
            WHERE candidate.item_id = m.id AND candidate.series_id IN (SELECT series_id FROM series_items WHERE item_id = target.id))
          + 5 * (SELECT COUNT(*) FROM effective_item_categories candidate
            WHERE candidate.item_id = m.id AND candidate.category_id IN (SELECT category_id FROM effective_item_categories WHERE item_id = target.id))
          + 4 * (SELECT COUNT(*) FROM effective_item_tags candidate
            WHERE candidate.item_id = m.id AND candidate.tag_id IN (SELECT tag_id FROM effective_item_tags WHERE item_id = target.id))
          + 3 * (SELECT COUNT(*) FROM effective_item_people candidate
            WHERE candidate.item_id = m.id AND (candidate.person_id, candidate.role) IN
              (SELECT person_id, role FROM effective_item_people WHERE item_id = target.id))) AS similarity_score
      FROM media_items m
      JOIN sources s ON s.id = m.source_id
      JOIN media_items target ON target.id = ?
      WHERE m.available = 1 AND m.media_type = 'video' AND m.id <> target.id
      ORDER BY similarity_score DESC, m.modified_at_ms DESC, m.title COLLATE NOCASE
      LIMIT 24
    `).all(id);
  });

  app.get("/api/items/:id", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const item = database.prepare(`${itemSelect()} WHERE m.id = ? AND m.available = 1`).get(id);
    if (!item) return reply.code(404).send({ message: "Media item not found." });
    const categoryIds = database.prepare("SELECT category_id FROM effective_item_categories WHERE item_id = ?").all(id)
      .map((row) => (row as { category_id: number }).category_id);
    const tags = tagsByItem([id]).get(id) ?? [];
    const categories = categoriesByItem([id]).get(id) ?? [];
    const seriesIds = seriesByItem([id]).get(id) ?? [];
    const credits = creditsByItem([id]).get(id);
    return { ...item, source_attributes: sourceAttributes(Number(item.source_id)), series_ids: seriesIds, categories, category_ids: categoryIds, tags, cast: credits?.cast ?? [], artists: credits?.artists ?? [] };
  });

  const renameItem = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idInput.parse(request.params);
    const { title } = z.object({ title: z.string().trim().min(1).max(255) }).parse(request.body);

    const item = mediaRow(id);
    if (!item) return reply.code(404).send({ message: "Media item not found." });
    if (getScanProgress(item.source_id)) {
      return reply.code(409).send({ message: "Wait for this source's scan to finish before renaming media." });
    }
    if (item.relative_path === ".") {
      return reply.code(400).send({ message: "The library root folder cannot be renamed here. Rename the source instead." });
    }

    const root = await realpath(item.root_path);
    const currentPath = await resolveItemPath(item);
    const currentStat = await stat(currentPath);
    const currentName = path.basename(currentPath);
    const extension = currentStat.isDirectory() ? "" : path.extname(currentName);
    const fileName = `${title}${extension}`;
    const invalidMessage = invalidFileNameMessage(fileName);
    if (invalidMessage) return reply.code(400).send({ message: invalidMessage });
    if (fileName.length > 255 || (Buffer.byteLength(fileName) > 255 && process.platform !== "win32")) {
      return reply.code(400).send({ message: "The title is too long for this file or folder name." });
    }

    const nextPath = path.join(path.dirname(currentPath), fileName);
    if (!withinRoot(root, nextPath)) return reply.code(400).send({ message: "The renamed item must stay inside its library source." });
    const sameWindowsPath = process.platform === "win32" && currentPath.toLocaleLowerCase() === nextPath.toLocaleLowerCase();
    if (fileName !== currentName && !sameWindowsPath) {
      try {
        await lstat(nextPath);
        return reply.code(409).send({ message: "A file or folder with that name already exists." });
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
    }

    const relativePath = path.relative(root, nextPath);
    const changedPath = fileName !== currentName;
    // Resolve stored paths rather than following symlinks when updating children.
    const oldStoredPath = path.resolve(root, item.relative_path);
    const descendants = currentStat.isDirectory()
      ? (database.prepare("SELECT id, relative_path FROM media_items WHERE source_id = ? AND id <> ?").all(item.source_id, id) as Array<{ id: number; relative_path: string }>)
        .map((child) => ({ ...child, suffix: path.relative(oldStoredPath, path.resolve(root, child.relative_path)) }))
        .filter((child) => child.suffix !== "" && withinRoot(oldStoredPath, path.resolve(root, child.relative_path)))
      : [];
    if (changedPath) await renamePath(currentPath, nextPath);
    try {
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = database.prepare(`
          UPDATE media_items SET title = ?, filename = ?, file_extension = ?, relative_path = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND available = 1 AND relative_path = ?
        `).run(title, fileName, extension.slice(1).toLowerCase(), relativePath, id, item.relative_path);
        if (!result.changes) throw new Error("The media item changed while renaming. Please reload and try again.");
        const updateChild = database.prepare("UPDATE media_items SET relative_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND relative_path = ?");
        for (const child of descendants) updateChild.run(path.join(relativePath, child.suffix), child.id, child.relative_path);
        database.exec("COMMIT");
      } catch (error) { database.exec("ROLLBACK"); throw error; }
    } catch (error) {
      if (changedPath) await renamePath(nextPath, currentPath);
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        return reply.code(409).send({ message: "That renamed path is already indexed." });
      }
      throw error;
    }

    return { id, title, filename: fileName, file_extension: extension.slice(1).toLowerCase(), relative_path: relativePath };
  };
  app.patch("/api/items/:id", renameItem);
  app.post("/api/items/:id/rename", renameItem);

  app.put("/api/items/:id/favorite", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const { favorite } = z.object({ favorite: z.boolean() }).parse(request.body);
    const changed = database.prepare("UPDATE media_items SET favorite = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND available = 1")
      .run(favorite ? 1 : 0, id).changes;
    if (!changed) return reply.code(404).send({ message: "Media item not found." });
    return { id, favorite: favorite ? 1 : 0 };
  });

  app.get("/api/items/:id/file", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const item = mediaRow(id);
    if (!item) return reply.code(404).send({ message: "Media item not found." });
    const filePath = await resolveItemPath(item);
    return sendLocalFile(reply, filePath, request.headers.range);
  });

  app.post("/api/items/:id/open", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && !["http://127.0.0.1:5173", "http://localhost:5173", `http://${request.headers.host}`].includes(origin)) {
      return reply.code(403).send({ message: "Open videos from the Vaultly application." });
    }
    const { id } = idInput.parse(request.params);
    const item = mediaRow(id);
    if (!item || item.media_type !== "video") return reply.code(404).send({ message: "Video not found." });
    const filePath = await resolveItemPath(item);
    if (!(await stat(filePath)).isFile() || !isVideoFile(filePath)) {
      return reply.code(400).send({ message: "Only supported video files can be opened in the default player." });
    }
    if (!options.openVideo && process.platform !== "win32") {
      return reply.code(501).send({ message: "Opening the default player requires Windows or the Vaultly desktop app." });
    }
    try { await (options.openVideo ?? openVideoInDefaultPlayer)(filePath); }
    catch (error) {
      app.log.warn({ err: error, id }, "Could not open the default video player");
      return reply.code(502).send({ message: "Could not open the default player. Check that a video player is assigned to this file format in your system settings." });
    }
    return reply.code(204).send();
  });

  app.post("/api/items/:id/reveal", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const item = mediaRow(id);
    if (!item) return reply.code(404).send({ message: "Media item not found." });
    const itemPath = await resolveItemPath(item);
    if (options.revealPath) {
      await options.revealPath(itemPath);
      return reply.code(204).send();
    }
    if (process.platform !== "win32") return reply.code(501).send({ message: "Opening the containing folder is available in the desktop app on this platform." });
    const itemStat = await stat(itemPath);
    const explorer = spawn("explorer.exe", itemStat.isDirectory() ? [itemPath] : ["/select,", itemPath], {
      detached: true, stdio: "ignore", windowsHide: true,
    });
    explorer.on("error", () => undefined);
    explorer.unref();
    return reply.code(204).send();
  });

  app.get("/api/items/:id/video-metadata", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const item = mediaRow(id);
    if (!item || item.media_type !== "video") return reply.code(404).send({ message: "Video not found." });
    const stored = database.prepare("SELECT duration_seconds FROM media_items WHERE id = ?")
      .get(id) as { duration_seconds: number | null } | undefined;
    if (stored?.duration_seconds) return { duration_seconds: stored.duration_seconds };
    const duration = await getVideoDuration(await resolveItemPath(item));
    if (duration) database.prepare("UPDATE media_items SET duration_seconds = ? WHERE id = ?").run(duration, id);
    return { duration_seconds: duration };
  });

  app.get("/api/items/:id/tracks", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const item = mediaRow(id);
    if (!item || item.media_type !== "video") return reply.code(404).send();
    return getVideoTracks(await resolveItemPath(item));
  });
  app.get("/api/items/:id/audio/:page", async (request, reply) => {
    const { id, page } = pageInput.parse(request.params);
    const item = mediaRow(id);
    if (!item || item.media_type !== "video") return reply.code(404).send();
    const filename = await resolveItemPath(item);
    const track = (await getVideoTracks(filename)).audio.find((track) => track.index === page);
    if (!track) return reply.code(404).send({ message: "Audio track not found." });
    try { return sendLocalFile(reply, await getAudioTrack(id, filename, track), request.headers.range); }
    catch { return reply.code(422).send({ message: "Could not prepare this audio track." }); }
  });
  app.get("/api/items/:id/embedded-subtitles/:page", async (request, reply) => {
    const { id, page } = pageInput.parse(request.params);
    const item = mediaRow(id);
    if (!item || item.media_type !== "video") return reply.code(404).send();
    const filename = await resolveItemPath(item);
    const track = (await getVideoTracks(filename)).subtitles.find((track) => track.index === page);
    if (!track) return reply.code(404).send();
    try { return reply.type("text/vtt; charset=utf-8").send(await getEmbeddedSubtitle(filename, track)); }
    catch { return reply.code(422).send({ message: "Could not read embedded subtitles." }); }
  });

  app.get("/api/items/:id/subtitles", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const item = mediaRow(id);
    if (!item || item.media_type !== "video") return reply.code(404).send();
    return { subtitles: await videoSubtitles(await resolveItemPath(item)) };
  });
  app.get("/api/items/:id/subtitles/:page", async (request, reply) => {
    const { id, page } = pageInput.parse(request.params);
    const item = mediaRow(id);
    if (!item || item.media_type !== "video") return reply.code(404).send();
    const video = await resolveItemPath(item);
    const names = await videoSubtitles(video);
    if (!names[page]) return reply.code(404).send();
    const filename = await realpath(path.join(path.dirname(video), names[page]));
    if (!withinRoot(await realpath(item.root_path), filename)) return reply.code(403).send();
    return reply.type("text/vtt; charset=utf-8").send(await readSubtitle(filename));
  });

  app.get("/api/items/:id/ebook", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const item = mediaRow(id);
    if (!item || item.media_type !== "story") return reply.code(404).send({ message: "Book not found." });
    const location = await resolveItemPath(item);
    const extension = path.extname(location).toLowerCase();
    try {
      if (extension === ".epub") return { chapters: epubChapters(await openBookArchive(location)) };
      if (![".txt", ".fb2", ".html", ".htm"].includes(extension)) return reply.code(415).send({ message: "Use the associated desktop app for this book format." });
      if ((await stat(location)).size > 32 * 1024 * 1024) return reply.code(413).send({ message: "Book text is too large for the built-in reader." });
      const text = await readFile(location, "utf8");
      return { chapters: [extension === ".txt" ? { text } : { html: text }] };
    } catch (error) { return reply.code(422).send({ message: error instanceof Error ? error.message : "Could not read book archive." }); }
  });

  app.get("/api/items/:id/ebook-image", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const { path: name } = z.object({ path: z.string().max(2000) }).parse(request.query);
    const item = mediaRow(id);
    if (!item || item.media_type !== "story" || !imageExtensions.has(path.extname(name).toLowerCase())) return reply.code(404).send({ message: "Book image not found." });
    const location = await resolveItemPath(item);
    if (path.extname(location).toLowerCase() !== ".epub") return reply.code(404).send();
    try { return reply.type(mimeTypes[path.extname(name).toLowerCase()] ?? "application/octet-stream").send((await openBookArchive(location)).read(name)); }
    catch { return reply.code(404).send({ message: "Book image unavailable." }); }
  });

  app.post("/api/items/:id/open-document", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && !["http://127.0.0.1:5173", "http://localhost:5173", `http://${request.headers.host}`].includes(origin)) return reply.code(403).send();
    const { id } = idInput.parse(request.params);
    const item = mediaRow(id);
    if (!item) return reply.code(404).send({ message: "Book not found." });
    const location = await resolveItemPath(item);
    if (!ebookExtensions.has(path.extname(location).toLowerCase()) && !pictureExtensions.has(path.extname(location).toLowerCase()) && ![".cbz", ".zip", ".cbr", ".cb7", ".cbt"].includes(path.extname(location).toLowerCase())) return reply.code(400).send({ message: "Unsupported document format." });
    if (!options.openVideo && process.platform !== "win32") return reply.code(501).send({ message: "Opening books requires the desktop app." });
    try { await (options.openVideo ?? openVideoInDefaultPlayer)(location); }
    catch { return reply.code(502).send({ message: "Assign a desktop reader to this file format in system settings." }); }
    return reply.code(204).send();
  });

  app.put("/api/items/:id/cover", { bodyLimit: 7 * 1024 * 1024 }, async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const item = mediaRow(id);
    if (!item) return reply.code(404).send({ message: "Media not found." });
    const { image } = z.object({ image: z.string().max(7 * 1024 * 1024) }).parse(request.body);
    try {
      const cover = await normalizeVideoCover(Buffer.from(image, "base64"));
      const signature = `manual:${Date.now()}`;
      database.prepare("UPDATE media_items SET cover_data = ?, cover_width = ?, cover_height = ?, cover_signature = ? WHERE id = ?")
        .run(cover.data, cover.width, cover.height, signature, id);
      return { cover_width: cover.width, cover_height: cover.height, custom_cover: 1, has_cover: 1, cover_signature: signature };
    } catch { return reply.code(400).send({ message: "Choose a valid PNG, JPEG, WebP or AVIF image smaller than 5 MB." }); }
  });
  app.delete("/api/items/:id/cover", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const item = mediaRow(id);
    if (!item) return reply.code(404).send();
    const mediaPath = await resolveItemPath(item);
    const cover = await findVideoCover(item.root_path, mediaPath, undefined, (await stat(mediaPath)).isDirectory());
    database.prepare("UPDATE media_items SET cover_data = NULL, cover_path = ?, cover_width = ?, cover_height = ?, cover_signature = ? WHERE id = ?")
      .run(cover?.path ?? null, cover?.width ?? null, cover?.height ?? null, cover?.signature ?? null, id);
    return { cover_width: cover?.width ?? null, cover_height: cover?.height ?? null, custom_cover: 0, has_cover: cover ? 1 : 0, cover_signature: cover?.signature ?? null };
  });

  app.get("/api/items/:id/thumbnail", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const item = mediaRow(id);
    if (item) {
      const cover = database.prepare("SELECT cover_data, cover_path FROM media_items WHERE id = ?").get(id) as { cover_data: Uint8Array | null; cover_path: string | null };
      if (cover.cover_data) return reply.type("image/png").header("Cache-Control", "private, no-cache").send(Buffer.from(cover.cover_data));
      if (cover.cover_path) {
        try {
          const root = await realpath(item.root_path);
          const filename = await realpath(path.resolve(root, cover.cover_path));
          if (withinRoot(root, filename) && imageExtensions.has(path.extname(filename).toLowerCase())) return sendLocalFile(reply, filename, undefined);
        } catch { /* Use the normal thumbnail when a sidecar cover disappeared. */ }
      }
    }
    if (item?.media_type === "comic" && path.extname(item.relative_path).toLowerCase() !== ".pdf") {
      const pages = await comicPages(item);
      if (pages.length) {
        const location = await resolveItemPath(item);
        if ((await stat(location)).isDirectory()) {
          const cover = await realpath(path.join(location, pages[0]));
          if (!withinRoot(await realpath(item.root_path), cover)) return reply.code(403).send();
          return sendLocalFile(reply, cover, undefined);
        }
        if (imageExtensions.has(path.extname(location).toLowerCase())) return sendLocalFile(reply, location, undefined);
        return reply.type(mimeTypes[path.extname(pages[0]).toLowerCase()] ?? "application/octet-stream").send((await openBookArchive(location)).read(pages[0]));
      }
    }
    if (!item || (item.media_type !== "video" && item.media_type !== "story" && !(item.media_type === "comic" && path.extname(item.relative_path).toLowerCase() === ".pdf"))) {
      return reply.code(404).send({ message: "Thumbnail not found." });
    }
    const filePath = await resolveItemPath(item);
    try {
      if (item.media_type !== "video") {
        if (path.extname(filePath).toLowerCase() !== ".pdf") return reply.code(404).send({ message: "Book thumbnail unavailable." });
        const generation = getPdfThumbnail(id, filePath, item.size_bytes, item.modified_at_ms)
          .catch((error: unknown) => {
            app.log.warn({ err: error, id }, "Could not generate PDF thumbnail");
            return null;
          });
        const thumbnailPath = await Promise.race([
          generation,
          new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 75)),
        ]);
        if (thumbnailPath === undefined) {
          return reply.code(202).header("Cache-Control", "no-store").header("Retry-After", "3")
            .send({ message: "Thumbnail is being prepared." });
        }
        if (thumbnailPath === null) return reply.code(404).send({ message: "Thumbnail unavailable." });
        return sendLocalFile(reply, thumbnailPath, undefined);
      }
      const thumbnailPath = await getVideoThumbnail(id, filePath, item.size_bytes, item.modified_at_ms);
      return sendLocalFile(reply, thumbnailPath, undefined);
    } catch (error) {
      app.log.warn({ err: error, id }, "Could not generate media thumbnail");
      return reply.code(404).send({ message: "Thumbnail unavailable for this item." });
    }
  });

  app.get("/api/items/:id/pages", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const item = mediaRow(id);
    if (!item || item.media_type !== "comic") return reply.code(404).send({ message: "Comic not found." });
    const pages = await comicPages(item);
    return { pages, archive: pages.length === 0 };
  });

  app.get("/api/items/:id/pages/:page", async (request, reply) => {
    const { id, page } = pageInput.parse(request.params);
    const item = mediaRow(id);
    if (!item || item.media_type !== "comic") return reply.code(404).send({ message: "Comic not found." });
    const pages = await comicPages(item);
    const pageName = pages[page];
    if (!pageName) return reply.code(404).send({ message: "Page not found." });
    const directoryPath = await resolveItemPath(item);
    if ((await stat(directoryPath)).isFile()) {
      if (imageExtensions.has(path.extname(directoryPath).toLowerCase())) return sendLocalFile(reply, directoryPath, undefined);
      return reply.type(mimeTypes[path.extname(pageName).toLowerCase()] ?? "application/octet-stream").send((await openBookArchive(directoryPath)).read(pageName));
    }
    const pagePath = await realpath(path.join(directoryPath, pageName));
    if (!withinRoot(directoryPath, pagePath)) return reply.code(403).send({ message: "Page is outside this comic." });
    return sendLocalFile(reply, pagePath, undefined);
  });

  app.get("/api/categories", async () => {
    return withAttributePatterns("categories", database.prepare(`
      SELECT c.id, c.name, COUNT(m.id) AS item_count
      FROM categories c
      LEFT JOIN effective_item_categories ic ON ic.category_id = c.id
      LEFT JOIN media_items m ON m.id = ic.item_id AND m.available = 1
      GROUP BY c.id ORDER BY c.name COLLATE NOCASE
    `).all() as Array<{ id: number; name: string; item_count: number }>);
  });

  app.get("/api/categories/overview", async (request) => {
    const { type } = z.object({ type: z.enum(["comic", "video", "story"]).optional() }).parse(request.query);
    const typeClause = type ? "AND m.media_type = ?" : "";
    const values = type ? [type] : [];
    const categories = database.prepare(`
      SELECT c.id, c.name, COUNT(m.id) AS item_count
      FROM categories c
      LEFT JOIN effective_item_categories ic ON ic.category_id = c.id
      LEFT JOIN media_items m ON m.id = ic.item_id AND m.available = 1 ${typeClause}
      GROUP BY c.id HAVING COUNT(m.id) > 0 ORDER BY c.name COLLATE NOCASE
    `).all(...values);
    const uncategorized = database.prepare(`
      SELECT COUNT(*) AS item_count FROM media_items m
      WHERE m.available = 1 ${type ? "AND m.media_type = ?" : ""}
        AND NOT EXISTS (SELECT 1 FROM effective_item_categories ic WHERE ic.item_id = m.id)
    `).get(...values) as { item_count: number };
    return { categories, uncategorized_count: uncategorized.item_count };
  });

  app.get("/api/tags", async () => {
    return withAttributePatterns("tags", database.prepare(`
      SELECT t.id, t.name, COUNT(m.id) AS item_count
      FROM tags t
      LEFT JOIN effective_item_tags it ON it.tag_id = t.id
      LEFT JOIN media_items m ON m.id = it.item_id AND m.available = 1
      GROUP BY t.id ORDER BY t.name COLLATE NOCASE
    `).all() as Array<{ id: number; name: string; item_count: number }>);
  });

  app.post("/api/tags", async (request, reply) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(request.body);
    try {
      const result = database.prepare("INSERT INTO tags(name) VALUES (?)").run(name);
      return reply.code(201).send({ id: Number(result.lastInsertRowid), name, item_count: 0 });
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        return reply.code(409).send({ message: "That tag already exists." });
      }
      throw error;
    }
  });

  app.patch("/api/tags/:id", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(request.body);
    try {
      const result = database.prepare("UPDATE tags SET name = ? WHERE id = ?").run(name, id);
      if (!result.changes) return reply.code(404).send({ message: "Tag not found." });
      return { id, name };
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        return reply.code(409).send({ message: "That tag already exists." });
      }
      throw error;
    }
  });

  app.delete("/api/tags/:id", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const result = database.prepare("DELETE FROM tags WHERE id = ?").run(id);
    if (!result.changes) return reply.code(404).send({ message: "Tag not found." });
    return reply.code(204).send();
  });

  app.put("/api/items/:id/tags", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const { tagIds } = z.object({ tagIds: z.array(z.number().int().positive()).max(100) }).parse(request.body);
    if (!mediaRow(id)) return reply.code(404).send({ message: "Media item not found." });
    const uniqueIds = [...new Set(tagIds)];
    for (const tagId of uniqueIds) {
      if (!database.prepare("SELECT id FROM tags WHERE id = ?").get(tagId)) {
        return reply.code(400).send({ message: `Tag ${tagId} does not exist.` });
      }
    }
    database.exec("BEGIN IMMEDIATE");
    try {
      const assignments = itemAssignmentIds("tags", id, uniqueIds);
      database.prepare("DELETE FROM item_tags WHERE item_id = ?").run(id);
      const insert = database.prepare("INSERT INTO item_tags(item_id, tag_id) VALUES (?, ?)");
      for (const tagId of assignments) insert.run(id, tagId);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return { id, tags: tagsByItem([id]).get(id) ?? [] };
  });

  app.post("/api/categories", async (request, reply) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(request.body);
    try {
      const result = database.prepare("INSERT INTO categories(name) VALUES (?)").run(name);
      return reply.code(201).send({ id: Number(result.lastInsertRowid), name, item_count: 0 });
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        return reply.code(409).send({ message: "That category already exists." });
      }
      throw error;
    }
  });

  app.patch("/api/categories/:id", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(request.body);
    try {
      const result = database.prepare("UPDATE categories SET name = ? WHERE id = ?").run(name, id);
      if (!result.changes) return reply.code(404).send({ message: "Category not found." });
      return { id, name };
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        return reply.code(409).send({ message: "That category already exists." });
      }
      throw error;
    }
  });

  app.delete("/api/categories/:id", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const result = database.prepare("DELETE FROM categories WHERE id = ?").run(id);
    if (!result.changes) return reply.code(404).send({ message: "Category not found." });
    return reply.code(204).send();
  });

  app.put("/api/items/:id/categories", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const { categoryIds } = z.object({ categoryIds: z.array(z.number().int().positive()).max(100) }).parse(request.body);
    if (!mediaRow(id)) return reply.code(404).send({ message: "Media item not found." });
    const uniqueIds = [...new Set(categoryIds)];
    for (const categoryId of uniqueIds) {
      if (!database.prepare("SELECT id FROM categories WHERE id = ?").get(categoryId)) {
        return reply.code(400).send({ message: `Category ${categoryId} does not exist.` });
      }
    }
    database.exec("BEGIN IMMEDIATE");
    try {
      const assignments = itemAssignmentIds("categories", id, uniqueIds);
      database.prepare("DELETE FROM item_categories WHERE item_id = ?").run(id);
      const insert = database.prepare("INSERT INTO item_categories(item_id, category_id) VALUES (?, ?)");
      for (const categoryId of assignments) insert.run(id, categoryId);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return { id, category_ids: (database.prepare("SELECT category_id FROM effective_item_categories WHERE item_id = ?").all(id) as Array<{ category_id: number }>).map((row) => row.category_id) };
  });
}
