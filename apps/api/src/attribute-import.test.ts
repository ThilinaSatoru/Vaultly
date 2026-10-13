import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import { database } from "./database.js";
import { buildVaultlyServer } from "./server.js";

test.each(["people", "tags", "categories"] as const)("%s existing-only import updates matching names and never creates unknown names", async (kind) => {
  const token = randomUUID();
  const name = `Ångström ${token}`;
  const alias = `Import alias ${token}`;
  const junk = `Unknown ${token}`;
  const app = await buildVaultlyServer();
  app.log.level = "silent";
  const source = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES (?, ?, ?)").run(token, token, token).lastInsertRowid);
  const id = Number(database.prepare(`INSERT INTO ${kind}(name) VALUES (?)`).run(name).lastInsertRowid);
  const item = Number(database.prepare("INSERT INTO media_items(source_id, media_type, title, filename, file_extension, relative_path) VALUES (?, 'video', ?, ?, 'mp4', ?)").run(source, alias, `${alias}.mp4`, `${alias}.mp4`).lastInsertRowid);
  if (kind === "people") database.prepare("UPDATE people SET gender = 'female', country = 'Old country', profile_image = 'local-image' WHERE id = ?").run(id);
  const upload = (records: unknown[]) => app.inject({ method: "POST", url: `/api/attributes/${kind}/import?existingOnly=true`, payload: { records } });
  try {
    const result = await upload([
      { name: name.toUpperCase(), patterns: [alias], ...(kind === "people" ? { country: "New country", avatar_url: "https://example.com/photo.jpg" } : {}) },
      { name: junk },
      { name, patterns: ["Ignored duplicate"] },
    ]);
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json()).toMatchObject({ total: 3, created: 0, updated: 1, skipped: 2, indexed: 1 });
    expect(database.prepare(`SELECT id FROM ${kind} WHERE name = ?`).get(junk)).toBeUndefined();
    expect(database.prepare(`SELECT name FROM ${kind} WHERE id = ?`).get(id)).toEqual({ name });
    expect((await app.inject(`/api/attributes/${kind}/${id}/patterns`)).json()).toEqual({ patterns: [alias] });
    if (kind === "people") {
      expect(database.prepare("SELECT gender, country, avatar_url, profile_image FROM people WHERE id = ?").get(id)).toEqual({ gender: "female", country: "New country", avatar_url: "https://example.com/photo.jpg", profile_image: "local-image" });
      expect((await upload([{ name, country: null }])).json()).toMatchObject({ created: 0, updated: 1 });
      expect(database.prepare("SELECT country, gender FROM people WHERE id = ?").get(id)).toEqual({ country: null, gender: "female" });
      expect((await app.inject(`/api/attributes/${kind}/${id}/patterns`)).json()).toEqual({ patterns: [alias] });
    }
    // An alias is not an existing name; a file with no name matches changes nothing.
    const skipped = await upload([{ name: alias }, { name: junk }]);
    expect(skipped.json()).toEqual({ total: 2, created: 0, updated: 0, indexed: 0, skipped: 2 });
    expect(database.prepare(`SELECT id FROM ${kind} WHERE name = ?`).get(alias)).toBeUndefined();
    expect(database.prepare(`SELECT id FROM ${kind} WHERE name = ?`).get(junk)).toBeUndefined();
    const assignment = kind === "people" ? "person_id" : kind === "tags" ? "tag_id" : "category_id";
    expect(database.prepare(`SELECT item_id FROM item_${kind} WHERE ${assignment} = ?`).all(id)).toEqual([{ item_id: item }]);
  } finally {
    database.prepare("DELETE FROM sources WHERE id = ?").run(source);
    database.prepare(`DELETE FROM ${kind} WHERE id = ?`).run(id);
    await app.close();
  }
});

