import { registerAttributeRoutes, sourceAttributesInput, sourceAttributes, invalidSourceAttribute, setSourceAttributes } from "./attribute-routes.js";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { database, type SourceRow } from "./database.js";
import { pickDirectory } from "./folder-picker.js";
import { cancelAllSourceScans, cancelSourceScan, getScanProgress, scanSource } from "./scanner.js";
import { registerMediaRoutes } from "./media-routes.js";
import { registerSeriesRoutes } from "./series-routes.js";
import { registerPeopleRoutes } from "./people-routes.js";
import { registerBulkRoutes } from "./bulk-routes.js";
import { registerCircleRoutes } from "./circle-routes.js";
import { registerBackupRoutes } from "./backup-routes.js";

export interface VaultlyServerOptions {
  host?: string;
  port?: number;
  staticRoot?: string;
  pickDirectory?: () => Promise<string | null>;
  revealPath?: (itemPath: string) => Promise<void>;
}

export async function buildVaultlyServer(options: VaultlyServerOptions = {}) {
const app = Fastify({ logger: true });
await app.register(cors, { origin: ["http://127.0.0.1:5173", "http://localhost:5173"] });
app.setErrorHandler((error, _request, reply) => {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ message: error.issues[0]?.message ?? "Invalid request." });
  }
  if ((error as NodeJS.ErrnoException).code === "ENOENT") {
    return reply.code(400).send({ message: "That directory does not exist or is unavailable." });
  }
  app.log.error(error);
  return reply.code(500).send({ message: "Something went wrong while updating the library." });
});

await app.register(registerMediaRoutes, { revealPath: options.revealPath });
await app.register(registerSeriesRoutes);
await app.register(registerPeopleRoutes);
await app.register(registerBulkRoutes);
await app.register(registerCircleRoutes);
await app.register(registerBackupRoutes);
await app.register(registerAttributeRoutes);

const sourceInput = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  rootPath: z.string().trim().min(1),
});
const sourceCreateInput = sourceInput.merge(sourceAttributesInput);

const sourceIdInput = z.object({ id: z.coerce.number().int().positive() });

const sourceSummaryQuery = `
  SELECT
    s.*,
    COUNT(CASE WHEN m.available = 1 THEN 1 END) AS item_count,
    COUNT(CASE WHEN m.available = 1 AND m.media_type = 'comic' THEN 1 END) AS comic_count,
    COUNT(CASE WHEN m.available = 1 AND m.media_type = 'video' THEN 1 END) AS video_count,
    COUNT(CASE WHEN m.available = 1 AND m.media_type = 'story' THEN 1 END) AS story_count
  FROM sources s
  LEFT JOIN media_items m ON m.source_id = s.id
  GROUP BY s.id
`;

app.get("/api/health", async () => ({ ok: true }));

app.get("/api/sources", async () => {
  const sources = database.prepare("SELECT * FROM sources ORDER BY created_at DESC").all() as unknown as SourceRow[];
  const checked = await Promise.all(sources.map(async (source) => {
    try {
      const sourceStat = await stat(source.root_path);
      return { ...source, path_available: sourceStat.isDirectory(), path_error: sourceStat.isDirectory() ? null : "The source path is not a directory." };
    } catch {
      return { ...source, path_available: false, path_error: "The source path or drive is unavailable." };
    }
  }));
  const updateConnection = database.prepare("UPDATE sources SET connected = ? WHERE id = ? AND connected <> ?");
  for (const source of checked) {
    const connected = source.path_available ? 1 : 0;
    const changed = updateConnection.run(connected, source.id, connected).changes;
    if (changed) {
      database.prepare("UPDATE media_items SET available = CASE WHEN ? = 1 THEN indexed ELSE 0 END WHERE source_id = ?")
        .run(connected, source.id);
    }
  }
  const availability = new Map(checked.map((source) => [source.id, { path_available: source.path_available, path_error: source.path_error }]));
  const summaries = database.prepare(`${sourceSummaryQuery} ORDER BY s.created_at DESC`).all() as Array<SourceRow & Record<string, unknown>>;
  return summaries.map((source) => ({ ...source, ...availability.get(source.id), ...sourceAttributes(source.id), scan_progress: getScanProgress(source.id) }));
});

// Progress polls avoid recounting the library and checking every source folder.
app.get("/api/sources/scan/progress", async () => {
  const sources = database.prepare("SELECT id, status, last_error, last_scanned_at FROM sources").all() as Array<Pick<SourceRow, "id" | "status" | "last_error" | "last_scanned_at">>;
  return sources.map((source) => ({ ...source, scan_progress: getScanProgress(source.id) }));
});

