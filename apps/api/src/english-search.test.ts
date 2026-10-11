import { DatabaseSync } from "node:sqlite";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { database } from "./database.js";
import { registerMediaRoutes } from "./media-routes.js";
import { initializeSearchIndex } from "./search-index.js";

test("English index backfills, upgrades dictionary versions, and follows edits and deletions", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE media_items(id INTEGER PRIMARY KEY, title TEXT, filename TEXT, relative_path TEXT)");
    db.prepare("INSERT INTO media_items VALUES (1, ?, ?, ?)").run("Children on vacations", "Running.pdf", "unrelated");
    initializeSearchIndex(db); initializeSearchIndex(db);
    expect(db.prepare("SELECT rowid FROM media_english WHERE media_english MATCH 'child AND holiday'").all()).toEqual([{ rowid: 1 }]);
    db.exec("UPDATE search_index_versions SET version = 0; DELETE FROM media_english");
    initializeSearchIndex(db);
    expect(db.prepare("SELECT COUNT(*) AS count FROM media_english").get()).toEqual({ count: 1 });
    db.exec("UPDATE media_items SET title = 'Winter', filename = 'one.pdf' WHERE id = 1");
    expect(db.prepare("SELECT rowid FROM media_english WHERE media_english MATCH 'holiday'").all()).toEqual([]);
    db.exec("DELETE FROM media_items WHERE id = 1");
    expect(db.prepare("SELECT COUNT(*) AS count FROM media_english").get()).toEqual({ count: 0 });
    db.exec("INSERT INTO media_english(media_english) VALUES ('integrity-check')");
  } finally { db.close(); }
});

test("English search restricts matches to titles/filenames, preserves literal phrases and filters", async () => {
  const token = randomUUID();
  const source = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES (?, ?, ?)").run(token, token, token).lastInsertRowid);
  const tag = Number(database.prepare("INSERT INTO tags(name) VALUES (?)").run(`vacation ${token}`).lastInsertRowid);
  const app = Fastify(); await app.register(registerMediaRoutes);
  try {
    const insert = database.prepare("INSERT INTO media_items(source_id, media_type, title, filename, relative_path, file_extension) VALUES (?, 'story', ?, ?, ?, 'pdf')");
    const title = Number(insert.run(source, "Children on vacations", "one.pdf", "one.pdf").lastInsertRowid);
    const filename = Number(insert.run(source, "Winter", "Running movies.pdf", "two.pdf").lastInsertRowid);
    const pathOnly = Number(insert.run(source, "Other", "other.pdf", "vacation/other.pdf").lastInsertRowid);
    database.prepare("INSERT INTO item_tags(item_id, tag_id) VALUES (?, ?)").run(pathOnly, tag);
    const search = async (filters: Record<string, string>) => {
      const response = await app.inject(`/api/items?${new URLSearchParams({ source: String(source), searchMode: "english", ...filters })}`);
      expect(response.statusCode, response.body).toBe(200); return response.json();
    };
    expect((await search({ q: "child holiday" })).items.map((item: { id: number }) => item.id)).toEqual([title]);
    expect((await search({ q: "run film" })).items.map((item: { id: number }) => item.id)).toEqual([filename]);
    expect((await search({ filename: "run film" })).items.map((item: { id: number }) => item.id)).toEqual([filename]);
    expect((await search({ filename: "child holiday" })).total).toBe(0);
    expect((await search({ q: "vacation" })).total).toBe(1);
    expect((await search({ q: '"vacations"' })).total).toBe(1);
    expect((await search({ q: '"holiday"' })).total).toBe(0);
    expect((await search({ q: "holiday", type: "video" })).total).toBe(0);
    expect((await search({ q: "child holiday", page: "1" })).items).toEqual([]);
    expect((await search({ q: "100%_literal OR", sort: "relevance" })).total).toBe(0);
    database.prepare("UPDATE media_items SET available = 0 WHERE id = ?").run(title);
    expect((await search({ q: "holiday" })).total).toBe(0);
  } finally {
    database.prepare("DELETE FROM sources WHERE id = ?").run(source);
    database.prepare("DELETE FROM tags WHERE id = ?").run(tag);
    await app.close();
  }
});