test("prepared JSON imports skip duplicate people, validate atomically, index credits, and survive backups without downloads", async () => {
  const token = randomUUID();
  const name = `Import Person ${token}`;
  const download = vi.spyOn(globalThis, "fetch");
  const app = await buildVaultlyServer();
  app.log.level = "silent";
  const source = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES (?, ?, ?)").run(token, token, token).lastInsertRowid);
  const insert = database.prepare("INSERT INTO media_items(source_id, media_type, title, filename, file_extension, relative_path) VALUES (?, ?, ?, ?, ?, ?)");
  const video = Number(insert.run(source, "video", name, `${name}.mp4`, "mp4", "video").lastInsertRowid);
  const comic = Number(insert.run(source, "comic", name, `${name}.pdf`, "pdf", "comic").lastInsertRowid);
  const upload = (kind: string, payload: unknown) => app.inject({ method: "POST", url: `/api/attributes/${kind}/import`, payload: payload as never });
  try {
    const payload = { scraped_at: "2026-10-13T06:08:45.385Z", total: 120, records: [{ name, gender: "transgender", country_code: "us", country: "United States", avatar_url: "https://example.com/avatar.jpg", source: "directory/people", profile_url: "https://example.com/profile" }] };
    const response = await upload("people", payload);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ total: 1, created: 1, updated: 0, indexed: 2 });
    const person = database.prepare("SELECT * FROM people WHERE name = ?").get(name) as { id: number };
    expect(person).toMatchObject({ ...payload.records[0], scraped_at: payload.scraped_at, profile_image: null });
    expect(database.prepare("SELECT item_id, role FROM item_people WHERE person_id = ? ORDER BY item_id").all(person.id)).toEqual([{ item_id: video, role: "cast" }, { item_id: comic, role: "artist" }]);
    expect((await app.inject(`/api/items?people=${person.id}&source=${source}`)).json().total).toBe(2);
    expect((await upload("people", [{ name: name.toUpperCase(), country: "Canada", patterns: ["Alias", "ALIAS"] }])).json()).toEqual({ total: 1, created: 0, updated: 0, skipped: 1, indexed: 0 });
    expect(database.prepare("SELECT gender, country, avatar_url FROM people WHERE id = ?").get(person.id)).toMatchObject({ gender: "transgender", country: "United States", avatar_url: payload.records[0].avatar_url });
    expect((await app.inject("/api/people")).json().find((row: { id: number }) => row.id === person.id)).toMatchObject({ patterns: [], country: "United States" });
    expect((await upload("people", [{ name, country: null }])).statusCode).toBe(200);
    const rejected = await upload("people", [{ name: `Rejected ${token}` }, { name, avatar_url: "file:///private" }]);
    expect(rejected.statusCode).toBe(400);
    expect(database.prepare("SELECT id FROM people WHERE name = ?").get(`Rejected ${token}`)).toBeUndefined();
    for (const kind of ["tags", "categories"]) {
      const result = await upload(kind, { records: [{ name, patterns: [name] }] });
      expect(result.statusCode, result.body).toBe(200);
      expect(result.json()).toMatchObject({ created: 1, indexed: 2 });
      expect((await upload(kind, [{ name }])).json()).toMatchObject({ created: 0, updated: 1, indexed: 0 });
    }
    expect((await upload("tags", { records: [{ name, patterns: ["*"] }] })).statusCode).toBe(400);
    expect((await upload("people", { records: [] })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: `/api/people/${person.id}/image`, payload: { url: "https://example.com/image.jpg" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/people/profile-scan" })).statusCode).toBe(404);
    expect(download).not.toHaveBeenCalled();
    const backup = (await app.inject("/api/backup")).json();
    expect(backup.data.people.find((row: { id: number }) => row.id === person.id)).toMatchObject({ gender: "transgender", country: "United States", avatar_url: payload.records[0].avatar_url, scraped_at: payload.scraped_at });
    database.prepare("UPDATE people SET gender = NULL WHERE id = ?").run(person.id);
    const restored = await app.inject({ method: "POST", url: "/api/backup/restore", payload: backup });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(database.prepare("SELECT gender FROM people WHERE id = ?").get(person.id)).toMatchObject({ gender: "transgender" });
  } finally {
    download.mockRestore();
    database.prepare("DELETE FROM sources WHERE id = ?").run(source);
    for (const kind of ["people", "tags", "categories"]) database.prepare(`DELETE FROM ${kind} WHERE name = ?`).run(name);
    await app.close();
  }
});
