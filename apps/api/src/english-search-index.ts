import type { DatabaseSync } from "node:sqlite";
import { englishMatchingVersion, englishText } from "./english-matching.js";

export function registerEnglishMatchingFunction(db: DatabaseSync): void {
  db.function("vaultly_english", { deterministic: true }, (value) => englishText(String(value ?? "")));
}

export function initializeEnglishSearchIndex(db: DatabaseSync): void {
  registerEnglishMatchingFunction(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_index_versions (name TEXT PRIMARY KEY, version INTEGER NOT NULL);
    CREATE VIRTUAL TABLE IF NOT EXISTS media_english USING fts5(title, filename, tokenize='unicode61 remove_diacritics 2');
    CREATE TRIGGER IF NOT EXISTS media_english_insert AFTER INSERT ON media_items BEGIN
      INSERT INTO media_english(rowid, title, filename) VALUES (new.id, vaultly_english(new.title), vaultly_english(new.filename));
    END;
    CREATE TRIGGER IF NOT EXISTS media_english_delete AFTER DELETE ON media_items BEGIN
      DELETE FROM media_english WHERE rowid = old.id;
    END;
    CREATE TRIGGER IF NOT EXISTS media_english_update AFTER UPDATE OF title, filename ON media_items
    WHEN old.title IS NOT new.title OR old.filename IS NOT new.filename BEGIN
      DELETE FROM media_english WHERE rowid = old.id;
      INSERT INTO media_english(rowid, title, filename) VALUES (new.id, vaultly_english(new.title), vaultly_english(new.filename));
    END;
  `);
  const version = db.prepare("SELECT version FROM search_index_versions WHERE name = 'english'").get() as { version: number } | undefined;
  if (version?.version !== englishMatchingVersion) {
    db.exec("DELETE FROM media_english; INSERT INTO media_english(rowid, title, filename) SELECT id, vaultly_english(title), vaultly_english(filename) FROM media_items");
    db.prepare("INSERT OR REPLACE INTO search_index_versions(name, version) VALUES ('english', ?)").run(englishMatchingVersion);
  }
}
