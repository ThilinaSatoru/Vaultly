import Fastify from "fastify";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { rm } from "node:fs/promises";
const isolated = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs"), { tmpdir } = await import("node:os"), { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "vaultly-youtube-")), previous = process.env.VAULTLY_RUNTIME_DIR;
  process.env.VAULTLY_RUNTIME_DIR = directory; return { directory, previous };
});
import { database } from "./database.js";
import { registerYoutubeRoutes, youtubeLink } from "./youtube-library.js";
import { registerBackupRoutes } from "./backup-routes.js";
const app = Fastify();
afterEach(() => vi.unstubAllGlobals());
beforeAll(async () => { await app.register(registerYoutubeRoutes); await app.register(registerBackupRoutes); await app.ready(); });
afterAll(async () => { await app.close(); database.close(); if (isolated.previous === undefined) delete process.env.VAULTLY_RUNTIME_DIR; else process.env.VAULTLY_RUNTIME_DIR = isolated.previous; await rm(isolated.directory, { recursive: true, force: true }); });

test("accepts YouTube video and playlist URL forms and rejects unrelated or unsafe hosts", () => {
  for (const url of ["https://youtu.be/abcdefghijk", "https://www.youtube.com/watch?v=abcdefghijk", "https://m.youtube.com/shorts/abcdefghijk", "https://music.youtube.com/watch?v=abcdefghijk"]) expect(youtubeLink(url).videoId).toBe("abcdefghijk");
  expect(youtubeLink("https://www.youtube.com/playlist?list=PLabcdefghijklmn").playlistId).toBe("PLabcdefghijklmn");
  for (const url of ["https://youtube.com.evil.test/watch?v=abcdefghijk", "javascript:alert(1)", "https://user@youtube.com/watch?v=abcdefghijk", "https://youtube.com:123/watch?v=abcdefghijk"]) expect(() => youtubeLink(url)).toThrow();
});
test("maintains a local playlist with unique videos, names, exact ordering, and scoped mutations", async () => {
  const playlist = (await app.inject({ method: "POST", url: "/api/youtube/playlists", payload: { name: "Local music" } })).json();
  const base = `/api/youtube/playlists/${playlist.id}`;
  const create = (video: string, title: string) => app.inject({ method: "POST", url: `${base}/entries`, payload: { url: `https://youtu.be/${video}`, title } });
  const one = (await create("abcdefghijk", "First")).json(), two = (await create("lmnopqrstuv", "Second")).json();
  expect((await create("abcdefghijk", "Duplicate")).statusCode).toBe(409);
  expect((await app.inject({ method: "PUT", url: `${base}/order`, payload: { ids: [two.id] } })).statusCode).toBe(400);
  expect((await app.inject({ method: "PUT", url: `${base}/order`, payload: { ids: [two.id, one.id] } })).statusCode).toBe(200);
  expect((await app.inject(`${base}/entries`)).json().map((entry: { title: string }) => entry.title)).toEqual(["Second", "First"]);
  await app.inject({ method: "PATCH", url: `${base}/entries/${one.id}`, payload: { title: "Renamed" } });
  expect((await app.inject(`${base}/entries`)).json()[1].title).toBe("Renamed");
  expect((await app.inject({ method: "DELETE", url: `/api/youtube/playlists/999999/entries/${one.id}` })).statusCode).toBe(404);
  await app.inject({ method: "PATCH", url: base, payload: { name: "My playlist" } });
  expect((await app.inject("/api/youtube/playlists")).json()).toContainEqual(expect.objectContaining({ id: playlist.id, name: "My playlist", item_count: 2 }));
  await app.inject({ method: "DELETE", url: base });
  expect(database.prepare("SELECT id FROM youtube_entries WHERE playlist_id=?").all(playlist.id)).toEqual([]);
});
test("saved YouTube playlist links remain separate from locally managed video lists", async () => {
  const payload = { name: "YouTube favorites", url: "https://youtube.com/playlist?list=PLabcdefghijklmn" };
  const response = await app.inject({ method: "POST", url: "/api/youtube/playlists", payload });
  expect(response.statusCode).toBe(201); expect(response.json().remote_id).toBe("PLabcdefghijklmn");
  expect((await app.inject({ method: "POST", url: "/api/youtube/playlists", payload })).statusCode).toBe(409);
  expect((await app.inject({ method: "POST", url: `/api/youtube/playlists/${response.json().id}/entries`, payload: { title: "Video", url: "https://youtu.be/abcdefghijk" } })).statusCode).toBe(400);
  expect((await app.inject({ method: "POST", url: "/api/youtube/playlists", payload: { name: "Invalid", url: "https://youtu.be/abcdefghijk" } })).statusCode).toBe(400);
});
test("backups round-trip YouTube entries and older backups restore without new tables", async () => {
  const playlist = (await app.inject({ method: "POST", url: "/api/youtube/playlists", payload: { name: "Backup playlist" } })).json();
  await app.inject({ method: "POST", url: `/api/youtube/playlists/${playlist.id}/entries`, payload: { title: "Keep me", url: "https://youtu.be/backupabcde" } });
  const backup = (await app.inject("/api/backup")).json();
  expect(backup.data.youtube_entries).toHaveLength(1);
  await app.inject({ method: "DELETE", url: `/api/youtube/playlists/${playlist.id}` });
  expect((await app.inject({ method: "POST", url: "/api/backup/restore", payload: backup })).statusCode).toBe(200);
  expect((await app.inject(`/api/youtube/playlists/${playlist.id}/entries`)).json()[0].title).toBe("Keep me");
  const legacy = structuredClone(backup); delete legacy.data.youtube_videos;
  expect((await app.inject({ method: "POST", url: "/api/backup/restore", payload: legacy })).statusCode).toBe(200);
  expect((await app.inject("/api/youtube/videos")).json().items).toContainEqual(expect.objectContaining({ video_id: "backupabcde", title: "Keep me" }));
  delete backup.data.youtube_entries; delete backup.data.youtube_playlists; delete backup.data.youtube_videos;
  expect((await app.inject({ method: "POST", url: "/api/backup/restore", payload: backup })).statusCode).toBe(200);
  expect((await app.inject("/api/youtube/playlists")).json()).toEqual([]);
});

