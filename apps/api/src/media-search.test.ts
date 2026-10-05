import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { database } from "./database.js";
import { registerMediaRoutes } from "./media-routes.js";

test("indexed search combines tokens and filters, paginates, and follows edits and source deletion", async () => {
  const token = randomUUID();
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-search-"));
  await mkdir(path.join(root, "Summer"));
  await writeFile(path.join(root, "Summer", "Trip_00.pdf"), "story");
  const sourceId = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES (?, ?, ?)").run(token, root, root).lastInsertRowid);
  const tagId = Number(database.prepare("INSERT INTO tags(name) VALUES (?)").run(token).lastInsertRowid);
  const app = Fastify();
  await app.register(registerMediaRoutes);
  try {
    database.exec("BEGIN");
    const insert = database.prepare("INSERT INTO media_items(source_id, media_type, title, filename, relative_path, file_extension) VALUES (?, 'story', ?, ?, ?, 'pdf')");
    const ids: number[] = [];
    for (let i = 0; i < 55; i++) {
      const number = String(i).padStart(2, "0");
      ids.push(Number(insert.run(sourceId, `Holiday ${number}`, `Trip_${number}.pdf`, path.join("Summer", `Trip_${number}.pdf`)).lastInsertRowid));
    }
    database.prepare("INSERT INTO item_tags(item_id, tag_id) VALUES (?, ?)").run(ids[0], tagId);
    insert.run(sourceId, "Winter", "TripXother.pdf", "Winter/TripXother.pdf");
    database.exec("COMMIT");
    const search = async (filters: Record<string, string>) => {
      const response = await app.inject(`/api/items?${new URLSearchParams({ source: String(sourceId), ...filters })}`);
      expect(response.statusCode).toBe(200);
      return response.json();
    };
    const first = await search({ q: "holiday summer", type: "story" });
    expect(first.total).toBe(55);
    expect(first.items.map((item: { id: number }) => item.id)).toEqual(ids.slice(0, 48));
    const second = await search({ q: "HOLIDAY summer", page: "1", extension: "pdf" });
    expect(second.items.map((item: { id: number }) => item.id)).toEqual(ids.slice(48));
    expect((await search({ filename: "Trip_", path: `Summer${path.sep}`, tags: String(tagId) })).items.map((item: { id: number }) => item.id)).toEqual([ids[0]]);
    expect((await search({ filename: "Trip_" })).total).toBe(55);
    expect((await search({ q: "Holiday Winter" })).total).toBe(0);
    expect((await search({ q: "00" })).items.map((item: { id: number }) => item.id)).toEqual([ids[0]]);
    const edit = await app.inject({ method: "PATCH", url: `/api/items/${ids[0]}`, payload: { title: "Edited title" } });
    expect(edit.statusCode, edit.body).toBe(200);
    expect((await search({ q: "holiday summer" })).total).toBe(54);
    expect((await search({ q: "edited summer" })).items.map((item: { id: number }) => item.id)).toEqual([ids[0]]);
    expect((await search({ filename: "Trip_00" })).total).toBe(0);
    expect((await search({ filename: "Edited title.pdf", path: "Summer" })).items.map((item: { id: number }) => item.id)).toEqual([ids[0]]);
    database.prepare("UPDATE media_items SET available = 0 WHERE id = ?").run(ids[0]);
    expect((await search({ q: "edited" })).total).toBe(0);
    database.prepare("DELETE FROM sources WHERE id = ?").run(sourceId);
    expect((await search({ q: "holiday" })).total).toBe(0);
    database.exec("INSERT INTO media_search(media_search, rank) VALUES ('integrity-check', 1)");
  } finally {
    if (database.isTransaction) database.exec("ROLLBACK");
    database.prepare("DELETE FROM sources WHERE id = ?").run(sourceId);
    database.prepare("DELETE FROM tags WHERE id = ?").run(tagId);
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
