import { expect, test, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("startup reuses the existing index and recovers interrupted statuses without rescanning", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-startup-"));
  const media = path.join(root, "media");
  vi.stubEnv("VAULTLY_RUNTIME_DIR", path.join(root, "runtime"));
  vi.resetModules();
  let close: (() => Promise<void>) | undefined;
  let db: (typeof import("./database.js"))["database"] | undefined;
  try {
    await mkdir(media);
    await writeFile(path.join(media, "New.pdf"), "must wait for manual scan");
    db = (await import("./database.js")).database;
    for (const [name, status, scanned] of [["Existing", "ready", "2025-01-01"], ["Interrupted", "scanning", "2025-01-01"], ["First scan", "scanning", null]]) {
      const id = db.prepare("INSERT INTO sources(name, root_path, normalized_path, status, last_scanned_at) VALUES (?, ?, ?, ?, ?)")
        .run(name, media, name, status, scanned).lastInsertRowid;
      db.prepare("INSERT INTO media_items(source_id, media_type, title, filename, relative_path, favorite) VALUES (?, 'story', 'Custom title', 'Old.pdf', 'Old.pdf', 1)").run(id);
    }
    db.close();
    db = undefined;
    // Reload the startup modules against the saved database, as a new process would.
    vi.resetModules();
    const { buildVaultlyServer } = await import("./server.js");
    db = (await import("./database.js")).database;
    const app = await buildVaultlyServer();
    close = () => app.close();
    app.log.level = "silent";
    await app.inject("/api/sources");
    expect({
      sources: db.prepare("SELECT name, status, last_scanned_at FROM sources ORDER BY id").all(),
      items: db.prepare("SELECT title, filename, favorite FROM media_items ORDER BY id").all(),
    }).toEqual({
      sources: [
        { name: "Existing", status: "ready", last_scanned_at: "2025-01-01" },
        { name: "Interrupted", status: "ready", last_scanned_at: "2025-01-01" },
        { name: "First scan", status: "idle", last_scanned_at: null },
      ],
      items: Array.from({ length: 3 }, () => ({ title: "Custom title", filename: "Old.pdf", favorite: 1 })),
    });
  } finally {
    await close?.();
    db?.close();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
