import { expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, utimes, writeFile } from "node:fs/promises";
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
    await writeFile(path.join(root, `${personName}.mp4`), "video fixture");
    created.source = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES (?, ?, ?)")
      .run(`Test ${token}`, root, process.platform === "win32" ? root.toLowerCase() : root).lastInsertRowid);
    created.category = Number(database.prepare("INSERT INTO categories(name) VALUES (?)").run(categoryName).lastInsertRowid);
    created.parentCategory = Number(database.prepare("INSERT INTO categories(name) VALUES (?)").run(parentName).lastInsertRowid);
    created.person = Number(database.prepare("INSERT INTO people(name) VALUES (?)").run(personName).lastInsertRowid);

    await scanSource(created.source, root);
    expect((database.prepare("SELECT status FROM sources WHERE id = ?").get(created.source) as { status: string }).status).toBe("ready");
    const item = database.prepare("SELECT id FROM media_items WHERE source_id = ? AND filename = ?")
      .get(created.source, filename) as { id: number };
    expect(database.prepare("SELECT category_id FROM item_categories WHERE item_id = ?").all(item.id))
      .toEqual([{ category_id: created.category }]);
    expect(database.prepare("SELECT role FROM item_people WHERE item_id = ?").all(item.id))
      .toEqual([{ role: "artist" }]);
    const video = database.prepare("SELECT id FROM media_items WHERE source_id = ? AND media_type = 'video'").get(created.source) as { id: number };
    expect(database.prepare("SELECT role FROM item_people WHERE item_id = ?").all(video.id))
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

test("unchanged rescans avoid media writes while removed and returning files update availability", async () => {
  const token = randomUUID();
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-incremental-"));
  let sourceId = 0;
  try {
    await writeFile(path.join(root, "Stable.pdf"), "stable fixture");
    sourceId = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES (?, ?, ?)").run(token, root, root).lastInsertRowid);
    await scanSource(sourceId, root);
    const item = database.prepare("SELECT id FROM media_items WHERE source_id = ?").get(sourceId) as { id: number };
    database.exec(`CREATE TEMP TABLE scan_writes(id INTEGER);
      CREATE TEMP TRIGGER count_scan_writes AFTER UPDATE ON media_items BEGIN INSERT INTO scan_writes VALUES (new.id); END;`);
    await scanSource(sourceId, root);
    expect(database.prepare("SELECT * FROM scan_writes").all()).toEqual([]);
    await rename(path.join(root, "Stable.pdf"), path.join(root, "Stable.txt"));
    await scanSource(sourceId, root);
    expect(database.prepare("SELECT indexed, available FROM media_items WHERE id = ?").get(item.id)).toEqual({ indexed: 0, available: 0 });
    await rename(path.join(root, "Stable.txt"), path.join(root, "Stable.pdf"));
    await scanSource(sourceId, root);
    expect(database.prepare("SELECT indexed, available FROM media_items WHERE id = ?").get(item.id)).toEqual({ indexed: 1, available: 1 });
    database.exec("INSERT INTO media_search(media_search, rank) VALUES ('integrity-check', 1)");
  } finally {
    database.exec("DROP TRIGGER IF EXISTS count_scan_writes; DROP TABLE IF EXISTS scan_writes;");
    if (sourceId) database.prepare("DELETE FROM sources WHERE id = ?").run(sourceId);
    await rm(root, { recursive: true, force: true });
  }
});

test("scan creates and extends an ordered collection from matching sequel prefixes", async () => {
  const token = `Scan Set ${randomUUID().slice(0, 8)}`;
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-series-"));
  let sourceId = 0;
  let seriesId = 0;
  try {
    await Promise.all([
      writeFile(path.join(root, `${token} Part 02.mp4`), "two"),
      writeFile(path.join(root, `${token} Part 01.mp4`), "one"),
    ]);
    sourceId = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES (?, ?, ?)")
      .run(token, root, process.platform === "win32" ? root.toLowerCase() : root).lastInsertRowid);
    await scanSource(sourceId, root);
    const series = database.prepare("SELECT id, title, auto_key FROM series WHERE title = ?").get(token) as { id: number; title: string; auto_key: string };
    seriesId = series.id;
    expect(series.auto_key).toBeTruthy();
    expect(database.prepare(`SELECT m.filename FROM series_items si JOIN media_items m ON m.id = si.item_id
      WHERE si.series_id = ? ORDER BY si.position, si.item_id`).all(seriesId)).toEqual([
        { filename: `${token} Part 01.mp4` }, { filename: `${token} Part 02.mp4` },
      ]);
    await writeFile(path.join(root, `${token} Part 03.mp4`), "three");
    await scanSource(sourceId, root);
    expect(database.prepare("SELECT COUNT(*) AS count FROM series_items WHERE series_id = ?").get(seriesId)).toEqual({ count: 3 });
  } finally {
    if (sourceId) database.prepare("DELETE FROM sources WHERE id = ?").run(sourceId);
    if (seriesId) database.prepare("DELETE FROM series WHERE id = ?").run(seriesId);
    await rm(root, { recursive: true, force: true });
  }
});

