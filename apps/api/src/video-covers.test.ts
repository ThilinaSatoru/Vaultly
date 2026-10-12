import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { createCanvas } from "@napi-rs/canvas";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { coverCandidates, findMediaCover } from "./video-covers.js";
import { parseVideoTracks } from "./video-tracks.js";
import { database } from "./database.js";
import { buildVaultlyServer } from "./server.js";
import { scanSource } from "./scanner.js";

test("recognised covers win in predictable order while unrelated images are ignored", () => {
  expect(coverCandidates("Movie.mp4", ["junk.jpg", "poster.png", "Movie-cover.webp", "Movie.jpg", "cover.png", "folder.jpg"])).toEqual(["Movie.jpg", "Movie-cover.webp", "poster.png", "cover.png", "folder.jpg"]);
  expect(coverCandidates("Movie.mp4", ["junk.jpg"])).toEqual([]);
});

test("common sidecar patterns support separators, full filenames, case and fallback artwork", () => {
  expect(coverCandidates("Movie.mkv", ["Movie_cover.PNG", "Movie.mkv-poster.jpg", "Movie Front.webp", "front-cover.jpg", "fanart.jpg", "banner.png", "thumbnail.webp", "Holiday.png"])).toEqual([
    "Movie Front.webp", "Movie_cover.PNG", "Movie.mkv-poster.jpg", "front-cover.jpg", "fanart.jpg", "banner.png", "thumbnail.webp",
  ]);
  expect(coverCandidates("Book.epub", ["Book.poster.avif", "AlbumArtSmall.jpg", "folder.jpeg", "cover-front.png"])).toEqual(["Book.poster.avif", "folder.jpeg", "cover-front.png", "AlbumArtSmall.jpg"]);
  expect(coverCandidates("Series.v2", ["Series.v2-poster.png", "poster.png"], true)).toEqual(["Series.v2-poster.png", "poster.png"]);
});

