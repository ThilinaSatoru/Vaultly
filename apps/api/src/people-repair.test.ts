import { afterAll, expect, test, vi } from "vitest";
import { rmSync } from "node:fs";
const isolated = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs"); const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "vaultly-people-repair-"));
  const previous = process.env.VAULTLY_RUNTIME_DIR; process.env.VAULTLY_RUNTIME_DIR = directory;
  return { directory, previous };
});
import { database } from "./database.js";
import { repairPeopleMatches } from "./people-repair.js";
import { buildVaultlyServer } from "./server.js";
afterAll(() => { database.close(); if (isolated.previous === undefined) delete process.env.VAULTLY_RUNTIME_DIR; else process.env.VAULTLY_RUNTIME_DIR = isolated.previous; rmSync(isolated.directory, { recursive: true, force: true }); });

test("repair removes wrong legacy credits, adds strict matches and preserves new manual and embedded metadata credits", async () => {
  const source = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES ('Fixture', 'fixture', 'fixture')").run().lastInsertRowid);
  const person = (name: string) => Number(database.prepare("INSERT INTO people(name) VALUES (?)").run(name).lastInsertRowid);
  const jane = person("Jane Doe"), wrong = person("Jane Smith"), manual = person("Manual Credit"), metadata = person("Embedded Artist");
  const item = Number(database.prepare("INSERT INTO media_items(source_id, media_type, title, filename, relative_path) VALUES (?, 'video', 'Movie', 'Jane Doe.mp4', 'Jane Doe.mp4')").run(source).lastInsertRowid);
  const add = database.prepare("INSERT INTO item_people(item_id, person_id, role, origin) VALUES (?, ?, 'cast', ?)");
  add.run(item, wrong, "legacy"); add.run(item, manual, "manual"); add.run(item, metadata, "metadata");
  const result = await repairPeopleMatches();
  expect(result).toMatchObject({ status: "completed", removed: 1, added: 1, processed: 1 });
  expect((database.prepare("SELECT person_id FROM item_people WHERE item_id = ? ORDER BY person_id").all(item) as Array<{ person_id: number }>).map((row) => row.person_id)).toEqual([jane, manual, metadata]);
  expect(await repairPeopleMatches()).toMatchObject({ status: "completed", removed: 0, added: 0 });
});

test("imports resolve alias ambiguity against people outside the current upload chunk", async () => {
  const app = await buildVaultlyServer(); app.log.level = "silent";
  try {
    const source = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES ('Import', 'import', 'import')").run().lastInsertRowid);
    const item = Number(database.prepare("INSERT INTO media_items(source_id, media_type, title, filename, relative_path) VALUES (?, 'video', 'Shared', 'Shared Alias.mp4', 'Shared Alias.mp4')").run(source).lastInsertRowid);
    const upload = (name: string) => app.inject({ method: "POST", url: "/api/attributes/people/import", payload: [{ name, patterns: ["Shared Alias"] }] });
    expect((await upload("First Person")).json().indexed).toBe(1);
    expect((await upload("Second Person")).json().indexed).toBe(0);
    expect(database.prepare("SELECT person_id FROM item_people WHERE item_id = ?").all(item)).toEqual([]);
    await repairPeopleMatches();
    expect(database.prepare("SELECT person_id FROM item_people WHERE item_id = ?").all(item)).toEqual([]);
  } finally { await app.close(); }
});
