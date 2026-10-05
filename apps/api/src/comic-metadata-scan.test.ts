import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { database } from "./database.js";
import { scanSource } from "./scanner.js";

test("comic sidecars reuse tags and artist aliases, create artists once, and apply changed metadata on rescan", async () => {
  const token = randomUUID();
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-comic-meta-"));
  const source = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES (?, ?, ?)").run(token, root, root).lastInsertRowid);
  const named = (table: "tags" | "people", name: string) => Number(database.prepare(`INSERT INTO ${table}(name) VALUES (?)`).run(`${token} ${name}`).lastInsertRowid);
  const male = named("tags", "Muscle (male)"), female = named("tags", "Muscle (female)");
  const broad = named("tags", "Muscle"), manualTag = named("tags", "Manual"), laterTag = named("tags", "Later");
  const artist = named("people", "Jane Doe"), guest = named("people", "Guest"), manualArtist = named("people", "Manual artist");
  const newName = `${token} Zoë Rivera`, unknownTag = `${token} Unknown tag`;
  const firstPath = path.join(root, "First");
  const secondPath = path.join(root, "Nested", "Second");
  const firstMeta = path.join(firstPath, "meta.json");
  const tagIds = (item: number) => (database.prepare("SELECT tag_id FROM item_tags WHERE item_id = ? ORDER BY tag_id").all(item) as Array<{ tag_id: number }>).map((row) => row.tag_id);
  const artistIds = (item: number) => (database.prepare("SELECT person_id, role FROM item_people WHERE item_id = ? ORDER BY person_id").all(item) as Array<{ person_id: number; role: string }>);
  try {
    database.prepare("INSERT INTO tag_patterns(tag_id, pattern) VALUES (?, ?)").run(male, `${token} male muscles`);
    database.prepare("INSERT INTO person_patterns(person_id, pattern) VALUES (?, ?)").run(artist, `${token} J. Doe`);
    await mkdir(firstPath);
    await mkdir(secondPath, { recursive: true });
    await writeFile(path.join(firstPath, "001.jpg"), "page one");
    await writeFile(path.join(secondPath, "001.png"), "page two");
    await writeFile(firstMeta, JSON.stringify({
      title: "External title", folder: "D:\\unrelated\\folder",
      metadata: {
        tags: [{ id: String(female), name: `${token} MALE MUSCLES` }, { name: unknownTag }],
        artists: [{ id: "foreign-person-id", name: `${token} j. doe` }, { name: newName }],
      },
      tags: [`${token} MUSCLE (MALE)`, unknownTag],
      artists: [newName.toUpperCase(), `${token} GUEST`],
    }));
    await writeFile(path.join(secondPath, "meta.json"), JSON.stringify({ artists: [newName.toLowerCase(), `${token} JANE DOE`] }));
    await scanSource(source, root);
    expect(database.prepare("SELECT status FROM sources WHERE id = ?").get(source)).toEqual({ status: "ready" });
    const rows = database.prepare("SELECT id, relative_path, title, file_count FROM media_items WHERE source_id = ?").all(source) as Array<{ id: number; relative_path: string; title: string; file_count: number }>;
    expect(rows).toHaveLength(2);
    const first = rows.find((row) => row.relative_path === "First")!;
    const second = rows.find((row) => row.relative_path === path.join("Nested", "Second"))!;
    expect(first).toMatchObject({ title: "First", file_count: 1 });
    expect(tagIds(first.id)).toEqual([male]);
    expect(tagIds(second.id)).toEqual([]);
    expect(database.prepare("SELECT id FROM tags WHERE name = ?").get(unknownTag)).toBeUndefined();
    expect(database.prepare("SELECT COUNT(*) AS count FROM tags WHERE name LIKE ?").get(`${token}%`)).toEqual({ count: 5 });
    const newArtists = database.prepare("SELECT id FROM people WHERE name LIKE ?").all(`${token}%Rivera`) as Array<{ id: number }>;
    expect(newArtists).toHaveLength(1);
    const newArtist = newArtists[0].id;
    expect(artistIds(first.id)).toEqual([artist, guest, newArtist].sort((a, b) => a - b).map((person_id) => ({ person_id, role: "artist" })));
    expect(artistIds(second.id)).toEqual([artist, newArtist].sort((a, b) => a - b).map((person_id) => ({ person_id, role: "artist" })));

    database.prepare("INSERT INTO item_tags(item_id, tag_id) VALUES (?, ?)").run(first.id, manualTag);
    database.prepare("INSERT INTO item_people(item_id, person_id, role) VALUES (?, ?, 'artist')").run(first.id, manualArtist);
    database.prepare("UPDATE media_items SET title = ? WHERE id = ?").run("My custom title", first.id);
    await writeFile(firstMeta, JSON.stringify({ tags: [`${token} LATER`], artists: [newName.toLowerCase()] }));
    await scanSource(source, root);
    await scanSource(source, root);
    expect(tagIds(first.id)).toEqual([male, manualTag, laterTag].sort((a, b) => a - b));
    expect(artistIds(first.id)).toHaveLength(4);
    expect(database.prepare("SELECT title FROM media_items WHERE id = ?").get(first.id)).toEqual({ title: "My custom title" });
    expect(database.prepare("SELECT COUNT(*) AS count FROM people WHERE name LIKE ?").get(`${token}%Rivera`)).toEqual({ count: 1 });
    await rm(firstMeta);
    await scanSource(source, root);
    expect(tagIds(first.id)).toEqual([male, manualTag, laterTag].sort((a, b) => a - b));
    expect(artistIds(first.id)).toHaveLength(4);
  } finally {
    database.prepare("DELETE FROM sources WHERE id = ?").run(source);
    for (const id of [male, female, broad, manualTag, laterTag]) database.prepare("DELETE FROM tags WHERE id = ?").run(id);
    database.prepare("DELETE FROM people WHERE name LIKE ?").run(`${token}%`);
    await rm(root, { recursive: true, force: true });
  }
});

