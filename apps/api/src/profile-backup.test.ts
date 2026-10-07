import { afterAll, expect, test, vi } from "vitest";
import Fastify from "fastify";
import { createCanvas } from "@napi-rs/canvas";
import { gzipSync, gunzipSync } from "node:zlib";
import { readdirSync, rmSync } from "node:fs";

const isolated = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  return { directory: mkdtempSync(join(tmpdir(), "vaultly-profile-test-")) };
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
import { database } from "./database.js";
import { registerPeopleRoutes } from "./people-routes.js";
import { registerBackupRoutes } from "./backup-routes.js";
import { profileImageDirectory } from "./profile-images.js";

afterAll(() => { database.close(); rmSync(isolated.directory, { recursive: true, force: true }); });

test("profile images are stored locally, replaced, archived, and restored with preferences", async () => {
  const app = Fastify();
  await app.register(registerPeopleRoutes);
  await app.register(registerBackupRoutes);
  const image = createCanvas(800, 400).toBuffer("image/png");
  try {
    const person = (await app.inject({ method: "POST", url: "/api/people", payload: { name: "Example person" } })).json();
    const endpoint = `/api/people/${person.id}/image`;
    const upload = () => app.inject({ method: "PUT", url: endpoint, payload: { data: image.toString("base64") } });
    expect((await upload()).statusCode).toBe(200);
    const first = readdirSync(profileImageDirectory)[0];
    expect((await app.inject(endpoint)).headers["content-type"]).toContain("image/png");
    expect((await upload()).statusCode).toBe(200);
    expect(readdirSync(profileImageDirectory)).toHaveLength(1);
    expect(readdirSync(profileImageDirectory)[0]).not.toBe(first);

    const archive = await app.inject({ method: "POST", url: "/api/backup/archive", payload: { preferences: { "vaultly.pdf.fit": "width" } } });
    expect(archive.statusCode).toBe(200);
    expect(archive.headers["content-type"]).toContain("application/gzip");
    const backup = JSON.parse(gunzipSync(archive.rawPayload).toString());
    expect(backup.version).toBe(2);
    expect(Object.keys(backup.profileImages)).toHaveLength(1);
    const oldFilename = backup.data.people[0].profile_image;

    // Broken image references cannot replace the current database or files.
    const broken = structuredClone(backup);
    broken.profileImages = {};
    const invalid = await app.inject({ method: "POST", url: "/api/backup/restore", payload: broken });
    expect(invalid.statusCode).toBe(400);
    expect(database.prepare("SELECT profile_image FROM people WHERE id = ?").get(person.id)).toMatchObject({ profile_image: oldFilename });
    expect(readdirSync(profileImageDirectory)).toEqual([oldFilename]);

    // A SQL failure after staging images rolls back metadata and removes staged files.
    const badRows = structuredClone(backup);
    badRows.data.people.push({ ...badRows.data.people[0] });
    expect((await app.inject({ method: "POST", url: "/api/backup/restore", payload: badRows })).statusCode).toBe(500);
    expect(readdirSync(profileImageDirectory)).toEqual([oldFilename]);

    await app.inject({ method: "DELETE", url: endpoint });
    expect(readdirSync(profileImageDirectory)).toHaveLength(0);
    const restored = await app.inject({ method: "POST", url: "/api/backup/restore", headers: { "content-type": "application/gzip" }, payload: archive.rawPayload });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().preferences).toEqual({ "vaultly.pdf.fit": "width" });
    expect((await app.inject(endpoint)).statusCode).toBe(200);
    expect(readdirSync(profileImageDirectory)).toHaveLength(1);

    const legacy = structuredClone(backup);
    legacy.version = 1;
    delete legacy.profileImages;
    delete legacy.data.people[0].profile_image;
    expect((await app.inject({ method: "POST", url: "/api/backup/restore", payload: legacy })).statusCode).toBe(200);
    expect((await app.inject(endpoint)).statusCode).toBe(404);
    expect(readdirSync(profileImageDirectory)).toHaveLength(0);
    expect((await app.inject({ method: "POST", url: "/api/backup/restore", headers: { "content-type": "application/gzip" }, payload: gzipSync("invalid") })).statusCode).toBe(400);

    const fetchImage = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array(image)));
    try {
      expect((await app.inject({ method: "PUT", url: endpoint, payload: { url: "https://example.com/photo.png" } })).statusCode).toBe(200);
      expect(fetchImage).toHaveBeenCalledOnce();
      expect((await app.inject({ method: "PUT", url: endpoint, payload: { url: "file:///photo.png" } })).statusCode).toBe(400);
      expect((await app.inject({ method: "PUT", url: endpoint, payload: { data: Buffer.from("<svg/>").toString("base64") } })).statusCode).toBe(400);
      expect(readdirSync(profileImageDirectory)).toHaveLength(1);
      await app.inject({ method: "DELETE", url: `/api/people/${person.id}` });
      expect(readdirSync(profileImageDirectory)).toHaveLength(0);
    } finally { fetchImage.mockRestore(); }
  } finally { await app.close(); }
});
