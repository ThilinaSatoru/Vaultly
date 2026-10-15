import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { database } from "./database.js";
import { buildVaultlyServer } from "./server.js";

test("media filter attributes include only available credits in the requested type, including inherited credits", async () => {
  const token = randomUUID();
  const app = await buildVaultlyServer();
  app.log.level = "silent";
  const source = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES (?, ?, ?)").run(token, token, token).lastInsertRowid);
  const ids = { tags: [] as number[], categories: [] as number[], people: [] as number[] };
  const create = (kind: keyof typeof ids, name: string) => {
    const id = Number(database.prepare(`INSERT INTO ${kind}(name) VALUES (?)`).run(`${name} ${token}`).lastInsertRowid);
    ids[kind].push(id); return id;
  };
  let series = 0;
  try {
    const insert = database.prepare("INSERT INTO media_items(source_id, media_type, title, filename, relative_path, available) VALUES (?, ?, ?, ?, ?, ?)");
    const types = ["video", "comic", "story"] as const;
    const media = types.map((type) => Number(insert.run(source, type, type, type, type, 1).lastInsertRowid));
    const offline = Number(insert.run(source, "video", "offline", "offline", "offline", 0).lastInsertRowid);
    const assigned = types.map((type, index) => {
      const tag = create("tags", type), category = create("categories", type), person = create("people", type);
      database.prepare("INSERT INTO item_tags(item_id, tag_id) VALUES (?, ?)").run(media[index], tag);
      database.prepare("INSERT INTO item_categories(item_id, category_id) VALUES (?, ?)").run(media[index], category);
      database.prepare("INSERT INTO item_people(item_id, person_id, role) VALUES (?, ?, ?)").run(media[index], person, "cast");
      return { tag, category, person };
    });
    const offlineTag = create("tags", "offline"), offlineCategory = create("categories", "offline"), offlinePerson = create("people", "offline");
    database.prepare("INSERT INTO item_tags(item_id, tag_id) VALUES (?, ?)").run(offline, offlineTag);
    database.prepare("INSERT INTO item_categories(item_id, category_id) VALUES (?, ?)").run(offline, offlineCategory);
    database.prepare("INSERT INTO item_people(item_id, person_id, role) VALUES (?, ?, 'cast')").run(offline, offlinePerson);
    for (const kind of ["tags", "categories", "people"] as const) create(kind, "unused");
    const sharedTag = create("tags", "shared"), sharedCategory = create("categories", "shared"), sharedPerson = create("people", "shared");
    database.prepare("INSERT INTO source_tags(source_id, tag_id) VALUES (?, ?)").run(source, sharedTag);
    database.prepare("INSERT INTO source_categories(source_id, category_id) VALUES (?, ?)").run(source, sharedCategory);
    // Duplicate direct and inherited assignments must still count each item once.
    database.prepare("INSERT INTO item_tags(item_id, tag_id) VALUES (?, ?)").run(media[0], sharedTag);
    database.prepare("INSERT INTO tag_patterns(tag_id, pattern) VALUES (?, 'shared alias')").run(sharedTag);
    series = Number(database.prepare("INSERT INTO series(title) VALUES (?)").run(token).lastInsertRowid);
    database.prepare("INSERT INTO series_people(series_id, person_id) VALUES (?, ?)").run(series, sharedPerson);
    for (const [index, item] of media.entries()) database.prepare("INSERT INTO series_items(series_id, item_id, position) VALUES (?, ?, ?)").run(series, item, index);
    for (const [index, type] of types.entries()) {
      const response = await app.inject(`/api/attributes/filter-options?type=${type}`);
      expect(response.statusCode, response.body).toBe(200);
      const result = response.json();
      const own = (kind: keyof typeof ids) => result[kind].filter((entry: { id: number }) => ids[kind].includes(entry.id));
      expect(own("tags").map((entry: { id: number }) => entry.id).sort()).toEqual([assigned[index].tag, sharedTag].sort());
      expect(own("categories").map((entry: { id: number }) => entry.id).sort()).toEqual([assigned[index].category, sharedCategory].sort());
      expect(own("people").map((entry: { id: number }) => entry.id).sort()).toEqual([assigned[index].person, sharedPerson].sort());
      expect(own("tags").find((entry: { id: number }) => entry.id === sharedTag)).toMatchObject({ item_count: 1, patterns: ["shared alias"] });
      expect(own("people").find((entry: { id: number }) => entry.id === sharedPerson)).toMatchObject({ cast_count: type === "video" ? 1 : 0, artist_count: type === "video" ? 0 : 1 });
    }
    const all = (await app.inject("/api/attributes/filter-options")).json();
    expect(all.tags.find((entry: { id: number }) => entry.id === sharedTag).item_count).toBe(3);
    expect(all.people.find((entry: { id: number }) => entry.id === sharedPerson)).toMatchObject({ cast_count: 1, artist_count: 2 });
    expect((await app.inject("/api/attributes/filter-options?type=unknown")).statusCode).toBe(400);
    // Management lists must continue to include uncredited records.
    expect((await app.inject("/api/tags")).json().some((entry: { id: number }) => entry.id === offlineTag)).toBe(true);
  } finally {
    database.prepare("DELETE FROM sources WHERE id = ?").run(source);
    if (series) database.prepare("DELETE FROM series WHERE id = ?").run(series);
    for (const kind of ["tags", "categories", "people"] as const) for (const id of ids[kind]) database.prepare(`DELETE FROM ${kind} WHERE id = ?`).run(id);
    await app.close();
  }
});
