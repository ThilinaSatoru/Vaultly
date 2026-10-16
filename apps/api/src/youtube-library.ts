import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { database } from "./database.js";

export function youtubeLink(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Enter a YouTube video or playlist URL."); }
  if (!["https:", "http:"].includes(url.protocol) || !["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtube-nocookie.com"].includes(url.hostname) || url.username || url.password || url.port)
    throw new Error("Use a youtube.com or youtu.be URL.");
  const parts = url.pathname.split("/").filter(Boolean);
  const videoId = url.hostname === "youtu.be" ? parts[0] : ["embed", "shorts", "live"].includes(parts[0]) ? parts[1] : url.searchParams.get("v");
  const playlistId = url.searchParams.get("list");
  return { videoId: videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId) ? videoId : null,
    playlistId: playlistId && /^[a-zA-Z0-9_-]{10,100}$/.test(playlistId) ? playlistId : null };
}

const idInput = z.object({ id: z.coerce.number().int().positive() });
const name = z.string().trim().min(1).max(200);
export async function youtubeMetadata(videoId: string) {
  const url = new URL("https://www.youtube.com/oembed");
  url.searchParams.set("url", `https://www.youtube.com/watch?v=${videoId}`); url.searchParams.set("format", "json");
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: "error" });
    if (!response.ok) throw new Error("Unavailable video");
    const metadata = z.object({ title: z.string().trim().min(1).max(500), author_name: z.string().max(200).optional() }).parse(await response.json());
    return { title: metadata.title, author: metadata.author_name ?? "" };
  } catch { throw new Error("Could not read this video's title from YouTube. Check that the link is public and try again."); }
}
interface YoutubeVideo { id: number; video_id: string; title: string; author: string; added_at: string }
const videoById = (id: number) => database.prepare("SELECT * FROM youtube_videos WHERE id=?").get(id) as YoutubeVideo | undefined;
async function saveVideo(videoId: string, title?: string) {
  const existing = database.prepare("SELECT * FROM youtube_videos WHERE video_id=?").get(videoId) as YoutubeVideo | undefined;
  if (existing) return existing;
  const metadata = title ? { title, author: "" } : await youtubeMetadata(videoId);
  // Metadata requests can overlap; keep one library record per YouTube video.
  database.prepare("INSERT OR IGNORE INTO youtube_videos(video_id,title,author) VALUES (?,?,?)").run(videoId, metadata.title, metadata.author);
  return database.prepare("SELECT * FROM youtube_videos WHERE video_id=?").get(videoId) as unknown as YoutubeVideo;
}
export async function registerYoutubeRoutes(app: FastifyInstance) {
  const exists = (id: number) => database.prepare("SELECT * FROM youtube_playlists WHERE id=?").get(id);
  const videoQuery = (input: unknown) => {
    const query = z.object({ playlist: z.coerce.number().int().positive().optional(), channel: z.string().max(200).optional(), search: z.string().max(500).default(""), sort: z.enum(["added", "title", "playlist"]).default("added"), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(60) }).parse(input);
    const joins = query.playlist ? "JOIN youtube_entries e ON e.video_id=v.video_id AND e.playlist_id=?" : "";
    const params = [...(query.playlist ? [query.playlist] : []), query.search.toLowerCase(), query.search.toLowerCase(), ...(query.channel !== undefined ? [query.channel] : [])];
    const where = "WHERE (instr(lower(v.title),?)>0 OR instr(lower(v.author),?)>0)" + (query.channel !== undefined ? " AND v.author=?" : "");
    const order = query.sort === "playlist" && query.playlist ? "e.position,e.id" : query.sort === "title" ? "v.title COLLATE NOCASE,v.id" : "v.added_at DESC,v.id DESC";
    return { query, joins, params, where, order };
  };
  app.get("/api/youtube/channels", async () => database.prepare("SELECT author AS name,COUNT(*) AS video_count FROM youtube_videos GROUP BY author ORDER BY author COLLATE NOCASE").all());
  app.get("/api/youtube/videos", async (request, reply) => {
    const { query, joins, params, where, order } = videoQuery(request.query);
    if (query.playlist && !exists(query.playlist)) return reply.code(404).send({ message: "Playlist not found." });
    const total = Number(database.prepare(`SELECT COUNT(*) AS count FROM youtube_videos v ${joins} ${where}`).get(...params)!.count);
    const items = database.prepare(`SELECT v.*${query.playlist ? ",e.id AS entry_id,e.position" : ""} FROM youtube_videos v ${joins} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, query.pageSize, (query.page - 1) * query.pageSize);
    return { items, total, page: query.page, pageSize: query.pageSize };
  });
  app.get("/api/youtube/queue", async (request) => {
    const { joins, params, where, order } = videoQuery(request.query);
    return database.prepare(`SELECT v.id,v.video_id,v.title FROM youtube_videos v ${joins} ${where} ORDER BY ${order}`).all(...params);
  });
  app.post("/api/youtube/videos", async (request, reply) => {
    const { url } = z.object({ url: z.string().min(1).max(2000) }).parse(request.body);
    try { const { videoId } = youtubeLink(url); if (!videoId) return reply.code(400).send({ message: "Enter a YouTube video link." }); return reply.code(201).send(await saveVideo(videoId)); }
    catch (error) { return reply.code(400).send({ message: error instanceof Error ? error.message : String(error) }); }
  });
  app.patch("/api/youtube/videos/:id", async (request, reply) => {
    const { id } = idInput.parse(request.params), { title } = z.object({ title: name }).parse(request.body);
    const video = videoById(id); if (!video) return reply.code(404).send({ message: "Video not found." });
    database.prepare("UPDATE youtube_videos SET title=? WHERE id=?").run(title, id);
    database.prepare("UPDATE youtube_entries SET title=? WHERE video_id=?").run(title, video.video_id);
    return videoById(id);
  });
  app.delete("/api/youtube/videos/:id", async (request, reply) => {
    const { id } = idInput.parse(request.params), video = videoById(id); if (!video) return reply.code(404).send({ message: "Video not found." });
    database.exec("BEGIN IMMEDIATE");
    try { database.prepare("DELETE FROM youtube_entries WHERE video_id=?").run(video.video_id); database.prepare("DELETE FROM youtube_videos WHERE id=?").run(id); database.exec("COMMIT"); }
    catch (error) { database.exec("ROLLBACK"); throw error; }
    return reply.code(204).send();
  });
  app.get("/api/youtube/playlists", async () => database.prepare(`SELECT p.*,
    (SELECT COUNT(*) FROM youtube_entries e WHERE e.playlist_id=p.id) AS item_count FROM youtube_playlists p ORDER BY p.name COLLATE NOCASE, p.id`).all());
  app.post("/api/youtube/playlists", async (request, reply) => {
    const input = z.object({ name, url: z.string().max(2000).optional() }).parse(request.body);
    let remoteId: string | null = null;
    if (input.url) {
      try { remoteId = youtubeLink(input.url).playlistId; } catch (error) { return reply.code(400).send({ message: String(error) }); }
      if (!remoteId) return reply.code(400).send({ message: "This link needs a valid YouTube playlist ID." });
      if (database.prepare("SELECT id FROM youtube_playlists WHERE remote_id=?").get(remoteId)) return reply.code(409).send({ message: "That YouTube playlist is already saved." });
    }
    const result = database.prepare("INSERT INTO youtube_playlists(name, remote_id) VALUES (?, ?)").run(input.name, remoteId);
    return reply.code(201).send(exists(Number(result.lastInsertRowid)));
  });
  app.patch("/api/youtube/playlists/:id", async (request, reply) => {
    const { id } = idInput.parse(request.params), input = z.object({ name }).parse(request.body);
    if (!exists(id)) return reply.code(404).send({ message: "Playlist not found." });
    database.prepare("UPDATE youtube_playlists SET name=? WHERE id=?").run(input.name, id);
    return exists(id);
  });
  app.delete("/api/youtube/playlists/:id", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    if (!database.prepare("DELETE FROM youtube_playlists WHERE id=?").run(id).changes) return reply.code(404).send({ message: "Playlist not found." });
    return reply.code(204).send();
  });
  app.get("/api/youtube/playlists/:id/entries", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    if (!exists(id)) return reply.code(404).send({ message: "Playlist not found." });
    return database.prepare("SELECT e.*,COALESCE(v.title,e.title) AS title FROM youtube_entries e LEFT JOIN youtube_videos v ON v.video_id=e.video_id WHERE playlist_id=? ORDER BY position,e.id").all(id);
  });
  app.post("/api/youtube/playlists/:id/entries", async (request, reply) => {
    const { id } = idInput.parse(request.params), input = z.object({ url: z.string().max(2000).optional(), videoId: z.number().int().positive().optional(), title: name.optional() }).refine((input) => Boolean(input.url) !== Boolean(input.videoId), "Choose a library video or a YouTube link.").parse(request.body);
    const playlist = exists(id);
    if (!playlist) return reply.code(404).send({ message: "Playlist not found." });
    if (playlist.remote_id) return reply.code(400).send({ message: "Add videos to a local playlist. Saved YouTube playlists are managed on YouTube." });
    const saved = input.videoId ? videoById(input.videoId) : undefined;
    if (input.videoId && !saved) return reply.code(404).send({ message: "Library video not found." });
    let videoId: string | null;
    try { videoId = saved?.video_id ?? youtubeLink(input.url!).videoId; } catch (error) { return reply.code(400).send({ message: String(error) }); }
    if (!videoId) return reply.code(400).send({ message: "Enter a YouTube video link." });
    if (database.prepare("SELECT id FROM youtube_entries WHERE playlist_id=? AND video_id=?").get(id, videoId)) return reply.code(409).send({ message: "This video is already in the playlist." });
    let video: YoutubeVideo;
    try { video = saved ?? await saveVideo(videoId, input.title); } catch (error) { return reply.code(400).send({ message: error instanceof Error ? error.message : String(error) }); }
    // Recheck after the title lookup, which may yield to another add request.
    if (!exists(id)) return reply.code(404).send({ message: "Playlist not found." });
    if (database.prepare("SELECT id FROM youtube_entries WHERE playlist_id=? AND video_id=?").get(id, videoId)) return reply.code(409).send({ message: "This video is already in the playlist." });
    const result = database.prepare("INSERT INTO youtube_entries(playlist_id, video_id, title, position) VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1)+1 FROM youtube_entries WHERE playlist_id=?))").run(id, videoId, video.title, id);
    return reply.code(201).send(database.prepare("SELECT * FROM youtube_entries WHERE id=?").get(Number(result.lastInsertRowid)));
  });
  app.patch("/api/youtube/playlists/:id/entries/:entryId", async (request, reply) => {
    const { id, entryId } = z.object({ id: z.coerce.number().int().positive(), entryId: z.coerce.number().int().positive() }).parse(request.params);
    const input = z.object({ title: name }).parse(request.body);
    if (!database.prepare("UPDATE youtube_entries SET title=? WHERE id=? AND playlist_id=?").run(input.title, entryId, id).changes) return reply.code(404).send({ message: "Video not found." });
    database.prepare("UPDATE youtube_videos SET title=? WHERE video_id=(SELECT video_id FROM youtube_entries WHERE id=?)").run(input.title, entryId);
    database.prepare("UPDATE youtube_entries SET title=? WHERE video_id=(SELECT video_id FROM youtube_entries WHERE id=?)").run(input.title, entryId);
    return { saved: true };
  });
  app.delete("/api/youtube/playlists/:id/entries/:entryId", async (request, reply) => {
    const { id, entryId } = z.object({ id: z.coerce.number().int().positive(), entryId: z.coerce.number().int().positive() }).parse(request.params);
    if (!database.prepare("DELETE FROM youtube_entries WHERE id=? AND playlist_id=?").run(entryId, id).changes) return reply.code(404).send({ message: "Video not found." });
    return reply.code(204).send();
  });
  app.put("/api/youtube/playlists/:id/order", async (request, reply) => {
    const { id } = idInput.parse(request.params), { ids } = z.object({ ids: z.array(z.number().int().positive()).max(10000) }).parse(request.body);
    if (!exists(id)) return reply.code(404).send({ message: "Playlist not found." });
    const current = database.prepare("SELECT id FROM youtube_entries WHERE playlist_id=?").all(id).map((row) => Number(row.id));
    if (ids.length !== current.length || new Set(ids).size !== ids.length || ids.some((entry) => !current.includes(entry))) return reply.code(400).send({ message: "Include every video exactly once." });
    database.exec("BEGIN IMMEDIATE");
    try {
      const update = database.prepare("UPDATE youtube_entries SET position=? WHERE id=? AND playlist_id=?");
      ids.forEach((entry, position) => update.run(position, entry, id)); database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
    return { saved: true };
  });
}
