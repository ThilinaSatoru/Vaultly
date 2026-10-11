import { afterEach, expect, test } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectItems } from "./scanner.js";
import { folderCollection } from "./source-media.js";
import { browseFolders } from "./folder-browse.js";
import { subtitleVtt } from "./subtitles.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
test("typed scans separate books, pictures, manga pages and videos throughout nested directories", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-media-types-")); roots.push(root);
  const folder = path.join(root, "Show", "Season 02", "Custom");
  await mkdir(folder, { recursive: true });
  await Promise.all(["Episode 03.mkv", "Episode 03.srt", "cover.jpg", "001.png", "Book.epub", "Manga.pdf", "Notes.wps", "Readme.txt", "Manga.cbz"].map((name) => writeFile(path.join(folder, name), name)));
  for (const type of ["movies", "tv", "anime"] as const) {
    const items = await collectItems(root, undefined, undefined, type);
    expect(items.map((item) => item.filename)).toEqual(["Episode 03.mkv"]);
  }
  expect((await collectItems(root, undefined, undefined, "ebooks")).map((item) => item.fileExtension).sort()).toEqual(["epub", "pdf", "txt", "wps"]);
  const pictures = await collectItems(root, undefined, undefined, "pictures");
  expect(pictures.map((item) => item.filename).sort()).toEqual(["001.png", "cover.jpg"]);
  expect(pictures.every((item) => item.fileCount === 1 && item.fileExtension)).toBe(true);
  const manga = await collectItems(root, undefined, undefined, "manga");
  expect(manga).toHaveLength(3);
  expect(manga.find((item) => item.fileExtension === "pdf")?.mediaType).toBe("comic");
  expect(manga.find((item) => item.fileExtension === "")?.fileCount).toBe(2);
});
test("series grouping handles root seasons, nested shows, episode season numbers and extras", () => {
  expect(folderCollection("Show/Season 02/Custom/Episode 03.mkv", "Episode 03.mkv", "tv")).toEqual({ title: "Show", key: "show", order: 20003 });
  expect(folderCollection("Season 01/01.mkv", "01.mkv", "anime", "My anime")).toEqual({ title: "My anime", key: "@root", order: 10001 });
  expect(folderCollection("Show/S02E04.mkv", "S02E04.mkv", "tv")?.order).toBe(20004);
  expect(folderCollection("Show/Extras/01.mkv", "01.mkv", "tv")?.order).toBe(1000001);
  expect(folderCollection("Show/Chapter 02", "Chapter 02", "manga")?.order).toBe(2);
  expect(folderCollection("Movie/movie.mp4", "movie.mp4", "movies")).toBeNull();
});
test("folder browsing keeps sibling names and separate source roots, including Windows paths", () => {
  const rows = [
    { source_id: 1, source_name: "Books", relative_path: "Shelf\\Volume 10\\Book.epub" },
    { source_id: 1, source_name: "Books", relative_path: "Shelf/Volume 2/Book.wps" },
    { source_id: 2, source_name: "Pictures", relative_path: "Shelf/Photo.png" },
    { source_id: 1, source_name: "Books", relative_path: "Root.pdf" },
  ];
  expect(browseFolders(rows)).toEqual([{ source_id: 1, path: "", name: "Books", item_count: 3 }, { source_id: 2, path: "", name: "Pictures", item_count: 1 }]);
  expect(browseFolders(rows, 1, "Shelf").map((entry) => entry.name)).toEqual(["Volume 2", "Volume 10"]);
  expect(browseFolders(rows, 1, "Shelf/Volume")).toEqual([]);
});
test("SRT conversion preserves cue text and converts timestamps to native WebVTT", () => {
  expect(subtitleVtt("\uFEFF1\r\n00:00:01,000 --> 00:00:02,500\r\nHello\r\n")).toBe("WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500\nHello\n");
  expect(subtitleVtt("WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello")).toMatch(/^WEBVTT\n\n00:/);
});


test("movie scans omit sample clips while preserving real films and other source types", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-movie-samples-")); roots.push(root);
  const folder = path.join(root, "Movie"); await mkdir(folder);
  const names = ["sample.avi", "SAMPLE.mp4", "Movie.sample.mkv", "Movie-Sample-1080p.mp4", "#sample.mp4", "Throne of Blood.avi", "Samples of Life.mp4", "Unsampled.mp4"];
  await Promise.all(names.map((name) => writeFile(path.join(folder, name), name)));
  expect((await collectItems(root, undefined, undefined, "movies")).map((item) => item.filename).sort()).toEqual(["Samples of Life.mp4", "Throne of Blood.avi", "Unsampled.mp4"]);
  expect((await collectItems(root, undefined, undefined, "tv")).map((item) => item.filename).sort()).toEqual(names.sort());
});
