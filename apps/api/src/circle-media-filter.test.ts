import { expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { database } from "./database.js";
import { buildVaultlyServer } from "./server.js";

test("circle badges filter media by circle and type without duplicate items", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-circle-filter-"));
  const app = await buildVaultlyServer();
  app.log.level = "silent";
  const token = randomUUID();
  let sourceId = 0, circleId = 0;
  const seriesIds: number[] = [];
  try {
    sourceId = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES (?, ?, ?)").run(token, root, root.toLowerCase()).lastInsertRowid);
    circleId = Number(database.prepare("INSERT INTO circles(title) VALUES (?)").run(token).lastInsertRowid);
    const items = ["video", "comic", "story", "video"].map((type, index) => Number(database.prepare("INSERT INTO media_items(source_id, media_type, title, filename, relative_path) VALUES (?, ?, ?, ?, ?)").run(sourceId, type, `${token}-${index}`, `${index}.media`, `${index}.media`).lastInsertRowid));
    for (let index = 0; index < 2; index++) {
      const seriesId = Number(database.prepare("INSERT INTO series(title) VALUES (?)").run(`${token}-${index}`).lastInsertRowid);
      seriesIds.push(seriesId);
      database.prepare("INSERT INTO circle_series(circle_id, series_id, position) VALUES (?, ?, ?)").run(circleId, seriesId, index);
      items.slice(0, 3).forEach((itemId, position) => database.prepare("INSERT INTO series_items(series_id, item_id, position) VALUES (?, ?, ?)").run(seriesId, itemId, position));
    }
    const all = await app.inject(`/api/items?circle=${circleId}&source=${sourceId}`);
    expect(all.statusCode).toBe(200);
    expect(all.json().items.map((item: { id: number }) => item.id).sort()).toEqual(items.slice(0, 3).sort());
    expect(all.json().total).toBe(3);
    for (const [index, type] of ["video", "comic", "story"].entries()) {
      const result = (await app.inject(`/api/items?circle=${circleId}&type=${type}`)).json();
      expect(result.total).toBe(1);
      expect(result.items[0].id).toBe(items[index]);
    }
    expect((await app.inject("/api/items?circle=0")).statusCode).toBe(400);
    expect((await app.inject("/api/items?circle=invalid")).statusCode).toBe(400);
  } finally {
    if (circleId) database.prepare("DELETE FROM circles WHERE id = ?").run(circleId);
    for (const id of seriesIds) database.prepare("DELETE FROM series WHERE id = ?").run(id);
    if (sourceId) database.prepare("DELETE FROM sources WHERE id = ?").run(sourceId);
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
