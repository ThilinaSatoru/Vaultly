import { expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { database } from "./database.js";
import { buildVaultlyServer } from "./server.js";
import { scanSource } from "./scanner.js";
import { normalizeMetadataPhrase } from "./filename-metadata.js";

test("patterns and inherited source attributes work across scans, queries, edits and backups", async () => {
  const token = randomUUID();
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-attributes-"));
  const app = await buildVaultlyServer();
  app.log.level = "silent";
  let sourceId = 0;
  let secondSourceId = 0;
  const tags: number[] = [], categories: number[] = [], people: number[] = [];
  const create = (table: "tags" | "categories" | "people", name: string) => {
    const id = Number(database.prepare(`INSERT INTO ${table}(name) VALUES (?)`).run(`${name} ${token}`).lastInsertRowid);
    (table === "tags" ? tags : table === "categories" ? categories : people).push(id);
    return id;
  };
  try {
    sourceId = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES (?, ?, ?)").run(token, root, root.toLowerCase()).lastInsertRowid);
    const aliasTag = create("tags", "Canonical tag"), commonTag = create("tags", "Common tag"), manualTag = create("tags", "Manual tag");
    const aliasCategory = create("categories", "Canonical category"), commonCategory = create("categories", "Common category");
    const person = create("people", "Canonical person");
    const aliases = { tag: `Tag alias ${token}`, category: `Category alias ${token}`, person: `Person alias ${token}` };
    for (const [kind, id, alias] of [["tags", aliasTag, aliases.tag], ["categories", aliasCategory, aliases.category], ["people", person, aliases.person]] as const) {
      const response = await app.inject({ method: "PUT", url: `/api/attributes/${kind}/${id}/patterns`, payload: { patterns: [alias, alias.toUpperCase(), `${alias} extra`] } });
      expect(response.statusCode).toBe(200);
      expect(response.json().patterns).toHaveLength(2);
      expect((await app.inject(`/api/attributes/${kind}/${id}/patterns`)).json().patterns).toHaveLength(2);
      const listed = (await app.inject(`/api/${kind}`)).json().find((entry: { id: number }) => entry.id === id);
      expect(listed.patterns.map((pattern: string) => pattern.toLowerCase()))
        .toEqual(expect.arrayContaining([alias.toLowerCase(), `${alias} extra`.toLowerCase()]));
    }
    const reversed = (alias: string, separator: string) => normalizeMetadataPhrase(alias).split(" ").reverse().join(separator);
    const firstName = `${reversed(aliases.tag, " ")} - ${reversed(aliases.category, "")} - ${reversed(aliases.person, "")}.pdf`;
    await writeFile(path.join(root, firstName), "fixture");
    await scanSource(sourceId, root);
    const item = database.prepare("SELECT id FROM media_items WHERE source_id = ? AND filename = ?").get(sourceId, firstName) as { id: number };
    database.prepare("INSERT INTO item_tags(item_id, tag_id) VALUES (?, ?)").run(item.id, manualTag);
    expect(database.prepare("SELECT tag_id FROM item_tags WHERE item_id = ? ORDER BY tag_id").all(item.id)).toEqual([aliasTag, manualTag].sort((a, b) => a - b).map((tag_id) => ({ tag_id })));
    expect(database.prepare("SELECT person_id, role FROM item_people WHERE item_id = ?").all(item.id)).toEqual([{ person_id: person, role: "artist" }]);
    expect((await app.inject({ method: "PUT", url: `/api/sources/${sourceId}/attributes`, payload: { tagIds: [commonTag, commonTag], categoryIds: [commonCategory] } })).statusCode).toBe(200);
    const detail = (await app.inject(`/api/items/${item.id}`)).json();
    expect(detail.source_attributes.tags.map((tag: { id: number }) => tag.id)).toEqual([commonTag]);
    expect(detail.tags.map((tag: { id: number }) => tag.id).sort()).toEqual([aliasTag, commonTag, manualTag].sort());
    expect(detail.category_ids.sort()).toEqual([aliasCategory, commonCategory].sort());
    expect((await app.inject(`/api/items?tags=${commonTag}&categories=${commonCategory}&source=${sourceId}`)).json().total).toBe(1);
    const source = (await app.inject("/api/sources")).json().find((entry: { id: number }) => entry.id === sourceId);
    expect(source.tags.map((tag: { id: number }) => tag.id)).toEqual([commonTag]);
    // Saving effective attributes in the viewer must not copy inherited ones into manual rows.
    expect((await app.inject({ method: "PUT", url: `/api/items/${item.id}/tags`, payload: { tagIds: detail.tags.map((tag: { id: number }) => tag.id) } })).statusCode).toBe(200);
    expect((await app.inject({ method: "PUT", url: `/api/items/${item.id}/categories`, payload: { categoryIds: detail.category_ids } })).statusCode).toBe(200);
    expect(database.prepare("SELECT tag_id FROM item_tags WHERE item_id = ? AND tag_id = ?").get(item.id, commonTag)).toBeUndefined();
    expect(database.prepare("SELECT category_id FROM item_categories WHERE item_id = ? AND category_id = ?").get(item.id, commonCategory)).toBeUndefined();
    await writeFile(path.join(root, "unrelated.pdf"), "new fixture");
    await scanSource(sourceId, root);
    await scanSource(sourceId, root);
    expect((await app.inject(`/api/items?tags=${commonTag}&categories=${commonCategory}&source=${sourceId}`)).json().total).toBe(2);
    const tagCounts = (await app.inject("/api/tags")).json();
    expect(tagCounts.find((tag: { id: number }) => tag.id === commonTag).item_count).toBe(2);
    const backup = (await app.inject("/api/backup")).json();
    expect(backup.data.source_tags).toContainEqual({ source_id: sourceId, tag_id: commonTag });
    expect(backup.data.tag_patterns.some((row: { tag_id: number }) => row.tag_id === aliasTag)).toBe(true);
    // Removing inheritance removes only shared attributes, preserving individual assignments.
    await app.inject({ method: "PUT", url: `/api/sources/${sourceId}/attributes`, payload: { tagIds: [], categoryIds: [] } });
    const cleared = (await app.inject(`/api/items/${item.id}`)).json();
    expect(cleared.tags.map((tag: { id: number }) => tag.id).sort()).toEqual([aliasTag, manualTag].sort());
    expect(cleared.category_ids).toEqual([aliasCategory]);
    expect((await app.inject({ method: "PUT", url: `/api/sources/${sourceId}/attributes`, payload: { tagIds: [2147483647] } })).statusCode).toBe(400);
    const invalidPattern = await app.inject({ method: "PUT", url: `/api/attributes/tags/${aliasTag}/patterns`, payload: { patterns: ["***"] } });
    expect(invalidPattern.statusCode, invalidPattern.body).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/api/attributes/tags/2147483647/patterns", payload: { patterns: ["valid alias"] } })).statusCode).toBe(404);
    // An individually assigned attribute survives removal of an overlapping source attribute.
    database.prepare("INSERT INTO item_tags(item_id, tag_id) VALUES (?, ?)").run(item.id, commonTag);
    await app.inject({ method: "PUT", url: `/api/sources/${sourceId}/attributes`, payload: { tagIds: [commonTag] } });
    expect((await app.inject("/api/tags")).json().find((tag: { id: number }) => tag.id === commonTag).item_count).toBe(2);
    await app.inject({ method: "PUT", url: `/api/sources/${sourceId}/attributes`, payload: { tagIds: [] } });
    expect((await app.inject(`/api/items/${item.id}`)).json().tags.some((tag: { id: number }) => tag.id === commonTag)).toBe(true);
    const newRoot = path.join(root, "new-source");
    await mkdir(newRoot);
    await writeFile(path.join(newRoot, "fresh.pdf"), "fixture");
    const added = await app.inject({ method: "POST", url: "/api/sources", payload: { rootPath: newRoot, tagIds: [commonTag], categoryIds: [commonCategory] } });
    expect(added.statusCode).toBe(201);
    secondSourceId = added.json().id;
    expect(added.json().tags.map((tag: { id: number }) => tag.id)).toEqual([commonTag]);
    await scanSource(secondSourceId, newRoot);
    expect((await app.inject(`/api/items?source=${secondSourceId}&tags=${commonTag}&categories=${commonCategory}`)).json().total).toBe(1);
  } finally {
    if (secondSourceId) database.prepare("DELETE FROM sources WHERE id = ?").run(secondSourceId);
    if (sourceId) database.prepare("DELETE FROM sources WHERE id = ?").run(sourceId);
    for (const id of tags) database.prepare("DELETE FROM tags WHERE id = ?").run(id);
    for (const id of categories) database.prepare("DELETE FROM categories WHERE id = ?").run(id);
    for (const id of people) database.prepare("DELETE FROM people WHERE id = ?").run(id);
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
