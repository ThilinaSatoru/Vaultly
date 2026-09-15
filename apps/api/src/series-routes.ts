import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { database } from "./database.js";

const idInput = z.object({ id: z.coerce.number().int().positive() });
const idsInput = z.array(z.number().int().positive()).max(1000);
const detailsInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(3000).default(""),
  preferredType: z.enum(["video", "comic", "story", "mixed"]).optional(),
});

interface SeriesRow {
  id: number;
  title: string;
  description: string;
  item_count: number;
  video_count: number;
  comic_count: number;
  story_count: number;
  preferred_type: "video" | "comic" | "story" | "mixed";
  cover_item_id: number | null;
  cover_item_type: "comic" | "video" | "story" | null;
  cover_item_path: string | null;
  has_cover: number;
  favorite: number;
}

function seriesTags(ids: number[]) {
  const result = new Map<number, Array<{ id: number; name: string }>>();
  if (!ids.length) return result;
  const rows = database.prepare(`
    SELECT st.series_id, t.id, t.name FROM series_tags st
    JOIN tags t ON t.id = st.tag_id
    WHERE st.series_id IN (${ids.map(() => "?").join(",")})
    ORDER BY t.name COLLATE NOCASE
  `).all(...ids) as unknown as Array<{ series_id: number; id: number; name: string }>;
  for (const row of rows) {
    const tags = result.get(row.series_id) ?? [];
    tags.push({ id: row.id, name: row.name });
    result.set(row.series_id, tags);
  }
  return result;
}

function seriesCategories(ids: number[]) {
  const result = new Map<number, Array<{ id: number; name: string }>>();
  if (!ids.length) return result;
  const rows = database.prepare(`
    SELECT sc.series_id, c.id, c.name FROM series_categories sc
    JOIN categories c ON c.id = sc.category_id
    WHERE sc.series_id IN (${ids.map(() => "?").join(",")})
    ORDER BY c.name COLLATE NOCASE
  `).all(...ids) as unknown as Array<{ series_id: number; id: number; name: string }>;
  for (const row of rows) {
    const categories = result.get(row.series_id) ?? [];
    categories.push({ id: row.id, name: row.name });
    result.set(row.series_id, categories);
  }
  return result;
}

function getSeries(id: number) {
  const row = database.prepare(`
    SELECT s.id, s.title, s.description, s.preferred_type, s.favorite,
      (SELECT COUNT(*) FROM series_items si JOIN media_items m ON m.id = si.item_id
        WHERE si.series_id = s.id AND m.available = 1) AS item_count,
      (SELECT COUNT(*) FROM series_items si JOIN media_items m ON m.id = si.item_id
        WHERE si.series_id = s.id AND m.available = 1 AND m.media_type = 'video') AS video_count,
      (SELECT COUNT(*) FROM series_items si JOIN media_items m ON m.id = si.item_id
        WHERE si.series_id = s.id AND m.available = 1 AND m.media_type = 'comic') AS comic_count,
      (SELECT COUNT(*) FROM series_items si JOIN media_items m ON m.id = si.item_id
        WHERE si.series_id = s.id AND m.available = 1 AND m.media_type = 'story') AS story_count,
      (SELECT m.id FROM series_items si JOIN media_items m ON m.id = si.item_id
        WHERE si.series_id = s.id AND m.available = 1 ORDER BY si.position LIMIT 1) AS cover_item_id,
      (SELECT m.media_type FROM series_items si JOIN media_items m ON m.id = si.item_id
        WHERE si.series_id = s.id AND m.available = 1 ORDER BY si.position LIMIT 1) AS cover_item_type,
      (SELECT m.relative_path FROM series_items si JOIN media_items m ON m.id = si.item_id
        WHERE si.series_id = s.id AND m.available = 1 ORDER BY si.position LIMIT 1) AS cover_item_path,
      (s.cover_data IS NOT NULL) AS has_cover
    FROM series s WHERE s.id = ?
  `).get(id) as SeriesRow | undefined;
  if (!row) return undefined;
  return {
    ...row,
    tags: seriesTags([id]).get(id) ?? [],
    categories: seriesCategories([id]).get(id) ?? [],
  };
}

