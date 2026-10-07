import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { database } from "./database.js";
import { scanSource } from "./scanner.js";
import { buildVaultlyServer } from "./server.js";

test("default player actions use indexed original videos, preserve files, and reject unsafe or unavailable items", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-default-player-"));
  const filename = "[Live] Video & 'episode'.TS";
  const original = path.join(root, filename);
  await writeFile(original, "original video bytes");
  const open = vi.fn(async (_file: string) => undefined);
  const app = await buildVaultlyServer({ openVideo: open });
  app.log.level = "silent";
  const source = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES (?, ?, ?)").run("Default player fixture", root, root).lastInsertRowid);
  try {
    await scanSource(source, root);
    const item = database.prepare("SELECT id FROM media_items WHERE source_id = ?").get(source) as { id: number };
    const url = `/api/items/${item.id}/open`;
    expect((await app.inject({ method: "POST", url })).statusCode).toBe(204);
    expect(open).toHaveBeenCalledWith(await realpath(original));
    expect(open).toHaveBeenCalledTimes(1);
    expect(await readFile(original, "utf8")).toBe("original video bytes");
    expect(await readdir(root)).toEqual([filename]);
    expect((await app.inject({ method: "POST", url, headers: { origin: "https://unrelated.example" } })).statusCode).toBe(403);
    expect(open).toHaveBeenCalledTimes(1);
    expect((await app.inject({ method: "POST", url, headers: { origin: "http://127.0.0.1:4400", host: "127.0.0.1:4400" } })).statusCode).toBe(204);
    open.mockRejectedValueOnce(new Error("No application associated"));
    expect((await app.inject({ method: "POST", url })).statusCode).toBe(502);
    database.prepare("UPDATE media_items SET available = 0 WHERE id = ?").run(item.id);
    expect((await app.inject({ method: "POST", url })).statusCode).toBe(404);
    database.prepare("UPDATE media_items SET available = 1, media_type = 'story' WHERE id = ?").run(item.id);
    expect((await app.inject({ method: "POST", url })).statusCode).toBe(404);
    await writeFile(path.join(root, "Program.cmd"), "never execute");
    database.prepare("UPDATE media_items SET media_type = 'video', relative_path = 'Program.cmd' WHERE id = ?").run(item.id);
    expect((await app.inject({ method: "POST", url })).statusCode).toBe(400);
    database.prepare("UPDATE media_items SET relative_path = '../outside.ts' WHERE id = ?").run(item.id);
    expect((await app.inject({ method: "POST", url })).statusCode).toBeGreaterThanOrEqual(400);
    expect(open).toHaveBeenCalledTimes(3);
    expect((await app.inject({ method: "POST", url: `/api/items/${item.id}/playback` })).statusCode).toBe(404);
  } finally {
    database.prepare("DELETE FROM sources WHERE id = ?").run(source);
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
