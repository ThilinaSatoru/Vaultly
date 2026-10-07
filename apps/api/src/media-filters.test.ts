import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { database } from "./database.js";
import { scanSource } from "./scanner.js";
import { buildVaultlyServer } from "./server.js";

test("TS videos scan at the root and in nested folders, remain searchable on rescan, and stream with a video MIME type", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-ts-video-"));
  const app = await buildVaultlyServer();
  app.log.level = "silent";
  const source = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES (?, ?, ?)").run("TS video fixture", root, root).lastInsertRowid);
  try {
    await mkdir(path.join(root, "Videos", "Nested"), { recursive: true });
    const relativePaths = ["Recording.ts", path.join("Videos", "Nested", "Broadcast.TS")];
    await Promise.all(relativePaths.map((relativePath) => writeFile(path.join(root, relativePath), "transport-stream-fixture")));
    await scanSource(source, root);
    const list = async (filters: Record<string, string> = {}) => {
      const response = await app.inject(`/api/items?${new URLSearchParams({ source: String(source), type: "video", extension: "ts", ...filters })}`);
      expect(response.statusCode, response.body).toBe(200);
      return response.json() as { total: number; items: Array<{ id: number; filename: string; relative_path: string; media_type: string; file_extension: string }> };
    };
    const initial = await list();
    expect(initial.total).toBe(2);
    expect(initial.items.map((item) => item.relative_path).sort()).toEqual([...relativePaths].sort());
    for (const item of initial.items) {
      expect(item).toMatchObject({ media_type: "video", file_extension: "ts" });
      const response = await app.inject({ url: `/api/items/${item.id}/file`, headers: { range: "bytes=0-8" } });
      expect(response.statusCode).toBe(206);
      expect(response.headers["content-type"]).toBe("video/mp2t");
      expect(response.body).toBe("transport");
    }
    const nested = await list({ q: "broadcast nested", filename: "Broadcast.TS", path: "Nested" });
    expect(nested.total).toBe(1);
    expect(nested.items[0].filename).toBe("Broadcast.TS");
    expect((await app.inject("/api/items/formats?type=video")).json()).toContainEqual({ extension: "ts", item_count: 2 });
    await scanSource(source, root);
    expect((await list()).items.map((item) => item.id)).toEqual(initial.items.map((item) => item.id));
  } finally {
    database.prepare("DELETE FROM sources WHERE id = ?").run(source);
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("nested scan results combine text, metadata, source, format, range and membership filters", async () => {
  // This suffix is searchable through source and attribute names; keep it from matching the "be" case.
  const token = randomUUID().replace(/be/gi, "xx");
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-filters-"));
  const app = await buildVaultlyServer();
  app.log.level = "silent";
  const source = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES (?, ?, ?)").run(token, root, root).lastInsertRowid);
  const attributes: Record<"tags" | "categories" | "people", number[]> = { tags: [], categories: [], people: [] };
  const create = (table: keyof typeof attributes, name: string) => {
    const id = Number(database.prepare(`INSERT INTO ${table}(name) VALUES (?)`).run(`${name} ${token}`).lastInsertRowid);
    attributes[table].push(id);
    return id;
  };
  let series = 0;
  try {
    await mkdir(path.join(root, "Shelf", "Deep", "Panels"), { recursive: true });
    await Promise.all([
      writeFile(path.join(root, "Alpha.pdf"), "root story"),
      writeFile(path.join(root, "Shelf", "Deep", "Beta.pdf"), "nested story"),
      writeFile(path.join(root, "Shelf", "Deep", "Gamma.mp4"), "nested video"),
      writeFile(path.join(root, "Shelf", "Deep", "Delta.cbz"), "nested archive"),
      writeFile(path.join(root, "Shelf", "Deep", "Panels", "001.jpg"), "comic page"),
    ]);
    await scanSource(source, root);
    const rows = database.prepare("SELECT id, filename FROM media_items WHERE source_id = ?").all(source) as Array<{ id: number; filename: string }>;
    const id = (filename: string) => rows.find((row) => row.filename === filename)!.id;
    const alpha = id("Alpha.pdf"), beta = id("Beta.pdf"), gamma = id("Gamma.mp4"), delta = id("Delta.cbz"), panels = id("Panels");
    const all = [alpha, beta, gamma, delta, panels];
    const tag = create("tags", "Adventure"), commonTag = create("tags", "Shared"), category = create("categories", "Fiction"), commonCategory = create("categories", "Library"), person = create("people", "Creator");
    database.prepare("INSERT INTO tag_patterns(tag_id, pattern) VALUES (?, 'quest-alias')").run(tag);
    database.prepare("INSERT INTO category_patterns(category_id, pattern) VALUES (?, 'genre-alias')").run(category);
    database.prepare("INSERT INTO person_patterns(person_id, pattern) VALUES (?, 'maker-alias')").run(person);
    database.prepare("INSERT INTO item_tags(item_id, tag_id) VALUES (?, ?)").run(beta, tag);
    database.prepare("INSERT INTO item_categories(item_id, category_id) VALUES (?, ?)").run(beta, category);
    database.prepare("INSERT INTO source_tags(source_id, tag_id) VALUES (?, ?)").run(source, commonTag);
    database.prepare("INSERT INTO source_categories(source_id, category_id) VALUES (?, ?)").run(source, commonCategory);
    database.prepare("INSERT INTO item_people(item_id, person_id, role) VALUES (?, ?, 'artist')").run(beta, person);
    database.prepare("INSERT INTO item_people(item_id, person_id, role) VALUES (?, ?, 'cast')").run(gamma, person);
    database.prepare("UPDATE media_items SET favorite = 1 WHERE id = ?").run(beta);
    const update = database.prepare("UPDATE media_items SET size_bytes = ?, modified_at_ms = ? WHERE id = ?");
    all.forEach((item, index) => update.run((index + 1) * 1024 * 1024, new Date(`2026-01-0${index + 1}T12:00:00`).getTime(), item));
    series = Number(database.prepare("INSERT INTO series(title) VALUES (?)").run(token).lastInsertRowid);
    database.prepare("INSERT INTO series_items(series_id, item_id, position) VALUES (?, ?, 0)").run(series, beta);
    const query = async (filters: Record<string, string>) => {
      const response = await app.inject(`/api/items?${new URLSearchParams({ source: String(source), ...filters })}`);
      expect(response.statusCode, response.body).toBe(200);
      return response.json() as { total: number; items: Array<{ id: number }> };
    };
    const cases: Array<[Record<string, string>, number[]]> = [
      [{}, all],
      [{ q: "BETA deep" }, [beta]],
      [{ q: "be" }, [beta]],
      [{ q: "Shelf", type: "story", filename: "Beta", extension: "pdf", path: "Deep" }, [beta]],
      [{ q: "Adventure" }, [beta]],
      [{ q: "QUEST genre maker", tags: `${tag},${commonTag}`, categories: `${category},${commonCategory}`, people: String(person) }, [beta]],
      [{ q: "Shared Library" }, all],
      [{ q: "Creator" }, [beta, gamma]],
      [{ type: "video", cast: String(person) }, [gamma]],
      [{ artists: String(person) }, [beta]],
      [{ extension: "folder" }, [panels]],
      [{ type: "comic" }, [delta, panels]],
      [{ minMb: "2", maxMb: "3", modifiedFrom: "2026-01-02", modifiedTo: "2026-01-03" }, [beta, gamma]],
      [{ series: "grouped" }, [beta]],
      [{ series: String(series), favorite: "1", q: "maker" }, [beta]],
      [{ series: "ungrouped" }, [alpha, gamma, delta, panels]],
      [{ untagged: "1" }, []],
      [{ uncategorized: "1" }, []],
      [{ q: "absent" }, []],
      [{ q: "Beta Gamma" }, []],
      [{ source: "2147483647" }, []],
      [{ page: "1" }, []],
    ];
    for (const [filters, expected] of cases) {
      const result = await query(filters);
      expect(result.items.map((item) => item.id).sort((a, b) => a - b), JSON.stringify(filters)).toEqual([...expected].sort((a, b) => a - b));
      expect(result.total).toBe(filters.page ? all.length : expected.length);
    }
    const alphabetical = [alpha, beta, delta, gamma, panels];
    for (const [sort, expected] of [["title", alphabetical], ["filename", alphabetical], ["oldest", all], ["smallest", all], ["recent", [...all].reverse()], ["size", [...all].reverse()]] as const) {
      expect((await query({ sort })).items.map((item) => item.id)).toEqual(expected);
    }
    database.prepare("DELETE FROM source_tags WHERE source_id = ?").run(source);
    database.prepare("DELETE FROM source_categories WHERE source_id = ?").run(source);
    expect((await query({ untagged: "1" })).total).toBe(4);
    expect((await query({ uncategorized: "1" })).total).toBe(4);
    database.prepare("UPDATE media_items SET available = 0 WHERE id = ?").run(beta);
    expect((await query({ q: "quest" })).total).toBe(0);
    expect((await query({ favorite: "1" })).total).toBe(0);
    const invalidFilters: Array<Record<string, string>> = [{ minMb: "3", maxMb: "2" }, { type: "invalid" }, { tags: "invalid" }, { page: "-1" }];
    for (const filters of invalidFilters) {
      expect((await app.inject(`/api/items?${new URLSearchParams(filters)}`)).statusCode).toBe(400);
    }
  } finally {
    database.prepare("DELETE FROM sources WHERE id = ?").run(source);
    if (series) database.prepare("DELETE FROM series WHERE id = ?").run(series);
    for (const table of ["tags", "categories", "people"] as const) for (const id of attributes[table]) database.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