export async function registerSeriesRoutes(app: FastifyInstance) {
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: 5 * 1024 * 1024 }, (_request, body, done) => {
    done(null, body);
  });

  app.get("/api/series", async (request) => {
    const { q, tags, favorite } = z.object({
      q: z.string().trim().max(200).optional(),
      tags: z.string().regex(/^\d+(,\d+)*$/).max(500).optional(),
      favorite: z.enum(["1"]).optional(),
    }).parse(request.query);
    const conditions = ["1 = 1"];
    const values: Array<string | number> = [];
    if (q) {
      conditions.push("(s.title LIKE ? OR s.description LIKE ?)");
      values.push(`%${q}%`, `%${q}%`);
    }
    if (favorite) conditions.push("s.favorite = 1");
    for (const tagId of new Set(tags?.split(",").map(Number) ?? [])) {
      conditions.push("EXISTS (SELECT 1 FROM series_tags st WHERE st.series_id = s.id AND st.tag_id = ?)");
      values.push(tagId);
    }
    const rows = database.prepare(`
      SELECT s.id, s.title, s.description, s.preferred_type, s.favorite,
        (SELECT COUNT(*) FROM series_items si JOIN media_items m ON m.id = si.item_id
          WHERE si.series_id = s.id AND m.available = 1) AS item_count,
        (SELECT COUNT(*) FROM series_items si JOIN media_items m ON m.id = si.item_id
          WHERE si.series_id = s.id AND m.available = 1 AND m.media_type = 'video') AS video_count,
        (SELECT COUNT(*) FROM series_items si JOIN media_items m ON m.id = si.item_id
          WHERE si.series_id = s.id AND m.available = 1 AND m.media_type = 'comic') AS comic_count,
        (SELECT COUNT(*) FROM series_items si JOIN media_items m ON m.id = si.item_id
          WHERE si.series_id = s.id AND m.available = 1 AND m.media_type = 'story') AS story_count,
        (SELECT m.id FROM series_items si JOIN media_items m ON m.id = si.item_id
          WHERE si.series_id = s.id AND m.available = 1 ORDER BY si.position LIMIT 1) AS cover_item_id,
        (SELECT m.media_type FROM series_items si JOIN media_items m ON m.id = si.item_id
          WHERE si.series_id = s.id AND m.available = 1 ORDER BY si.position LIMIT 1) AS cover_item_type,
        (SELECT m.relative_path FROM series_items si JOIN media_items m ON m.id = si.item_id
          WHERE si.series_id = s.id AND m.available = 1 ORDER BY si.position LIMIT 1) AS cover_item_path,
        (s.cover_data IS NOT NULL) AS has_cover
      FROM series s WHERE ${conditions.join(" AND ")}
      ORDER BY s.title COLLATE NOCASE, s.id
    `).all(...values) as unknown as SeriesRow[];
    const tagsBySeries = seriesTags(rows.map((row) => row.id));
    const categoriesBySeries = seriesCategories(rows.map((row) => row.id));
    return rows.map((row) => ({ ...row, tags: tagsBySeries.get(row.id) ?? [], categories: categoriesBySeries.get(row.id) ?? [] }));
  });

  app.post("/api/series", async (request, reply) => {
    const { title, description, preferredType } = detailsInput.parse(request.body);
    const result = database.prepare("INSERT INTO series(title, description, preferred_type) VALUES (?, ?, ?)")
      .run(title, description, preferredType ?? "mixed");
    return reply.code(201).send(getSeries(Number(result.lastInsertRowid)));
  });

  app.get("/api/series/:id", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const series = getSeries(id);
    if (!series) return reply.code(404).send({ message: "Series or set not found." });
    const items = database.prepare(`
      SELECT m.id, m.title, m.media_type, m.relative_path, m.size_bytes,
        m.modified_at_ms, m.file_count, src.name AS source_name, si.position
      FROM series_items si JOIN media_items m ON m.id = si.item_id
      JOIN sources src ON src.id = m.source_id
      WHERE si.series_id = ? AND m.available = 1
      ORDER BY si.position, si.item_id
    `).all(id);
    return { ...series, items };
  });

  app.patch("/api/series/:id", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const { title, description, preferredType } = detailsInput.parse(request.body);
    const changed = database.prepare("UPDATE series SET title = ?, description = ?, preferred_type = COALESCE(?, preferred_type), updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(title, description, preferredType ?? null, id).changes;
    if (!changed) return reply.code(404).send({ message: "Series or set not found." });
    return getSeries(id);
  });

  app.delete("/api/series/:id", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const changed = database.prepare("DELETE FROM series WHERE id = ?").run(id).changes;
    if (!changed) return reply.code(404).send({ message: "Series or set not found." });
    return reply.code(204).send();
  });

  app.put("/api/series/:id/favorite", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const { favorite } = z.object({ favorite: z.boolean() }).parse(request.body);
    const changed = database.prepare("UPDATE series SET favorite = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(favorite ? 1 : 0, id).changes;
    if (!changed) return reply.code(404).send({ message: "Series or set not found." });
    return { id, favorite: favorite ? 1 : 0 };
  });

  app.put("/api/series/:id/tags", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const { tagIds } = z.object({ tagIds: idsInput }).parse(request.body);
    if (!getSeries(id)) return reply.code(404).send({ message: "Series or set not found." });
    const unique = [...new Set(tagIds)];
    for (const tagId of unique) {
      if (!database.prepare("SELECT id FROM tags WHERE id = ?").get(tagId)) {
        return reply.code(400).send({ message: `Tag ${tagId} does not exist.` });
      }
    }
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare("DELETE FROM series_tags WHERE series_id = ?").run(id);
      const insert = database.prepare("INSERT INTO series_tags(series_id, tag_id) VALUES (?, ?)");
      for (const tagId of unique) insert.run(id, tagId);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return getSeries(id);
  });

  app.put("/api/series/:id/categories", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const { categoryIds } = z.object({ categoryIds: idsInput }).parse(request.body);
    if (!getSeries(id)) return reply.code(404).send({ message: "Series or set not found." });
    const unique = [...new Set(categoryIds)];
    for (const categoryId of unique) {
      if (!database.prepare("SELECT id FROM categories WHERE id = ?").get(categoryId)) {
        return reply.code(400).send({ message: `Category ${categoryId} does not exist.` });
      }
    }
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare("DELETE FROM series_categories WHERE series_id = ?").run(id);
      const insert = database.prepare("INSERT INTO series_categories(series_id, category_id) VALUES (?, ?)");
      for (const categoryId of unique) insert.run(id, categoryId);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return getSeries(id);
  });

  app.put("/api/series/:id/items", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const { itemIds } = z.object({ itemIds: idsInput }).parse(request.body);
    if (!getSeries(id)) return reply.code(404).send({ message: "Series or set not found." });
    const unique = [...new Set(itemIds)];
    for (const itemId of unique) {
      if (!database.prepare("SELECT id FROM media_items WHERE id = ? AND available = 1").get(itemId)) {
        return reply.code(400).send({ message: `Media item ${itemId} is unavailable.` });
      }
    }
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare("DELETE FROM series_items WHERE series_id = ?").run(id);
      const insert = database.prepare("INSERT INTO series_items(series_id, item_id, position) VALUES (?, ?, ?)");
      unique.forEach((itemId, position) => insert.run(id, itemId, position));
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return getSeries(id);
  });

  app.get("/api/items/:id/series", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    if (!database.prepare("SELECT id FROM media_items WHERE id = ? AND available = 1").get(id)) {
      return reply.code(404).send({ message: "Media item not found." });
    }
    return database.prepare(`
      SELECT s.id, s.title AS name FROM series_items si
      JOIN series s ON s.id = si.series_id
      WHERE si.item_id = ? ORDER BY s.title COLLATE NOCASE
    `).all(id);
  });

  app.put("/api/items/:id/series", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const { seriesIds } = z.object({ seriesIds: idsInput }).parse(request.body);
    if (!database.prepare("SELECT id FROM media_items WHERE id = ? AND available = 1").get(id)) {
      return reply.code(404).send({ message: "Media item not found." });
    }
    const unique = [...new Set(seriesIds)];
    for (const seriesId of unique) {
      if (!database.prepare("SELECT id FROM series WHERE id = ?").get(seriesId)) {
        return reply.code(400).send({ message: `Series or set ${seriesId} does not exist.` });
      }
    }
    database.exec("BEGIN IMMEDIATE");
    try {
      if (unique.length) {
        database.prepare(`DELETE FROM series_items WHERE item_id = ? AND series_id NOT IN (${unique.map(() => "?").join(",")})`)
          .run(id, ...unique);
      } else {
        database.prepare("DELETE FROM series_items WHERE item_id = ?").run(id);
      }
      const append = database.prepare(`
        INSERT OR IGNORE INTO series_items(series_id, item_id, position)
        VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM series_items WHERE series_id = ?))
      `);
      for (const seriesId of unique) append.run(seriesId, id, seriesId);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return database.prepare(`
      SELECT s.id, s.title AS name FROM series_items si JOIN series s ON s.id = si.series_id
      WHERE si.item_id = ? ORDER BY s.title COLLATE NOCASE
    `).all(id);
  });

  app.get("/api/series/:id/cover", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const row = database.prepare("SELECT cover_data, cover_mime FROM series WHERE id = ?")
      .get(id) as { cover_data: Uint8Array | null; cover_mime: string | null } | undefined;
    if (!row?.cover_data || !row.cover_mime) return reply.code(404).send({ message: "No cover image." });
    return reply.header("Content-Type", row.cover_mime).header("Cache-Control", "private, no-cache")
      .send(Buffer.from(row.cover_data));
  });

  app.put("/api/series/:id/cover", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    if (!(request.body instanceof Buffer)) return reply.code(400).send({ message: "Choose an image file." });
    const bytes = request.body;
    const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png"
      : bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? "image/jpeg"
        : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? "image/webp" : null;
    if (!mime) return reply.code(400).send({ message: "Use a PNG, JPEG, or WebP cover image." });
    const changed = database.prepare("UPDATE series SET cover_data = ?, cover_mime = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(bytes, mime, id).changes;
    if (!changed) return reply.code(404).send({ message: "Series or set not found." });
    return { id, has_cover: 1 };
  });

  app.delete("/api/series/:id/cover", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const changed = database.prepare("UPDATE series SET cover_data = NULL, cover_mime = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(id).changes;
    if (!changed) return reply.code(404).send({ message: "Series or set not found." });
    return reply.code(204).send();
  });
}
