import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { database } from "./database.js";

const idInput = z.object({ id: z.coerce.number().int().positive() });
const detailsInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(3000).default(""),
  preferredType: z.enum(["video", "comic", "story", "mixed"]).optional(),
});
const idsInput = z.array(z.number().int().positive()).max(1000);

interface CircleRow {
  id: number;
  title: string;
  description: string;
  preferred_type: "video" | "comic" | "story" | "mixed";
  set_count: number;
  item_count: number;
  video_count: number;
  comic_count: number;
  story_count: number;
}

function getCircle(id: number) {
  const circle = database.prepare(`
    SELECT c.id, c.title, c.description, c.preferred_type,
      (SELECT COUNT(*) FROM circle_series cs WHERE cs.circle_id = c.id) AS set_count,
      (SELECT COUNT(DISTINCT m.id) FROM circle_series cs JOIN series_items si ON si.series_id = cs.series_id
        JOIN media_items m ON m.id = si.item_id WHERE cs.circle_id = c.id AND m.available = 1) AS item_count
      ,(SELECT COUNT(DISTINCT m.id) FROM circle_series cs JOIN series_items si ON si.series_id = cs.series_id
        JOIN media_items m ON m.id = si.item_id WHERE cs.circle_id = c.id AND m.available = 1 AND m.media_type = 'video') AS video_count
      ,(SELECT COUNT(DISTINCT m.id) FROM circle_series cs JOIN series_items si ON si.series_id = cs.series_id
        JOIN media_items m ON m.id = si.item_id WHERE cs.circle_id = c.id AND m.available = 1 AND m.media_type = 'comic') AS comic_count
      ,(SELECT COUNT(DISTINCT m.id) FROM circle_series cs JOIN series_items si ON si.series_id = cs.series_id
        JOIN media_items m ON m.id = si.item_id WHERE cs.circle_id = c.id AND m.available = 1 AND m.media_type = 'story') AS story_count
    FROM circles c WHERE c.id = ?
  `).get(id) as CircleRow | undefined;
  if (!circle) return undefined;
  const seriesIds = (database.prepare("SELECT series_id FROM circle_series WHERE circle_id = ? ORDER BY position, series_id")
    .all(id) as Array<{ series_id: number }>).map((row) => row.series_id);
  return { ...circle, series_ids: seriesIds };
}

