import type { DatabaseSync } from "node:sqlite";

export const youtubeBackupColumns = {
  youtube_videos: ["id", "video_id", "title", "author", "added_at"],
  youtube_playlists: ["id", "name", "remote_id"],
  youtube_entries: ["id", "playlist_id", "video_id", "title", "position"],
} as const;

export function initializeYoutubeSchema(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS youtube_videos (
    id INTEGER PRIMARY KEY, video_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, author TEXT NOT NULL DEFAULT '', added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS youtube_playlists (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, remote_id TEXT
  );
  CREATE TABLE IF NOT EXISTS youtube_entries (
    id INTEGER PRIMARY KEY, playlist_id INTEGER NOT NULL REFERENCES youtube_playlists(id) ON DELETE CASCADE,
    video_id TEXT NOT NULL, title TEXT NOT NULL, position INTEGER NOT NULL,
    UNIQUE(playlist_id, video_id)
  );
  CREATE INDEX IF NOT EXISTS idx_youtube_playlist_order ON youtube_entries(playlist_id, position, id);`);
  populateYoutubeVideos(db);
}

export function populateYoutubeVideos(db: DatabaseSync) {
  db.exec(`INSERT OR IGNORE INTO youtube_videos(video_id, title) SELECT video_id, title FROM youtube_entries ORDER BY id`);
}

