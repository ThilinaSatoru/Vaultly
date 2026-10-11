import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { database } from "./database.js";
import { scanSource } from "./scanner.js";

test("English scans add descriptive attributes without changing people, manual assignments or source files", async () => {
  const token = randomUUID().slice(0, 8);
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-english-scan-"));
  const filename = `Children ${token} - vacations ${token}.pdf`;
  const source = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES (?, ?, ?)").run(token, root, root).lastInsertRowid);
  const tag = Number(database.prepare("INSERT INTO tags(name) VALUES (?)").run(`Child ${token}`).lastInsertRowid);
  const manual = Number(database.prepare("INSERT INTO tags(name) VALUES (?)").run(`Manual ${token}`).lastInsertRowid);
  const category = Number(database.prepare("INSERT INTO categories(name) VALUES (?)").run(`Holiday ${token}`).lastInsertRowid);
  const person = Number(database.prepare("INSERT INTO people(name) VALUES (?)").run(`Child ${token}`).lastInsertRowid);
  try {
    await writeFile(path.join(root, filename), "pdf fixture");
    await scanSource(source, root);
    const item = database.prepare("SELECT id, filename FROM media_items WHERE source_id = ?").get(source) as { id: number; filename: string };
    expect(item.filename).toBe(filename);
    expect(database.prepare("SELECT tag_id FROM item_tags WHERE item_id = ?").all(item.id)).toEqual([]);
    expect(database.prepare("SELECT category_id FROM item_categories WHERE item_id = ?").all(item.id)).toEqual([]);
    database.prepare("INSERT INTO item_tags(item_id, tag_id) VALUES (?, ?)").run(item.id, manual);
    await scanSource(source, root, { englishAttributes: true });
    await scanSource(source, root, { englishAttributes: true });
    expect(database.prepare("SELECT tag_id FROM item_tags WHERE item_id = ? ORDER BY tag_id").all(item.id))
      .toEqual([tag, manual].sort((a, b) => a - b).map((tag_id) => ({ tag_id })));
    expect(database.prepare("SELECT category_id FROM item_categories WHERE item_id = ?").all(item.id)).toEqual([{ category_id: category }]);
    expect(database.prepare("SELECT person_id FROM item_people WHERE item_id = ?").all(item.id)).toEqual([]);
    await scanSource(source, root);
    expect(database.prepare("SELECT COUNT(*) AS count FROM item_tags WHERE item_id = ?").get(item.id)).toEqual({ count: 2 });
  } finally {
    database.prepare("DELETE FROM sources WHERE id = ?").run(source);
    database.prepare("DELETE FROM tags WHERE id IN (?, ?)").run(tag, manual);
    database.prepare("DELETE FROM categories WHERE id = ?").run(category);
    database.prepare("DELETE FROM people WHERE id = ?").run(person);
    await rm(root, { recursive: true, force: true });
  }
});
