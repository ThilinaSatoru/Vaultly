import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { database } from "./database.js";

const tableOrder = [
  "sources", "media_items", "categories", "tags", "people", "series", "circles",
  "item_categories", "item_tags", "item_people", "series_items", "series_tags",
  "series_categories", "circle_series",
] as const;

const deleteOrder = [...tableOrder].reverse();

const columns: Record<(typeof tableOrder)[number], string[]> = {
  sources: ["id", "name", "root_path", "normalized_path", "status", "connected", "last_error", "last_scanned_at", "created_at", "updated_at"],
  media_items: ["id", "source_id", "media_type", "title", "filename", "file_extension", "relative_path", "size_bytes", "modified_at_ms", "file_count", "favorite", "duration_seconds", "indexed", "available", "created_at", "updated_at"],
  categories: ["id", "name", "created_at"],
  tags: ["id", "name", "created_at"],
  people: ["id", "name", "created_at"],
  series: ["id", "title", "description", "cover_data", "cover_mime", "preferred_type", "favorite", "auto_key", "created_at", "updated_at"],
  circles: ["id", "title", "description", "preferred_type", "created_at", "updated_at"],
  item_categories: ["item_id", "category_id"],
  item_tags: ["item_id", "tag_id"],
  item_people: ["item_id", "person_id", "role"],
  series_items: ["series_id", "item_id", "position"],
  series_tags: ["series_id", "tag_id"],
  series_categories: ["series_id", "category_id"],
  circle_series: ["circle_id", "series_id", "position"],
};

type BackupRow = Record<string, unknown>;

const backupInput = z.object({
  format: z.literal("vaultly-backup"),
  version: z.literal(1),
  data: z.record(z.string(), z.array(z.record(z.string(), z.unknown())).max(1_000_000)),
});

function exportRow(table: string, row: BackupRow): BackupRow {
  if (table !== "series" || !(row.cover_data instanceof Uint8Array)) return row;
  return { ...row, cover_data: Buffer.from(row.cover_data).toString("base64") };
}

function importValue(table: string, column: string, value: unknown): unknown {
  if (table === "series" && column === "cover_data" && typeof value === "string") return Buffer.from(value, "base64");
  return value;
}

export async function registerBackupRoutes(app: FastifyInstance) {
  app.get("/api/backup", async () => {
    const data = Object.fromEntries(tableOrder.map((table) => [
      table,
      (database.prepare(`SELECT ${columns[table].join(", ")} FROM ${table}`).all() as BackupRow[])
        .map((row) => exportRow(table, row)),
    ]));
    return { format: "vaultly-backup", version: 1, createdAt: new Date().toISOString(), data };
  });

  app.post("/api/backup/restore", { bodyLimit: 100 * 1024 * 1024 }, async (request, reply) => {
    const backup = backupInput.parse(request.body);
    for (const table of tableOrder) {
      if (!Array.isArray(backup.data[table])) return reply.code(400).send({ message: `Backup is missing ${table}.` });
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      for (const table of deleteOrder) database.exec(`DELETE FROM ${table}`);
      for (const table of tableOrder) {
        const tableColumns = columns[table];
        const insert = database.prepare(`INSERT INTO ${table} (${tableColumns.join(", ")}) VALUES (${tableColumns.map(() => "?").join(", ")})`);
        for (const row of backup.data[table]!) {
          insert.run(...tableColumns.map((column) => importValue(table, column, row[column]) as never));
        }
      }
      // Treat restored paths as unverified until the source health check runs on the new host.
      database.exec("UPDATE sources SET connected = 0");
      database.exec("UPDATE media_items SET available = 0");
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return { restored: true, sources: backup.data.sources!.length, items: backup.data.media_items!.length };
  });
}
