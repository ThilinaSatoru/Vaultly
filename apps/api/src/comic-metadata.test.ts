import { expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseComicMetadata, readComicMetadata } from "./comic-metadata.js";

test("accepts nested named entries and top-level strings while ignoring external IDs and unrelated fields", () => {
  expect(parseComicMetadata({
    title: "A title", folder: "An external path", sourceUrl: "https://example.com/comic",
    metadata: { tags: [{ id: "external", name: " Adventure " }, null, { id: "name-missing" }], artists: [{ name: "Artist" }] },
    tags: ["Adventure", "Another", 4, { name: false }], artists: ["Artist", "Guest"],
    attributeMatches: [{ kind: "people", definitionId: "untrusted-id" }],
  })).toEqual({ tags: ["Adventure", "Another"], artists: ["Artist", "Guest"] });
  expect(parseComicMetadata({ metadata: { tags: "invalid", artists: null }, tags: null, artists: 4 }))
    .toEqual({ tags: [], artists: [] });
  expect(parseComicMetadata(null)).toBeUndefined();
  expect(parseComicMetadata([])).toBeUndefined();
});

test("reads UTF-8 sidecars with a BOM and tolerates missing, malformed, and oversized files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-sidecar-"));
  const file = path.join(root, "meta.json");
  try {
    expect(await readComicMetadata(file)).toBeUndefined();
    expect(await readComicMetadata(root)).toBeUndefined();
    await writeFile(file, '\uFEFF{"artists":["Zoë"],"tags":["Travel"]}');
    expect(await readComicMetadata(file)).toEqual({ artists: ["Zoë"], tags: ["Travel"] });
    await writeFile(file, "{broken json");
    expect(await readComicMetadata(file)).toBeUndefined();
    await writeFile(file, JSON.stringify({ artists: ["A".repeat(1024 * 1024)] }));
    expect(await readComicMetadata(file)).toBeUndefined();
    const controller = new AbortController();
    controller.abort();
    await expect(readComicMetadata(file, controller.signal)).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});
