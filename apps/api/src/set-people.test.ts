import { afterAll, expect, test, vi } from "vitest";

const isolated = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  return { directory: mkdtempSync(join(tmpdir(), "vaultly-set-people-")) };
});
vi.mock("./database.js", async (original) => {
  const previous = process.env.VAULTLY_RUNTIME_DIR;
  process.env.VAULTLY_RUNTIME_DIR = isolated.directory;
  try { return await original(); }
  finally {
    if (previous === undefined) delete process.env.VAULTLY_RUNTIME_DIR;
    else process.env.VAULTLY_RUNTIME_DIR = previous;
  }
});
import { rmSync } from "node:fs";
import { database } from "./database.js";
import { buildVaultlyServer } from "./server.js";
afterAll(() => { database.close(); rmSync(isolated.directory, { recursive: true, force: true }); });

test("shared set people inherit roles, deduplicate credits, survive backups and leave manual credits intact", async () => {
  const app = await buildVaultlyServer(); app.log.level = "silent";
  try {
    const source = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES ('Sets', 'sets', 'sets')").run().lastInsertRowid);
    const person = Number(database.prepare("INSERT INTO people(name) VALUES ('Shared Person')").run().lastInsertRowid);
    const series = (await app.inject({ method: "POST", url: "/api/series", payload: { title: "Mixed set" } })).json();
    const insert = database.prepare("INSERT INTO media_items(source_id, media_type, title, filename, relative_path) VALUES (?, ?, ?, ?, ?)");
    const items = ["video", "comic", "story"].map((type) => Number(insert.run(source, type, type, type, type).lastInsertRowid));
    await app.inject({ method: "PUT", url: `/api/series/${series.id}/items`, payload: { itemIds: items } });
    const update = (personIds: number[]) => app.inject({ method: "PUT", url: `/api/series/${series.id}/people`, payload: { personIds } });
    expect((await update([person, person])).json().people).toEqual([{ id: person, name: "Shared Person" }]);
    for (const [index, id] of items.entries()) {
      const detail = (await app.inject(`/api/items/${id}`)).json();
      expect(detail[index === 0 ? "cast" : "artists"]).toEqual([{ id: person, name: "Shared Person" }]);
    }
    expect((await app.inject(`/api/items?people=${person}`)).json().total).toBe(3);
    expect((await app.inject("/api/items?q=Shared%20Person")).json().total).toBe(3);
    expect((await app.inject("/api/people")).json().find((p: { id: number }) => p.id === person)).toMatchObject({ cast_count: 1, artist_count: 2, set_count: 1 });
    expect((await app.inject("/api/backup")).json().data.series_people).toContainEqual({ series_id: series.id, person_id: person });
    // Saving effective viewer credits must not turn inherited credits into permanent item rows.
    await app.inject({ method: "PUT", url: `/api/items/${items[1]}/people/artist`, payload: { personIds: [person] } });
    expect(database.prepare("SELECT * FROM item_people WHERE item_id = ?").all(items[1])).toEqual([]);
    database.prepare("INSERT INTO item_people(item_id, person_id, role, origin) VALUES (?, ?, 'cast', 'manual')").run(items[0], person);
    await app.inject({ method: "PUT", url: `/api/items/${items[0]}/people/cast`, payload: { personIds: [person] } });
    expect((await app.inject(`/api/items/${items[0]}`)).json().cast).toHaveLength(1);
    expect((await update([999999])).statusCode).toBe(400);
    await update([]);
    expect((await app.inject(`/api/items?people=${person}`)).json().total).toBe(1);
    // Membership changes also remove inheritance without rewriting individual credits.
    await update([person]);
    await app.inject({ method: "PUT", url: `/api/series/${series.id}/items`, payload: { itemIds: [items[0]] } });
    expect((await app.inject(`/api/items/${items[2]}`)).json().artists).toEqual([]);
  } finally { await app.close(); }
});

test("cleanup preserves offline credits and empty-set people; imports skip case-insensitive duplicates without changing profiles", async () => {
  const app = await buildVaultlyServer(); app.log.level = "silent";
  try {
    const upload = (records: unknown[]) => app.inject({ method: "POST", url: "/api/attributes/people/import", payload: records });
    const first = await upload([{ name: "Élodie Example", country: "France", patterns: ["Original Alias"] }, { name: "éLODIE EXAMPLE", country: "Wrong" }]);
    expect(first.json()).toMatchObject({ created: 1, skipped: 1, updated: 0 });
    expect((await upload([{ name: "ÉLODIE EXAMPLE", country: "Changed", patterns: [] }])).json()).toMatchObject({ created: 0, skipped: 1 });
    const person = database.prepare("SELECT id, country FROM people WHERE name = 'Élodie Example'").get() as { id: number; country: string };
    expect(person.country).toBe("France");
    expect(database.prepare("SELECT pattern FROM person_patterns WHERE person_id = ?").all(person.id)).toEqual([{ pattern: "Original Alias" }]);
    const source = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path, enabled, connected) VALUES ('Offline', 'offline', 'offline', 0, 0)").run().lastInsertRowid);
    const item = Number(database.prepare("INSERT INTO media_items(source_id, media_type, title, filename, relative_path) VALUES (?, 'video', 'Offline', 'offline', 'offline')").run(source).lastInsertRowid);
    database.prepare("INSERT INTO item_people(item_id, person_id, role) VALUES (?, ?, 'cast')").run(item, person.id);
    const reserved = Number(database.prepare("INSERT INTO people(name) VALUES ('Empty Set Person')").run().lastInsertRowid);
    const series = Number(database.prepare("INSERT INTO series(title) VALUES ('Empty set')").run().lastInsertRowid);
    database.prepare("INSERT INTO series_people(series_id, person_id) VALUES (?, ?)").run(series, reserved);
    const unused = Number(database.prepare("INSERT INTO people(name) VALUES ('Unused junk')").run().lastInsertRowid);
    database.prepare("INSERT INTO person_patterns(person_id, pattern) VALUES (?, 'Junk alias')").run(unused);
    const cleanup = await app.inject({ method: "POST", url: "/api/people/cleanup" });
    expect(cleanup.statusCode).toBe(200);
    expect(database.prepare("SELECT id FROM people WHERE id = ?").get(unused)).toBeUndefined();
    expect(database.prepare("SELECT * FROM person_patterns WHERE person_id = ?").all(unused)).toEqual([]);
    expect(database.prepare("SELECT id FROM people WHERE id = ?").get(person.id)).toBeDefined();
    expect(database.prepare("SELECT id FROM people WHERE id = ?").get(reserved)).toBeDefined();
    expect((await app.inject({ method: "POST", url: "/api/people/cleanup" })).json().removed).toBe(0);
  } finally { await app.close(); }
});
