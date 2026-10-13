import { afterAll, expect, test, vi } from "vitest";
import { rmSync } from "node:fs";

const isolated = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "vaultly-source-enabled-"));
  const previous = process.env.VAULTLY_RUNTIME_DIR;
  process.env.VAULTLY_RUNTIME_DIR = directory;
  return { directory, previous };
});
import { database } from "./database.js";
import { buildVaultlyServer } from "./server.js";
import { scanSource } from "./scanner.js";

afterAll(() => {
  database.close();
  if (isolated.previous === undefined) delete process.env.VAULTLY_RUNTIME_DIR;
  else process.env.VAULTLY_RUNTIME_DIR = isolated.previous;
  rmSync(isolated.directory, { recursive: true, force: true });
});

test("disabling hides content, skips scans, survives drive polling and restores indexed favorites", async () => {
  const app = await buildVaultlyServer();
  app.log.level = "silent";
  try {
    const id = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path, status) VALUES ('Test', ?, ?, 'ready')").run(isolated.directory, isolated.directory).lastInsertRowid);
    const item = Number(database.prepare("INSERT INTO media_items(source_id, media_type, title, relative_path, favorite) VALUES (?, 'video', 'Saved', 'saved.mp4', 1)").run(id).lastInsertRowid);
    const removed = Number(database.prepare("INSERT INTO media_items(source_id, media_type, title, relative_path, indexed, available) VALUES (?, 'video', 'Removed', 'removed.mp4', 0, 0)").run(id).lastInsertRowid);
    expect((await app.inject({ method: "PATCH", url: `/api/sources/${id}/enabled`, payload: { enabled: false } })).statusCode).toBe(200);
    expect(database.prepare("SELECT available, favorite FROM media_items WHERE id = ?").get(item)).toMatchObject({ available: 0, favorite: 1 });
    expect((await app.inject({ method: "POST", url: `/api/sources/${id}/scan` })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/api/sources/scan" })).json().count).toBe(0);
    await scanSource(id, isolated.directory);
    database.prepare("UPDATE sources SET connected = 0 WHERE id = ?").run(id);
    const polled = (await app.inject("/api/sources")).json().find((source: { id: number }) => source.id === id);
    expect(polled).toMatchObject({ enabled: 0, path_available: true, item_count: 1, video_count: 1 });
    database.prepare("UPDATE media_items SET available = 1 WHERE id = ?").run(item);
    expect(database.prepare("SELECT available FROM media_items WHERE id = ?").get(item)).toMatchObject({ available: 0 });
    const inserted = Number(database.prepare("INSERT INTO media_items(source_id, media_type, title, relative_path) VALUES (?, 'story', 'Late', 'late.pdf')").run(id).lastInsertRowid);
    expect(database.prepare("SELECT available FROM media_items WHERE id = ?").get(inserted)).toMatchObject({ available: 0 });
    expect((await app.inject(`/api/media/${item}`)).statusCode).toBe(404);
    expect((await app.inject({ method: "PATCH", url: `/api/sources/${id}/enabled`, payload: { enabled: true } })).statusCode).toBe(200);
    expect(database.prepare("SELECT available, favorite FROM media_items WHERE id = ?").get(item)).toMatchObject({ available: 1, favorite: 1 });
    expect(database.prepare("SELECT available FROM media_items WHERE id = ?").get(removed)).toMatchObject({ available: 0 });
    expect((await app.inject({ method: "PATCH", url: `/api/sources/${id}/enabled`, payload: { enabled: "false" } })).statusCode).toBe(400);
  } finally { await app.close(); }
});
