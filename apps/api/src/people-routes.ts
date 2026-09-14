import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { database } from "./database.js";

const idInput = z.object({ id: z.coerce.number().int().positive() });
const itemRoleInput = z.object({ id: z.coerce.number().int().positive(), role: z.enum(["cast", "artist"]) });
const nameInput = z.object({ name: z.string().trim().min(1).max(100) });

function creditsForItem(id: number, role: "cast" | "artist") {
  return database.prepare(`
    SELECT p.id, p.name FROM item_people ip JOIN people p ON p.id = ip.person_id
    WHERE ip.item_id = ? AND ip.role = ? ORDER BY p.name COLLATE NOCASE
  `).all(id, role);
}

export async function registerPeopleRoutes(app: FastifyInstance) {
  app.get("/api/people", async () => database.prepare(`
    SELECT p.id, p.name,
      COUNT(DISTINCT CASE WHEN ip.role = 'cast' AND m.available = 1 THEN m.id END) AS cast_count,
      COUNT(DISTINCT CASE WHEN ip.role = 'artist' AND m.available = 1 THEN m.id END) AS artist_count
    FROM people p LEFT JOIN item_people ip ON ip.person_id = p.id
    LEFT JOIN media_items m ON m.id = ip.item_id
    GROUP BY p.id ORDER BY p.name COLLATE NOCASE
  `).all());

  app.post("/api/people", async (request, reply) => {
    const { name } = nameInput.parse(request.body);
    try {
      const result = database.prepare("INSERT INTO people(name) VALUES (?)").run(name);
      return reply.code(201).send({ id: Number(result.lastInsertRowid), name, cast_count: 0, artist_count: 0 });
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        return reply.code(409).send({ message: "That person already exists." });
      }
      throw error;
    }
  });

  app.patch("/api/people/:id", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const { name } = nameInput.parse(request.body);
    try {
      const changed = database.prepare("UPDATE people SET name = ? WHERE id = ?").run(name, id).changes;
      if (!changed) return reply.code(404).send({ message: "Person not found." });
      return { id, name };
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        return reply.code(409).send({ message: "That person already exists." });
      }
      throw error;
    }
  });

  app.delete("/api/people/:id", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const changed = database.prepare("DELETE FROM people WHERE id = ?").run(id).changes;
    if (!changed) return reply.code(404).send({ message: "Person not found." });
    return reply.code(204).send();
  });

  app.put("/api/items/:id/people/:role", async (request, reply) => {
    const { id, role } = itemRoleInput.parse(request.params);
    const { personIds } = z.object({ personIds: z.array(z.number().int().positive()).max(100) }).parse(request.body);
    if (!database.prepare("SELECT id FROM media_items WHERE id = ? AND available = 1").get(id)) {
      return reply.code(404).send({ message: "Media item not found." });
    }
    const unique = [...new Set(personIds)];
    for (const personId of unique) {
      if (!database.prepare("SELECT id FROM people WHERE id = ?").get(personId)) {
        return reply.code(400).send({ message: `Person ${personId} does not exist.` });
      }
    }
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare("DELETE FROM item_people WHERE item_id = ? AND role = ?").run(id, role);
      const insert = database.prepare("INSERT INTO item_people(item_id, person_id, role) VALUES (?, ?, ?)");
      for (const personId of unique) insert.run(id, personId, role);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return { id, role, people: creditsForItem(id, role) };
  });
}
