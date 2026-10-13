import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { database } from "./database.js";
import { FilenameMetadataMatcher, normalizeMetadataPhrase } from "./filename-metadata.js";
import { PeopleMatcher } from "./people-matching.js";

const definitions = {
  tags: { table: "tag_patterns", column: "tag_id" },
  categories: { table: "category_patterns", column: "category_id" },
  people: { table: "person_patterns", column: "person_id" },
} as const;
const attributeParams = z.object({ kind: z.enum(["tags", "categories", "people"]), id: z.coerce.number().int().positive() });
const patternsInput = z.object({ patterns: z.array(z.string().trim().min(1).max(100)
  .refine((value) => normalizeMetadataPhrase(value).length >= 2, "Each pattern must contain at least two letters or numbers.")).max(100) });
export const sourceAttributesInput = z.object({
  tagIds: z.array(z.number().int().positive()).max(100).default([]),
  categoryIds: z.array(z.number().int().positive()).max(100).default([]),
});

export function sourceAttributes(id: number) {
  return {
    tags: database.prepare("SELECT t.id, t.name FROM source_tags st JOIN tags t ON t.id = st.tag_id WHERE st.source_id = ? ORDER BY t.name COLLATE NOCASE").all(id),
    categories: database.prepare("SELECT c.id, c.name FROM source_categories sc JOIN categories c ON c.id = sc.category_id WHERE sc.source_id = ? ORDER BY c.name COLLATE NOCASE").all(id),
  };
}

export function invalidSourceAttribute(input: { tagIds: number[]; categoryIds: number[] }): string | null {
  for (const [table, ids] of [["tags", input.tagIds], ["categories", input.categoryIds]] as const) {
    for (const id of new Set(ids)) if (!database.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id)) return `Unknown ${table} entry ${id}.`;
  }
  return null;
}

/** Caller owns the transaction; inherited attributes never overwrite item assignments. */
export function setSourceAttributes(id: number, input: { tagIds: number[]; categoryIds: number[] }) {
  database.prepare("DELETE FROM source_tags WHERE source_id = ?").run(id);
  database.prepare("DELETE FROM source_categories WHERE source_id = ?").run(id);
  const addTag = database.prepare("INSERT INTO source_tags(source_id, tag_id) VALUES (?, ?)");
  const addCategory = database.prepare("INSERT INTO source_categories(source_id, category_id) VALUES (?, ?)");
  for (const tagId of new Set(input.tagIds)) addTag.run(id, tagId);
  for (const categoryId of new Set(input.categoryIds)) addCategory.run(id, categoryId);
}

/** Saving an item's effective attributes must not turn inherited ones into manual assignments. */
export function itemAssignmentIds(kind: "tags" | "categories", id: number, requested: number[]): number[] {
  const column = kind === "tags" ? "tag_id" : "category_id";
  const assigned = new Set((database.prepare(`SELECT ${column} AS id FROM item_${kind} WHERE item_id = ?`).all(id) as Array<{ id: number }>).map((row) => row.id));
  const inherited = new Set((database.prepare(`SELECT s.${column} AS id FROM source_${kind} s JOIN media_items m ON m.source_id = s.source_id WHERE m.id = ?`).all(id) as Array<{ id: number }>).map((row) => row.id));
  return requested.filter((value) => assigned.has(value) || !inherited.has(value));
}

export function withAttributePatterns<T extends { id: number }>(kind: keyof typeof definitions, entries: T[]): Array<T & { patterns: string[] }> {
  const { table, column } = definitions[kind];
  const byId = new Map<number, string[]>();
  // Fetch only the requested entries, with bounded SQL parameters and no full-table row array.
  for (let offset = 0; offset < entries.length; offset += 500) {
    const ids = entries.slice(offset, offset + 500).map((entry) => entry.id);
    for (const value of database.prepare(`SELECT ${column} AS id, pattern FROM ${table} WHERE ${column} IN (${ids.map(() => "?").join(",")}) ORDER BY pattern COLLATE NOCASE`).iterate(...ids)) {
      const row = value as { id: number; pattern: string };
      const patterns = byId.get(row.id) ?? [];
      patterns.push(row.pattern);
      byId.set(row.id, patterns);
    }
  }
  return entries.map((entry) => ({ ...entry, patterns: byId.get(entry.id) ?? [] }));
}

