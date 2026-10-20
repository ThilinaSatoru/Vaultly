import { afterEach, expect, test } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { automaticCollectionGroups, collectItems, inferCollectionPattern } from "./scanner.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test("classifies mixed and nested media without indexing individual comic pages", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-scan-"));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, "Comics", "Issue 01"), { recursive: true });
  await mkdir(path.join(root, "Videos"));
  await mkdir(path.join(root, "Stories"));

  await Promise.all([
    writeFile(path.join(root, "Comics", "Issue 01", "001.jpg"), "image-one"),
    writeFile(path.join(root, "Comics", "Issue 01", "002.png"), "image-two"),
    writeFile(path.join(root, "Comics", "Archive.cbz"), "archive"),
    writeFile(path.join(root, "Videos", "Sample Movie.mp4"), "video"),
    writeFile(path.join(root, "Stories", "My Story.pdf"), "pdf"),
    writeFile(path.join(root, "ignore.txt"), "ignored"),
  ]);

  const items = await collectItems(root);

  expect(items).toHaveLength(4);
  expect(items.map((item) => [item.mediaType, item.title]).sort()).toEqual([
    ["comic", "Archive.cbz"],
    ["comic", "Issue 01"],
    ["story", "My Story.pdf"],
    ["video", "Sample Movie.mp4"],
  ]);
  expect(items.find((item) => item.title === "Issue 01")?.fileCount).toBe(2);
  expect(items.find((item) => item.title === "Issue 01")?.fileExtension).toBe("");
  expect(items.find((item) => item.title === "My Story.pdf")?.filename).toBe("My Story.pdf");
  expect(items.find((item) => item.title === "My Story.pdf")?.fileExtension).toBe("pdf");
});

test("scans the root and every branch at arbitrary depth, including children of comic folders", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-recursive-scan-"));
  temporaryDirectories.push(root);
  await writeFile(path.join(root, "Root.pdf"), "root story");
  await writeFile(path.join(root, "Cover.jpg"), "root comic page");

  // More siblings than the directory batch size catches accidentally dropped branches.
  const branches = Array.from({ length: 9 }, (_, index) => `Branch ${index}`);
  await Promise.all(branches.map(async (branch) => {
    const nestedDirectory = path.join(root, branch, "Comic", "Volume", "Chapter", "Extras");
    await mkdir(nestedDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(root, branch, "Story.pdf"), "story"),
      writeFile(path.join(root, branch, "Comic", "001.jpg"), "comic page"),
      writeFile(path.join(nestedDirectory, "Movie.mp4"), "video"),
      writeFile(path.join(nestedDirectory, "Archive.cbz"), "comic archive"),
    ]);
  }));
  await mkdir(path.join(root, "Empty", "Nested"), { recursive: true });

  const items = await collectItems(root);
  const expectedPaths = [".", "Root.pdf", ...branches.flatMap((branch) => [
    path.join(branch, "Story.pdf"),
    path.join(branch, "Comic"),
    path.join(branch, "Comic", "Volume", "Chapter", "Extras", "Movie.mp4"),
    path.join(branch, "Comic", "Volume", "Chapter", "Extras", "Archive.cbz"),
  ])];

  expect(items.map((item) => item.relativePath).sort()).toEqual(expectedPaths.sort());
  expect(items.filter((item) => item.mediaType === "video")).toHaveLength(branches.length);
  expect(items.filter((item) => item.mediaType === "story")).toHaveLength(branches.length + 1);
  expect(items.filter((item) => item.mediaType === "comic")).toHaveLength(branches.length * 2 + 1);
});

test("indexes additional transport, disc, mobile and legacy video extensions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-video-formats-"));
  temporaryDirectories.push(root);
  const filenames = ["Movie.mts", "Movie.M2TS", "Movie.vob", "Movie.ogv", "Movie.3gp", "Movie.3g2", "Movie.asf", "Movie.mxf"];
  await Promise.all(filenames.map((name) => writeFile(path.join(root, name), "video fixture")));
  const items = await collectItems(root);
  expect(items.map((item) => item.filename).sort()).toEqual([...filenames].sort());
  expect(items.every((item) => item.mediaType === "video")).toBe(true);
});

