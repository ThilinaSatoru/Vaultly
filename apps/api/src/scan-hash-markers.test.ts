import { expect, test } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { database } from "./database.js";
import { scanSource } from "./scanner.js";

interface Row { id: number; title: string; filename: string; relative_path: string; favorite: number; available: number }

async function fixture(run: (root: string, sourceId: number) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-hash-scan-"));
  const sourceId = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES (?, ?, ?)")
    .run("Hash scan", root, root).lastInsertRowid);
  try { await run(root, sourceId); }
  finally {
    database.prepare("DELETE FROM sources WHERE id = ?").run(sourceId);
    database.prepare("DELETE FROM series WHERE auto_key LIKE ?").run(`${sourceId}|%`);
    await rm(root, { recursive: true, force: true });
  }
}

const rows = (sourceId: number) => database.prepare("SELECT id, title, filename, relative_path, favorite, available FROM media_items WHERE source_id = ? ORDER BY filename")
  .all(sourceId) as unknown as Row[];

test("scan strips every hash, renames media files, resolves collisions, and favourites affected items", async () => {
  await fixture(async (root, sourceId) => {
    for (const filename of ["##Clip#.mp4", "#Sto#ry##.pdf", "##Archive#.cbz", "Story.pdf", "###.pdf"]) {
      await writeFile(path.join(root, filename), filename);
    }
    await scanSource(sourceId, root);
    expect(database.prepare("SELECT status, last_error FROM sources WHERE id = ?").get(sourceId)).toEqual({ status: "ready", last_error: null });
    const items = rows(sourceId);
    expect(items.map((item) => item.filename)).toEqual(["Archive.cbz", "Clip.mp4", "Story (2).pdf", "Story.pdf", "Untitled.pdf"]);
    expect(items.every((item) => !item.title.includes("#") && !item.filename.includes("#") && item.available === 1)).toBe(true);
    expect(items.filter((item) => item.favorite === 0).map((item) => item.filename)).toEqual(["Story.pdf"]);
    expect(await readFile(path.join(root, "Story.pdf"), "utf8")).toBe("Story.pdf");
    expect(await readFile(path.join(root, "Story (2).pdf"), "utf8")).toBe("#Sto#ry##.pdf");
    for (const item of items) expect(await readFile(path.join(root, item.relative_path), "utf8")).toBeTruthy();
    await expect(readFile(path.join(root, "#Sto#ry##.pdf"))).rejects.toMatchObject({ code: "ENOENT" });
    database.prepare("UPDATE media_items SET favorite = 0 WHERE source_id = ?").run(sourceId);
    await scanSource(sourceId, root);
    expect(rows(sourceId).map((item) => item.id)).toEqual(items.map((item) => item.id));
    expect(rows(sourceId).every((item) => item.favorite === 0)).toBe(true);
    database.exec("INSERT INTO media_search(media_search, rank) VALUES ('integrity-check', 1)");
  });
});

test("existing marked titles and filenames keep their IDs, assignments, and collection membership", async () => {
  await fixture(async (root, sourceId) => {
    const names = ["##First#.pdf", "#Second##.pdf", "Plain.pdf"];
    for (const name of names) await writeFile(path.join(root, name), "identical content");
    const insert = database.prepare(`INSERT INTO media_items(source_id, media_type, title, filename, file_extension,
      relative_path, size_bytes, modified_at_ms) VALUES (?, 'story', ?, ?, 'pdf', ?, 17, 1)`);
    const ids = names.map((name) => Number(insert.run(sourceId, name === "Plain.pdf" ? "#Custom## title#" : name.slice(0, -4), name, name).lastInsertRowid));
    const tagId = Number(database.prepare("INSERT INTO tags(name) VALUES (?)").run(`Hash tag ${sourceId}`).lastInsertRowid);
    const seriesId = Number(database.prepare("INSERT INTO series(title) VALUES ('Hash collection')").run().lastInsertRowid);
    try {
      database.prepare("INSERT INTO item_tags(item_id, tag_id) VALUES (?, ?)").run(ids[0], tagId);
      database.prepare("INSERT INTO series_items(series_id, item_id, position) VALUES (?, ?, 0)").run(seriesId, ids[0]);
      await scanSource(sourceId, root);
      const items = rows(sourceId);
      expect(items.map((item) => item.id).sort()).toEqual([...ids].sort());
      expect(items.map((item) => [item.title, item.filename, item.favorite])).toEqual([
        ["First", "First.pdf", 1], ["Custom title", "Plain.pdf", 1], ["Second", "Second.pdf", 1],
      ]);
      expect(database.prepare("SELECT tag_id FROM item_tags WHERE item_id = ?").all(ids[0])).toEqual([{ tag_id: tagId }]);
      expect(database.prepare("SELECT item_id FROM series_items WHERE series_id = ?").all(seriesId)).toEqual([{ item_id: ids[0] }]);
      await scanSource(sourceId, root);
      expect(rows(sourceId)).toEqual(items);
    } finally {
      database.prepare("DELETE FROM tags WHERE id = ?").run(tagId);
      database.prepare("DELETE FROM series WHERE id = ?").run(seriesId);
    }
  });
});

