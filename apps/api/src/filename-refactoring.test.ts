import { afterAll, expect, test, vi } from "vitest";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
const isolated = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "vaultly-refactoring-"));
  const previous = process.env.VAULTLY_RUNTIME_DIR;
  process.env.VAULTLY_RUNTIME_DIR = directory;
  return { directory, previous };
});
vi.mock("./thumbnails.js", () => ({
  getVideoMetadata: vi.fn().mockResolvedValue({ durationSeconds: 10, width: 1920, height: 1080 }),
  clearThumbnailCache: vi.fn(), getPdfThumbnail: vi.fn(), getVideoThumbnail: vi.fn(),
  getThumbnailActivity: () => ({ thumbnails: 0, metadata: 0, running: 0 }),
}));
import { database } from "./database.js";
import { refactoredFilename, refactorSourceFilenames } from "./filename-refactoring.js";
import { getScanProgress, scanSource } from "./scanner.js";
import { buildVaultlyServer } from "./server.js";

afterAll(async () => {
  database.close();
  if (isolated.previous === undefined) delete process.env.VAULTLY_RUNTIME_DIR;
  else process.env.VAULTLY_RUNTIME_DIR = isolated.previous;
  await rm(isolated.directory, { recursive: true, force: true });
});

const jane = { id: 1, name: "Jane Doe", patterns: ["JD"] };
const tag = { id: 2, name: "Travel diary", patterns: ["vacation"] };
test("cleans names, aliases, brackets and junk separators before composing a stable filename", () => {
  const result = refactoredFilename("[JD]..An__Evening-vacation.#Travel_diary.MP4", [jane], [tag], [jane, tag]);
  expect(result).toEqual({ filename: "Jane Doe - An Evening #Travel_diary.MP4", title: "Jane Doe - An Evening #Travel_diary.MP4" });
  expect(refactoredFilename(result.filename, [jane], [tag], [jane, tag])).toEqual(result);
  expect(refactoredFilename("lone__title.mkv", [], [], []).filename).toBe("lone title.mkv");
  expect(refactoredFilename("JD.mp4", [jane], [], [jane]).filename).toBe("Jane Doe - Untitled.mp4");
  expect(refactoredFilename("CON.mp4", [], [], []).filename).toBe("_CON.mp4");
});

test("bounded Unicode filenames keep their extension and attributes", () => {
  const result = refactoredFilename(`${"語".repeat(150)}.mp4`, [jane], [tag], [jane, tag]);
  expect(Buffer.byteLength(result.filename)).toBeLessThanOrEqual(240);
  expect(result.title).toBe(result.filename);
  expect(result.filename).toMatch(/^Jane Doe - 語+ #Travel_diary\.mp4$/);
});

test("opt-in scan keeps IDs, credits, favorites, collections, sidecar covers and subtitles", async () => {
  const root = path.join(isolated.directory, "media");
  await mkdir(root);
  const original = "JD__Evening.vacation.mp4";
  await writeFile(path.join(root, original), "original video bytes");
  const sourceId = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path, media_type) VALUES ('Files', ?, ?, 'movies')").run(root, root).lastInsertRowid);
  const castId = Number(database.prepare("INSERT INTO people(name) VALUES ('Jane Doe')").run().lastInsertRowid);
  database.prepare("INSERT INTO person_patterns(person_id, pattern) VALUES (?, 'JD')").run(castId);
  const tagId = Number(database.prepare("INSERT INTO tags(name) VALUES ('Travel diary')").run().lastInsertRowid);
  database.prepare("INSERT INTO tag_patterns(tag_id, pattern) VALUES (?, 'vacation')").run(tagId);
  await scanSource(sourceId, root, { refactorFilenames: true });
  expect(await readdir(root)).toEqual([original]); // Disabled by default.
  const item = database.prepare("SELECT * FROM media_items WHERE source_id = ?").get(sourceId) as { id: number };
  database.prepare("UPDATE media_items SET favorite = 1, title = 'Old custom title' WHERE id = ?").run(item.id);
  const series = Number(database.prepare("INSERT INTO series(title) VALUES ('Saved collection')").run().lastInsertRowid);
  database.prepare("INSERT INTO series_items(series_id, item_id, position) VALUES (?, ?, 0)").run(series, item.id);
  database.prepare("UPDATE sources SET filename_refactoring = 1 WHERE id = ?").run(sourceId);
  await scanSource(sourceId, root); // Enabling alone never renames.
  expect(await readdir(root)).toEqual([original]);
  const cover = `${path.basename(original, ".mp4")}.jpg`;
  const subtitle = `${path.basename(original, ".mp4")}.en.srt`;
  await writeFile(path.join(root, cover), createCanvas(10, 10).toBuffer("image/png"));
  await writeFile(path.join(root, subtitle), "1\n00:00:00,000 --> 00:00:01,000\nHello\n");
  await scanSource(sourceId, root);
  const before = await stat(path.join(root, original));
  await scanSource(sourceId, root, { refactorFilenames: true });
  const filename = "Jane Doe - Evening #Travel_diary.mp4";
  const expectedFiles = [filename, "Jane Doe - Evening #Travel_diary.en.srt", cover].sort();
  expect((await readdir(root)).sort()).toEqual(expectedFiles);
  expect(await readFile(path.join(root, filename), "utf8")).toBe("original video bytes");
  expect((await stat(path.join(root, filename))).mtimeMs).toBeCloseTo(before.mtimeMs, 1);
  expect(database.prepare("SELECT id, relative_path, filename, title, favorite FROM media_items WHERE source_id = ?").get(sourceId)).toEqual({ id: item.id, relative_path: filename, filename, title: filename, favorite: 1 });
  expect(database.prepare("SELECT person_id FROM item_people WHERE item_id = ? AND role = 'cast'").get(item.id)).toMatchObject({ person_id: castId });
  expect(database.prepare("SELECT tag_id FROM item_tags WHERE item_id = ?").get(item.id)).toMatchObject({ tag_id: tagId });
  expect(database.prepare("SELECT series_id FROM series_items WHERE item_id = ?").get(item.id)).toMatchObject({ series_id: series });
  expect(database.prepare("SELECT cover_path FROM media_items WHERE id = ?").get(item.id)).toMatchObject({ cover_path: cover });
  database.prepare("UPDATE media_items SET title = 'Stale title' WHERE id = ?").run(item.id);
  await scanSource(sourceId, root, { refactorFilenames: true });
  expect(database.prepare("SELECT title FROM media_items WHERE id = ?").get(item.id)).toEqual({ title: filename });
  database.prepare("UPDATE media_items SET title = 'Stale after refactor' WHERE id = ?").run(item.id);
  await scanSource(sourceId, root);
  expect(database.prepare("SELECT title FROM media_items WHERE id = ?").get(item.id)).toEqual({ title: filename });
  expect((await readdir(root)).sort()).toEqual(expectedFiles);
  expect(database.prepare("SELECT cover_path FROM media_items WHERE id = ?").get(item.id)).toMatchObject({ cover_path: cover });
  expect(database.prepare("SELECT COUNT(*) AS count FROM media_items WHERE source_id = ?").get(sourceId)).toMatchObject({ count: 1 });
  expect(getScanProgress(sourceId)).toBeNull();
});

