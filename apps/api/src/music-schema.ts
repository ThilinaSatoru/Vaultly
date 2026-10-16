import type { DatabaseSync } from "node:sqlite";

// Music owns its entire namespace: no foreign keys into the gallery directory.
export const musicBackupColumns = {
  music_sources: ["id", "name", "root_path", "normalized_path", "status", "last_error", "last_scanned_at"],
  music_artists: ["id", "name"],
  music_albums: ["id", "title", "artist", "year"],
  music_tracks: ["id", "source_id", "relative_path", "filename", "title", "artist", "album_id", "album_artist", "track_number", "disc_number", "year", "duration", "bitrate", "sample_rate", "channels", "bit_depth", "codec", "size_bytes", "modified_at_ms", "metadata_json", "cover_data", "rating", "available"],
  music_track_artists: ["track_id", "artist_id"],
  music_attributes: ["id", "kind", "name", "patterns_json"],
  music_track_attributes: ["track_id", "attribute_id", "origin"],
  music_playlists: ["id", "name"],
  music_playlist_tracks: ["playlist_id", "track_id", "position"],
} as const;

export function initializeMusicSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS music_sources (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL,
      normalized_path TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'idle',
      last_error TEXT, last_scanned_at TEXT
    );
    CREATE TABLE IF NOT EXISTS music_artists (id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE);
    CREATE TABLE IF NOT EXISTS music_albums (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL COLLATE NOCASE,
      artist TEXT NOT NULL COLLATE NOCASE, year TEXT NOT NULL DEFAULT '', UNIQUE(title, artist)
    );
    CREATE TABLE IF NOT EXISTS music_tracks (
      id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL REFERENCES music_sources(id) ON DELETE CASCADE,
      relative_path TEXT NOT NULL, filename TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL,
      album_id INTEGER REFERENCES music_albums(id), album_artist TEXT NOT NULL DEFAULT '',
      track_number INTEGER NOT NULL DEFAULT 0, disc_number INTEGER NOT NULL DEFAULT 0, year TEXT NOT NULL DEFAULT '',
      duration REAL, bitrate INTEGER, sample_rate INTEGER, channels TEXT NOT NULL DEFAULT '', bit_depth INTEGER,
      codec TEXT NOT NULL DEFAULT '', size_bytes INTEGER NOT NULL, modified_at_ms REAL NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}', cover_data BLOB,
      rating INTEGER NOT NULL DEFAULT 0 CHECK(rating BETWEEN 0 AND 5), available INTEGER NOT NULL DEFAULT 1,
      UNIQUE(source_id, relative_path)
    );
    CREATE INDEX IF NOT EXISTS idx_music_tracks_title ON music_tracks(available, title COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_music_tracks_album ON music_tracks(album_id, disc_number, track_number);
    CREATE INDEX IF NOT EXISTS idx_music_tracks_source ON music_tracks(source_id, available);
    CREATE TABLE IF NOT EXISTS music_track_artists (
      track_id INTEGER NOT NULL REFERENCES music_tracks(id) ON DELETE CASCADE,
      artist_id INTEGER NOT NULL REFERENCES music_artists(id) ON DELETE CASCADE, PRIMARY KEY(track_id, artist_id)
    );
    CREATE INDEX IF NOT EXISTS idx_music_artist_tracks ON music_track_artists(artist_id, track_id);
    CREATE TABLE IF NOT EXISTS music_attributes (
      id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('tag', 'category')),
      name TEXT NOT NULL COLLATE NOCASE, patterns_json TEXT NOT NULL DEFAULT '[]', UNIQUE(kind, name)
    );
    CREATE TABLE IF NOT EXISTS music_track_attributes (
      track_id INTEGER NOT NULL REFERENCES music_tracks(id) ON DELETE CASCADE,
      attribute_id INTEGER NOT NULL REFERENCES music_attributes(id) ON DELETE CASCADE,
      origin TEXT NOT NULL DEFAULT 'manual', PRIMARY KEY(track_id, attribute_id)
    );
    CREATE INDEX IF NOT EXISTS idx_music_attribute_tracks ON music_track_attributes(attribute_id, track_id);
    CREATE TABLE IF NOT EXISTS music_playlists (id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE);
    CREATE TABLE IF NOT EXISTS music_playlist_tracks (
      playlist_id INTEGER NOT NULL REFERENCES music_playlists(id) ON DELETE CASCADE,
      track_id INTEGER NOT NULL REFERENCES music_tracks(id) ON DELETE CASCADE,
      position INTEGER NOT NULL, PRIMARY KEY(playlist_id, track_id)
    );
    CREATE INDEX IF NOT EXISTS idx_music_playlist_order ON music_playlist_tracks(playlist_id, position);
    UPDATE music_sources SET status = CASE WHEN last_scanned_at IS NULL THEN 'idle' ELSE 'ready' END WHERE status = 'scanning';
  `);
}