test("scan preserves an item's identity and metadata after an external rename", async () => {
  const token = randomUUID().slice(0, 10);
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-rename-"));
  let sourceId = 0;
  let tagId = 0;
  try {
    const original = `Original ${token}.pdf`;
    const renamed = `Renamed ${token}.pdf`;
    await writeFile(path.join(root, original), "stable content for rename reconciliation");
    sourceId = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES (?, ?, ?)")
      .run(token, root, process.platform === "win32" ? root.toLowerCase() : root).lastInsertRowid);
    await scanSource(sourceId, root);
    const before = database.prepare("SELECT id FROM media_items WHERE source_id = ? AND filename = ?")
      .get(sourceId, original) as { id: number };
    tagId = Number(database.prepare("INSERT INTO tags(name) VALUES (?)").run(`Rename ${token}`).lastInsertRowid);
    database.prepare("INSERT INTO item_tags(item_id, tag_id) VALUES (?, ?)").run(before.id, tagId);
    database.prepare("UPDATE media_items SET favorite = 1, title = 'My preserved title' WHERE id = ?").run(before.id);

    await rename(path.join(root, original), path.join(root, renamed));
    await scanSource(sourceId, root);

    const after = database.prepare("SELECT id, filename, title, favorite, available FROM media_items WHERE id = ?")
      .get(before.id);
    expect(after).toEqual({ id: before.id, filename: renamed, title: "My preserved title", favorite: 1, available: 1 });
    expect(database.prepare("SELECT tag_id FROM item_tags WHERE item_id = ?").all(before.id)).toEqual([{ tag_id: tagId }]);
    if (process.platform === "win32") {
      const caseRenamed = renamed.toUpperCase();
      await rename(path.join(root, renamed), path.join(root, caseRenamed));
      await scanSource(sourceId, root);
      expect(database.prepare("SELECT id, filename, title FROM media_items WHERE source_id = ? AND available = 1").all(sourceId))
        .toEqual([{ id: before.id, filename: caseRenamed, title: "My preserved title" }]);
    }
  } finally {
    if (sourceId) database.prepare("DELETE FROM sources WHERE id = ?").run(sourceId);
    if (tagId) database.prepare("DELETE FROM tags WHERE id = ?").run(tagId);
    await rm(root, { recursive: true, force: true });
  }
});

test("batch renames preserve distinct identities when many documents share the same size", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-batch-rename-"));
  let sourceId = 0;
  try {
    for (let index = 0; index < 32; index++) {
      const file = path.join(root, `Original-${index}.pdf`);
      await writeFile(file, "equal size");
      const modified = new Date(1_700_000_000_000 + index * 1000);
      await utimes(file, modified, modified);
    }
    sourceId = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES (?, ?, ?)").run("Batch rename", root, root).lastInsertRowid);
    await scanSource(sourceId, root);
    const originals = database.prepare("SELECT id, filename FROM media_items WHERE source_id = ?").all(sourceId) as Array<{ id: number; filename: string }>;
    for (const item of originals) {
      database.prepare("UPDATE media_items SET title = ?, favorite = 1 WHERE id = ?").run(`Custom ${item.id}`, item.id);
      await rename(path.join(root, item.filename), path.join(root, item.filename.replace("Original", "Renamed")));
    }
    await scanSource(sourceId, root);
    for (const item of originals) {
      expect(database.prepare("SELECT filename, title, favorite, available FROM media_items WHERE id = ?").get(item.id))
        .toEqual({ filename: item.filename.replace("Original", "Renamed"), title: `Custom ${item.id}`, favorite: 1, available: 1 });
    }
    expect(database.prepare("SELECT COUNT(*) AS count FROM media_items WHERE source_id = ?").get(sourceId)).toEqual({ count: 32 });
  } finally {
    if (sourceId) {
      database.prepare("DELETE FROM sources WHERE id = ?").run(sourceId);
      database.prepare("DELETE FROM series WHERE auto_key LIKE ?").run(`${sourceId}|%`);
    }
    await rm(root, { recursive: true, force: true });
  }
});
