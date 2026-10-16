import { afterAll, expect, test, vi } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { createCanvas } from "@napi-rs/canvas";

const isolated = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "vaultly-music-"));
  const previous = process.env.VAULTLY_RUNTIME_DIR;
  process.env.VAULTLY_RUNTIME_DIR = join(directory, "runtime");
  return { directory, previous };
});
import { database } from "./database.js";
import { buildVaultlyServer } from "./server.js";
import { scanMusicSource, cancelMusicScan } from "./music-scanner.js";
import { parseMusicMetadata } from "./music-metadata.js";
import * as musicMetadata from "./music-metadata.js";
import { runCommand } from "./background-processes.js";
import { getBackgroundActivity } from "./background-activity.js";

afterAll(async () => {
  database.close();
  if (isolated.previous === undefined) delete process.env.VAULTLY_RUNTIME_DIR; else process.env.VAULTLY_RUNTIME_DIR = isolated.previous;
  await rm(isolated.directory, { recursive: true, force: true });
});

test("reads container tags, audio quality and attached artwork without replacing titles with stream metadata", () => {
  expect(parseMusicMetadata(`Input #0, flac, from 'track.flac':
  Metadata:
    TITLE           : A quiet holiday
    ALBUM           : Night music
    album_artist    : Various Artists
    artist          : One Artist
  Duration: 00:03:24.50, start: 0.000000, bitrate: 950 kb/s
    Stream #0:0: Audio: flac, 96000 Hz, stereo, s32 (24 bit)
    Metadata:
      title         : Audio track
    Stream #0:1: Video: mjpeg, yuvj420p, 600x600 (attached pic)`)).toMatchObject({
      tags: { title: "A quiet holiday", album: "Night music", album_artist: "Various Artists", artist: "One Artist" },
      duration: 204.5, bitrate: 950, sample_rate: 96000, bit_depth: 24, codec: "flac", channels: "stereo", hasCover: true, hasAudio: true,
    });
});

