import type { FastifyInstance } from "fastify";
import { z } from "zod";
import path from "node:path";
import { createReadStream } from "node:fs";
import { mkdir, realpath, rename, stat, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { database, runtimeDirectory } from "./database.js";
import { musicBackupColumns } from "./music-schema.js";
import { scanMusicSource, cancelMusicScan, musicScanProgress, musicVideoExtensions } from "./music-scanner.js";
import { runCommand } from "./background-processes.js";
import { withMediaProcess } from "./process-resources.js";

const idInput = z.object({ id: z.coerce.number().int().positive() });
const nameInput = z.string().trim().min(1).max(200);
const trackColumns = musicBackupColumns.music_tracks.filter((column) => !["cover_data", "metadata_json"].includes(column)).map((column) => `t.${column}`).join(", ");
const trackSelect = `SELECT ${trackColumns}, a.title AS album, s.name AS source_name,
  (t.cover_data IS NOT NULL OR EXISTS(SELECT 1 FROM music_tracks art WHERE art.album_id=t.album_id AND art.cover_data IS NOT NULL)) AS has_cover,
  COALESCE((SELECT json_group_array(json_object('id', ma.id, 'kind', ma.kind, 'name', ma.name))
    FROM music_track_attributes ta JOIN music_attributes ma ON ma.id=ta.attribute_id WHERE ta.track_id=t.id), '[]') AS attributes_json
  FROM music_tracks t JOIN music_sources s ON s.id=t.source_id LEFT JOIN music_albums a ON a.id=t.album_id`;
function serialize(row: Record<string, unknown>) {
  const { attributes_json, ...track } = row;
  return { ...track, is_video: musicVideoExtensions.has(path.extname(String(track.filename)).toLowerCase()), attributes: JSON.parse(String(attributes_json)) };
}
const queryInput = z.object({
  ids: z.string().regex(/^\d+(?:,\d+)*$/).max(6000).optional(),
  q: z.string().max(500).default(""), artist: z.coerce.number().int().positive().optional(),
  album: z.coerce.number().int().positive().optional(), playlist: z.coerce.number().int().positive().optional(),
  attribute: z.coerce.number().int().positive().optional(), source: z.coerce.number().int().positive().optional(),
  rating: z.coerce.number().int().min(0).max(5).default(0), codec: z.string().max(40).default(""),
  sort: z.enum(["title", "artist", "album", "rating", "duration", "bitrate", "size", "playlist"]).default("album"),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(500).default(100),
});
function trackQuery(input: z.infer<typeof queryInput>) {
  const conditions = ["t.available=1", "t.rating >= ?"];
  const values: (string | number)[] = [input.rating];
  const add = (condition: string, value: string | number | undefined) => { if (value !== undefined && value !== "") { conditions.push(condition); values.push(value); } };
  add("EXISTS(SELECT 1 FROM music_track_artists ar WHERE ar.track_id=t.id AND ar.artist_id=?)", input.artist);
  add("t.album_id=?", input.album);
  if (input.ids) {
    const ids = input.ids.split(",").map(Number);
    conditions.push(`t.id IN (${ids.map(() => "?").join(",")})`); values.push(...ids);
  }
  add("t.source_id=?", input.source);
  add("EXISTS(SELECT 1 FROM music_playlist_tracks p WHERE p.track_id=t.id AND p.playlist_id=?)", input.playlist);
  add("EXISTS(SELECT 1 FROM music_track_attributes ta WHERE ta.track_id=t.id AND ta.attribute_id=?)", input.attribute);
  add("t.codec=?", input.codec);
  for (const term of input.q.trim().split(/\s+/).filter(Boolean)) {
    conditions.push(`(t.title || ' ' || t.artist || ' ' || t.album_artist || ' ' || COALESCE(a.title,'') || ' ' || t.filename || ' ' || t.relative_path || ' ' || t.year || ' ' || t.codec || ' ' ||
      COALESCE((SELECT group_concat(ma.name, ' ') FROM music_track_attributes ta JOIN music_attributes ma ON ma.id=ta.attribute_id WHERE ta.track_id=t.id),'')) LIKE ? ESCAPE '\\'`);
    values.push(`%${term.replace(/[\\%_]/g, "\\$&")}%`);
  }
  const sorts = { title: "t.title COLLATE NOCASE", artist: "t.artist COLLATE NOCASE, a.title COLLATE NOCASE, t.disc_number, t.track_number",
    album: "a.title COLLATE NOCASE, a.artist COLLATE NOCASE, t.disc_number, t.track_number", rating: "t.rating DESC", duration: "t.duration DESC", bitrate: "t.bitrate DESC", size: "t.size_bytes DESC",
    playlist: input.playlist ? `(SELECT p.position FROM music_playlist_tracks p WHERE p.track_id=t.id AND p.playlist_id=${input.playlist})` : "t.title COLLATE NOCASE" };
  return { where: ` WHERE ${conditions.join(" AND ")}`, values, order: ` ORDER BY ${sorts[input.sort]}, t.title COLLATE NOCASE, t.id` };
}

const conversions = new Map<string, Promise<string>>();
async function compatibleAudio(filename: string, info: { size: number; mtimeMs: number }) {
  const directory = path.join(runtimeDirectory, "music-playback");
  const key = createHash("sha256").update(`${filename}:${info.size}:${info.mtimeMs}`).digest("hex");
  const target = path.join(directory, `${key}.mp3`);
  if ((await stat(target).catch(() => null))?.size) return target;
  if (conversions.has(target)) return conversions.get(target)!;
  const task = withMediaProcess(async () => {
    await mkdir(directory, { recursive: true });
    const temporary = `${target}.tmp.mp3`;
    try {
      await runCommand(ffmpegInstaller.path, ["-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "2", "-i", filename,
        "-map", "0:a:0", "-vn", "-c:a", "libmp3lame", "-b:a", "256k", "-threads", "2", "-y", temporary],
        { windowsHide: true, timeout: 300000, maxBuffer: 1024 * 1024 });
      await rename(temporary, target);
      return target;
    } finally { await unlink(temporary).catch(() => undefined); }
  }).finally(() => conversions.delete(target));
  conversions.set(target, task);
  return task;
}

export async function registerMusicRoutes(app: FastifyInstance) {
  // All mutations are local app actions, including filesystem scanning/conversion.
  app.addHook("preHandler", async (request, reply) => {
    const origin = request.headers.origin;
    if (request.method !== "GET" && origin && !["http://127.0.0.1:5173", "http://localhost:5173", `http://${request.headers.host}`].includes(origin))
      return reply.code(403).send({ message: "Manage music from Vaultly." });
  });
  app.get("/api/music/sources", async () => {
    const sources = database.prepare(`SELECT s.*, (SELECT COUNT(*) FROM music_tracks t WHERE t.source_id=s.id AND t.available=1) AS track_count FROM music_sources s ORDER BY s.name`).all();
    return Promise.all(sources.map(async (source) => ({ ...source, media_type: "music", progress: musicScanProgress(Number(source.id)),
      path_available: Boolean((await stat(String(source.root_path)).catch(() => null))?.isDirectory()) })));
  });
  app.get("/api/music/library", async () => ({
    sources: (database.prepare(`SELECT s.*, (SELECT COUNT(*) FROM music_tracks t WHERE t.source_id=s.id AND t.available=1) AS track_count FROM music_sources s ORDER BY s.name`).all() as Array<{ id: number }>).map((s) => ({ ...s, progress: musicScanProgress(s.id) })),
    artists: database.prepare(`SELECT ar.*, COUNT(*) AS track_count FROM music_artists ar JOIN music_track_artists ta ON ta.artist_id=ar.id JOIN music_tracks t ON t.id=ta.track_id WHERE t.available=1 GROUP BY ar.id ORDER BY ar.name COLLATE NOCASE`).all(),
    albums: database.prepare(`SELECT a.*, COUNT(*) AS track_count, SUM(t.duration) AS duration,
      COALESCE(MIN(CASE WHEN t.cover_data IS NOT NULL THEN t.id END), MIN(t.id)) AS cover_track_id
      FROM music_albums a JOIN music_tracks t ON t.album_id=a.id WHERE t.available=1 GROUP BY a.id ORDER BY a.title COLLATE NOCASE`).all(),
    playlists: database.prepare(`SELECT p.*, (SELECT COUNT(*) FROM music_playlist_tracks pt JOIN music_tracks t ON t.id=pt.track_id WHERE pt.playlist_id=p.id AND t.available=1) AS track_count FROM music_playlists p ORDER BY p.name COLLATE NOCASE`).all(),
    attributes: (database.prepare(`SELECT ma.*, (SELECT COUNT(*) FROM music_track_attributes ta JOIN music_tracks t ON t.id=ta.track_id WHERE ta.attribute_id=ma.id AND t.available=1) AS track_count FROM music_attributes ma ORDER BY ma.name COLLATE NOCASE`).all() as Array<Record<string, unknown>>).map(({ patterns_json, ...a }) => ({ ...a, patterns: JSON.parse(String(patterns_json)) })),
    stats: database.prepare("SELECT COUNT(*) AS tracks, COALESCE(SUM(duration),0) AS duration, COALESCE(SUM(size_bytes),0) AS size_bytes FROM music_tracks WHERE available=1").get(),
  }));
  app.get("/api/music/tracks", async (request) => {
    const input = queryInput.parse(request.query), query = trackQuery(input);
    const total = database.prepare(`SELECT COUNT(*) AS total FROM music_tracks t LEFT JOIN music_albums a ON a.id=t.album_id${query.where}`).get(...query.values) as { total: number };
    const rows = database.prepare(`${trackSelect}${query.where}${query.order} LIMIT ? OFFSET ?`).all(...query.values, input.pageSize, (input.page - 1) * input.pageSize);
    return { items: rows.map(serialize), total: total.total, page: input.page, pageSize: input.pageSize };
  });
  app.get("/api/music/queue", async (request) => {
    const query = trackQuery(queryInput.parse(request.query));
    return database.prepare(`SELECT t.id FROM music_tracks t LEFT JOIN music_albums a ON a.id=t.album_id${query.where}${query.order}`).all(...query.values).map((r) => r.id);
  });
  app.get("/api/music/tracks/:id", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const track = database.prepare(`${trackSelect} WHERE t.id=?`).get(id);
    if (!track) return reply.code(404).send({ message: "Music track not found." });
    const metadata = database.prepare("SELECT metadata_json FROM music_tracks WHERE id=?").get(id)!;
    return { ...serialize(track), metadata: JSON.parse(String(metadata.metadata_json)) };
  });
  app.patch("/api/music/tracks/:id", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const input = z.object({ rating: z.number().int().min(0).max(5).optional(), attributes: z.array(z.number().int().positive()).max(500).optional() }).parse(request.body);
    if (!database.prepare("SELECT id FROM music_tracks WHERE id=?").get(id)) return reply.code(404).send({ message: "Music track not found." });
    if (input.attributes?.some((a) => !database.prepare("SELECT id FROM music_attributes WHERE id=?").get(a))) return reply.code(400).send({ message: "Unknown music attribute." });
    database.exec("BEGIN IMMEDIATE");
    try {
      if (input.rating !== undefined) database.prepare("UPDATE music_tracks SET rating=? WHERE id=?").run(input.rating, id);
      if (input.attributes) {
        database.prepare("DELETE FROM music_track_attributes WHERE track_id=?").run(id);
        for (const attribute of new Set(input.attributes)) database.prepare("INSERT INTO music_track_attributes(track_id, attribute_id, origin) VALUES (?, ?, 'manual')").run(id, attribute);
      }
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
    return { saved: true };
  });
  app.get("/api/music/tracks/:id/cover", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const row = database.prepare(`SELECT COALESCE(t.cover_data,
      (SELECT art.cover_data FROM music_tracks art WHERE art.album_id=t.album_id AND art.cover_data IS NOT NULL ORDER BY art.id LIMIT 1)) AS cover_data
      FROM music_tracks t WHERE t.id=?`).get(id);
    if (!row?.cover_data) return reply.code(404).send();
    return reply.type("image/jpeg").send(Buffer.from(row.cover_data as Uint8Array));
  });
  app.get("/api/music/tracks/:id/audio", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const track = database.prepare("SELECT t.relative_path, s.root_path FROM music_tracks t JOIN music_sources s ON s.id=t.source_id WHERE t.id=? AND t.available=1").get(id) as { relative_path: string; root_path: string } | undefined;
    if (!track) return reply.code(404).send({ message: "Music file unavailable. Rescan its source." });
    const root = await realpath(track.root_path);
    let filename = await realpath(path.resolve(root, track.relative_path));
    const relative = path.relative(root, filename);
    if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) return reply.code(403).send();
    let info = await stat(filename);
    if (!info.isFile()) return reply.code(404).send();
    const compatible = z.object({ compatible: z.enum(["1"]).optional(), vaultProfile: z.string().optional() }).parse(request.query).compatible;
    if (compatible || [".wma", ".aiff", ".aif", ".ape", ".wv", ".alac"].includes(path.extname(filename).toLowerCase())) {
      filename = await compatibleAudio(filename, info); info = await stat(filename);
    }
    const types: Record<string, string> = { ".mp3": "audio/mpeg", ".flac": "audio/flac", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".opus": "audio/ogg", ".wav": "audio/wav",
      ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo", ".ogv": "video/ogg" };
    reply.type(types[path.extname(filename).toLowerCase()] ?? "application/octet-stream").header("Accept-Ranges", "bytes");
    if (!request.headers.range) return reply.header("Content-Length", info.size).send(createReadStream(filename));
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
    if (!range || (!range[1] && !range[2])) return reply.code(416).header("Content-Range", `bytes */${info.size}`).send();
    const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return reply.code(416).header("Content-Range", `bytes */${info.size}`).send();
    return reply.code(206).header("Content-Range", `bytes ${start}-${end}/${info.size}`).header("Content-Length", end - start + 1).send(createReadStream(filename, { start, end }));
  });
  app.post("/api/music/sources", async (request, reply) => {
    const input = z.object({ rootPath: z.string().trim().min(1), name: nameInput.optional() }).parse(request.body);
    const root = await realpath(path.resolve(input.rootPath));
    if (!(await stat(root)).isDirectory()) return reply.code(400).send({ message: "Choose a music folder." });
    const normalized = process.platform === "win32" ? root.toLowerCase() : root;
    if (database.prepare("SELECT id FROM music_sources WHERE normalized_path=?").get(normalized)) return reply.code(409).send({ message: "That music folder is already indexed." });
    const result = database.prepare("INSERT INTO music_sources(name, root_path, normalized_path) VALUES (?, ?, ?)").run(input.name || path.basename(root), root, normalized);
    const id = Number(result.lastInsertRowid);
    void scanMusicSource(id);
    return reply.code(202).send({ id });
  });
  app.post("/api/music/sources/:id/scan", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    if (!database.prepare("SELECT id FROM music_sources WHERE id=?").get(id)) return reply.code(404).send({ message: "Music source not found." });
    void scanMusicSource(id); return reply.code(202).send({ scanning: true });
  });
  app.post("/api/music/sources/:id/cancel", async (request) => ({ cancelled: await cancelMusicScan(idInput.parse(request.params).id) }));
  app.delete("/api/music/sources/:id", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    await cancelMusicScan(id);
    database.prepare("DELETE FROM music_sources WHERE id=?").run(id);
    return reply.code(204).send();
  });
  const attributeInput = z.object({ kind: z.enum(["tag", "category"]), name: nameInput, patterns: z.array(z.string().trim().min(1).max(200)).max(100).default([]) });
  app.post("/api/music/attributes", async (request) => {
    const input = attributeInput.parse(request.body);
    const row = database.prepare("INSERT INTO music_attributes(kind,name,patterns_json) VALUES(?,?,?) ON CONFLICT(kind,name) DO UPDATE SET patterns_json=excluded.patterns_json RETURNING id").get(input.kind, input.name, JSON.stringify(input.patterns));
    return { ...row, ...input };
  });
  app.delete("/api/music/attributes/:id", async (request, reply) => { database.prepare("DELETE FROM music_attributes WHERE id=?").run(idInput.parse(request.params).id); return reply.code(204).send(); });
  app.post("/api/music/playlists", async (request, reply) => {
    const { name } = z.object({ name: nameInput }).parse(request.body);
    if (database.prepare("SELECT id FROM music_playlists WHERE name=?").get(name)) return reply.code(409).send({ message: "A music playlist already has that name." });
    return database.prepare("INSERT INTO music_playlists(name) VALUES(?) RETURNING *").get(name);
  });
  app.patch("/api/music/playlists/:id", async (request, reply) => {
    const { id } = idInput.parse(request.params), { name } = z.object({ name: nameInput }).parse(request.body);
    if (database.prepare("SELECT id FROM music_playlists WHERE name=? AND id<>?").get(name,id)) return reply.code(409).send({ message: "A music playlist already has that name." });
    database.prepare("UPDATE music_playlists SET name=? WHERE id=?").run(name,id); return { saved: true };
  });
  app.delete("/api/music/playlists/:id", async (request, reply) => { database.prepare("DELETE FROM music_playlists WHERE id=?").run(idInput.parse(request.params).id); return reply.code(204).send(); });
  app.post("/api/music/playlists/:id/tracks", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const { trackIds } = z.object({ trackIds: z.array(z.number().int().positive()).min(1).max(100000) }).parse(request.body);
    if (!database.prepare("SELECT id FROM music_playlists WHERE id=?").get(id)) return reply.code(404).send({ message: "Playlist not found." });
    if (trackIds.some((track) => !database.prepare("SELECT id FROM music_tracks WHERE id=?").get(track))) return reply.code(400).send({ message: "Unknown music track." });
    let position = Number(database.prepare("SELECT COALESCE(MAX(position),-1) AS position FROM music_playlist_tracks WHERE playlist_id=?").get(id)!.position) + 1;
    database.exec("BEGIN IMMEDIATE");
    try { for (const track of new Set(trackIds)) database.prepare("INSERT OR IGNORE INTO music_playlist_tracks(playlist_id,track_id,position) VALUES(?,?,?)").run(id,track,position++); database.exec("COMMIT"); }
    catch (error) { database.exec("ROLLBACK"); throw error; }
    return { saved: true };
  });
  app.delete("/api/music/playlists/:id/tracks/:trackId", async (request, reply) => {
    const { id, trackId } = z.object({ id: z.coerce.number().int().positive(), trackId: z.coerce.number().int().positive() }).parse(request.params);
    database.prepare("DELETE FROM music_playlist_tracks WHERE playlist_id=? AND track_id=?").run(id,trackId); return reply.code(204).send();
  });
  app.put("/api/music/playlists/:id/order", async (request, reply) => {
    const { id } = idInput.parse(request.params), { trackIds } = z.object({ trackIds: z.array(z.number().int().positive()).max(100000) }).parse(request.body);
    const current = database.prepare(`SELECT p.track_id, t.available FROM music_playlist_tracks p JOIN music_tracks t ON t.id=p.track_id
      WHERE p.playlist_id=? ORDER BY p.position, p.track_id`).all(id) as Array<{ track_id: number; available: number }>;
    const supplied = new Set(trackIds);
    const expected = trackIds.length === current.length ? current : current.filter((row) => row.available);
    if (supplied.size !== expected.length || trackIds.length !== expected.length || expected.some((row) => !supplied.has(row.track_id))) return reply.code(400).send({ message: "Supply every visible playlist track exactly once." });
    let visibleIndex = 0;
    const order = trackIds.length === current.length ? trackIds : current.map((row) => row.available ? trackIds[visibleIndex++]! : row.track_id);
    database.exec("BEGIN IMMEDIATE");
    try { order.forEach((track,index) => database.prepare("UPDATE music_playlist_tracks SET position=? WHERE playlist_id=? AND track_id=?").run(index,id,track)); database.exec("COMMIT"); }
    catch (error) { database.exec("ROLLBACK"); throw error; }
    return { saved: true };
  });
}
