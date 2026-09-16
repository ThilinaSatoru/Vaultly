import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { database } from "./database.js";

const idInput = z.object({ id: z.coerce.number().int().positive() });
const playlistInput = z.object({ name: z.string().trim().min(1).max(120) });
const songInput = z.object({
  title: z.string().trim().min(1).max(240),
  url: z.string().trim().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "chordify.net" || url.hostname.endsWith(".chordify.net"));
  }, "Enter a valid Chordify song URL."),
});
const songIdsInput = z.object({ songIds: z.array(z.number().int().positive()).max(2000) });

interface PlaylistRow {
  id: number;
  name: string;
  song_count: number;
  created_at: string;
  updated_at: string;
}

function getPlaylist(id: number) {
  const playlist = database.prepare(`
    SELECT p.id, p.name, p.created_at, p.updated_at,
      (SELECT COUNT(*) FROM chordify_playlist_songs ps WHERE ps.playlist_id = p.id) AS song_count
    FROM chordify_playlists p WHERE p.id = ?
  `).get(id) as PlaylistRow | undefined;
  if (!playlist) return undefined;
  const songs = database.prepare(`
    SELECT s.id, s.title, s.url, ps.position, ps.added_at
    FROM chordify_playlist_songs ps
    JOIN chordify_songs s ON s.id = ps.song_id
    WHERE ps.playlist_id = ?
    ORDER BY ps.position, ps.added_at, s.id
  `).all(id);
  return { ...playlist, songs };
}

function cleanUnusedSongs() {
  database.prepare(`
    DELETE FROM chordify_songs
    WHERE NOT EXISTS (SELECT 1 FROM chordify_playlist_songs ps WHERE ps.song_id = chordify_songs.id)
  `).run();
}

export async function registerChordifyRoutes(app: FastifyInstance) {
  app.get("/api/chordify/playlists", async () => database.prepare(`
    SELECT p.id, p.name, p.created_at, p.updated_at,
      (SELECT COUNT(*) FROM chordify_playlist_songs ps WHERE ps.playlist_id = p.id) AS song_count
    FROM chordify_playlists p
    ORDER BY p.name COLLATE NOCASE, p.id
  `).all());

  app.post("/api/chordify/playlists", async (request, reply) => {
    const { name } = playlistInput.parse(request.body);
    try {
      const result = database.prepare("INSERT INTO chordify_playlists(name) VALUES (?)").run(name);
      return reply.code(201).send(getPlaylist(Number(result.lastInsertRowid)));
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        return reply.code(409).send({ message: "A Chordify playlist with that name already exists." });
      }
      throw error;
    }
  });

  app.get("/api/chordify/playlists/:id", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    return getPlaylist(id) ?? reply.code(404).send({ message: "Chordify playlist not found." });
  });

  app.patch("/api/chordify/playlists/:id", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const { name } = playlistInput.parse(request.body);
    try {
      const changed = database.prepare("UPDATE chordify_playlists SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(name, id).changes;
      if (!changed) return reply.code(404).send({ message: "Chordify playlist not found." });
      return getPlaylist(id);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        return reply.code(409).send({ message: "A Chordify playlist with that name already exists." });
      }
      throw error;
    }
  });

  app.delete("/api/chordify/playlists/:id", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const changed = database.prepare("DELETE FROM chordify_playlists WHERE id = ?").run(id).changes;
    if (!changed) return reply.code(404).send({ message: "Chordify playlist not found." });
    cleanUnusedSongs();
    return reply.code(204).send();
  });

  app.post("/api/chordify/playlists/:id/songs", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const input = songInput.parse(request.body);
    if (!getPlaylist(id)) return reply.code(404).send({ message: "Chordify playlist not found." });

    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare(`
        INSERT INTO chordify_songs(title, url) VALUES (?, ?)
        ON CONFLICT(url) DO UPDATE SET title = excluded.title, updated_at = CURRENT_TIMESTAMP
      `).run(input.title, input.url);
      const song = database.prepare("SELECT id FROM chordify_songs WHERE url = ?").get(input.url) as { id: number };
      const result = database.prepare(`
        INSERT OR IGNORE INTO chordify_playlist_songs(playlist_id, song_id, position)
        VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM chordify_playlist_songs WHERE playlist_id = ?))
      `).run(id, song.id, id);
      database.prepare("UPDATE chordify_playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
      database.exec("COMMIT");
      if (!result.changes) return reply.code(409).send({ message: "That song is already in this playlist." });
      return reply.code(201).send(getPlaylist(id));
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  });

  app.put("/api/chordify/playlists/:id/songs", async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const { songIds } = songIdsInput.parse(request.body);
    const playlist = getPlaylist(id);
    if (!playlist) return reply.code(404).send({ message: "Chordify playlist not found." });
    const currentIds = playlist.songs.map((song) => (song as { id: number }).id);
    if (songIds.length !== currentIds.length || new Set(songIds).size !== songIds.length || songIds.some((songId) => !currentIds.includes(songId))) {
      return reply.code(400).send({ message: "The song order must include every playlist song exactly once." });
    }
    const update = database.prepare("UPDATE chordify_playlist_songs SET position = ? WHERE playlist_id = ? AND song_id = ?");
    database.exec("BEGIN IMMEDIATE");
    try {
      songIds.forEach((songId, position) => update.run(position, id, songId));
      database.prepare("UPDATE chordify_playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return getPlaylist(id);
  });

  app.delete("/api/chordify/playlists/:id/songs/:songId", async (request, reply) => {
    const { id, songId } = z.object({ id: z.coerce.number().int().positive(), songId: z.coerce.number().int().positive() }).parse(request.params);
    const changed = database.prepare("DELETE FROM chordify_playlist_songs WHERE playlist_id = ? AND song_id = ?").run(id, songId).changes;
    if (!changed) return reply.code(404).send({ message: "Song not found in this playlist." });
    database.prepare("UPDATE chordify_playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    cleanUnusedSongs();
    return reply.code(204).send();
  });
}
