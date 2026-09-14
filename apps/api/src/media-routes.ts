import type { FastifyInstance, FastifyReply } from "fastify";
import { createReadStream } from "node:fs";
import { opendir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { database } from "./database.js";
import { getPdfThumbnail, getVideoThumbnail } from "./thumbnails.js";

const idInput = z.object({ id: z.coerce.number().int().positive() });
const pageInput = z.object({
  id: z.coerce.number().int().positive(),
  page: z.coerce.number().int().nonnegative(),
});
const listInput = z.object({
  type: z.enum(["comic", "video", "story"]).optional(),
  q: z.string().trim().max(200).optional(),
  category: z.coerce.number().int().positive().optional(),
  sort: z.enum(["title", "recent", "size"]).default("title"),
  page: z.coerce.number().int().nonnegative().default(0),
});

interface MediaPathRow {
  id: number;
  media_type: "comic" | "video" | "story";
  title: string;
  root_path: string;
  relative_path: string;
  file_count: number;
  size_bytes: number;
  modified_at_ms: number;
}

const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);
const mimeTypes: Record<string, string> = {
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".mkv": "video/x-matroska",
  ".webm": "video/webm", ".avi": "video/x-msvideo", ".mov": "video/quicktime",
  ".wmv": "video/x-ms-wmv", ".flv": "video/x-flv", ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg", ".pdf": "application/pdf", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".gif": "image/gif", ".avif": "image/avif", ".cbz": "application/zip",
  ".zip": "application/zip",
};

function mediaRow(id: number): MediaPathRow | undefined {
  return database.prepare(`
    SELECT m.id, m.media_type, m.title, m.relative_path, m.file_count,
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

async function comicPages(item: MediaPathRow): Promise<string[]> {
  const directoryPath = await resolveItemPath(item);
  if (!(await stat(directoryPath)).isDirectory()) return [];
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

const itemSelect = `
  SELECT m.id, m.source_id, m.media_type, m.title, m.relative_path, m.size_bytes,
    m.modified_at_ms, m.file_count, s.name AS source_name,
    COALESCE((SELECT group_concat(c.name, ', ')
      FROM item_categories ic JOIN categories c ON c.id = ic.category_id
      WHERE ic.item_id = m.id), '') AS category_names
  FROM media_items m JOIN sources s ON s.id = m.source_id
`;

export async function registerMediaRoutes(app: FastifyInstance) {
  app.get("/api/items", async (request) => {
    const input = listInput.parse(request.query);
    const conditions = ["m.available = 1"];
    const values: Array<string | number> = [];

    if (input.type) {
      conditions.push("m.media_type = ?");
      values.push(input.type);
    }
    if (input.category) {
      conditions.push("EXISTS (SELECT 1 FROM item_categories ic WHERE ic.item_id = m.id AND ic.category_id = ?)");
      values.push(input.category);
    }
    if (input.q) {
      for (const token of input.q.split(/\s+/).filter(Boolean)) {
        const pattern = `%${token.replace(/[\\%_]/g, "\\$&")}%`;
        conditions.push("(m.title LIKE ? ESCAPE '\\' OR m.relative_path LIKE ? ESCAPE '\\')");
        values.push(pattern, pattern);
      }
    }

    const where = conditions.join(" AND ");
    const order = input.sort === "recent"
      ? "m.modified_at_ms DESC, m.id DESC"
      : input.sort === "size"
        ? "m.size_bytes DESC, m.id DESC"
        : "m.title COLLATE NOCASE ASC, m.id ASC";
    const total = database.prepare(`
      SELECT COUNT(*) AS count FROM media_items m WHERE ${where}
    `).get(...values) as { count: number };
    const items = database.prepare(`
      ${itemSelect} WHERE ${where} ORDER BY ${order} LIMIT 48 OFFSET ?
    `).all(...values, input.page * 48);
    return { items, total: total.count, page: input.page, pageSize: 48 };
  });

  app.get("/api/items/:id", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const item = database.prepare(`${itemSelect} WHERE m.id = ? AND m.available = 1`).get(id);
    if (!item) return reply.code(404).send({ message: "Media item not found." });
    const categoryIds = database.prepare("SELECT category_id FROM item_categories WHERE item_id = ?").all(id)
      .map((row) => (row as { category_id: number }).category_id);
    return { ...item, category_ids: categoryIds };
  });

  app.patch("/api/items/:id", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const { title } = z.object({ title: z.string().trim().min(1).max(300) }).parse(request.body);
    const result = database.prepare("UPDATE media_items SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(title, id);
    if (!result.changes) return reply.code(404).send({ message: "Media item not found." });
    return { id, title };
  });

  app.get("/api/items/:id/file", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const item = mediaRow(id);
    if (!item) return reply.code(404).send({ message: "Media item not found." });
    const filePath = await resolveItemPath(item);
    return sendLocalFile(reply, filePath, request.headers.range);
  });

  app.get("/api/items/:id/thumbnail", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const item = mediaRow(id);
    if (!item || (item.media_type !== "video" && item.media_type !== "story")) {
      return reply.code(404).send({ message: "Thumbnail not found." });
    }
    const filePath = await resolveItemPath(item);
    try {
      if (item.media_type === "story") {
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
    const pagePath = await realpath(path.join(directoryPath, pageName));
    if (!withinRoot(directoryPath, pagePath)) return reply.code(403).send({ message: "Page is outside this comic." });
    return sendLocalFile(reply, pagePath, undefined);
  });

  app.get("/api/categories", async () => {
    return database.prepare(`
      SELECT c.id, c.name, COUNT(m.id) AS item_count
      FROM categories c
      LEFT JOIN item_categories ic ON ic.category_id = c.id
      LEFT JOIN media_items m ON m.id = ic.item_id AND m.available = 1
      GROUP BY c.id ORDER BY c.name COLLATE NOCASE
    `).all();
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
      database.prepare("DELETE FROM item_categories WHERE item_id = ?").run(id);
      const insert = database.prepare("INSERT INTO item_categories(item_id, category_id) VALUES (?, ?)");
      for (const categoryId of uniqueIds) insert.run(id, categoryId);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return { id, category_ids: uniqueIds };
  });
}
