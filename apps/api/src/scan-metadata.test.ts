import { expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
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
    sourceId = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path, media_type) VALUES (?, ?, ?, 'ebooks')").run(token, root, root).lastInsertRowid);
    await scanSource(sourceId, root);
    const item = database.prepare("SELECT id FROM media_items WHERE source_id = ?").get(sourceId) as { id: number };
    database.exec(`CREATE TEMP TABLE scan_writes(id INTEGER);
      CREATE TEMP TRIGGER count_scan_writes AFTER UPDATE ON media_items BEGIN INSERT INTO scan_writes VALUES (new.id); END;`);
    await scanSource(sourceId, root);
    expect(database.prepare("SELECT * FROM scan_writes").all()).toEqual([]);
    const coverPath = path.join(root, "Stable-cover.png");
    for (const [width, height] of [[120, 180], [180, 120]]) {
      await writeFile(coverPath, createCanvas(width, height).toBuffer("image/png"));
      await scanSource(sourceId, root);
      expect(database.prepare("SELECT cover_path, cover_width, cover_height FROM media_items WHERE id = ?").get(item.id))
        .toEqual({ cover_path: "Stable-cover.png", cover_width: width, cover_height: height });
      expect(database.prepare("SELECT * FROM scan_writes").all()).toEqual([{ id: item.id }]);
      database.exec("DELETE FROM scan_writes");
      await scanSource(sourceId, root);
      expect(database.prepare("SELECT * FROM scan_writes").all()).toEqual([]);
    }
    await rm(coverPath);
    await scanSource(sourceId, root);
    expect(database.prepare("SELECT cover_path, cover_width, cover_height, cover_signature FROM media_items WHERE id = ?").get(item.id))
      .toEqual({ cover_path: null, cover_width: null, cover_height: null, cover_signature: null });
    expect(database.prepare("SELECT * FROM scan_writes").all()).toEqual([{ id: item.id }]);
    database.exec("DELETE FROM scan_writes");
    await scanSource(sourceId, root);
    expect(database.prepare("SELECT * FROM scan_writes").all()).toEqual([]);
    await rename(path.join(root, "Stable.pdf"), path.join(root, "Stable.unsupported"));
    await scanSource(sourceId, root);
    expect(database.prepare("SELECT indexed, available FROM media_items WHERE id = ?").get(item.id)).toEqual({ indexed: 0, available: 0 });
    await rename(path.join(root, "Stable.unsupported"), path.join(root, "Stable.pdf"));
    await scanSource(sourceId, root);
    expect(database.prepare("SELECT indexed, available FROM media_items WHERE id = ?").get(item.id)).toEqual({ indexed: 1, available: 1 });
    database.exec("INSERT INTO media_search(media_search, rank) VALUES ('integrity-check', 1)");
  } finally {
    database.exec("DROP TRIGGER IF EXISTS count_scan_writes; DROP TABLE IF EXISTS scan_writes;");
    if (sourceId) database.prepare("DELETE FROM sources WHERE id = ?").run(sourceId);
    await rm(root, { recursive: true, force: true });
  }
});

test("scan groups videos by their dedicated folder and extends the ordered collection", async () => {
  const token = `Scan Set ${randomUUID().slice(0, 8)}`;
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-series-"));
  let sourceId = 0;
  let seriesId = 0;
  try {
    const folder = path.join(root, token);
    await mkdir(folder);
    await Promise.all([
      writeFile(path.join(folder, "Episode 10.mp4"), "two"),
      writeFile(path.join(folder, "Episode 02.mp4"), "one"),
    ]);
    sourceId = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES (?, ?, ?)")
      .run(token, root, process.platform === "win32" ? root.toLowerCase() : root).lastInsertRowid);
    await scanSource(sourceId, root);
    const series = database.prepare("SELECT id, title, auto_key FROM series WHERE title = ?").get(token) as { id: number; title: string; auto_key: string };
    seriesId = series.id;
    expect(series.auto_key).toBeTruthy();
    expect(database.prepare(`SELECT m.filename FROM series_items si JOIN media_items m ON m.id = si.item_id
      WHERE si.series_id = ? ORDER BY si.position, si.item_id`).all(seriesId)).toEqual([
        { filename: "Episode 02.mp4" }, { filename: "Episode 10.mp4" },
      ]);
    await writeFile(path.join(folder, "Episode 11.mp4"), "three");
    await scanSource(sourceId, root);
    expect(database.prepare("SELECT COUNT(*) AS count FROM series_items WHERE series_id = ?").get(seriesId)).toEqual({ count: 3 });
  } finally {
    if (sourceId) database.prepare("DELETE FROM sources WHERE id = ?").run(sourceId);
    if (seriesId) database.prepare("DELETE FROM series WHERE id = ?").run(seriesId);
    await rm(root, { recursive: true, force: true });
  }
});