test("comic folder renames update nested indexed paths and preserve all existing IDs", async () => {
  await fixture(async (root, sourceId) => {
    await mkdir(path.join(root, "##Comic#", "#Nested##"), { recursive: true });
    await writeFile(path.join(root, "##Comic#", "001.jpg"), "page");
    await writeFile(path.join(root, "##Comic#", "#Nested##", "001.jpg"), "nested page");
    await writeFile(path.join(root, "##Comic#", "#Nested##", "#Movie#.mp4"), "movie");
    const insert = database.prepare(`INSERT INTO media_items(source_id, media_type, title, filename, file_extension,
      relative_path) VALUES (?, ?, ?, ?, ?, ?)`);
    const originals = [
      ["comic", "##Comic#", "", "##Comic#"],
      ["comic", "#Nested##", "", path.join("##Comic#", "#Nested##")],
      ["video", "#Movie#.mp4", "mp4", path.join("##Comic#", "#Nested##", "#Movie#.mp4")],
    ];
    const ids = originals.map(([type, name, extension, relativePath]) => Number(insert.run(sourceId, type, name, name, extension, relativePath).lastInsertRowid));
    await scanSource(sourceId, root);
    const items = rows(sourceId);
    expect(items.map((item) => item.id).sort()).toEqual([...ids].sort());
    expect(items.map((item) => item.relative_path).sort()).toEqual(["Comic", path.join("Comic", "Nested"), path.join("Comic", "Nested", "Movie.mp4")].sort());
    expect(items.every((item) => item.favorite === 1 && item.available === 1)).toBe(true);
    expect(await readFile(path.join(root, "Comic", "Nested", "Movie.mp4"), "utf8")).toBe("movie");
    expect(await readFile(path.join(root, "Comic", "Nested", "001.jpg"), "utf8")).toBe("nested page");
    await scanSource(sourceId, root);
    expect(rows(sourceId)).toEqual(items);
  });
});

test("a source-root comic gets a clean title and favourite without moving its source directory", async () => {
  await fixture(async (root, sourceId) => {
    const comicRoot = path.join(root, "##Root# comic##");
    await mkdir(comicRoot);
    await writeFile(path.join(comicRoot, "001.jpg"), "page");
    database.prepare("UPDATE sources SET root_path = ?, normalized_path = ? WHERE id = ?").run(comicRoot, comicRoot, sourceId);
    await scanSource(sourceId, comicRoot);
    expect(rows(sourceId)).toMatchObject([{ title: "Root comic", relative_path: ".", favorite: 1 }]);
    database.prepare("UPDATE media_items SET favorite = 0 WHERE source_id = ?").run(sourceId);
    await scanSource(sourceId, comicRoot);
    expect(rows(sourceId)).toMatchObject([{ title: "Root comic", relative_path: ".", favorite: 0 }]);
    expect(await readFile(path.join(comicRoot, "001.jpg"), "utf8")).toBe("page");
  });
});

test("a failed index update rolls the filesystem rename back", async () => {
  await fixture(async (root, sourceId) => {
    await writeFile(path.join(root, "##Rollback#.pdf"), "original");
    database.exec(`CREATE TEMP TRIGGER reject_hash_scan_insert BEFORE INSERT ON media_items
      WHEN NEW.source_id = ${sourceId} BEGIN SELECT RAISE(ABORT, 'Forced index failure'); END;`);
    try {
      await scanSource(sourceId, root);
      expect(database.prepare("SELECT status, last_error FROM sources WHERE id = ?").get(sourceId))
        .toEqual({ status: "error", last_error: "Forced index failure" });
      expect(rows(sourceId)).toEqual([]);
      expect(await readFile(path.join(root, "##Rollback#.pdf"), "utf8")).toBe("original");
      await expect(readFile(path.join(root, "Rollback.pdf"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { database.exec("DROP TRIGGER reject_hash_scan_insert"); }
  });
});
