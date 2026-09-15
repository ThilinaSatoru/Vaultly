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
    favorite INTEGER NOT NULL DEFAULT 0,
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

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS item_tags (
    item_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, tag_id)
  );

  CREATE INDEX IF NOT EXISTS idx_item_tags_tag_item
    ON item_tags(tag_id, item_id);

  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS item_people (
    item_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('cast', 'artist')),
    PRIMARY KEY (item_id, person_id, role)
  );

  CREATE INDEX IF NOT EXISTS idx_item_people_role_person ON item_people(role, person_id, item_id);

  CREATE TABLE IF NOT EXISTS series (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    cover_data BLOB,
    cover_mime TEXT,
    favorite INTEGER NOT NULL DEFAULT 0,
    auto_key TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS series_items (
    series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (series_id, item_id)
  );

  CREATE INDEX IF NOT EXISTS idx_series_items_item ON series_items(item_id);
  CREATE INDEX IF NOT EXISTS idx_series_items_order ON series_items(series_id, position);

  CREATE TABLE IF NOT EXISTS series_tags (
    series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (series_id, tag_id)
  );

  CREATE INDEX IF NOT EXISTS idx_series_tags_tag ON series_tags(tag_id, series_id);

  CREATE TABLE IF NOT EXISTS series_categories (
    series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (series_id, category_id)
  );

  CREATE INDEX IF NOT EXISTS idx_series_categories_category
    ON series_categories(category_id, series_id);

`);

// Filename and format are stored separately from the relative path so a filename
// filter never matches an unrelated parent directory.
const mediaColumns = (database.prepare("PRAGMA table_info(media_items)").all() as Array<{ name: string }>).map((column) => column.name);
const needsFilename = !mediaColumns.includes("filename");
const needsExtension = !mediaColumns.includes("file_extension");
const needsFavorite = !mediaColumns.includes("favorite");
if (needsFilename) database.exec("ALTER TABLE media_items ADD COLUMN filename TEXT NOT NULL DEFAULT ''");
if (needsExtension) database.exec("ALTER TABLE media_items ADD COLUMN file_extension TEXT NOT NULL DEFAULT ''");
if (needsFavorite) database.exec("ALTER TABLE media_items ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0");
if (needsFilename || needsExtension) {
  const knownExtensions = new Set(["mp4", "m4v", "mkv", "webm", "avi", "mov", "wmv", "flv", "mpeg", "mpg", "pdf", "cbz", "zip"]);
  const rows = database.prepare(`
    SELECT m.id, m.relative_path, s.root_path FROM media_items m JOIN sources s ON s.id = m.source_id
  `).all() as Array<{ id: number; relative_path: string; root_path: string }>;
  const update = database.prepare("UPDATE media_items SET filename = ?, file_extension = ? WHERE id = ?");
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) {
      const filename = (row.relative_path === "." ? row.root_path : row.relative_path).split(/[\\/]/).filter(Boolean).at(-1) || row.relative_path;
      const suffix = filename.includes(".") ? filename.slice(filename.lastIndexOf(".") + 1).toLowerCase() : "";
      update.run(filename, knownExtensions.has(suffix) ? suffix : "", row.id);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

// Earlier indexes can include an image-folder comic at the source root.
const rootFolderItems = database.prepare(`
  SELECT m.id, s.root_path FROM media_items m JOIN sources s ON s.id = m.source_id
  WHERE m.relative_path = '.' AND m.filename = '.'
`).all() as Array<{ id: number; root_path: string }>;
const correctRootFilename = database.prepare("UPDATE media_items SET filename = ? WHERE id = ?");
for (const item of rootFolderItems) {
  correctRootFilename.run(item.root_path.split(/[\\/]/).filter(Boolean).at(-1) || item.root_path, item.id);
}

const seriesColumns = (database.prepare("PRAGMA table_info(series)").all() as Array<{ name: string }>).map((column) => column.name);
if (!seriesColumns.includes("preferred_type")) {
  database.exec("ALTER TABLE series ADD COLUMN preferred_type TEXT NOT NULL DEFAULT 'mixed'");
}
if (!seriesColumns.includes("favorite")) database.exec("ALTER TABLE series ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0");
if (!seriesColumns.includes("auto_key")) database.exec("ALTER TABLE series ADD COLUMN auto_key TEXT");
database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_series_auto_key ON series(auto_key) WHERE auto_key IS NOT NULL");

database.exec("CREATE INDEX IF NOT EXISTS idx_media_items_format ON media_items(available, media_type, file_extension)");

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
