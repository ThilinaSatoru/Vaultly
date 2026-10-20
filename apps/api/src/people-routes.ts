import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { database } from "./database.js";
import { withAttributePatterns } from "./attribute-routes.js";
import { downloadProfileImage, normalizeProfileImage, readProfileImage, removeProfileImage, storeProfileImage } from "./profile-images.js";
import { getPeopleRepairProgress, repairPeopleMatches } from "./people-repair.js";

const idInput = z.object({ id: z.coerce.number().int().positive() });
const itemRoleInput = z.object({ id: z.coerce.number().int().positive(), role: z.enum(["cast", "artist"]) });
const nameInput = z.object({ name: z.string().trim().min(1).max(100) });
const profileInput = z.object({
  name: z.string().trim().min(1).max(100),
  gender: z.string().trim().max(80).nullable().optional(),
  country: z.string().trim().max(100).nullable().optional(),
  profile_url: z.union([z.string().trim().url().max(2000), z.literal("")]).nullable().optional(),
}).strict();

function creditsForItem(id: number, role: "cast" | "artist") {
  return database.prepare(`
    SELECT p.id, p.name FROM effective_item_people ip JOIN people p ON p.id = ip.person_id
    WHERE ip.item_id = ? AND ip.role = ? ORDER BY p.name COLLATE NOCASE
  `).all(id, role);
}

export async function registerPeopleRoutes(app: FastifyInstance) {
  app.post("/api/people/cleanup", async () => {
    // Availability is deliberately ignored: offline and disabled sources retain credits.
    const removed = database.prepare(`DELETE FROM people WHERE
      NOT EXISTS (SELECT 1 FROM item_people ip WHERE ip.person_id = people.id)
      AND NOT EXISTS (SELECT 1 FROM series_people sp WHERE sp.person_id = people.id)
      RETURNING profile_image`).all() as Array<{ profile_image: string | null }>;
    for (const person of removed) await removeProfileImage(person.profile_image);
    return { removed: removed.length };
  });
  app.get("/api/people/matching/repair", async () => getPeopleRepairProgress());
  app.post("/api/people/matching/repair", async (_request, reply) => {
    void repairPeopleMatches();
    return reply.code(202).send(getPeopleRepairProgress());
  });
  app.get("/api/people/:id/image", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const person = database.prepare("SELECT profile_image FROM people WHERE id = ?").get(id) as { profile_image: string | null } | undefined;
    if (!person?.profile_image) return reply.code(404).send({ message: "Profile image not found." });
    return reply.type("image/png").header("Cache-Control", "no-cache").send(await readProfileImage(person.profile_image));
  });
  app.put("/api/people/:id/image", { bodyLimit: 15 * 1024 * 1024 }, async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const parsed = z.union([
      z.object({ data: z.string().min(1).max(14 * 1024 * 1024) }).strict(),
      z.object({ url: z.string().trim().url().refine((value) => /^https?:\/\//i.test(value)) }).strict(),
    ]).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Upload an image file or enter an HTTP or HTTPS image link." });
    const input = parsed.data;
    if (!database.prepare("SELECT id FROM people WHERE id = ?").get(id)) return reply.code(404).send({ message: "Person not found." });
    let data: Buffer;
    try { data = await normalizeProfileImage("url" in input ? await downloadProfileImage(input.url) : Buffer.from(input.data, "base64")); }
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
    SELECT p.*,
      COUNT(DISTINCT CASE WHEN ip.role = 'cast' AND m.available = 1 THEN m.id END) AS cast_count,
      COUNT(DISTINCT CASE WHEN ip.role = 'artist' AND m.available = 1 THEN m.id END) AS artist_count,
      (SELECT COUNT(*) FROM series_people sp WHERE sp.person_id = p.id) AS set_count
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
    const profile = profileInput.parse(request.body);
    const name = profile.name;
    try {
      const changed = database.prepare(`UPDATE people SET name = ?,
        gender = CASE WHEN ? THEN ? ELSE gender END,
        country = CASE WHEN ? THEN ? ELSE country END,
        profile_url = CASE WHEN ? THEN ? ELSE profile_url END WHERE id = ?`)
        .run(name, "gender" in profile, profile.gender?.trim() || null, "country" in profile, profile.country?.trim() || null,
          "profile_url" in profile, profile.profile_url?.trim() || null, id).changes;
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
      const direct = new Set((database.prepare("SELECT person_id FROM item_people WHERE item_id = ?").all(id) as Array<{ person_id: number }>).map((row) => row.person_id));
      database.prepare("DELETE FROM item_people WHERE item_id = ?").run(id);
      const inherited = new Set((database.prepare(`SELECT sp.person_id FROM series_items si
        JOIN series_people sp ON sp.series_id = si.series_id WHERE si.item_id = ?`).all(id) as Array<{ person_id: number }>).map((row) => row.person_id));
      const insert = database.prepare("INSERT INTO item_people(item_id, person_id, role, origin) VALUES (?, ?, ?, 'manual')");
      for (const personId of unique) if (!inherited.has(personId) || direct.has(personId)) insert.run(id, personId, role);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return { id, role, people: creditsForItem(id, role) };
  });
}
