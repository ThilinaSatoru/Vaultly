import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { database } from "./database.js";
import { scanSource } from "./scanner.js";
import { buildVaultlyServer } from "./server.js";

test("folder gallery respects categories, source types and direct children; WPS opens only on request", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-folder-api-"));
  const open = vi.fn(async (_filename: string) => {});
  const app = await buildVaultlyServer({ openVideo: open }); app.log.level = "silent";
  const source = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path, media_type) VALUES (?, ?, ?, 'ebooks')").run("Book shelf", root, root).lastInsertRowid);
  const category = Number(database.prepare("INSERT INTO categories(name) VALUES (?)").run(`Books ${source}`).lastInsertRowid);
  try {
    await mkdir(path.join(root, "Shelf", "Deep"), { recursive: true });
    await Promise.all([
      writeFile(path.join(root, "Root.txt"), "A readable story"),
      writeFile(path.join(root, "Shelf", "Book.wps"), "WPS document"),
      writeFile(path.join(root, "Shelf", "Deep", "Nested.txt"), "Another story"),
      writeFile(path.join(root, "Shelf", "Deep", "cover.jpg"), "not a comic"),
    ]);
    await scanSource(source, root);
    database.prepare("INSERT INTO source_categories(source_id, category_id) VALUES (?, ?)").run(source, category);
    const list = async (folder: string) => {
      const response = await app.inject(`/api/items?${new URLSearchParams({ sort: "folders", type: "story", sourceType: "ebooks", source: String(source), category: String(category), folder })}`);
      expect(response.statusCode, response.body).toBe(200);
      return response.json();
    };
    const first = await list("");
    expect(first.items.map((item: { filename: string }) => item.filename)).toEqual(["Root.txt"]);
    expect(first.folders).toEqual([{ source_id: source, path: "Shelf", name: "Shelf", item_count: 2 }]);
    const shelf = await list("Shelf");
    expect(shelf.items.map((item: { filename: string }) => item.filename)).toEqual(["Book.wps"]);
    expect(shelf.folders[0].path).toBe("Shelf/Deep");
    expect((await list("Shelf/Deep")).items[0].filename).toBe("Nested.txt");
    expect((await list("Shel")).items).toHaveLength(0);
    expect((await app.inject(`/api/items?source=${source}&sourceType=pictures`)).json().total).toBe(0);
    expect(open).not.toHaveBeenCalled();
    expect((await app.inject(`/api/items/${first.items[0].id}/ebook`)).json()).toEqual({ chapters: [{ text: "A readable story" }] });
    expect((await app.inject({ method: "POST", url: `/api/items/${shelf.items[0].id}/open-document`, headers: { origin: "https://unrelated.example" } })).statusCode).toBe(403);
    expect(open).not.toHaveBeenCalled();
    expect((await app.inject({ method: "POST", url: `/api/items/${shelf.items[0].id}/open-document` })).statusCode).toBe(204);
    expect(open).toHaveBeenCalledWith(path.join(root, "Shelf", "Book.wps"));
  } finally {
    database.prepare("DELETE FROM sources WHERE id = ?").run(source);
    database.prepare("DELETE FROM categories WHERE id = ?").run(category);
    await app.close(); await rm(root, { recursive: true, force: true });
  }
});

test("changing a PDF source to manga and back preserves the item and its favourites", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-pdf-manga-"));
  const source = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path, media_type) VALUES (?, ?, ?, 'ebooks')").run("PDF source", root, root).lastInsertRowid);
  const app = await buildVaultlyServer(); app.log.level = "silent";
  try {
    await writeFile(path.join(root, "Chapter 01.pdf"), "PDF fixture");
    await scanSource(source, root);
    const previous = database.prepare("SELECT id FROM media_items WHERE source_id = ?").get(source) as { id: number };
    database.prepare("UPDATE media_items SET favorite = 1, title = 'My manga' WHERE id = ?").run(previous.id);
    database.prepare("UPDATE sources SET media_type = 'manga' WHERE id = ?").run(source);
    await scanSource(source, root);
    const comic = (await app.inject(`/api/items?type=comic&sourceType=manga&source=${source}`)).json();
    expect(comic.items[0]).toMatchObject({ id: previous.id, title: "My manga", favorite: 1, media_type: "comic", file_extension: "pdf" });
    expect((await app.inject(`/api/items/${previous.id}/file`)).statusCode).toBe(200);
    database.prepare("UPDATE sources SET media_type = 'ebooks' WHERE id = ?").run(source);
    await scanSource(source, root);
    expect(database.prepare("SELECT id, favorite, media_type FROM media_items WHERE source_id = ? AND available = 1").all(source))
      .toEqual([{ id: previous.id, favorite: 1, media_type: "story" }]);
  } finally {
    database.prepare("DELETE FROM sources WHERE id = ?").run(source);
    await app.close(); await rm(root, { recursive: true, force: true });
  }
});
