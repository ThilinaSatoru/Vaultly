import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { database } from "./database.js";
import { withAttributePatterns } from "./attribute-routes.js";
import { downloadProfileImage, normalizeProfileImage, readProfileImage, removeProfileImage, storeProfileImage, type ProfileImageFetch } from "./profile-images.js";

const idInput = z.object({ id: z.coerce.number().int().positive() });
const itemRoleInput = z.object({ id: z.coerce.number().int().positive(), role: z.enum(["cast", "artist"]) });
const nameInput = z.object({ name: z.string().trim().min(1).max(100) });

function creditsForItem(id: number, role: "cast" | "artist") {
  return database.prepare(`
    SELECT p.id, p.name FROM effective_item_people ip JOIN people p ON p.id = ip.person_id
    WHERE ip.item_id = ? AND ip.role = ? ORDER BY p.name COLLATE NOCASE
  `).all(id, role);
}

export async function registerPeopleRoutes(app: FastifyInstance, options: { fetchProfileImage?: ProfileImageFetch } = {}) {
  app.get("/api/people/:id/image", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const person = database.prepare("SELECT profile_image FROM people WHERE id = ?").get(id) as { profile_image: string | null } | undefined;
    if (!person?.profile_image) return reply.code(404).send({ message: "Profile image not found." });
    return reply.type("image/png").header("Cache-Control", "no-cache").send(await readProfileImage(person.profile_image));
  });
  app.put("/api/people/:id/image", { bodyLimit: 15 * 1024 * 1024 }, async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const input = z.union([z.object({ data: z.string().min(1).max(14 * 1024 * 1024) }), z.object({ url: z.string().url().max(4096), referrer: z.string().url().max(4096).optional() })]).parse(request.body);
    if (!database.prepare("SELECT id FROM people WHERE id = ?").get(id)) return reply.code(404).send({ message: "Person not found." });
    let data: Buffer;
    try { data = await normalizeProfileImage("url" in input ? await downloadProfileImage(input.url, input.referrer, options.fetchProfileImage) : Buffer.from(input.data, "base64")); }
    catch (error) { return reply.code(400).send({ message: error instanceof Error ? error.message : "Could not load image." }); }
    const filename = await storeProfileImage(data);
    const person = database.prepare("SELECT profile_image FROM people WHERE id = ?").get(id) as { profile_image: string | null } | undefined;
    if (!person) { await removeProfileImage(filename); return reply.code(404).send({ message: "Person not found." }); }
    try { database.prepare("UPDATE people SET profile_image = ? WHERE id = ?").run(filename, id); }
    catch (error) { await removeProfileImage(filename); throw error; }
    await removeProfileImage(person.profile_image);
    return { id, profile_image: filename };
  });
  app.delete("/api/people/:id/image", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const person = database.prepare("SELECT profile_image FROM people WHERE id = ?").get(id) as { profile_image: string | null } | undefined;
    if (!person) return reply.code(404).send({ message: "Person not found." });
    database.prepare("UPDATE people SET profile_image = NULL WHERE id = ?").run(id);
    await removeProfileImage(person.profile_image);
    return reply.code(204).send();
  });
  app.get("/api/people", async () => withAttributePatterns("people", database.prepare(`
    SELECT p.id, p.name, p.profile_image,
      COUNT(DISTINCT CASE WHEN ip.role = 'cast' AND m.available = 1 THEN m.id END) AS cast_count,
      COUNT(DISTINCT CASE WHEN ip.role = 'artist' AND m.available = 1 THEN m.id END) AS artist_count
    FROM people p LEFT JOIN effective_item_people ip ON ip.person_id = p.id
    LEFT JOIN media_items m ON m.id = ip.item_id
    GROUP BY p.id ORDER BY p.name COLLATE NOCASE
  `).all() as Array<{ id: number; name: string; cast_count: number; artist_count: number }>));

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
    const person = database.prepare("SELECT profile_image FROM people WHERE id = ?").get(id) as { profile_image: string | null } | undefined;
    const changed = database.prepare("DELETE FROM people WHERE id = ?").run(id).changes;
    if (!changed) return reply.code(404).send({ message: "Person not found." });
    await removeProfileImage(person?.profile_image);
    return reply.code(204).send();
  });

  app.put("/api/items/:id/people/:role", async (request, reply) => {
    const { id } = itemRoleInput.parse(request.params);
    const { personIds } = z.object({ personIds: z.array(z.number().int().positive()).max(100) }).parse(request.body);
    const item = database.prepare("SELECT media_type FROM media_items WHERE id = ? AND available = 1").get(id) as { media_type: string } | undefined;
    if (!item) {
      return reply.code(404).send({ message: "Media item not found." });
    }
    const role = item.media_type === "video" ? "cast" : "artist";
    const unique = [...new Set(personIds)];
    for (const personId of unique) {
      if (!database.prepare("SELECT id FROM people WHERE id = ?").get(personId)) {
        return reply.code(400).send({ message: `Person ${personId} does not exist.` });
      }
    }
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare("DELETE FROM item_people WHERE item_id = ?").run(id);
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
