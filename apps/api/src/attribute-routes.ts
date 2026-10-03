import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { database } from "./database.js";
import { normalizeMetadataPhrase } from "./filename-metadata.js";

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
  for (const row of database.prepare(`SELECT ${column} AS id, pattern FROM ${table} ORDER BY pattern COLLATE NOCASE`).all() as Array<{ id: number; pattern: string }>) {
    byId.set(row.id, [...(byId.get(row.id) ?? []), row.pattern]);
  }
  return entries.map((entry) => ({ ...entry, patterns: byId.get(entry.id) ?? [] }));
}

export async function registerAttributeRoutes(app: FastifyInstance) {
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