test("link imports fetch titles and channels automatically and videos remain independent of playlists", async () => {
  const fetchMetadata = vi.fn(async () => ({ ok: true, json: async () => ({ title: "Embedded player demo", author_name: "Demo channel" }) }));
  vi.stubGlobal("fetch", fetchMetadata);
  const response = await app.inject({ method: "POST", url: "/api/youtube/videos", payload: { url: "https://youtu.be/abcdefghijk" } });
  expect(response.statusCode).toBe(201);
  const video = response.json(); expect(video).toMatchObject({ title: "Embedded player demo", author: "Demo channel", video_id: "abcdefghijk" });
  const requested = fetchMetadata.mock.calls[0]![0] as unknown as URL;
  expect(requested.origin).toBe("https://www.youtube.com"); expect(requested.pathname).toBe("/oembed");
  const duplicate = await app.inject({ method: "POST", url: "/api/youtube/videos", payload: { url: "https://youtube.com/watch?v=abcdefghijk" } });
  expect(duplicate.json().id).toBe(video.id); expect(fetchMetadata).toHaveBeenCalledOnce();
  expect((await app.inject("/api/youtube/videos?search=demo%20channel")).json().total).toBe(1);
  expect((await app.inject("/api/youtube/videos?search=embedded")).json().total).toBe(1);
  expect((await app.inject("/api/youtube/videos?channel=Other")).json().total).toBe(0);
  expect((await app.inject("/api/youtube/channels")).json()).toContainEqual({ name: "Demo channel", video_count: 1 });
  const playlist = (await app.inject({ method: "POST", url: "/api/youtube/playlists", payload: { name: "Saved demos" } })).json();
  await app.inject({ method: "POST", url: `/api/youtube/playlists/${playlist.id}/entries`, payload: { videoId: video.id } });
  expect(fetchMetadata).toHaveBeenCalledOnce();
  expect((await app.inject(`/api/youtube/videos?playlist=${playlist.id}&channel=Demo%20channel`)).json().items[0]).toMatchObject({ id: video.id, title: video.title, position: 0 });
  await app.inject({ method: "DELETE", url: `/api/youtube/playlists/${playlist.id}` });
  expect((await app.inject("/api/youtube/videos")).json().total).toBe(1);
  await app.inject({ method: "DELETE", url: `/api/youtube/videos/${video.id}` });
  expect((await app.inject("/api/youtube/videos")).json().total).toBe(0);
});

test("invalid links do not trigger metadata requests and unavailable videos produce a useful error", async () => {
  const fetchMetadata = vi.fn(async () => ({ ok: false })); vi.stubGlobal("fetch", fetchMetadata);
  expect((await app.inject({ method: "POST", url: "/api/youtube/videos", payload: { url: "https://evil.test/watch?v=abcdefghijk" } })).statusCode).toBe(400);
  expect(fetchMetadata).not.toHaveBeenCalled();
  const unavailable = await app.inject({ method: "POST", url: "/api/youtube/videos", payload: { url: "https://youtu.be/privateabcd" } });
  expect(unavailable.statusCode).toBe(400); expect(unavailable.json().message).toContain("title from YouTube");
  expect((await app.inject("/api/youtube/videos")).json().total).toBe(0);
});
