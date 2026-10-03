import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test } from "vitest";
import { initializeSearchIndex, substringFilter } from "./search-index.js";

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function setup() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(`CREATE TABLE media_items (
    id INTEGER PRIMARY KEY, title TEXT NOT NULL, filename TEXT NOT NULL,
    relative_path TEXT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0
  )`);
  const insert = db.prepare("INSERT INTO media_items(title, filename, relative_path) VALUES (?, ?, ?)");
  const fixtures = [
    ["Holiday movie", "Holiday.Movie.mp4", "Trips\\Summer\\Holiday.Movie.mp4"],
    ["Winter story", "Winter.pdf", "Trips/Winter/Winter.pdf"],
    ["100%_literal", "100%_literal.pdf", "Special/100%_literal.pdf"],
    ["100XXliteral", "100XXliteral.pdf", "Special/100XXliteral.pdf"],
    ["日本語の物語", "日本語.pdf", "書籍/日本語.pdf"],
    ["Quotes OR \"story\"", "[odd].pdf", "Special/[odd].pdf"],
    ["Café evening", "Café.pdf", "Reading/Café.pdf"],
  ];
  fixtures.forEach((row) => insert.run(...row));
  return db;
}

test("backfills once and preserves literal substring results across all search columns", () => {
  const db = setup();
  initializeSearchIndex(db);
  initializeSearchIndex(db);
  for (const columns of [["title", "relative_path"], ["filename"], ["relative_path"]] as const) {
    for (const term of ["holiday", "SUMMER", "Trips\\", "Winter", "100%_", "%_", "[odd]", 'OR "story"', "日本語", "日本", "Café", "CAFÉ", "a", "", "missing"]) {
      const filter = substringFilter(term, [...columns]);
      const indexed = db.prepare(`SELECT m.id FROM media_items m WHERE ${filter.sql} ORDER BY m.id`).all(...filter.values);
      const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
      const original = db.prepare(`SELECT m.id FROM media_items m WHERE ${columns.map((column) => `m.${column} LIKE ? ESCAPE '\\'`).join(" OR ")} ORDER BY m.id`)
        .all(...columns.map(() => pattern));
      expect(indexed, `${columns.join(",")}: ${term}`).toEqual(original);
    }
  }
  const filter = substringFilter("oliday", ["filename"]);
  const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT m.id FROM media_items m WHERE ${filter.sql}`).all(...filter.values);
  expect(plan.some((step) => String(step.detail).includes("VIRTUAL TABLE INDEX") && String(step.detail).includes("L"))).toBe(true);
});

test("tracks inserts, edits, renames, deletes and transaction rollback without rebuilding", () => {
  const db = setup();
  initializeSearchIndex(db);
  const query = (term: string) => {
    const filter = substringFilter(term, ["title", "relative_path"]);
    return db.prepare(`SELECT m.id FROM media_items m WHERE ${filter.sql}`).all(...filter.values);
  };
  db.prepare("INSERT INTO media_items(id, title, filename, relative_path) VALUES (99, 'New arrival', 'New.pdf', 'Books/New.pdf')").run();
  expect(query("arrival")).toEqual([{ id: 99 }]);
  db.prepare("UPDATE media_items SET title = 'Edited story', filename = 'Renamed.pdf', relative_path = 'Moved/Renamed.pdf' WHERE id = 99").run();
  expect(query("arrival")).toEqual([]);
  expect(query("Renamed")).toEqual([{ id: 99 }]);
  db.exec("BEGIN; UPDATE media_items SET title = 'Rollback title' WHERE id = 99; ROLLBACK;");
  expect(query("Rollback")).toEqual([]);
  expect(query("Edited")).toEqual([{ id: 99 }]);
  db.exec("UPDATE media_items SET favorite = 1 WHERE id = 99");
  db.exec("INSERT INTO media_search(media_search, rank) VALUES ('integrity-check', 1)");
  db.exec("DELETE FROM media_items WHERE id = 99");
  expect(query("Edited")).toEqual([]);
  db.exec("INSERT INTO media_search(media_search, rank) VALUES ('integrity-check', 1)");
});