test("root comic folders read their own sidecar and malformed sibling metadata does not fail the scan or leak into other media", async () => {
  const token = randomUUID();
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-comic-meta-root-"));
  const source = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES (?, ?, ?)").run(token, root, root).lastInsertRowid);
  try {
    await mkdir(path.join(root, "Broken"));
    await mkdir(path.join(root, "No sidecar"));
    await writeFile(path.join(root, "001.jpg"), "root page");
    await writeFile(path.join(root, "meta.json"), JSON.stringify({ artists: [token] }));
    await writeFile(path.join(root, "Broken", "001.jpg"), "broken page");
    await writeFile(path.join(root, "Broken", "meta.json"), "{invalid");
    await writeFile(path.join(root, "No sidecar", "001.jpg"), "plain page");
    await writeFile(path.join(root, "Book.pdf"), "pdf");
    await writeFile(path.join(root, "Archive.cbz"), "archive");
    await writeFile(path.join(root, "Video.mp4"), "video");
    await scanSource(source, root);
    expect(database.prepare("SELECT status FROM sources WHERE id = ?").get(source)).toEqual({ status: "ready" });
    expect(database.prepare("SELECT COUNT(*) AS count FROM media_items WHERE source_id = ?").get(source)).toEqual({ count: 6 });
    expect(database.prepare(`SELECT m.relative_path, ip.role FROM item_people ip JOIN media_items m ON m.id = ip.item_id
      WHERE m.source_id = ?`).all(source)).toEqual([{ relative_path: ".", role: "artist" }]);
  } finally {
    database.prepare("DELETE FROM sources WHERE id = ?").run(source);
    database.prepare("DELETE FROM people WHERE name = ?").run(token);
    await rm(root, { recursive: true, force: true });
  }
});
