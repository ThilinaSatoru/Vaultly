import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { database } from "./database.js";

const bulkInput = z.object({
  itemIds: z.array(z.number().int().positive()).min(1).max(500),
  field: z.enum(["tags", "categories", "series", "cast", "artists"]),
  mode: z.enum(["add", "remove"]),
  valueIds: z.array(z.number().int().positive()).min(1).max(100),
});

export async function registerBulkRoutes(app: FastifyInstance) {
  app.post("/api/items/bulk", async (request, reply) => {
    const input = bulkInput.parse(request.body);
    const itemIds = [...new Set(input.itemIds)];
    const valueIds = [...new Set(input.valueIds)];
    for (const itemId of itemIds) {
      if (!database.prepare("SELECT id FROM media_items WHERE id = ? AND available = 1").get(itemId)) {
        return reply.code(400).send({ message: `Media item ${itemId} is unavailable.` });
      }
    }
    const referenceTable = input.field === "tags" ? "tags" : input.field === "categories" ? "categories"
      : input.field === "series" ? "series" : "people";
    for (const valueId of valueIds) {
      if (!database.prepare(`SELECT id FROM ${referenceTable} WHERE id = ?`).get(valueId)) {
        return reply.code(400).send({ message: `${input.field} entry ${valueId} does not exist.` });
      }
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      if (input.field === "series") {
        const add = database.prepare(`
          INSERT OR IGNORE INTO series_items(series_id, item_id, position)
          VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM series_items WHERE series_id = ?))
        `);
        const remove = database.prepare("DELETE FROM series_items WHERE series_id = ? AND item_id = ?");
        for (const seriesId of valueIds) for (const itemId of itemIds) {
          if (input.mode === "add") add.run(seriesId, itemId, seriesId);
          else remove.run(seriesId, itemId);
        }
      } else if (input.field === "cast" || input.field === "artists") {
        const role = input.field === "cast" ? "cast" : "artist";
        const add = database.prepare("INSERT OR IGNORE INTO item_people(item_id, person_id, role) VALUES (?, ?, ?)");
        const remove = database.prepare("DELETE FROM item_people WHERE item_id = ? AND person_id = ? AND role = ?");
        for (const itemId of itemIds) for (const personId of valueIds) {
          if (input.mode === "add") add.run(itemId, personId, role);
          else remove.run(itemId, personId, role);
        }
      } else {
        const table = input.field === "tags" ? "item_tags" : "item_categories";
        const column = input.field === "tags" ? "tag_id" : "category_id";
        const add = database.prepare(`INSERT OR IGNORE INTO ${table}(item_id, ${column}) VALUES (?, ?)`);
        const remove = database.prepare(`DELETE FROM ${table} WHERE item_id = ? AND ${column} = ?`);
        for (const itemId of itemIds) for (const valueId of valueIds) {
          if (input.mode === "add") add.run(itemId, valueId);
          else remove.run(itemId, valueId);
        }
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return { updated: itemIds.length, field: input.field, mode: input.mode };
  });
}
