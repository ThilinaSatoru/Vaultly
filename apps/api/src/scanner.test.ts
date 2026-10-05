import { afterEach, expect, test } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectItems, inferCollectionPattern } from "./scanner.js";

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
    ["comic", "Archive"],
    ["comic", "Issue 01"],
    ["story", "My Story"],
    ["video", "Sample Movie"],
  ]);
  expect(items.find((item) => item.title === "Issue 01")?.fileCount).toBe(2);
  expect(items.find((item) => item.title === "Issue 01")?.fileExtension).toBe("");
  expect(items.find((item) => item.title === "My Story")?.filename).toBe("My Story.pdf");
  expect(items.find((item) => item.title === "My Story")?.fileExtension).toBe("pdf");
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