test("isolates real music scans, artwork, scopes, ratings, playlists, range playback, rescans and backups", async () => {
  const root = path.join(isolated.directory, "music"), folder = path.join(root, "Artists", "Night music");
  await mkdir(folder, { recursive: true });
  const cover = path.join(isolated.directory, "art.jpg");
  const canvas = createCanvas(64,64); const context = canvas.getContext("2d"); context.fillStyle = "#466e98"; context.fillRect(0,0,64,64);
  await writeFile(cover, canvas.toBuffer("image/jpeg"));
  const firstFile = path.join(folder,"01 Quiet.mp3"), secondFile = path.join(folder,"02 Ocean.flac");
  await runCommand(ffmpegInstaller.path, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-i", cover,
    "-map", "0:a", "-map", "1:v", "-c:a", "libmp3lame", "-b:a", "192k", "-c:v", "copy", "-id3v2_version", "3",
    "-metadata", "title=Quiet holiday", "-metadata", "artist=One Artist", "-metadata", "album=Night music", "-metadata", "album_artist=Various Artists",
    "-metadata", "genre=Ambient;Electronic", "-metadata", "track=1/2", "-metadata", "date=2025", "-y", firstFile], { windowsHide: true });
  await runCommand(ffmpegInstaller.path, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=3", "-c:a", "flac",
    "-metadata", "title=Ocean", "-metadata", "artist=Another Artist", "-metadata", "album=Night music", "-metadata", "album_artist=Various Artists", "-metadata", "track=2", "-y", secondFile], { windowsHide: true });
  await writeFile(path.join(folder,"Unrelated.pdf"),"not music");
  const app = await buildVaultlyServer(); app.log.level = "silent";
  try {
    const attribute = (await app.inject({ method: "POST", url: "/api/music/attributes", payload: { kind: "tag", name: "Vacations", patterns: ["holiday"] } })).json();
    const added = await app.inject({ method: "POST", url: "/api/music/sources", payload: { rootPath: root } });
    expect(added.statusCode).toBe(202);
    const sourceId = added.json().id;
    expect(getBackgroundActivity().some((task) => task.id === `music-${sourceId}`)).toBe(true);
    await scanMusicSource(sourceId);
    const library = (await app.inject("/api/music/library")).json();
    expect(library.stats.tracks).toBe(2);
    expect(library.sources[0]).toMatchObject({ status: "ready", track_count: 2 });
    expect(library.albums).toHaveLength(1);
    expect(library.albums[0]).toMatchObject({ title: "Night music", artist: "Various Artists", track_count: 2 });
    expect(library.artists.map((a: { name: string }) => a.name)).toEqual(["Another Artist", "One Artist", "Various Artists"]);
    expect((await app.inject("/api/items")).json().total).toBe(0);
    expect((await app.inject("/api/sources")).json()).toEqual([]);
    expect((await app.inject("/api/tags")).json()).toEqual([]);
    expect((await app.inject("/api/categories")).json()).toEqual([]);
    expect((await app.inject("/api/people")).json()).toEqual([]);
    const page = (await app.inject("/api/music/tracks?sort=album")).json();
    const [first,second] = page.items;
    expect(first).toMatchObject({ title: "Quiet holiday", artist: "One Artist", track_number: 1, codec: "mp3", has_cover: 1 });
    expect(first.duration).toBeGreaterThan(1);
    expect(first.bitrate).toBe(192);
    expect(first.attributes.map((a: { name: string }) => a.name)).toEqual(expect.arrayContaining(["Ambient","Electronic","Vacations","mp3"]));
    const image = await app.inject(`/api/music/tracks/${first.id}/cover`);
    expect(image.statusCode).toBe(200); expect(image.rawPayload.subarray(0,2)).toEqual(Buffer.from([0xff,0xd8]));
    expect((await app.inject(`/api/music/tracks?q=Various%20Ambient`)).json().total).toBe(1);
    expect((await app.inject(`/api/music/tracks?q=Quiet&artist=${library.artists[0].id}`)).json().total).toBe(0);
    expect((await app.inject(`/api/music/tracks?album=${library.albums[0].id}`)).json().total).toBe(2);
    expect((await app.inject(`/api/music/tracks?attribute=${attribute.id}`)).json().total).toBe(1);
    expect((await app.inject(`/api/music/tracks?pageSize=1&page=2`)).json().items[0].id).toBe(second.id);
    expect((await app.inject({ method: "PATCH", url: `/api/music/tracks/${second.id}`, payload: { rating: 5 } })).statusCode).toBe(200);
    expect((await app.inject("/api/music/tracks?sort=rating&rating=4")).json().items.map((t: { id: number }) => t.id)).toEqual([second.id]);
    expect((await app.inject({ method: "PATCH", url: `/api/music/tracks/${first.id}`, payload: { rating: 9 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `/api/music/tracks/${first.id}`, payload: { rating: 4 }, headers: { origin: "https://elsewhere.example" } })).statusCode).toBe(403);
    const manual = (await app.inject({ method: "POST", url: "/api/music/attributes", payload: { name: "My favourite", kind: "tag" } })).json();
    await app.inject({ method: "PATCH", url: `/api/music/tracks/${second.id}`, payload: { attributes: [manual.id] } });
    const playlist = (await app.inject({ method: "POST", url: "/api/music/playlists", payload: { name: "Late nights" } })).json();
    await app.inject({ method: "POST", url: `/api/music/playlists/${playlist.id}/tracks`, payload: { trackIds: [first.id,second.id,first.id] } });
    expect((await app.inject(`/api/music/queue?playlist=${playlist.id}&sort=playlist`)).json()).toEqual([first.id,second.id]);
    await app.inject({ method: "PUT", url: `/api/music/playlists/${playlist.id}/order`, payload: { trackIds: [second.id,first.id] } });
    expect((await app.inject(`/api/music/queue?playlist=${playlist.id}&sort=playlist`)).json()).toEqual([second.id,first.id]);
    expect((await app.inject({ method: "PUT", url: `/api/music/playlists/${playlist.id}/order`, payload: { trackIds: [first.id,first.id] } })).statusCode).toBe(400);
    const bytes = await readFile(firstFile);
    const range = await app.inject({ url: `/api/music/tracks/${first.id}/audio`, headers: { range: "bytes=10-29" } });
    expect(range.statusCode).toBe(206); expect(range.rawPayload).toEqual(bytes.subarray(10,30));
    const suffix = await app.inject({ url: `/api/music/tracks/${first.id}/audio`, headers: { range: "bytes=-10" } });
    expect(suffix.rawPayload).toEqual(bytes.subarray(-10));
    expect((await app.inject({ url: `/api/music/tracks/${first.id}/audio`, headers: { range: "bytes=999999999-" } })).statusCode).toBe(416);
    const transcoded = await app.inject(`/api/music/tracks/${second.id}/audio?compatible=1`);
    expect(transcoded.statusCode).toBe(200); expect(transcoded.headers["content-type"]).toContain("audio/mpeg"); expect(transcoded.rawPayload.length).toBeGreaterThan(1000);
    // Cancelled walks never mark unvisited tracks missing.
    void scanMusicSource(sourceId); await cancelMusicScan(sourceId);
    expect((await app.inject("/api/music/tracks")).json().total).toBe(2);
    const probes = vi.spyOn(musicMetadata,"readMusicMetadata");
    await app.inject({ method: "POST", url: "/api/music/attributes", payload: { name: "Night listening", kind: "category", patterns: ["Night music"] } });
    await scanMusicSource(sourceId);
    expect(probes).not.toHaveBeenCalled(); probes.mockRestore();
    expect((await app.inject(`/api/music/tracks/${first.id}`)).json().attributes).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Night listening" })]));
    expect((await app.inject(`/api/music/tracks/${second.id}`)).json()).toMatchObject({ rating: 5, attributes: expect.arrayContaining([expect.objectContaining({ id: manual.id })]) });
    await rm(secondFile); await scanMusicSource(sourceId);
    expect((await app.inject("/api/music/tracks")).json().total).toBe(1);
    expect((await app.inject({ method: "PUT", url: `/api/music/playlists/${playlist.id}/order`, payload: { trackIds: [first.id] } })).statusCode).toBe(200);
    const backup = (await app.inject("/api/backup")).json();
    expect(backup.data.music_tracks).toHaveLength(2);
    expect(Buffer.from(backup.data.music_tracks[0].cover_data,"base64")).toEqual(image.rawPayload);
    expect((await app.inject({ method: "POST", url: "/api/backup/restore", payload: backup })).statusCode).toBe(200);
    expect((await app.inject(`/api/music/tracks/${second.id}`)).json().rating).toBe(5);
    expect((await app.inject("/api/music/library")).json().playlists[0].name).toBe("Late nights");
    await scanMusicSource(sourceId);
    database.prepare("UPDATE music_tracks SET relative_path='../outside.mp3' WHERE id=?").run(first.id);
    await writeFile(path.join(isolated.directory,"outside.mp3"),bytes);
    expect((await app.inject(`/api/music/tracks/${first.id}/audio`)).statusCode).toBe(403);
    await app.inject({ method: "DELETE", url: `/api/music/sources/${sourceId}` });
    expect((await readFile(firstFile)).length).toBe(bytes.length);
    // Backups written before music existed remain restorable.
    for (const key of Object.keys(backup.data)) if (key.startsWith("music_")) delete backup.data[key];
    expect((await app.inject({ method: "POST", url: "/api/backup/restore", payload: backup })).statusCode).toBe(200);
  } finally { await app.close(); }
}, 60000);
