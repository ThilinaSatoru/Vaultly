import type { DatabaseSync } from "node:sqlite";

// External content keeps the text in media_items only. Trigrams support infix
// filename/path searches; omitting positions and token counts keeps it compact.
export function initializeSearchIndex(db: DatabaseSync): void {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'media_search'").get();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS media_search USING fts5(
        title, filename, relative_path, content='media_items', content_rowid='id',
        tokenize='trigram', detail=none, columnsize=0
      );
      CREATE TRIGGER IF NOT EXISTS media_search_insert AFTER INSERT ON media_items BEGIN
        INSERT INTO media_search(rowid, title, filename, relative_path)
        VALUES (new.id, new.title, new.filename, new.relative_path);
      END;
      CREATE TRIGGER IF NOT EXISTS media_search_delete AFTER DELETE ON media_items BEGIN
        INSERT INTO media_search(media_search, rowid, title, filename, relative_path)
        VALUES ('delete', old.id, old.title, old.filename, old.relative_path);
      END;
      CREATE TRIGGER IF NOT EXISTS media_search_update
      AFTER UPDATE OF title, filename, relative_path ON media_items
      WHEN old.title IS NOT new.title OR old.filename IS NOT new.filename OR old.relative_path IS NOT new.relative_path
      BEGIN
        INSERT INTO media_search(media_search, rowid, title, filename, relative_path)
        VALUES ('delete', old.id, old.title, old.filename, old.relative_path);
        INSERT INTO media_search(rowid, title, filename, relative_path)
        VALUES (new.id, new.title, new.filename, new.relative_path);
      END;
    `);
    // One-time backfill for existing libraries. Later startups reuse the index.
    if (!exists) db.exec("INSERT INTO media_search(media_search) VALUES ('rebuild')");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

type SearchColumn = "title" | "filename" | "relative_path";

export function substringFilter(text: string, columns: SearchColumn[]): { sql: string; values: string[]; indexed: boolean } {
  const exactPattern = `%${text.replace(/[\\%_]/g, "\\$&")}%`;
  const exact = `(${columns.map((column) => `m.${column} LIKE ? ESCAPE '\\'`).join(" OR ")})`;
  // SQLite cannot accelerate LIKE with ESCAPE. Use an unescaped superset for
  // index candidates, then verify literal %, _ and backslashes on media_items.
  // Short terms without any three-character literal run use the original scan.
  if (!/[^%_]{3}/u.test(text)) return { sql: exact, values: columns.map(() => exactPattern), indexed: false };
  const candidates = columns.map((column) => `SELECT rowid FROM media_search WHERE ${column} LIKE ?`).join(" UNION ");
  return {
    sql: `(m.id IN (${candidates}) AND ${exact})`,
    values: [...columns.map(() => `%${text}%`), ...columns.map(() => exactPattern)],
    indexed: true,
  };
}