test("damaged preferred artwork falls back to the next valid cover inside the media folder", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-cover-fallback-"));
  try {
    await writeFile(path.join(root, "Film-poster.png"), "damaged");
    await writeFile(path.join(root, "cover.png"), createCanvas(120, 180).toBuffer("image/png"));
    expect(await findMediaCover(root, path.join(root, "Film.mkv"))).toMatchObject({ path: "cover.png", width: 120, height: 180 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("season files inherit nearby group artwork without looking outside the source", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "vaultly-series-cover-"));
  const root = path.join(base, "Library"), show = path.join(root, "Show"), season = path.join(show, "Season 1");
  try {
    await mkdir(season, { recursive: true });
    await writeFile(path.join(base, "cover.png"), createCanvas(300, 100).toBuffer("image/png"));
    const episode = path.join(season, "Episode.mkv");
    expect(await findMediaCover(root, episode)).toBeNull();
    await writeFile(path.join(show, "Show-poster.png"), createCanvas(120, 180).toBuffer("image/png"));
    expect(await findMediaCover(root, episode)).toMatchObject({ path: path.join("Show", "Show-poster.png"), width: 120, height: 180 });
    await writeFile(path.join(season, "cover.png"), createCanvas(180, 120).toBuffer("image/png"));
    expect(await findMediaCover(root, episode)).toMatchObject({ path: path.join("Show", "Season 1", "cover.png"), width: 180, height: 120 });
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("books and comic folders scan covers, retain manual artwork, and restore scanned covers", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-reading-covers-"));
  const source = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path, media_type) VALUES (?, ?, ?, 'mixed')").run("Reading covers", root, root).lastInsertRowid);
  const app = await buildVaultlyServer(); app.log.level = "silent";
  const portrait = createCanvas(120, 180).toBuffer("image/png"), landscape = createCanvas(180, 120).toBuffer("image/png");
  try {
    await mkdir(path.join(root, "Books")); await mkdir(path.join(root, "Comics"));
    await writeFile(path.join(root, "Books", "Book.pdf"), "fixture; cover bypasses PDF decoding");
    await writeFile(path.join(root, "Books", "Book_cover.png"), landscape);
    await writeFile(path.join(root, "Comics", "001.png"), landscape);
    await writeFile(path.join(root, "Comics", "cover.png"), portrait);
    await scanSource(source, root);
    const list = () => app.inject(`/api/items?source=${source}`);
    const items = (await list()).json().items;
    const book = items.find((item: { media_type: string }) => item.media_type === "story");
    const comic = items.find((item: { relative_path: string }) => item.relative_path === "Comics");
    expect(book).toMatchObject({ has_cover: 1, cover_width: 180, cover_height: 120 });
    expect(comic).toMatchObject({ has_cover: 1, cover_width: 120, cover_height: 180 });
    expect((await app.inject(`/api/items/${book.id}/thumbnail`)).rawPayload).toEqual(landscape);
    expect((await app.inject(`/api/items/${comic.id}/thumbnail`)).rawPayload).toEqual(portrait);
    for (const item of [book, comic]) {
      const result = await app.inject({ method: "PUT", url: `/api/items/${item.id}/cover`, payload: { image: landscape.toString("base64") } });
      expect(result.statusCode, result.body).toBe(200);
    }
    await writeFile(path.join(root, "Books", "Book_cover.png"), portrait);
    await scanSource(source, root);
    const rescanned = (await list()).json().items;
    expect(rescanned.find((item: { id: number }) => item.id === comic.id)).toMatchObject({ custom_cover: 1, cover_width: 180, cover_height: 120 });
    for (const item of [book, comic]) {
      expect((await app.inject({ method: "DELETE", url: `/api/items/${item.id}/cover` })).json()).toMatchObject({ custom_cover: 0, has_cover: 1, cover_width: 120, cover_height: 180 });
      expect((await app.inject(`/api/items/${item.id}/thumbnail`)).rawPayload).toEqual(portrait);
    }
  } finally {
    database.prepare("DELETE FROM sources WHERE id = ?").run(source);
    await app.close(); await rm(root, { recursive: true, force: true });
  }
});

test("stream probing skips bitmap subtitles and records languages, defaults and titles", () => {
  const tracks = parseVideoTracks(`  Stream #0:0: Video: h264
  Stream #0:1[0x2](eng): Audio: aac (default)
    Metadata:
      title           : English dub
  Stream #0:2(jpn): Audio: aac
  Stream #0:3(eng): Subtitle: subrip
  Stream #0:4: Subtitle: hdmv_pgs_subtitle`);
  expect(tracks.audio).toEqual([{ index: 1, language: "eng", title: "English dub", codec: "aac", default: true }, { index: 2, language: "jpn", title: "", codec: "aac", default: false }]);
  expect(tracks.subtitles.map((track) => track.index)).toEqual([3]);
});

test("video covers survive rescans and backup export, audio selection serves a seekable track", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-video-cover-"));
  const source = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path, media_type) VALUES (?, ?, ?, 'movies')").run("Cover test", root, root).lastInsertRowid);
  const app = await buildVaultlyServer(); app.log.level = "silent";
  const portrait = createCanvas(120, 180).toBuffer("image/png"), landscape = createCanvas(180, 120).toBuffer("image/png");
  try {
    await writeFile(path.join(root, "poster.png"), portrait);
    await writeFile(path.join(root, "junk.png"), landscape);
    await writeFile(path.join(root, "Film.eng.srt"), "1\n00:00:00,000 --> 00:00:01,000\nHello\n");
    await promisify(execFile)(ffmpegInstaller.path, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=10", "-f", "lavfi", "-i", "sine=frequency=440", "-f", "lavfi", "-i", "sine=frequency=880", "-i", path.join(root, "Film.eng.srt"), "-map", "0:v", "-map", "1:a", "-map", "2:a", "-map", "3:s", "-t", "2", "-c:v", "libx264", "-threads", "2", "-c:a", "aac", "-c:s", "mov_text", "-metadata:s:a:0", "language=eng", "-metadata:s:a:1", "language=jpn", "-metadata:s:s:0", "language=eng", "-y", path.join(root, "Film.mp4")], { windowsHide: true, timeout: 15_000 });
    await scanSource(source, root);
    const list = () => app.inject(`/api/items?source=${source}&type=video`);
    let item = (await list()).json().items[0];
    expect(item).toMatchObject({ has_cover: 1, custom_cover: 0, cover_width: 120, cover_height: 180, video_width: 160, video_height: 90 });
    expect((await app.inject(`/api/items/${item.id}/thumbnail`)).rawPayload).toEqual(portrait);
    const manual = await app.inject({ method: "PUT", url: `/api/items/${item.id}/cover`, payload: { image: landscape.toString("base64") } });
    expect(manual.statusCode, manual.body).toBe(200);
    expect(manual.json()).toMatchObject({ cover_width: 180, cover_height: 120, custom_cover: 1 });
    expect((await app.inject({ method: "PUT", url: `/api/items/${item.id}/cover`, payload: { image: Buffer.from("<svg/>").toString("base64") } })).statusCode).toBe(400);
    await scanSource(source, root);
    item = (await list()).json().items[0];
    expect(item).toMatchObject({ custom_cover: 1, cover_width: 180, cover_height: 120 });
    const backup = (await app.inject("/api/backup")).json();
    expect(backup.data.media_items.find((row: { id: number }) => row.id === item.id).cover_data).toBeTypeOf("string");
    const tracks = (await app.inject(`/api/items/${item.id}/tracks`)).json();
    expect(tracks.audio.map((track: { language: string }) => track.language)).toEqual(["eng", "jpn"]);
    expect((await app.inject(`/api/items/${item.id}/embedded-subtitles/${tracks.subtitles[0].index}`)).body).toContain("Hello");
    const audio = await app.inject({ url: `/api/items/${item.id}/audio/${tracks.audio[1].index}`, headers: { range: "bytes=0-99" } });
    expect(audio.statusCode, audio.body).toBe(206);
    expect(audio.headers["content-type"]).toBe("audio/mp4");
    expect(audio.rawPayload.length).toBe(100);
    expect((await app.inject(`/api/items/${item.id}/audio/9999`)).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/items/${item.id}/cover` })).json()).toMatchObject({ custom_cover: 0, cover_width: 120, cover_height: 180 });
  } finally {
    database.prepare("DELETE FROM sources WHERE id = ?").run(source);
    await app.close(); await rm(root, { recursive: true, force: true });
  }
}, 30_000);
