import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { database } from "./database.js";
import { registerMediaRoutes } from "./media-routes.js";

test("gallery paginates collection cards before files, without repeats or sparse full pages", async () => {
  const token = randomUUID();
  const source = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES (?, ?, ?)").run(token, token, token).lastInsertRowid);
  const sets = [0, 1].map((n) => Number(database.prepare("INSERT INTO series(title) VALUES (?)").run(`${token} set ${n}`).lastInsertRowid));
  const app = Fastify();
  await app.register(registerMediaRoutes);
  const standalone: number[] = [];
  const insert = database.prepare("INSERT INTO media_items(source_id, media_type, title, filename, relative_path, file_extension) VALUES (?, 'story', ?, ?, ?, 'epub')");
  try {
    for (let i = 0; i < 120; i++) {
      const title = `A grouped book ${String(i).padStart(3, "0")}`;
      const id = Number(insert.run(source, title, `${title}.epub`, `${title}.epub`).lastInsertRowid);
      database.prepare("INSERT INTO series_items(series_id, item_id, position) VALUES (?, ?, ?)").run(sets[i % 2], id, i);
      if (i === 0) database.prepare("INSERT INTO series_items(series_id, item_id, position) VALUES (?, ?, 0)").run(sets[1], id);
    }
    const query = async (extra: Record<string, string> = {}) => {
      const response = await app.inject(`/api/items?${new URLSearchParams({ source: String(source), type: "story", groupSeries: "1", ...extra })}`);
      expect(response.statusCode, response.body).toBe(200);
      return response.json();
    };
    const groupedOnly = await query();
    expect(groupedOnly).toMatchObject({ total: 2, mediaTotal: 120, pageSize: 48, items: [] });
    expect(groupedOnly.cards).toEqual(sets.map((id) => ({ kind: "series", id })));
    for (let i = 0; i < 60; i++) {
      const title = `Z standalone book ${String(i).padStart(3, "0")}`;
      standalone.push(Number(insert.run(source, title, `${title}.epub`, `${title}.epub`).lastInsertRowid));
    }
    const first = await query();
    const second = await query({ page: "1" });
    expect(first).toMatchObject({ total: 62, mediaTotal: 180 });
    expect(first.cards).toHaveLength(48);
    expect(second.cards).toHaveLength(14);
    expect(first.items.map((item: { id: number }) => item.id)).toEqual(standalone.slice(0, 46));
    expect(second.items.map((item: { id: number }) => item.id)).toEqual(standalone.slice(46));
    const keys = [...first.cards, ...second.cards].map((card: { kind: string; id: number }) => `${card.kind}:${card.id}`);
    expect(new Set(keys).size).toBe(62);
    expect((await query({ q: "grouped", searchMode: "english" })).total).toBe(2);
    expect((await query({ q: "standalone", searchMode: "fuzzy" })).total).toBe(60);
    const exact = await query({ q: "Z standalone book 059", searchMode: "english" });
    expect(exact.cards[0]).toEqual({ kind: "item", id: standalone[59] });
    const ungrouped = await query({ series: "ungrouped" });
    expect(ungrouped.total).toBe(60);
    expect(ungrouped.cards.every((card: { kind: string }) => card.kind === "item")).toBe(true);
    const plain = await app.inject(`/api/items?source=${source}&type=story`);
    expect(plain.json().total).toBe(180);
    expect(plain.json().items).toHaveLength(48);
    expect(plain.json().cards).toBeUndefined();
  } finally {
    database.prepare("DELETE FROM sources WHERE id = ?").run(source);
    for (const id of sets) database.prepare("DELETE FROM series WHERE id = ?").run(id);
    await app.close();
  }
});
