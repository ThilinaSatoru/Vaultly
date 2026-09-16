import cors from "@fastify/cors";
import Fastify from "fastify";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { database, type SourceRow } from "./database.js";
import { pickDirectory } from "./folder-picker.js";
import { scanSource } from "./scanner.js";
import { registerMediaRoutes } from "./media-routes.js";
import { registerSeriesRoutes } from "./series-routes.js";
import { registerPeopleRoutes } from "./people-routes.js";
import { registerBulkRoutes } from "./bulk-routes.js";
import { registerCircleRoutes } from "./circle-routes.js";
import { registerChordifyRoutes } from "./chordify-routes.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: ["http://127.0.0.1:5173", "http://localhost:5173"] });
await app.register(registerMediaRoutes);
await app.register(registerSeriesRoutes);
await app.register(registerPeopleRoutes);
await app.register(registerBulkRoutes);
await app.register(registerCircleRoutes);
await app.register(registerChordifyRoutes);

const sourceInput = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  rootPath: z.string().trim().min(1),
});

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
  const sources = database.prepare(`${sourceSummaryQuery} ORDER BY s.created_at DESC`).all() as Array<SourceRow & Record<string, unknown>>;
  return Promise.all(sources.map(async (source) => {
    try {
      const sourceStat = await stat(source.root_path);
      return { ...source, path_available: sourceStat.isDirectory(), path_error: sourceStat.isDirectory() ? null : "The source path is not a directory." };
    } catch {
      return { ...source, path_available: false, path_error: "The source path or drive is unavailable." };
    }
  }));
});

app.post("/api/system/pick-directory", async (_request, reply) => {
  try {
    return { path: await pickDirectory() };
  } catch (error) {
    return reply.code(501).send({
      message: error instanceof Error ? error.message : "The folder picker is unavailable.",
    });
  }
});

app.post("/api/sources", async (request, reply) => {
  const input = sourceInput.parse(request.body);
  const resolvedPath = await realpath(path.resolve(input.rootPath));
  const rootStat = await stat(resolvedPath);
  if (!rootStat.isDirectory()) {
    return reply.code(400).send({ message: "Choose a directory, not a file." });
  }

  const normalizedPath = process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath;
  const name = input.name || path.basename(resolvedPath) || resolvedPath;

  try {
    const result = database.prepare(`
      INSERT INTO sources (name, root_path, normalized_path, status)
      VALUES (?, ?, ?, 'idle')
    `).run(name, resolvedPath, normalizedPath);
    const sourceId = Number(result.lastInsertRowid);
    void scanSource(sourceId, resolvedPath);
    const source = database.prepare(`${sourceSummaryQuery} HAVING s.id = ?`).get(sourceId);
    return reply.code(201).send(source);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      return reply.code(409).send({ message: "That folder is already in your library." });
    }
    throw error;
  }
});

app.post("/api/sources/scan", async (_request, reply) => {
  const sources = database.prepare("SELECT * FROM sources ORDER BY id").all() as unknown as SourceRow[];
  for (const source of sources) void scanSource(source.id, source.root_path, { regenerateThumbnails: true });
  return reply.code(202).send({ status: "scanning", count: sources.length });
});

app.post("/api/sources/:id/scan", async (request, reply) => {
  const { id } = sourceIdInput.parse(request.params);
  const source = database.prepare("SELECT * FROM sources WHERE id = ?").get(id) as SourceRow | undefined;
  if (!source) return reply.code(404).send({ message: "Library source not found." });
  void scanSource(source.id, source.root_path, { regenerateThumbnails: true });
  return reply.code(202).send({ status: "scanning" });
});

app.delete("/api/sources/:id", async (request, reply) => {
  const { id } = sourceIdInput.parse(request.params);
  const result = database.prepare("DELETE FROM sources WHERE id = ?").run(id);
  if (result.changes === 0) return reply.code(404).send({ message: "Library source not found." });
  return reply.code(204).send();
});

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

await app.listen({ host: "127.0.0.1", port: 4310 });
