import { afterAll, expect, test, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import { z } from "zod";

const isolated = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "vaultly-media-deletion-"));
  const previous = process.env.VAULTLY_RUNTIME_DIR;
  process.env.VAULTLY_RUNTIME_DIR = directory;
  return { directory, previous };
});
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, unlink: async (file: string) => {
    if (file.endsWith("locked.mp4")) throw Object.assign(new Error("File is locked"), { code: "EACCES" });
    return fs.unlink(file);
  } };
});
import { database } from "./database.js";
import { registerMediaDeletionRoutes } from "./media-deletion.js";

const app = Fastify();
app.setErrorHandler((error, _request, reply) => reply.code(error instanceof z.ZodError ? 400 : 500).send({ message: error.message }));
await app.register(registerMediaDeletionRoutes);
const root = path.join(isolated.directory, "library");
mkdirSync(root);
const source = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES ('Delete tests', ?, ?)").run(root, root).lastInsertRowid);
function item(relative: string, type = "video", sourceId = source) {
  return Number(database.prepare("INSERT INTO media_items(source_id, media_type, title, filename, relative_path) VALUES (?, ?, ?, ?, ?)")
    .run(sourceId, type, relative, path.basename(relative), relative).lastInsertRowid);
}
const exists = (id: number) => Boolean(database.prepare("SELECT id FROM media_items WHERE id = ?").get(id));
const remove = async (id: number) => (await app.inject({ method: "DELETE", url: `/api/items/${id}` })).json();

afterAll(async () => {
  await app.close();
  database.close();
  if (isolated.previous === undefined) delete process.env.VAULTLY_RUNTIME_DIR;
  else process.env.VAULTLY_RUNTIME_DIR = isolated.previous;
  rmSync(isolated.directory, { recursive: true, force: true });
});

test("permanently deletes a file and cascades all metadata and collection assignments", async () => {
  writeFileSync(path.join(root, "movie.mp4"), "video");
  const id = item("movie.mp4");
  const tag = Number(database.prepare("INSERT INTO tags(name) VALUES ('Delete tag')").run().lastInsertRowid);
  const category = Number(database.prepare("INSERT INTO categories(name) VALUES ('Delete category')").run().lastInsertRowid);
  const person = Number(database.prepare("INSERT INTO people(name) VALUES ('Delete person')").run().lastInsertRowid);
  const series = Number(database.prepare("INSERT INTO series(title) VALUES ('Delete set')").run().lastInsertRowid);
  database.prepare("INSERT INTO item_tags(item_id, tag_id) VALUES (?, ?)").run(id, tag);
  database.prepare("INSERT INTO item_categories(item_id, category_id) VALUES (?, ?)").run(id, category);
  database.prepare("INSERT INTO item_people(item_id, person_id, role) VALUES (?, ?, 'cast')").run(id, person);
  database.prepare("INSERT INTO series_items(series_id, item_id, position) VALUES (?, ?, 0)").run(series, id);
  expect(await remove(id)).toEqual({ deletedIds: [id], failures: [] });
  expect(existsSync(path.join(root, "movie.mp4"))).toBe(false);
  expect(exists(id)).toBe(false);
  for (const table of ["item_tags", "item_categories", "item_people", "series_items"]) {
    expect(database.prepare(`SELECT * FROM ${table} WHERE item_id = ?`).all(id)).toEqual([]);
  }
  expect(database.prepare("SELECT id FROM tags WHERE id = ?").get(tag)).toBeDefined();
});

test("bulk deletion deduplicates IDs, clears missing files and preserves failed items", async () => {
  writeFileSync(path.join(root, "book.epub"), "book");
  writeFileSync(path.join(root, "locked.mp4"), "locked");
  const book = item("book.epub", "story"), locked = item("locked.mp4"), missing = item("gone.cbz", "comic");
  const result = (await app.inject({ method: "POST", url: "/api/items/bulk-delete", payload: { itemIds: [book, locked, book, missing] } })).json();
  expect(result.deletedIds).toEqual([book, missing]);
  expect(result.failures).toEqual([{ id: locked, message: "File is locked" }]);
  expect(exists(book)).toBe(false);
  expect(exists(missing)).toBe(false);
  expect(exists(locked)).toBe(true);
  expect(existsSync(path.join(root, "book.epub"))).toBe(false);
  expect(existsSync(path.join(root, "locked.mp4"))).toBe(true);
  expect(await remove(book)).toEqual({ deletedIds: [book], failures: [] });
});

test("comic folders delete their pages while keeping sibling media, subfolders and the source root", async () => {
  mkdirSync(path.join(root, "comic", "other"), { recursive: true });
  for (const file of ["comic/1.jpg", "comic/2.png", "comic/clip.mp4", "comic/meta.json", "comic/other/keep.jpg", "root.jpg"]) writeFileSync(path.join(root, file), "keep or delete");
  const comic = item("comic", "comic");
  expect((await remove(comic)).failures).toEqual([]);
  expect(existsSync(path.join(root, "comic/1.jpg"))).toBe(false);
  expect(existsSync(path.join(root, "comic/2.png"))).toBe(false);
  for (const file of ["comic/clip.mp4", "comic/meta.json", "comic/other/keep.jpg"]) expect(existsSync(path.join(root, file))).toBe(true);
  expect((await remove(item(".", "comic"))).failures).toEqual([]);
  expect(existsSync(root)).toBe(true);
  expect(existsSync(path.join(root, "root.jpg"))).toBe(false);
});

test("rejects escaping paths and redirected folders without removing their records or files", async () => {
  const outside = path.join(isolated.directory, "outside");
  mkdirSync(outside);
  writeFileSync(path.join(outside, "keep.mp4"), "keep");
  symlinkSync(outside, path.join(root, "redirected"), "junction");
  for (const relative of ["../outside/keep.mp4", "redirected/keep.mp4"]) {
    const id = item(relative);
    expect((await remove(id)).failures).toHaveLength(1);
    expect(exists(id)).toBe(true);
  }
  expect(existsSync(path.join(outside, "keep.mp4"))).toBe(true);
});

test("refuses offline sources and scans, and validates bulk input before deleting anything", async () => {
  const offline = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES ('Offline', ?, ?)")
    .run(path.join(root, "offline"), "offline").lastInsertRowid);
  const absent = item("movie.mp4", "video", offline);
  expect((await remove(absent)).failures).toHaveLength(1);
  expect(exists(absent)).toBe(true);
  writeFileSync(path.join(root, "busy.mp4"), "busy");
  const busy = item("busy.mp4");
  database.prepare("UPDATE sources SET status = 'scanning' WHERE id = ?").run(source);
  expect((await remove(busy)).failures).toHaveLength(1);
  database.prepare("UPDATE sources SET status = 'ready' WHERE id = ?").run(source);
  for (const itemIds of [[], [-1], [busy, "bad"], Array(501).fill(busy)]) {
    expect((await app.inject({ method: "POST", url: "/api/items/bulk-delete", payload: { itemIds } })).statusCode).toBe(400);
  }
  expect(exists(busy)).toBe(true);
  expect(existsSync(path.join(root, "busy.mp4"))).toBe(true);
});
