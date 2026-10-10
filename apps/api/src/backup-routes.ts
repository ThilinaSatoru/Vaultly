import type { FastifyInstance } from "fastify";
import { getConversionActivity } from "./source-conversion.js";
import { z } from "zod";
import { database } from "./database.js";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { normalizeProfileImage, readProfileImage, removeProfileImage, storeProfileImage } from "./profile-images.js";

const compress = promisify(gzip);
const decompress = promisify(gunzip);
const maxBackupBytes = 100 * 1024 * 1024;

const tableOrder = [
  "sources", "media_items", "categories", "tags", "people", "series", "circles",
  "item_categories", "item_tags", "item_people", "series_items", "series_tags",
  "series_categories", "circle_series",
  "tag_patterns", "category_patterns", "person_patterns", "source_tags", "source_categories",
] as const;

const optionalTables = new Set<string>(["tag_patterns", "category_patterns", "person_patterns", "source_tags", "source_categories"]);

const deleteOrder = [...tableOrder].reverse();

const columns: Record<(typeof tableOrder)[number], string[]> = {
  sources: ["id", "name", "root_path", "normalized_path", "status", "connected", "last_error", "last_scanned_at", "created_at", "updated_at"],
  media_items: ["id", "source_id", "media_type", "title", "filename", "file_extension", "relative_path", "size_bytes", "modified_at_ms", "file_count", "favorite", "duration_seconds", "video_width", "video_height", "video_metadata_signature", "indexed", "available", "created_at", "updated_at"],
  categories: ["id", "name", "created_at"],
  tags: ["id", "name", "created_at"],
  people: ["id", "name", "created_at", "profile_image"],
  series: ["id", "title", "description", "cover_data", "cover_mime", "preferred_type", "favorite", "auto_key", "created_at", "updated_at"],
  circles: ["id", "title", "description", "preferred_type", "created_at", "updated_at"],
  item_categories: ["item_id", "category_id"],
  item_tags: ["item_id", "tag_id"],
  item_people: ["item_id", "person_id", "role"],
  series_items: ["series_id", "item_id", "position"],
  series_tags: ["series_id", "tag_id"],
  series_categories: ["series_id", "category_id"],
  circle_series: ["circle_id", "series_id", "position"],
  tag_patterns: ["tag_id", "pattern"],
  category_patterns: ["category_id", "pattern"],
  person_patterns: ["person_id", "pattern"],
  source_tags: ["source_id", "tag_id"],
  source_categories: ["source_id", "category_id"],
};

type BackupRow = Record<string, unknown>;

const backupInput = z.object({
  format: z.literal("vaultly-backup"),
  version: z.union([z.literal(1), z.literal(2)]),
  data: z.record(z.string(), z.array(z.record(z.string(), z.unknown())).max(1_000_000)),
  profileImages: z.record(z.string(), z.string().max(14 * 1024 * 1024)).optional(),
  preferences: z.record(z.string(), z.string()).optional(),
});

function exportRow(table: string, row: BackupRow): BackupRow {
  if (table !== "series" || !(row.cover_data instanceof Uint8Array)) return row;
  return { ...row, cover_data: Buffer.from(row.cover_data).toString("base64") };
}

function importValue(table: string, column: string, value: unknown): unknown {
  if (table === "media_items" && ["video_width", "video_height", "video_metadata_signature"].includes(column) && value === undefined) return null;
  if (table === "series" && column === "cover_data" && typeof value === "string") return Buffer.from(value, "base64");
  return value;
}

