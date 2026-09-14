import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const runtimeDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../runtime");
mkdirSync(runtimeDirectory, { recursive: true });

export const database = new DatabaseSync(path.join(runtimeDirectory, "vaultly.db"));

database.exec("PRAGMA journal_mode = WAL");
database.exec("PRAGMA foreign_keys = ON");
database.exec("PRAGMA busy_timeout = 5000");

database.exec(`
  CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    root_path TEXT NOT NULL,
    normalized_path TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'idle'
      CHECK (status IN ('idle', 'scanning', 'ready', 'error')),
    last_error TEXT,
    last_scanned_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS media_items (
    id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    media_type TEXT NOT NULL CHECK (media_type IN ('comic', 'video', 'story')),
    title TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    modified_at_ms INTEGER NOT NULL DEFAULT 0,
    file_count INTEGER NOT NULL DEFAULT 1,
    available INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source_id, media_type, relative_path)
  );

  CREATE INDEX IF NOT EXISTS idx_media_items_source_available
    ON media_items(source_id, available);

  CREATE INDEX IF NOT EXISTS idx_media_items_type_available
    ON media_items(media_type, available);

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS item_categories (
    item_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, category_id)
  );

  CREATE INDEX IF NOT EXISTS idx_item_categories_category_item
    ON item_categories(category_id, item_id);

`);

database.exec("PRAGMA optimize");

export type SourceStatus = "idle" | "scanning" | "ready" | "error";

export interface SourceRow {
  id: number;
  name: string;
  root_path: string;
  normalized_path: string;
  status: SourceStatus;
  last_error: string | null;
  last_scanned_at: string | null;
  created_at: string;
  updated_at: string;
}
