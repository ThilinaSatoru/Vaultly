import { afterAll, expect, test, vi } from "vitest";
import { performance } from "node:perf_hooks";
import { rmSync } from "node:fs";

const isolated = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "vaultly-attribute-performance-"));
  const previous = process.env.VAULTLY_RUNTIME_DIR;
  process.env.VAULTLY_RUNTIME_DIR = directory;
  return { directory, previous };
});
import { database } from "./database.js";
import { buildVaultlyServer } from "./server.js";
import { FilenameMetadataMatcher } from "./filename-metadata.js";

afterAll(() => {
  database.close();
  rmSync(isolated.directory, { recursive: true, force: true });
  if (isolated.previous === undefined) delete process.env.VAULTLY_RUNTIME_DIR;
  else process.env.VAULTLY_RUNTIME_DIR = isolated.previous;
});

test("12k attributes import and match 12k indexed media with shared name prefixes", async () => {
  const count = 12000;
  const entries = Array.from({ length: count }, (_, id) => ({
    id: id + 1, name: `Shared Person ${id}`, patterns: [`Shared Alias ${id}`],
    country: "United States", country_code: "us", gender: "male",
    avatar_url: `https://example.com/${id}.jpg`, profile_url: `https://example.com/people/${id}`, source: "prepared",
  }));
  const started = performance.now();
  const matcher = new FilenameMetadataMatcher(entries);
  const buildMs = performance.now() - started;
  const matchStart = performance.now();
  for (let id = 0; id < count; id++) {
    expect(matcher.match(`Person ${id} Shared.mp4`, "mp4").map((entry) => entry.id)).toEqual([id + 1]);
  }
  const matchMs = performance.now() - matchStart;
  const app = await buildVaultlyServer();
  app.log.level = "silent";
  try {
    const source = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES ('Benchmark', 'benchmark', 'benchmark')").run().lastInsertRowid);
    database.exec("BEGIN IMMEDIATE");
    const insert = database.prepare("INSERT INTO media_items(source_id, media_type, title, filename, file_extension, relative_path) VALUES (?, 'video', ?, ?, 'mp4', ?)");
    for (let id = 0; id < count; id++) insert.run(source, entries[id].name, `${entries[id].name}.mp4`, `${id}.mp4`);
    database.exec("COMMIT");
    const records = entries.map(({ id: _id, ...entry }) => entry);
    const importStart = performance.now();
    const imported = await app.inject({ method: "POST", url: "/api/attributes/people/import", payload: { records } });
    const importMs = performance.now() - importStart;
    expect(imported.statusCode, imported.body).toBe(200);
    expect(imported.json()).toEqual({ total: count, created: count, updated: 0, indexed: count });
    const updateStart = performance.now();
    const updated = await app.inject({ method: "POST", url: "/api/attributes/people/import", payload: { records } });
    const updateMs = performance.now() - updateStart;
    expect(updated.json()).toEqual({ total: count, created: 0, updated: count, indexed: 0 });
    const listStart = performance.now();
    const listed = await app.inject("/api/people");
    const listMs = performance.now() - listStart;
    expect(listed.json()).toHaveLength(count);
    expect(listed.json()[0]).toMatchObject({ cast_count: 1, artist_count: 0 });
    const otherAttributes: Record<string, { importMs: number; listMs: number }> = {};
    for (const kind of ["tags", "categories"]) {
      const started = performance.now();
      const response = await app.inject({ method: "POST", url: `/api/attributes/${kind}/import`, payload: { records: records.map(({ name, patterns }) => ({ name, patterns })) } });
      const importMs = Math.round(performance.now() - started);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual({ total: count, created: count, updated: 0, indexed: count });
      const listStart = performance.now();
      const listed = await app.inject(`/api/${kind}`);
      const listMs = Math.round(performance.now() - listStart);
      expect(listed.json()).toHaveLength(count);
      expect(listed.json()[0]).toMatchObject({ item_count: 1 });
      otherAttributes[kind] = { importMs, listMs };
    }
    console.info("ATTRIBUTE_PERFORMANCE", JSON.stringify({ records: count, media: count, buildMs: Math.round(buildMs), matchMs: Math.round(matchMs), importMs: Math.round(importMs), updateMs: Math.round(updateMs), listMs: Math.round(listMs), responseMB: +(Buffer.byteLength(listed.body) / 1024 ** 2).toFixed(2), otherAttributes }));
  } finally { await app.close(); }
}, 60000);