app.post("/api/system/pick-directory", async (_request, reply) => {
  try {
    return { path: await (options.pickDirectory ?? pickDirectory)() };
  } catch (error) {
    return reply.code(501).send({
      message: error instanceof Error ? error.message : "The folder picker is unavailable.",
    });
  }
});

app.post("/api/sources", async (request, reply) => {
  const input = sourceCreateInput.parse(request.body);
  const invalid = invalidSourceAttribute(input);
  if (invalid) return reply.code(400).send({ message: invalid });
  const resolvedPath = await realpath(path.resolve(input.rootPath));
  const rootStat = await stat(resolvedPath);
  if (!rootStat.isDirectory()) {
    return reply.code(400).send({ message: "Choose a directory, not a file." });
  }

  const normalizedPath = process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath;
  const name = input.name || path.basename(resolvedPath) || resolvedPath;

  try {
    database.exec("BEGIN IMMEDIATE");
    let sourceId: number;
    try {
      const result = database.prepare(`
        INSERT INTO sources (name, root_path, normalized_path, status)
        VALUES (?, ?, ?, 'idle')
      `).run(name, resolvedPath, normalizedPath);
      sourceId = Number(result.lastInsertRowid);
      setSourceAttributes(sourceId, input);
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
    void scanSource(sourceId, resolvedPath);
    const source = database.prepare(`${sourceSummaryQuery} HAVING s.id = ?`).get(sourceId);
    return reply.code(201).send({ ...(source as Record<string, unknown>), ...sourceAttributes(sourceId) });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      return reply.code(409).send({ message: "That folder is already in your library." });
    }
    throw error;
  }
});

app.post("/api/sources/scan", async (_request, reply) => {
  const sources = database.prepare("SELECT * FROM sources ORDER BY id").all() as unknown as SourceRow[];
  for (const source of sources) void scanSource(source.id, source.root_path, { generateThumbnails: true });
  return reply.code(202).send({ status: "scanning", count: sources.length });
});

app.post("/api/sources/:id/scan", async (request, reply) => {
  const { id } = sourceIdInput.parse(request.params);
  const source = database.prepare("SELECT * FROM sources WHERE id = ?").get(id) as SourceRow | undefined;
  if (!source) return reply.code(404).send({ message: "Library source not found." });
  void scanSource(source.id, source.root_path, { generateThumbnails: true });
  return reply.code(202).send({ status: "scanning" });
});

app.post("/api/sources/scan/cancel", async () => ({ count: await cancelAllSourceScans() }));

app.post("/api/sources/:id/scan/cancel", async (request, reply) => {
  const { id } = sourceIdInput.parse(request.params);
  if (!database.prepare("SELECT id FROM sources WHERE id = ?").get(id)) {
    return reply.code(404).send({ message: "Library source not found." });
  }
  return { cancelled: await cancelSourceScan(id) };
});

app.patch("/api/sources/:id", async (request, reply) => {
  const { id } = sourceIdInput.parse(request.params);
  const input = sourceInput.parse(request.body);
  const source = database.prepare("SELECT * FROM sources WHERE id = ?").get(id) as SourceRow | undefined;
  if (!source) return reply.code(404).send({ message: "Library source not found." });
  await cancelSourceScan(id);
  const resolvedPath = await realpath(path.resolve(input.rootPath));
  const rootStat = await stat(resolvedPath);
  if (!rootStat.isDirectory()) return reply.code(400).send({ message: "Choose a directory, not a file." });
  const normalizedPath = process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath;
  const name = input.name || source.name;
  try {
    database.prepare(`UPDATE sources SET name = ?, root_path = ?, normalized_path = ?, connected = 1,
      status = 'idle', last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(name, resolvedPath, normalizedPath, id);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      return reply.code(409).send({ message: "That folder is already used by another source." });
    }
    throw error;
  }
  void scanSource(id, resolvedPath);
  return reply.code(202).send({ id, name, root_path: resolvedPath, status: "scanning" });
});

app.delete("/api/sources/:id", async (request, reply) => {
  const { id } = sourceIdInput.parse(request.params);
  await cancelSourceScan(id);
  const result = database.prepare("DELETE FROM sources WHERE id = ?").run(id);
  if (result.changes === 0) return reply.code(404).send({ message: "Library source not found." });
  return reply.code(204).send();
});



if (options.staticRoot) {
  await app.register(fastifyStatic, { root: path.resolve(options.staticRoot) });
  app.setNotFoundHandler((request, reply) => {
    if (request.method === "GET" && !request.url.startsWith("/api/")) return reply.sendFile("index.html");
    return reply.code(404).send({ message: "Not found." });
  });
}

return app;
}

export async function startVaultlyServer(options: VaultlyServerOptions = {}) {
  const app = await buildVaultlyServer(options);
  const address = await app.listen({ host: options.host ?? "127.0.0.1", port: options.port ?? 4400 });
  return { app, address };
}
