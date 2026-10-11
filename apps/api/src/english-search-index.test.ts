import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { registerEnglishMatchingFunction } from "./english-search-index.js";
import { initializeSearchIndex } from "./search-index.js";

test("startup can initialize search after registering English matching with an active statement", () => {
  const db = new DatabaseSync(":memory:");
  try {
    registerEnglishMatchingFunction(db);
    db.exec(`
      CREATE TABLE media_items(id INTEGER PRIMARY KEY, title TEXT, filename TEXT, relative_path TEXT);
      INSERT INTO media_items VALUES (1, 'Children on vacations', 'Running.pdf', 'one.pdf');
      INSERT INTO media_items VALUES (2, 'Winter', 'two.pdf', 'two.pdf');
    `);
    const rows = db.prepare("SELECT vaultly_english(title) AS title FROM media_items ORDER BY id").iterate();
    try {
      expect(rows.next().done).toBe(false);
      expect(() => initializeSearchIndex(db)).not.toThrow();
      expect(() => initializeSearchIndex(db)).not.toThrow();
      expect(db.prepare("SELECT rowid FROM media_english WHERE media_english MATCH 'child AND holiday'").all())
        .toEqual([{ rowid: 1 }]);
      expect(rows.next().done).toBe(false);
    } finally {
      rows.return?.();
    }
  } finally {
    db.close();
  }
});

test("English matching registration is independent for each connection", () => {
  for (let index = 0; index < 2; index++) {
    const db = new DatabaseSync(":memory:");
    try {
      registerEnglishMatchingFunction(db);
      registerEnglishMatchingFunction(db);
      expect(db.prepare("SELECT vaultly_english(NULL) AS value").get()).toEqual({ value: "" });
    } finally {
      db.close();
    }
  }
});