export async function registerCircleRoutes(app: FastifyInstance) {
  app.get("/api/circles", async (request) => {
    const { q } = z.object({ q: z.string().trim().max(200).optional() }).parse(request.query);
    const values: string[] = [];
    const where = q ? "WHERE c.title LIKE ? OR c.description LIKE ?" : "";
    if (q) values.push(`%${q}%`, `%${q}%`);
    const rows = database.prepare(`
      SELECT c.id, c.title, c.description, c.preferred_type,
        (SELECT COUNT(*) FROM circle_series cs WHERE cs.circle_id = c.id) AS set_count,
        (SELECT COUNT(DISTINCT m.id) FROM circle_series cs JOIN series_items si ON si.series_id = cs.series_id
          JOIN media_items m ON m.id = si.item_id WHERE cs.circle_id = c.id AND m.available = 1) AS item_count
        ,(SELECT COUNT(DISTINCT m.id) FROM circle_series cs JOIN series_items si ON si.series_id = cs.series_id
          JOIN media_items m ON m.id = si.item_id WHERE cs.circle_id = c.id AND m.available = 1 AND m.media_type = 'video') AS video_count
        ,(SELECT COUNT(DISTINCT m.id) FROM circle_series cs JOIN series_items si ON si.series_id = cs.series_id
          JOIN media_items m ON m.id = si.item_id WHERE cs.circle_id = c.id AND m.available = 1 AND m.media_type = 'comic') AS comic_count
        ,(SELECT COUNT(DISTINCT m.id) FROM circle_series cs JOIN series_items si ON si.series_id = cs.series_id
          JOIN media_items m ON m.id = si.item_id WHERE cs.circle_id = c.id AND m.available = 1 AND m.media_type = 'story') AS story_count
      FROM circles c ${where} ORDER BY c.title COLLATE NOCASE, c.id
    `).all(...values) as unknown as CircleRow[];
    return rows;
  });

  app.post("/api/circles", async (request, reply) => {
    const input = detailsInput.parse(request.body);
    const result = database.prepare("INSERT INTO circles(title, description, preferred_type) VALUES (?, ?, ?)").run(input.title, input.description, input.preferredType ?? "mixed");
    return reply.code(201).send(getCircle(Number(result.lastInsertRowid)));
  });

  app.get("/api/circles/:id", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const circle = getCircle(id);
    return circle ?? reply.code(404).send({ message: "Circle not found." });
  });

  app.patch("/api/circles/:id", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const input = detailsInput.parse(request.body);
    const changed = database.prepare("UPDATE circles SET title = ?, description = ?, preferred_type = COALESCE(?, preferred_type), updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(input.title, input.description, input.preferredType ?? null, id).changes;
    if (!changed) return reply.code(404).send({ message: "Circle not found." });
    return getCircle(id);
  });

  app.delete("/api/circles/:id", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const changed = database.prepare("DELETE FROM circles WHERE id = ?").run(id).changes;
    if (!changed) return reply.code(404).send({ message: "Circle not found." });
    return reply.code(204).send();
  });

  app.put("/api/circles/:id/series", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const { seriesIds } = z.object({ seriesIds: idsInput }).parse(request.body);
    if (!getCircle(id)) return reply.code(404).send({ message: "Circle not found." });
    const unique = [...new Set(seriesIds)];
    for (const seriesId of unique) {
      if (!database.prepare("SELECT id FROM series WHERE id = ?").get(seriesId)) {
        return reply.code(400).send({ message: `Series or set ${seriesId} does not exist.` });
      }
    }
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare("DELETE FROM circle_series WHERE circle_id = ?").run(id);
      const insert = database.prepare("INSERT INTO circle_series(circle_id, series_id, position) VALUES (?, ?, ?)");
      unique.forEach((seriesId, position) => insert.run(id, seriesId, position));
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return getCircle(id);
  });

  app.get("/api/series/:id/circles", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    if (!database.prepare("SELECT id FROM series WHERE id = ?").get(id)) {
      return reply.code(404).send({ message: "Series or set not found." });
    }
    return database.prepare(`
      SELECT c.id, c.title AS name FROM circle_series cs
      JOIN circles c ON c.id = cs.circle_id
      WHERE cs.series_id = ? ORDER BY c.title COLLATE NOCASE
    `).all(id);
  });

  app.put("/api/series/:id/circles", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const { circleIds } = z.object({ circleIds: idsInput }).parse(request.body);
    if (!database.prepare("SELECT id FROM series WHERE id = ?").get(id)) {
      return reply.code(404).send({ message: "Series or set not found." });
    }
    const unique = [...new Set(circleIds)];
    for (const circleId of unique) {
      if (!database.prepare("SELECT id FROM circles WHERE id = ?").get(circleId)) {
        return reply.code(400).send({ message: `Circle ${circleId} does not exist.` });
      }
    }
    database.exec("BEGIN IMMEDIATE");
    try {
      if (unique.length) {
        database.prepare(`DELETE FROM circle_series WHERE series_id = ? AND circle_id NOT IN (${unique.map(() => "?").join(",")})`)
          .run(id, ...unique);
      } else {
        database.prepare("DELETE FROM circle_series WHERE series_id = ?").run(id);
      }
      const append = database.prepare(`
        INSERT OR IGNORE INTO circle_series(circle_id, series_id, position)
        VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM circle_series WHERE circle_id = ?))
      `);
      for (const circleId of unique) append.run(circleId, id, circleId);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return database.prepare(`
      SELECT c.id, c.title AS name FROM circle_series cs JOIN circles c ON c.id = cs.circle_id
      WHERE cs.series_id = ? ORDER BY c.title COLLATE NOCASE
    `).all(id);
  });
}
