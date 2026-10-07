import { afterAll, expect, test, vi } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { readdirSync, rmSync } from "node:fs";

const isolated = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  return { directory: mkdtempSync(join(tmpdir(), "vaultly-people-scan-test-")) };
});
vi.mock("./database.js", async (original) => {
  const previous = process.env.VAULTLY_RUNTIME_DIR;
  process.env.VAULTLY_RUNTIME_DIR = isolated.directory;
  try { return await original(); }
  finally { if (previous === undefined) delete process.env.VAULTLY_RUNTIME_DIR; else process.env.VAULTLY_RUNTIME_DIR = previous; }
});
import { database } from "./database.js";
import { createPeopleProfileScanner, matchingProfiles, getProfileScanActivity, type ProfileCandidate } from "./people-profile-scan.js";
import { profileImageDirectory, storeProfileImage } from "./profile-images.js";

afterAll(() => { database.close(); rmSync(isolated.directory, { recursive: true, force: true }); });
const candidate = (name: string, slug: string, aliases: string[] = []): ProfileCandidate => ({ name, aliases, profileUrl: `https://xhamster.com/pornstars/${slug}`, imageUrl: "https://images.xhcdn.com/avatar1.png" });

test("matches exact normalized names and explicit aliases without substring or fuzzy matches", () => {
  expect(matchingProfiles(" Kaho Shibuya ", [candidate("Shibuya Kaho", "shibuya-kaho", ["Kaho Shibuya"])])).toHaveLength(1);
  expect(matchingProfiles("Alice Smith", [candidate("ALICE-SMITH", "alice")])).toHaveLength(1);
  expect(matchingProfiles("Alice", [candidate("Alice Smith", "alice-smith")])).toHaveLength(0);
  const duplicate = candidate("Alice", "alice");
  expect(matchingProfiles("Alice", [duplicate, duplicate])).toHaveLength(1);
});

test("scans every existing person, preserves photos and manual edits, and reports all outcomes", async () => {
  const image = createCanvas(10, 10).toBuffer("image/png");
  const kept = await storeProfileImage(image);
  const ids = new Map<string, number>();
  for (const name of ["Alice", "Bob", "Carol", "Dan", "Eve", "Frank", "Grace"]) {
    ids.set(name, Number(database.prepare("INSERT INTO people(name, profile_image) VALUES (?, ?)").run(name, name === "Alice" ? kept : null).lastInsertRowid));
  }
  const close = vi.fn(async () => undefined);
  const findPerson = vi.fn(async (name: string) => {
    if (name === "Bob") return [candidate("Robert", "robert", ["Bob"])];
    if (name === "Carol") return [candidate("Carol", "carol"), candidate("Carol", "carol-other")];
    if (name === "Eve") throw new Error("HTTP 403");
    if (name === "Frank") { database.prepare("UPDATE people SET profile_image = ? WHERE id = ?").run(kept, ids.get(name)!); return [candidate(name, "frank")]; }
    if (name === "Grace") { database.prepare("UPDATE people SET name = 'Renamed Grace' WHERE id = ?").run(ids.get(name)!); return [candidate(name, "grace")]; }
    return [];
  });
  const scanner = createPeopleProfileScanner({ createBrowser: async () => ({ findPerson, close }), fetchProfileImage: async () => new Response(new Uint8Array(image)) });
  await scanner.start();
  await vi.waitFor(async () => expect((await scanner.status()).status).toBe("completed"));
  const report = await scanner.status();
  expect(report).toMatchObject({ total: 7, processed: 7, updated: 1 });
  expect(report.results.map((row) => row.outcome)).toEqual(["existing", "updated", "ambiguous", "not-found", "error", "changed", "changed"]);
  expect(findPerson).not.toHaveBeenCalledWith("Alice", expect.anything());
  expect(database.prepare("SELECT profile_image FROM people WHERE id = ?").get(ids.get("Alice")!)).toMatchObject({ profile_image: kept });
  expect(database.prepare("SELECT profile_image FROM people WHERE id = ?").get(ids.get("Frank")!)).toMatchObject({ profile_image: kept });
  expect(readdirSync(profileImageDirectory)).toHaveLength(2);
  expect(close).toHaveBeenCalledOnce();
  expect((await createPeopleProfileScanner({}).status()).processed).toBe(7);
});

test("cancelling an in-flight lookup closes the browser and leaves unmatched people unchanged", async () => {
  const entered = vi.fn();
  const close = vi.fn(async () => undefined);
  const scanner = createPeopleProfileScanner({ createBrowser: async () => ({
    findPerson: (_name, signal) => new Promise((_resolve, reject) => { entered(); signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }); }), close,
  }) });
  await scanner.start();
  await vi.waitFor(() => expect(entered).toHaveBeenCalled());
  expect(getProfileScanActivity()).toEqual([expect.objectContaining({ total: 7, currentName: expect.any(String) })]);
  await expect(scanner.start()).rejects.toThrow("already running");
  expect((await scanner.cancel()).status).toBe("cancelled");
  expect(getProfileScanActivity()).toEqual([]);
  expect(close).toHaveBeenCalledOnce();
});
