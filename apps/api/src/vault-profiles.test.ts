import { afterAll, expect, test, vi } from "vitest";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const isolated = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "vaultly-vaults-test-"));
  const previous = process.env.VAULTLY_RUNTIME_DIR;
  process.env.VAULTLY_RUNTIME_DIR = directory;
  return { directory, previous };
});
import { database, runtimeDirectory } from "./database.js";
import { buildVaultlyServer } from "./server.js";
import { profileImageDirectory, storeProfileImage } from "./profile-images.js";
import { createCanvas } from "@napi-rs/canvas";
import { getVideoThumbnail } from "./thumbnails.js";
import { startSourceConversion, cancelSourceConversion, getConversionProgress } from "./source-conversion.js";

afterAll(() => {
  database.close();
  rmSync(isolated.directory, { recursive: true, force: true });
  if (isolated.previous === undefined) delete process.env.VAULTLY_RUNTIME_DIR;
  else process.env.VAULTLY_RUNTIME_DIR = isolated.previous;
});

test("new profiles start blank; databases, images, caches and backups stay isolated and selection persists", async () => {
  const app = await buildVaultlyServer();
  try {
    expect((await app.inject("/api/vault-profiles")).json()).toEqual({ activeId: "default", profiles: [{ id: "default", name: "Default" }] });
    database.prepare("INSERT INTO tags(name) VALUES ('Original tag')").run();
    database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES ('Original source', 'missing', 'missing')").run();
    startSourceConversion(1, "missing", "quick");
    await cancelSourceConversion(1);
    expect(getConversionProgress(1)).not.toBeNull();
    const image = await storeProfileImage(createCanvas(2, 2).toBuffer("image/png"));
    database.prepare("INSERT INTO people(name, profile_image) VALUES ('Original person', ?)").run(image);
    mkdirSync(path.join(runtimeDirectory, "thumbnails"));
    const originalThumbnail = path.join(runtimeDirectory, "thumbnails", "video-mid-v2-1-123-456.jpg");
    writeFileSync(originalThumbnail, "default thumbnail");

    const created = await app.inject({ method: "POST", url: "/api/vault-profiles", payload: { name: " Comics " } });
    expect(created.statusCode).toBe(201);
    const profile = created.json();
    expect(profile.name).toBe("Comics");
    expect(existsSync(path.join(isolated.directory, "vaults", profile.id, "vaultly.db"))).toBe(true);
    expect((await app.inject({ method: "POST", url: "/api/vault-profiles", payload: { name: "comics" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/api/vault-profiles", payload: { name: " " } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/vault-profiles/default/activate", headers: { origin: "https://example.com" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/vault-profiles/../../activate" })).statusCode).toBe(404);

    expect((await app.inject({ method: "POST", url: `/api/vault-profiles/${profile.id}/activate` })).statusCode).toBe(200);
    for (const table of ["sources", "media_items", "tags", "categories", "people", "series", "circles", "tag_patterns"]) {
      expect(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toMatchObject({ count: 0 });
    }
    expect(profileImageDirectory).toBe(path.join(isolated.directory, "vaults", profile.id, "profile-images"));
    expect((await app.inject("/api/people/profile-scan")).statusCode).toBe(404);
    // Old requests must never mutate a different vault, even when IDs repeat.
    const stale = await app.inject({ method: "POST", url: "/api/tags?vaultProfile=default", payload: { name: "Stale tag" } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("VAULT_CHANGED");
    expect((await app.inject({ url: "/api/items/1/file?vaultProfile=default" })).statusCode).toBe(409);
    database.prepare("INSERT INTO tags(name) VALUES ('Comics tag')").run();
    database.prepare("INSERT INTO people(name) VALUES ('Comics person')").run();
    mkdirSync(path.join(runtimeDirectory, "thumbnails"));
    const newThumbnail = path.join(runtimeDirectory, "thumbnails", "video-mid-v2-1-123-456.jpg");
    writeFileSync(newThumbnail, "comics thumbnail");
    expect(await getVideoThumbnail(1, "unused", 123, 456)).toBe(newThumbnail);

    const archive = await app.inject({ method: "POST", url: "/api/backup/archive", payload: { preferences: { "vaultly.pdf.fit": "width" } } });
    expect(archive.statusCode).toBe(200);
    expect(archive.headers["content-disposition"]).toContain(profile.id);
    const backup = JSON.parse(gunzipSync(archive.rawPayload).toString());
    expect(backup.profile).toEqual(profile);
    expect(backup.data.tags.map((tag: { name: string }) => tag.name)).toEqual(["Comics tag"]);
    expect(backup.data.sources).toEqual([]);
    expect(backup.profileImages).toEqual({});
    database.prepare("INSERT INTO tags(name) VALUES ('Remove on restore')").run();
    expect((await app.inject({ method: "POST", url: "/api/backup/restore", headers: { "content-type": "application/gzip" }, payload: archive.rawPayload })).statusCode).toBe(200);
    expect(database.prepare("SELECT name FROM tags").all()).toEqual([{ name: "Comics tag" }]);

    expect((await app.inject({ method: "POST", url: "/api/vault-profiles/default/activate" })).statusCode).toBe(200);
    expect(runtimeDirectory).toBe(isolated.directory);
    expect(getConversionProgress(1)).toBeNull();
    expect(database.prepare("SELECT name FROM tags").all()).toEqual([{ name: "Original tag" }]);
    expect(database.prepare("SELECT profile_image FROM people").get()).toMatchObject({ profile_image: image });
    expect(existsSync(path.join(profileImageDirectory, image))).toBe(true);
    expect(await getVideoThumbnail(1, "unused", 123, 456)).toBe(originalThumbnail);
    expect((await app.inject({ method: "POST", url: `/api/vault-profiles/${profile.id}/activate` })).statusCode).toBe(200);
    expect(database.prepare("SELECT name FROM tags").all()).toEqual([{ name: "Comics tag" }]);
    expect(JSON.parse(readFileSync(path.join(isolated.directory, "vault-profiles.json"), "utf8")).activeId).toBe(profile.id);
    const databaseUrl = new URL("./database.ts", import.meta.url).href;
    const restarted = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval",
      `const { database, runtimeDirectory } = await import(${JSON.stringify(databaseUrl)}); console.log(JSON.stringify({ directory: runtimeDirectory, tags: database.prepare("SELECT name FROM tags").all() })); database.close();`],
      { cwd: fileURLToPath(new URL("..", import.meta.url)), env: { ...process.env, VAULTLY_RUNTIME_DIR: isolated.directory }, windowsHide: true, timeout: 15000 }).toString();
    expect(JSON.parse(restarted)).toEqual({ directory: path.join(isolated.directory, "vaults", profile.id), tags: [{ name: "Comics tag" }] });
  } finally { await app.close(); }
}, 20000);

test("switching waits for an asynchronous request and background scans", async () => {
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const app = await buildVaultlyServer({ pickDirectory: async () => { entered(); await waiting; return null; } });
  try {
    const request = app.inject({ method: "POST", url: "/api/system/pick-directory" });
    const response = request.then((result) => result);
    await started;
    expect((await app.inject({ method: "POST", url: "/api/vault-profiles/default/activate" })).statusCode).toBe(409);
    release(); await response;
    database.prepare("INSERT INTO sources(name, root_path, normalized_path, status) VALUES ('Busy', 'busy', 'busy', 'scanning')").run();
    expect((await app.inject({ method: "POST", url: "/api/vault-profiles/default/activate" })).statusCode).toBe(409);
    database.prepare("DELETE FROM sources").run();
    expect((await app.inject({ method: "POST", url: "/api/vault-profiles/default/activate" })).statusCode).toBe(200);
  } finally { release(); await app.close(); }
});


test("profile deletion removes database and caches while preserving source files and other vaults", async () => {
  const app = await buildVaultlyServer();
  try {
    const created = (await app.inject({ method: "POST", url: "/api/vault-profiles", payload: { name: "Delete me" } })).json();
    const directory = path.join(isolated.directory, "vaults", created.id);
    for (const cache of ["thumbnails", "profile-images", "audio-tracks", "playback"]) {
      mkdirSync(path.join(directory, cache), { recursive: true }); writeFileSync(path.join(directory, cache, "fixture"), "cached");
    }
    writeFileSync(path.join(directory, "movie.mp4"), "source media");
    const other = (await app.inject({ method: "POST", url: "/api/vault-profiles", payload: { name: "Keep me" } })).json();
    await app.inject({ method: "POST", url: `/api/vault-profiles/${created.id}/activate` });
    database.prepare("INSERT INTO tags(name) VALUES ('Delete tag')").run();
    const deleted = await app.inject({ method: "DELETE", url: `/api/vault-profiles/${created.id}` });
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(deleted.json().profiles.some((profile: { id: string }) => profile.id === created.id)).toBe(false);
    expect(deleted.json().activeId).not.toBe(created.id);
    for (const name of ["vaultly.db", "vaultly.db-wal", "vaultly.db-shm", "thumbnails", "profile-images", "audio-tracks", "playback"]) expect(existsSync(path.join(directory, name))).toBe(false);
    expect(readFileSync(path.join(directory, "movie.mp4"), "utf8")).toBe("source media");
    expect(existsSync(path.join(isolated.directory, "vaults", other.id, "vaultly.db"))).toBe(true);
    expect((await app.inject({ method: "DELETE", url: `/api/vault-profiles/${created.id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/vault-profiles/${other.id}`, headers: { origin: "https://example.com" } })).statusCode).toBe(403);
    database.prepare("INSERT INTO sources(name, root_path, normalized_path, status) VALUES ('Busy delete', 'busy-delete', 'busy-delete', 'scanning')").run();
    expect((await app.inject({ method: "DELETE", url: `/api/vault-profiles/${other.id}` })).statusCode).toBe(409);
    database.prepare("DELETE FROM sources WHERE normalized_path = 'busy-delete'").run();
    expect((await app.inject({ method: "DELETE", url: `/api/vault-profiles/${other.id}` })).statusCode).toBe(200);
  } finally { await app.close(); }
});

test("profile deletion of the last vault creates an empty replacement and preserves the registry", async () => {
  const app = await buildVaultlyServer();
  try {
    for (const profile of (await app.inject("/api/vault-profiles")).json().profiles) {
      const response = await app.inject({ method: "DELETE", url: `/api/vault-profiles/${profile.id}` });
      expect(response.statusCode, response.body).toBe(200);
    }
    let profiles = (await app.inject("/api/vault-profiles")).json();
    // Repeated deletion must still work when the automatic name already exists.
    expect((await app.inject({ method: "DELETE", url: `/api/vault-profiles/${profiles.activeId}` })).statusCode).toBe(200);
    profiles = (await app.inject("/api/vault-profiles")).json();
    expect(profiles.profiles).toHaveLength(1); expect(profiles.profiles[0].id).toBe(profiles.activeId);
    expect(database.prepare("SELECT COUNT(*) AS count FROM tags").get()).toMatchObject({ count: 0 });
    expect(existsSync(path.join(isolated.directory, "vaultly.db"))).toBe(false);
    expect(JSON.parse(readFileSync(path.join(isolated.directory, "vault-profiles.json"), "utf8"))).toEqual(profiles);
  } finally { await app.close(); }
});
