import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { database } from "./database.js";
import { registerMediaRoutes } from "./media-routes.js";
import { editDistance, searchTerms } from "./advanced-search.js";

test("quoted phrases and transposition distance", () => {
  expect(searchTerms('holiday "summer trip"')).toEqual(["holiday", "summer trip"]);
  expect(editDistance("holidya", "holiday")).toBe(1);
  expect(editDistance("日本語", "日本語")).toBe(0);
});

test("advanced searches preserve filters, rank titles, and synchronize the word index", async () => {
  const token = randomUUID();
  const source = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES (?, ?, ?)").run(token, token, token).lastInsertRowid);
  const app = Fastify(); await app.register(registerMediaRoutes);
  try {
    const insert = database.prepare("INSERT INTO media_items(source_id, media_type, title, filename, relative_path, file_extension) VALUES (?, 'story', ?, ?, ?, 'pdf')");
    const title = Number(insert.run(source, "Holiday summer trip", "one.pdf", "one.pdf").lastInsertRowid);
    const path = Number(insert.run(source, "A distant journey", "holiday.pdf", "holiday.pdf").lastInsertRowid);
    const search = async (q: string, extra = "") => {
      const response = await app.inject(`/api/items?source=${source}&q=${encodeURIComponent(q)}${extra}`);
      expect(response.statusCode, response.body).toBe(200); return response.json();
    };
    expect((await search("holiday", "&sort=relevance")).items.map((item: { id: number }) => item.id)).toEqual([path, title]);
    expect((await search('"summer trip"')).total).toBe(1);
    expect((await search('"trip summer"')).total).toBe(0);
    expect((await search("holidya", "&searchMode=fuzzy&sort=relevance")).total).toBe(2);
    expect((await search("holidya")).total).toBe(0);
    expect((await search("holidya", "&searchMode=fuzzy&type=video")).total).toBe(0);
    database.prepare("UPDATE media_items SET title = 'Winter', filename = 'winter.pdf', relative_path = 'winter.pdf' WHERE id = ?").run(title);
    expect((await search("holidya", "&searchMode=fuzzy")).items.map((item: { id: number }) => item.id)).toEqual([path]);
    database.prepare("DELETE FROM sources WHERE id = ?").run(source);
    database.exec("INSERT INTO media_words(media_words, rank) VALUES ('integrity-check', 1)");
  } finally { database.prepare("DELETE FROM sources WHERE id = ?").run(source); await app.close(); }
});