test("recognizes conservative sequel filename patterns", () => {
  expect(inferCollectionPattern("Northern Lights S02E04 1080p.mkv")).toEqual({ title: "Northern Lights", order: 20004 });
  expect(inferCollectionPattern("Northern.Lights - Vol 03.pdf")).toEqual({ title: "Northern Lights", order: 3 });
  expect(inferCollectionPattern("Northern Lights 01.cbz")).toEqual({ title: "Northern Lights", order: 1 });
  expect(inferCollectionPattern("Northern Lights 2.mkv")).toEqual({ title: "Northern Lights", order: 2 });
  expect(inferCollectionPattern("Northern Lights (3).pdf")).toEqual({ title: "Northern Lights", order: 3 });
  expect(inferCollectionPattern("Northern Lights 2x05.mkv")).toEqual({ title: "Northern Lights", order: 20005 });
  expect(inferCollectionPattern("04 - Northern Lights.cbz")).toEqual({ title: "Northern Lights", order: 4 });
  expect(inferCollectionPattern("Northern Lights IV.cbz")).toEqual({ title: "Northern Lights", order: 4 });
  expect(inferCollectionPattern("Northern Lights 2024.mkv")).toBeNull();
  expect(inferCollectionPattern("Single Movie.mkv")).toBeNull();
});

test("shared one/two-word prefixes cover introductions, trailing credits and Unicode without duplicate memberships", () => {
  const names = ["Kaamini 2 Chapter 1 (RishJanzz).pdf", "Kaamini 2 Chapter 10 (RishJanzz).pdf", "Kaamini 2 Introduction RishJanzz.pdf",
    "Kamakumariya Dini 01.pdf", "Kamakumariya Dini Part 2.4.pdf", "Nelum Episode 1 (Rish Janzz).pdf", "Nelum Episode 2 (RishJanzz).pdf",
    "කාමිණි 1 RishJanzz.pdf", "කාමිණි 2 RishJanzz.pdf", "Standalone.pdf"];
  const entries = names.map((filename, id) => ({ id, item: { filename, relativePath: filename, mediaType: "story" as const } }));
  const groups = automaticCollectionGroups(7, "/books", "ebooks", entries);
  expect([...groups.values()].map((group) => [group.title, group.entries.length])).toEqual([
    ["Kaamini 2", 3], ["Kamakumariya Dini", 2], ["Nelum", 2], ["කාමිණි", 2],
  ]);
  const ids = [...groups.values()].flatMap((group) => group.entries.map((entry) => entry.id));
  expect(new Set(ids).size).toBe(ids.length);
  const mixed = automaticCollectionGroups(8, "/mixed", "mixed", [
    { id: 1, item: { filename: "Same intro.pdf", relativePath: "Same intro.pdf", mediaType: "story" } },
    { id: 2, item: { filename: "Same sequel.mp4", relativePath: "Same sequel.mp4", mediaType: "video" } },
  ]);
  expect(mixed.size).toBe(0);
  expect([...automaticCollectionGroups(9, "/movies", "movies", [
    { id: 1, item: { filename: "Harbor Beginning.mp4", relativePath: "First/Harbor Beginning.mp4", mediaType: "video" } },
    { id: 2, item: { filename: "Harbor Return.mp4", relativePath: "Second/Harbor Return.mp4", mediaType: "video" } },
  ]).values()].map((group) => group.entries.length)).toEqual([2]);
});

test("comic files in the same source directory do not become an automatic set", () => {
  const groups = automaticCollectionGroups(10, "/manga", "manga", [
    { id: 1, item: { filename: "Cover.cbz", relativePath: "Series/Cover.cbz", mediaType: "comic" } },
    { id: 2, item: { filename: "Volume.cbz", relativePath: "Series/Volume.cbz", mediaType: "comic" } },
  ]);
  expect(groups.size).toBe(0);
});

test("directory grouping can be disabled independently from filename prefix grouping", () => {
  const groups = automaticCollectionGroups(11, "/shows", "tv", [
    { id: 1, item: { filename: "Pilot.mp4", relativePath: "Series/Pilot.mp4", mediaType: "video" } },
    { id: 2, item: { filename: "Finale.mp4", relativePath: "Series/Finale.mp4", mediaType: "video" } },
  ], true, false);
  expect(groups.size).toBe(0);
});
