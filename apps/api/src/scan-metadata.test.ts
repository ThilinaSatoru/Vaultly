import { expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { database } from "./database.js";
import { scanSource } from "./scanner.js";

test("rescan adds filename metadata without replacing manually assigned tags", async () => {
  const token = randomUUID().slice(0, 12);
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-metadata-"));
  const parentName = `Parent ${token}`;
  const categoryName = `Category ${token}`;
  const tagName = `Tag ${token}`;
  const personName = `Person ${token}`;
  const filename = `${categoryName} - ${tagName} - ${personName}.pdf`;
  const created: { source?: number; category?: number; parentCategory?: number; tag?: number; manualTag?: number; person?: number } = {};

  try {
    await mkdir(path.join(root, parentName));
    await writeFile(path.join(root, parentName, filename), "pdf fixture");
    created.source = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES (?, ?, ?)")
      .run(`Test ${token}`, root, process.platform === "win32" ? root.toLowerCase() : root).lastInsertRowid);
    created.category = Number(database.prepare("INSERT INTO categories(name) VALUES (?)").run(categoryName).lastInsertRowid);
    created.parentCategory = Number(database.prepare("INSERT INTO categories(name) VALUES (?)").run(parentName).lastInsertRowid);
    created.person = Number(database.prepare("INSERT INTO people(name) VALUES (?)").run(personName).lastInsertRowid);

    // A prior cast credit establishes the person's role; a bare name alone must not guess one.
    const seed = Number(database.prepare(`
      INSERT INTO media_items(source_id, media_type, title, filename, file_extension, relative_path)
      VALUES (?, 'video', 'role seed', 'role-seed.mp4', 'mp4', 'role-seed.mp4')
    `).run(created.source).lastInsertRowid);
    database.prepare("INSERT INTO item_people(item_id, person_id, role) VALUES (?, ?, 'cast')").run(seed, created.person);

    await scanSource(created.source, root);
    expect((database.prepare("SELECT status FROM sources WHERE id = ?").get(created.source) as { status: string }).status).toBe("ready");
    const item = database.prepare("SELECT id FROM media_items WHERE source_id = ? AND filename = ?")
      .get(created.source, filename) as { id: number };
    expect(database.prepare("SELECT category_id FROM item_categories WHERE item_id = ?").all(item.id))
      .toEqual([{ category_id: created.category }]);
    expect(database.prepare("SELECT role FROM item_people WHERE item_id = ?").all(item.id))
      .toEqual([{ role: "cast" }]);

    created.manualTag = Number(database.prepare("INSERT INTO tags(name) VALUES (?)").run(`Manual ${token}`).lastInsertRowid);
    database.prepare("INSERT INTO item_tags(item_id, tag_id) VALUES (?, ?)").run(item.id, created.manualTag);
    created.tag = Number(database.prepare("INSERT INTO tags(name) VALUES (?)").run(tagName).lastInsertRowid);

    await scanSource(created.source, root);
    await scanSource(created.source, root);
    const tagRows = database.prepare("SELECT tag_id FROM item_tags WHERE item_id = ? ORDER BY tag_id").all(item.id) as unknown as Array<{ tag_id: number }>;
    const tagIds = tagRows.map((entry) => entry.tag_id);
    expect(tagIds).toEqual([created.manualTag, created.tag].sort((a, b) => a - b));
    expect(database.prepare("SELECT COUNT(*) AS count FROM item_categories WHERE item_id = ?").get(item.id))
      .toEqual({ count: 1 });
  } finally {
    if (created.source) database.prepare("DELETE FROM sources WHERE id = ?").run(created.source);
    if (created.category) database.prepare("DELETE FROM categories WHERE id = ?").run(created.category);
    if (created.parentCategory) database.prepare("DELETE FROM categories WHERE id = ?").run(created.parentCategory);
    if (created.tag) database.prepare("DELETE FROM tags WHERE id = ?").run(created.tag);
    if (created.manualTag) database.prepare("DELETE FROM tags WHERE id = ?").run(created.manualTag);
    if (created.person) database.prepare("DELETE FROM people WHERE id = ?").run(created.person);
    await rm(root, { recursive: true, force: true });
  }
});