export async function registerAttributeRoutes(app: FastifyInstance) {
  app.post("/api/attributes/:kind/import", { bodyLimit: 20 * 1024 * 1024 }, async (request) => {
    const { kind } = z.object({ kind: z.enum(["tags", "categories", "people"]) }).parse(request.params);
    const { existingOnly } = z.object({ existingOnly: z.enum(["true", "false"]).default("false").transform((value) => value === "true") }).parse(request.query);
    const httpUrl = z.string().url().max(4096).refine((value) => /^https?:\/\//i.test(value), "Use an HTTP or HTTPS URL.");
    const record = z.object({
      name: z.string().trim().min(1).max(kind === "people" ? 100 : 80),
      patterns: patternsInput.shape.patterns.optional(),
      ...(kind === "people" ? {
        gender: z.string().trim().max(100).nullable().optional(),
        country_code: z.string().trim().max(10).nullable().optional(),
        country: z.string().trim().max(100).nullable().optional(),
        avatar_url: httpUrl.nullable().optional(),
        source: z.string().trim().max(4096).nullable().optional(),
        profile_url: httpUrl.nullable().optional(),
      } : {}),
    }).strict();
    const records = z.array(record).min(1).max(50000);
    const input = z.union([records, z.object({
      records, scraped_at: z.string().datetime().optional(), total: z.number().int().nonnegative().optional(),
    }).strict()]).parse(request.body);
    const entries = Array.isArray(input) ? input : input.records;
    const scrapedAt = Array.isArray(input) ? undefined : input.scraped_at;
    const { table, column } = definitions[kind];
    let created = 0, updated = 0, indexed = 0, skipped = 0;
    database.exec("BEGIN IMMEDIATE");
    try {
      const ids = new Set<number>();
      const find = database.prepare(`SELECT id FROM ${kind} WHERE name = ? COLLATE NOCASE`);
      const existingNames = existingOnly ? new Map((database.prepare(`SELECT id, name FROM ${kind}`).all() as Array<{ id: number; name: string }>).map((entry) => [entry.name.toLowerCase(), entry.id])) : null;
      const seenNames = new Set<string>();
      const peopleNames = kind === "people" ? new Set((database.prepare("SELECT name FROM people").all() as Array<{ name: string }>).map((person) => person.name.toLowerCase())) : null;
      const create = database.prepare(`INSERT INTO ${kind}(name) VALUES (?)`);
      const clearPatterns = database.prepare(`DELETE FROM ${table} WHERE ${column} = ?`);
      const addPattern = database.prepare(`INSERT INTO ${table}(${column}, pattern) VALUES (?, ?)`);
      const fields = ["gender", "country_code", "country", "avatar_url", "source", "profile_url"] as const;
      // A presence flag preserves omitted fields while permitting explicit nulls.
      const updatePerson = kind === "people" ? database.prepare(`UPDATE people SET ${fields.map((field) => `${field} = CASE WHEN ? THEN ? ELSE ${field} END`).join(", ")}, scraped_at = CASE WHEN ? THEN ? ELSE scraped_at END WHERE id = ?`) : null;
      for (const entry of entries) {
        const key = entry.name.toLowerCase();
        if (existingOnly) {
          if (!existingNames?.has(key) || seenNames.has(key)) { skipped++; continue; }
          seenNames.add(key);
        } else if (peopleNames?.has(key)) { skipped++; continue; }
        const existing = existingOnly ? { id: existingNames!.get(key)! } : find.get(entry.name) as { id: number } | undefined;
        const id = existing?.id ?? Number(create.run(entry.name).lastInsertRowid);
        if (existing) updated++; else created++;
        peopleNames?.add(key);
        ids.add(id);
        if (updatePerson) {
          const values = fields.flatMap((field) => {
            const value = (entry as Record<string, unknown>)[field] as string | null | undefined;
            return [Number(value !== undefined), value ?? null];
          });
          updatePerson.run(...values, Number(scrapedAt !== undefined), scrapedAt ?? null, id);
        }
        if (entry.patterns !== undefined) {
          clearPatterns.run(id);
          for (const pattern of new Map(entry.patterns.map((value) => [normalizeMetadataPhrase(value), value])).values()) addPattern.run(id, pattern);
        }
      }
      if (!ids.size) {
        database.exec("COMMIT");
        return { total: entries.length, created, updated, indexed, skipped };
      }
      const importedEntries: Array<{ id: number; name: string }> = [];
      const importedIds = [...ids];
      for (let offset = 0; offset < importedIds.length; offset += 500) {
        const batch = importedIds.slice(offset, offset + 500);
        importedEntries.push(...database.prepare(`SELECT id, name FROM ${kind} WHERE id IN (${batch.map(() => "?").join(",")})`).all(...batch) as Array<{ id: number; name: string }>);
      }
      const imported = withAttributePatterns(kind, importedEntries);
      // Include every person when resolving alias ambiguity, even in chunked imports.
      const matcher = kind === "people" ? new PeopleMatcher(withAttributePatterns("people", database.prepare("SELECT id, name FROM people").all() as Array<{ id: number; name: string }>)) : new FilenameMetadataMatcher(imported);
      const assignment = kind === "people"
        ? database.prepare("INSERT OR IGNORE INTO item_people(item_id, person_id, role, origin) VALUES (?, ?, ?, 'filename')")
        : database.prepare(`INSERT OR IGNORE INTO item_${kind}(item_id, ${kind === "tags" ? "tag_id" : "category_id"}) VALUES (?, ?)`);
      const filenameCredits = kind === "people" ? database.prepare("SELECT person_id FROM item_people WHERE item_id = ? AND origin = 'filename'") : null;
      const removeFilenameCredit = kind === "people" ? database.prepare("DELETE FROM item_people WHERE item_id = ? AND person_id = ? AND origin = 'filename'") : null;
      for (const row of ids.size ? database.prepare("SELECT id, filename, file_extension, media_type FROM media_items WHERE indexed = 1").iterate() : []) {
        const item = row as { id: number; filename: string; file_extension: string; media_type: string };
        const matches = matcher.match(item.filename, item.file_extension);
        if (filenameCredits && removeFilenameCredit) {
          const matched = new Set(matches.map((person) => person.id));
          for (const credit of filenameCredits.all(item.id) as Array<{ person_id: number }>) if (!matched.has(credit.person_id)) removeFilenameCredit.run(item.id, credit.person_id);
        }
        for (const match of matches) {
          if (kind === "people" && !ids.has(match.id)) continue;
          indexed += Number(kind === "people" ? assignment.run(item.id, match.id, item.media_type === "video" ? "cast" : "artist").changes : assignment.run(item.id, match.id).changes);
        }
      }
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
    return { total: entries.length, created, updated, indexed, ...(skipped ? { skipped } : {}) };
  });
  app.get("/api/attributes/:kind/:id/patterns", async (request, reply) => {
    const { kind, id } = attributeParams.parse(request.params);
    if (!database.prepare(`SELECT id FROM ${kind} WHERE id = ?`).get(id)) return reply.code(404).send({ message: "Attribute not found." });
    const { table, column } = definitions[kind];
    return { patterns: (database.prepare(`SELECT pattern FROM ${table} WHERE ${column} = ? ORDER BY pattern COLLATE NOCASE`).all(id) as Array<{ pattern: string }>).map((row) => row.pattern) };
  });
  app.put("/api/attributes/:kind/:id/patterns", async (request, reply) => {
    const { kind, id } = attributeParams.parse(request.params);
    const input = patternsInput.parse(request.body);
    if (!database.prepare(`SELECT id FROM ${kind} WHERE id = ?`).get(id)) return reply.code(404).send({ message: "Attribute not found." });
    const { table, column } = definitions[kind];
    const patterns = [...new Map(input.patterns.map((pattern) => [normalizeMetadataPhrase(pattern), pattern])).values()];
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).run(id);
      const insert = database.prepare(`INSERT INTO ${table}(${column}, pattern) VALUES (?, ?)`);
      for (const pattern of patterns) insert.run(id, pattern);
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
    return { patterns };
  });
  app.get("/api/sources/:id/attributes", async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    if (!database.prepare("SELECT id FROM sources WHERE id = ?").get(id)) return reply.code(404).send({ message: "Source not found." });
    return sourceAttributes(id);
  });
  app.put("/api/sources/:id/attributes", async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const input = sourceAttributesInput.parse(request.body);
    if (!database.prepare("SELECT id FROM sources WHERE id = ?").get(id)) return reply.code(404).send({ message: "Source not found." });
    const invalid = invalidSourceAttribute(input);
    if (invalid) return reply.code(400).send({ message: invalid });
    database.exec("BEGIN IMMEDIATE");
    try {
      setSourceAttributes(id, input);
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
    return sourceAttributes(id);
  });
}