export async function registerBackupRoutes(app: FastifyInstance) {
  app.addContentTypeParser(["application/gzip", "application/octet-stream"], { parseAs: "buffer", bodyLimit: maxBackupBytes }, (_request, body, done) => done(null, body));
  const exportBackup = async () => {
    const data = Object.fromEntries(tableOrder.map((table) => [
      table,
      (database.prepare(`SELECT ${columns[table].join(", ")} FROM ${table}`).all() as BackupRow[])
        .map((row) => exportRow(table, row)),
    ]));
    const profileImages: Record<string, string> = {};
    for (const person of data.people!) {
      if (typeof person.profile_image === "string") profileImages[person.profile_image] = (await readProfileImage(person.profile_image)).toString("base64");
    }
    return { format: "vaultly-backup", version: 2, createdAt: new Date().toISOString(), data, profileImages };
  };
  app.get("/api/backup", exportBackup);
  app.post("/api/backup/archive", async (request, reply) => {
    const { preferences } = z.object({ preferences: z.record(z.string(), z.string()).optional() }).parse(request.body);
    const backup = await exportBackup();
    const encoded = Buffer.from(JSON.stringify({ ...backup, preferences }));
    if (encoded.length > maxBackupBytes) return reply.code(400).send({ message: "The backup exceeds the 100 MB restore limit." });
    return reply.type("application/gzip")
      .header("Content-Disposition", `attachment; filename="vaultly-backup-${new Date().toISOString().slice(0, 10)}.json.gz"`)
      .send(await compress(encoded, { level: 9 }));
  });

  app.post("/api/backup/restore", { bodyLimit: maxBackupBytes }, async (request, reply) => {
    if (getConversionActivity().length) return reply.code(409).send({ message: "Cancel video conversion before restoring a backup." });
    let payload = request.body;
    if (Buffer.isBuffer(payload)) {
      try { payload = JSON.parse((await decompress(payload, { maxOutputLength: maxBackupBytes })).toString("utf8")); }
      catch { return reply.code(400).send({ message: "That backup archive is invalid or too large." }); }
    }
    const backup = backupInput.parse(payload);
    for (const table of tableOrder) {
      if (optionalTables.has(table) && backup.data[table] === undefined) continue;
      if (!Array.isArray(backup.data[table])) return reply.code(400).send({ message: `Backup is missing ${table}.` });
    }

    const oldImages = (database.prepare("SELECT profile_image FROM people WHERE profile_image IS NOT NULL").all() as Array<{ profile_image: string }>).map((row) => row.profile_image);
    const newImages: string[] = [];
    try {
      // Validate and stage images under fresh filenames before replacing any metadata.
      for (const person of backup.data.people!) {
        if (person.profile_image == null) { person.profile_image = null; continue; }
        if (backup.version !== 2 || typeof person.profile_image !== "string") throw new Error("Invalid profile image reference.");
        const encoded = backup.profileImages?.[person.profile_image];
        if (!encoded) throw new Error("Backup is missing a profile image.");
        const filename = await storeProfileImage(await normalizeProfileImage(Buffer.from(encoded, "base64")));
        newImages.push(filename);
        person.profile_image = filename;
      }
    } catch (error) {
      await Promise.all(newImages.map(removeProfileImage));
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Invalid profile images." });
    }
    database.exec("BEGIN IMMEDIATE");
    try {
      for (const table of deleteOrder) database.exec(`DELETE FROM ${table}`);
      for (const table of tableOrder) {
        const tableColumns = columns[table];
        const insert = database.prepare(`INSERT INTO ${table} (${tableColumns.join(", ")}) VALUES (${tableColumns.map(() => "?").join(", ")})`);
        for (const row of backup.data[table] ?? []) {
          insert.run(...tableColumns.map((column) => importValue(table, column, row[column]) as never));
        }
      }
      // Treat restored paths as unverified until the source health check runs on the new host.
      database.exec("UPDATE sources SET connected = 0");
      database.exec("UPDATE media_items SET available = 0");
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      await Promise.all(newImages.map(removeProfileImage));
      throw error;
    }
    await Promise.all(oldImages.map(removeProfileImage));
    return { restored: true, sources: backup.data.sources!.length, items: backup.data.media_items!.length, preferences: backup.preferences };
  });
}
