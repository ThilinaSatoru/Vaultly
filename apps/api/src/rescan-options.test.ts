import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { rmSync } from "node:fs";

const isolated = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  return { directory: mkdtempSync(join(tmpdir(), "vaultly-rescan-options-")) };
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
vi.mock("./scanner.js", async (original) => ({
  ...await original<typeof import("./scanner.js")>(),
  scanSource: vi.fn().mockResolvedValue(undefined),
}));
import { database } from "./database.js";
import { buildVaultlyServer } from "./server.js";
import { scanSource } from "./scanner.js";

afterAll(() => { database.close(); rmSync(isolated.directory, { recursive: true, force: true }); });
beforeEach(() => { vi.mocked(scanSource).mockClear(); database.prepare("DELETE FROM sources").run(); });

test("rescan all scans only enabled sources of the selected media type and defaults to every type", async () => {
  const app = await buildVaultlyServer(); app.log.level = "silent";
  try {
    const insert = database.prepare("INSERT INTO sources(name, root_path, normalized_path, media_type, enabled) VALUES (?, ?, ?, ?, ?)");
    const movies = Number(insert.run('Movies', 'movies', 'movies', 'movies', 1).lastInsertRowid);
    const comics = Number(insert.run('Comics', 'comics', 'comics', 'manga', 1).lastInsertRowid);
    insert.run('Disabled', 'disabled', 'disabled', 'movies', 0);
    const selected = await app.inject({ method: 'POST', url: '/api/sources/scan', payload: { mediaType: 'movies', englishAttributes: false } });
    expect(selected.statusCode).toBe(202);
    expect(selected.json().count).toBe(1);
    expect(scanSource).toHaveBeenCalledExactlyOnceWith(movies, 'movies', { generateThumbnails: true, englishAttributes: false, mediaType: 'movies' });
    vi.mocked(scanSource).mockClear();
    expect((await app.inject({ method: 'POST', url: '/api/sources/scan', payload: { mediaType: 'tv' } })).json().count).toBe(0);
    expect(scanSource).not.toHaveBeenCalled();
    expect((await app.inject({ method: 'POST', url: '/api/sources/scan' })).json().count).toBe(2);
    expect(vi.mocked(scanSource).mock.calls.map(([id]) => id)).toEqual([movies, comics]);
    vi.mocked(scanSource).mockClear();
    expect((await app.inject({ method: 'POST', url: '/api/sources/scan', payload: { mediaType: 'invalid' } })).statusCode).toBe(400);
    expect(scanSource).not.toHaveBeenCalled();
  } finally { await app.close(); }
});
