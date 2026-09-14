import { afterEach, expect, test } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectItems } from "./scanner.js";

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
});