test("conflicts never overwrite files and aborted refactoring leaves paths intact", async () => {
  const root = path.join(isolated.directory, "conflicts");
  await mkdir(root);
  await writeFile(path.join(root, "a__b.mp4"), "keep original");
  await writeFile(path.join(root, "a b.mp4"), "keep destination");
  const sourceId = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES ('Conflicts', ?, ?)").run(root, root).lastInsertRowid);
  const id = Number(database.prepare("INSERT INTO media_items(source_id, media_type, filename, relative_path, title) VALUES (?, 'video', 'a__b.mp4', 'a__b.mp4', 'Custom title')").run(sourceId).lastInsertRowid);
  const item = { filename: "a__b.mp4", relativePath: "a__b.mp4", title: "Custom title", fileExtension: "mp4" };
  const logs: string[] = [];
  await refactorSourceFilenames(sourceId, root, [{ id, item }], new AbortController().signal, (message) => logs.push(message));
  expect(logs.some((line) => line.includes("Skipped"))).toBe(true);
  expect(await readFile(path.join(root, "a b.mp4"), "utf8")).toBe("keep destination");
  expect(await readFile(path.join(root, "a__b.mp4"), "utf8")).toBe("keep original");
  const controller = new AbortController(); controller.abort();
  await expect(refactorSourceFilenames(sourceId, root, [{ id, item }], controller.signal, () => undefined)).rejects.toThrow();
  expect(database.prepare("SELECT relative_path, title FROM media_items WHERE id = ?").get(id)).toEqual({ relative_path: "a__b.mp4", title: "Custom title" });
});

test("API requires source opt-in and explicit per-run confirmation", async () => {
  const app = await buildVaultlyServer(); app.log.level = "silent";
  try {
    const source = database.prepare("SELECT id FROM sources WHERE name = 'Conflicts'").get() as { id: number };
    const url = `/api/sources/${source.id}/scan`;
    expect((await app.inject({ method: "POST", url, payload: { refactorFilenames: true } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/sources/scan", payload: { refactorFilenames: true } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url, payload: { refactorFilenames: true, confirmFilenameChanges: true } })).statusCode).toBe(409);
    expect((await app.inject({ method: "PATCH", url: `/api/sources/${source.id}/filename-refactoring`, payload: { enabled: true } })).statusCode).toBe(200);
    expect(database.prepare("SELECT filename_refactoring FROM sources WHERE id = ?").get(source.id)).toMatchObject({ filename_refactoring: 1 });
    expect((await app.inject({ method: "POST", url, payload: { refactorFilenames: true, confirmFilenameChanges: true } })).statusCode).toBe(202);
  } finally { await app.close(); }
});
