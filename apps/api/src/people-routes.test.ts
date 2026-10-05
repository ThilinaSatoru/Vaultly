import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { database } from "./database.js";
import { buildVaultlyServer } from "./server.js";

test("shared people retain legacy credits and use media-specific roles for browsing, edits, and bulk actions", async () => {
  const token = randomUUID();
  const app = await buildVaultlyServer();
  app.log.level = "silent";
  const source = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES (?, ?, ?)").run(token, token, token).lastInsertRowid);
  const person = Number(database.prepare("INSERT INTO people(name) VALUES (?)").run(token).lastInsertRowid);
  const insert = database.prepare("INSERT INTO media_items(source_id, media_type, title, filename, relative_path) VALUES (?, ?, ?, ?, ?)");
  const items = ["video", "comic", "story"].map((type) => Number(insert.run(source, type, type, type, type).lastInsertRowid));
  try {
    const credit = database.prepare("INSERT INTO item_people(item_id, person_id, role) VALUES (?, ?, ?)");
    for (const item of items) { credit.run(item, person, "cast"); credit.run(item, person, "artist"); }
    for (const [index, id] of items.entries()) {
      const response = await app.inject(`/api/items/${id}`);
      expect(response.statusCode).toBe(200);
      const detail = response.json();
      expect(detail.cast).toEqual(index === 0 ? [{ id: person, name: token }] : []);
      expect(detail.artists).toEqual(index === 0 ? [] : [{ id: person, name: token }]);
    }
    const query = async (filters: Record<string, string>) => (await app.inject(`/api/items?${new URLSearchParams({ source: String(source), ...filters })}`)).json();
    expect((await query({ people: String(person) })).total).toBe(3);
    expect((await query({ cast: String(person) })).total).toBe(1);
    expect((await query({ artists: String(person) })).total).toBe(2);
    const listed = (await app.inject("/api/people")).json().find((entry: { id: number }) => entry.id === person);
    expect(listed).toMatchObject({ cast_count: 1, artist_count: 2, patterns: [] });

    // Old role-specific clients still edit the shared credit and receive the media's actual role.
    const edit = await app.inject({ method: "PUT", url: `/api/items/${items[1]}/people/cast`, payload: { personIds: [person, person] } });
    expect(edit.statusCode).toBe(200);
    expect(edit.json()).toMatchObject({ role: "artist", people: [{ id: person, name: token }] });
    expect(database.prepare("SELECT role FROM item_people WHERE item_id = ?").all(items[1])).toEqual([{ role: "artist" }]);
    const bulk = (mode: string) => app.inject({ method: "POST", url: "/api/items/bulk", payload: { itemIds: items, field: "people", mode, valueIds: [person] } });
    expect((await bulk("remove")).statusCode).toBe(200);
    expect((await query({ people: String(person) })).total).toBe(0);
    expect((await bulk("add")).statusCode).toBe(200);
    expect((await query({ people: String(person) })).total).toBe(3);
    for (const [index, id] of items.entries()) {
      expect(database.prepare("SELECT role FROM item_people WHERE item_id = ?").all(id)).toEqual([{ role: index === 0 ? "cast" : "artist" }]);
    }
  } finally {
    database.prepare("DELETE FROM sources WHERE id = ?").run(source);
    database.prepare("DELETE FROM people WHERE id = ?").run(person);
    await app.close();
  }
});