test("movie and mixed sources group root videos by prefix and retire duplicate legacy sets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-no-video-prefix-"));
  const sources: number[] = [];
  try {
    await Promise.all(["Same title Part 01.mp4", "Same title Part 02.mp4"].map((name) => writeFile(path.join(root, name), name)));
    for (const mediaType of ['movies', 'mixed']) {
      const source = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path, media_type) VALUES (?, ?, ?, ?)")
        .run(`Prefix ${mediaType}`, root, `${root}-${mediaType}`, mediaType).lastInsertRowid);
      sources.push(source);
      await scanSource(source, root);
      const items = database.prepare("SELECT id FROM media_items WHERE source_id = ? ORDER BY id").all(source) as Array<{ id: number }>;
      expect(database.prepare("SELECT si.* FROM series_items si JOIN media_items m ON m.id = si.item_id WHERE m.source_id = ?").all(source)).toHaveLength(2);
      const legacy = Number(database.prepare("INSERT INTO series(title, auto_key) VALUES ('Same title', ?)").run(`${source}|video||same title`).lastInsertRowid);
      const manual = Number(database.prepare("INSERT INTO series(title) VALUES ('My manual grouping')").run().lastInsertRowid);
      for (const [position, item] of items.entries()) {
        database.prepare("INSERT INTO series_items(series_id, item_id, position) VALUES (?, ?, ?)").run(legacy, item.id, position);
        database.prepare("INSERT INTO series_items(series_id, item_id, position) VALUES (?, ?, ?)").run(manual, item.id, position);
      }
      await scanSource(source, root);
      expect(database.prepare("SELECT id FROM series WHERE id = ?").get(legacy)).toBeUndefined();
      expect(database.prepare("SELECT item_id FROM series_items WHERE series_id = ?").all(manual)).toHaveLength(2);
      database.prepare("DELETE FROM series WHERE id = ?").run(manual);
    }
  } finally {
    for (const source of sources) {
      database.prepare("DELETE FROM series WHERE auto_key LIKE ?").run(`${source}|%`);
      database.prepare("DELETE FROM sources WHERE id = ?").run(source);
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("scan synchronizes renamed titles while preserving identity and assignments", async () => {
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
    expect(after).toEqual({ id: before.id, filename: renamed, title: renamed, favorite: 1, available: 1 });
    expect(database.prepare("SELECT tag_id FROM item_tags WHERE item_id = ?").all(before.id)).toEqual([{ tag_id: tagId }]);
    if (process.platform === "win32") {
      const caseRenamed = renamed.toUpperCase();
      await rename(path.join(root, renamed), path.join(root, caseRenamed));
      await scanSource(sourceId, root);
      expect(database.prepare("SELECT id, filename, title FROM media_items WHERE source_id = ? AND available = 1").all(sourceId))
        .toEqual([{ id: before.id, filename: caseRenamed, title: caseRenamed }]);
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
    await scanSource(sourceId, root, { generateThumbnails: false });
    const originals = database.prepare("SELECT id, filename FROM media_items WHERE source_id = ?").all(sourceId) as Array<{ id: number; filename: string }>;
    for (const item of originals) {
      database.prepare("UPDATE media_items SET title = ?, favorite = 1 WHERE id = ?").run(`Custom ${item.id}`, item.id);
      await rename(path.join(root, item.filename), path.join(root, item.filename.replace("Original", "Renamed")));
    }
    await scanSource(sourceId, root, { generateThumbnails: false });
    for (const item of originals) {
      expect(database.prepare("SELECT filename, title, favorite, available FROM media_items WHERE id = ?").get(item.id))
        .toEqual({ filename: item.filename.replace("Original", "Renamed"), title: item.filename.replace("Original", "Renamed"), favorite: 1, available: 1 });
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

test("book rescans reconcile exact automatic memberships and remove obsolete and duplicate sets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-prefix-reconcile-"));
  let sourceId = 0;
  try {
    for (const name of ["Harbor First.pdf", "Harbor Second.pdf", "Harbor Third.pdf"]) await writeFile(path.join(root, name), name);
    sourceId = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path, media_type) VALUES ('Prefix books', ?, ?, 'ebooks')").run(root, root).lastInsertRowid);
    await scanSource(sourceId, root, { generateThumbnails: false });
    const findSets = () => database.prepare("SELECT id, auto_key FROM series WHERE auto_key LIKE ?").all(`${sourceId}|%`) as Array<{ id: number; auto_key: string }>;
    const setId = findSets()[0].id;
    const legacyId = Number(database.prepare("INSERT INTO series(title, auto_key) VALUES ('Harbor', ?)").run(`${sourceId}|story||harbor`).lastInsertRowid);
    database.prepare("INSERT INTO series_items(series_id, item_id, position) SELECT ?, item_id, position FROM series_items WHERE series_id = ?").run(legacyId, setId);
    await scanSource(sourceId, root, { generateThumbnails: false });
    expect(findSets().map((set) => set.id)).toEqual([setId]);
    await rename(path.join(root, "Harbor Third.pdf"), path.join(root, "Meadow Alone.pdf"));
    await scanSource(sourceId, root, { generateThumbnails: false });
    expect(database.prepare("SELECT COUNT(*) AS count FROM series_items WHERE series_id = ?").get(setId)).toEqual({ count: 2 });
    expect(database.prepare("SELECT si.item_id, COUNT(*) AS count FROM series_items si JOIN series s ON s.id=si.series_id WHERE s.auto_key LIKE ? GROUP BY si.item_id HAVING COUNT(*) > 1").all(`${sourceId}|%`)).toEqual([]);
    await rm(path.join(root, "Harbor Second.pdf"));
    await scanSource(sourceId, root, { generateThumbnails: false });
    expect(findSets()).toEqual([]);
  } finally {
    if (sourceId) { database.prepare("DELETE FROM series WHERE auto_key LIKE ?").run(`${sourceId}|%`); database.prepare("DELETE FROM sources WHERE id = ?").run(sourceId); }
    await rm(root, { recursive: true, force: true });
  }
});
