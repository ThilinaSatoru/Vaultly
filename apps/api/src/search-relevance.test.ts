import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { database } from "./database.js";
import { registerMediaRoutes } from "./media-routes.js";
import { mediaSearchRelevance } from "./search-relevance.js";

test("full titles and filenames outrank literal phrases, split tokens and expanded matches", () => {
  expect(mediaSearchRelevance("holiday", "Holiday", "x.pdf", "x.pdf")).toBe(0);
  expect(mediaSearchRelevance("holiday", "Trip", "Holiday.pdf", "x.pdf")).toBe(1);
  expect(mediaSearchRelevance("holiday", "Holiday trip", "x.pdf", "x.pdf")).toBe(2);
  expect(mediaSearchRelevance("holiday trip", "Trip with a holiday", "x.pdf", "x.pdf")).toBe(3);
  expect(mediaSearchRelevance("holiday", "Vacation", "x.pdf", "x.pdf")).toBe(4);
  expect(mediaSearchRelevance('"zoe smith"', "Zoë-Smith", "x.pdf", "x.pdf")).toBe(0);
});

test("all search modes place exact matches on page one before partial and expanded results", async () => {
  const token = randomUUID();
  const source = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES (?, ?, ?)").run(token, token, token).lastInsertRowid);
  const app = Fastify();
  await app.register(registerMediaRoutes);
  try {
    const insert = database.prepare("INSERT INTO media_items(source_id, media_type, title, filename, relative_path, file_extension) VALUES (?, 'story', ?, ?, ?, 'pdf')");
    for (let i = 0; i < 55; i++) insert.run(source, `A holiday ${i}`, `partial${i}.pdf`, `partial${i}.pdf`);
    const synonym = Number(insert.run(source, "A vacation", "synonym.pdf", "synonym.pdf").lastInsertRowid);
    insert.run(source, "Holidya", "typo.pdf", "typo.pdf");
    const exact = Number(insert.run(source, "Holiday", "Holiday.pdf", "Holiday.pdf").lastInsertRowid);
    const search = async (filters: Record<string, string>) => {
      const response = await app.inject(`/api/items?${new URLSearchParams({ source: String(source), ...filters })}`);
      expect(response.statusCode, response.body).toBe(200);
      return response.json();
    };
    for (const searchMode of ["literal", "fuzzy", "english"]) {
      const result = await search({ q: "holiday", searchMode });
      expect(result.items[0].id).toBe(exact);
      expect(result.items).toHaveLength(48);
    }
    const english = await search({ q: "holiday", searchMode: "english", page: "1" });
    expect(english.items.at(-1).id).toBe(synonym);
    expect((await search({ filename: "Holiday.pdf", searchMode: "literal" })).items[0].id).toBe(exact);
    expect((await search({ path: "Holiday.pdf" })).items[0].id).toBe(exact);
    expect((await search({ q: "holiday", sort: "title" })).items[0].id).not.toBe(exact);
  } finally {
    database.prepare("DELETE FROM sources WHERE id = ?").run(source);
    await app.close();
  }
});
