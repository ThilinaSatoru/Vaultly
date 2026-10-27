import { registerYoutubeRoutes } from "./youtube-library.js";
import { registerAttributeRoutes, sourceAttributesInput, sourceAttributes, invalidSourceAttribute, setSourceAttributes } from "./attribute-routes.js";
import { sourceMediaTypes } from "./source-media.js";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { installVaultProfileRoutes } from "./vault-profile-routes.js";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { database, type SourceRow } from "./database.js";
import { removeLegacyPlaybackCache } from "./playback-cache.js";
import { pickDirectory } from "./folder-picker.js";
import { cancelAllSourceScans, cancelSourceScan, getScanProgress, scanSource } from "./scanner.js";
import { registerMediaRoutes } from "./media-routes.js";
import { registerMusicRoutes } from "./music-routes.js";
import { cancelAllMusicScans } from "./music-scanner.js";
import { registerSeriesRoutes } from "./series-routes.js";
import { registerPeopleRoutes } from "./people-routes.js";
import { registerBulkRoutes } from "./bulk-routes.js";
import { registerMediaDeletionRoutes } from "./media-deletion.js";
import { registerCircleRoutes } from "./circle-routes.js";
import { registerBackupRoutes } from "./backup-routes.js";
import { getBackgroundActivity } from "./background-activity.js";
import { cancelPeopleRepair, enableAutomaticPeopleRepair, waitForPeopleRepair } from "./people-repair.js";
import { resetProcessShutdown, stopBackgroundProcesses } from "./background-processes.js";
import { getSystemResources } from "./process-resources.js";
import { cancelSourceConversion, checkConversionRuntime, getConversionProgress, getUnsupportedVideoSummary, isSourceConverting, startSourceConversion } from "./source-conversion.js";

export interface VaultlyServerOptions {
  host?: string;
  port?: number;
  staticRoot?: string;
  pickDirectory?: () => Promise<string | null>;
  revealPath?: (itemPath: string) => Promise<void>;
  openVideo?: (itemPath: string) => Promise<void>;
}

export async function buildVaultlyServer(options: VaultlyServerOptions = {}) {
resetProcessShutdown();
await removeLegacyPlaybackCache().catch(() => undefined);
const app = Fastify({ logger: true });
await app.register(cors, { origin: ["http://127.0.0.1:5173", "http://localhost:5173"] });
installVaultProfileRoutes(app);
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

await app.register(registerMediaRoutes, { revealPath: options.revealPath, openVideo: options.openVideo });
await app.register(registerMusicRoutes);
await app.register(registerYoutubeRoutes);
await app.register(registerSeriesRoutes);
await app.register(registerPeopleRoutes);
await app.register(registerBulkRoutes);
await app.register(registerMediaDeletionRoutes);
await app.register(registerCircleRoutes);
await app.register(registerBackupRoutes);
await app.register(registerAttributeRoutes);

const sourceInput = z.object({
  mediaType: z.enum(sourceMediaTypes).optional(),
  prefixGrouping: z.boolean().optional(),
  directoryGrouping: z.boolean().optional(),
  filenameMetadataMatching: z.boolean().optional(),
  hashFavoriteMarkers: z.boolean().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  rootPath: z.string().trim().min(1),
});
const sourceCreateInput = sourceInput.merge(sourceAttributesInput);

const sourceIdInput = z.object({ id: z.coerce.number().int().positive() });

app.get("/api/sources/:id/conversion", async (request, reply) => {
  const { id } = sourceIdInput.parse(request.params);
  if (!database.prepare("SELECT id FROM sources WHERE id = ?").get(id)) return reply.code(404).send({ message: "Library source not found." });
  return getConversionProgress(id);
});
app.get("/api/sources/:id/conversion/unsupported", async (request, reply) => {
  const { id } = sourceIdInput.parse(request.params);
  if (!database.prepare("SELECT id FROM sources WHERE id = ?").get(id)) return reply.code(404).send({ message: "Library source not found." });
  return getUnsupportedVideoSummary(id);
});
app.post("/api/sources/:id/conversion", async (request, reply) => {
  const origin = request.headers.origin;
  if (origin && !["http://127.0.0.1:5173", "http://localhost:5173", `http://${request.headers.host}`].includes(origin)) return reply.code(403).send({ message: "Conversion must be started from Vaultly." });
  const { id } = sourceIdInput.parse(request.params);
  const { mode, scope } = z.object({ mode: z.enum(["quick", "slow", "both"]).default("both"), scope: z.enum(["unsupported", "all"]).default("all") }).parse(request.body ?? {});
  const source = database.prepare("SELECT * FROM sources WHERE id = ?").get(id) as SourceRow | undefined;
  if (!source) return reply.code(404).send({ message: "Library source not found." });
  if (!source.enabled) return reply.code(409).send({ message: "Enable this source before converting videos." });
  if (source.status === "scanning" || !source.last_scanned_at) return reply.code(409).send({ message: "Finish scanning this source before converting videos." });
  if (isSourceConverting(id)) return reply.code(202).send(getConversionProgress(id));
  try { await checkConversionRuntime(); }
  catch { return reply.code(503).send({ message: "Conversion requires Python, ffmpeg and ffprobe on PATH. Set VAULTLY_PYTHON if Python uses a different executable." }); }
  // A scan may have started while checking the external tools.
  const current = database.prepare("SELECT status, root_path, enabled FROM sources WHERE id = ?").get(id) as SourceRow | undefined;
  if (!current || !current.enabled || current.status === "scanning" || current.root_path !== source.root_path) return reply.code(409).send({ message: "Source changed; try conversion after scanning finishes." });
  return reply.code(202).send(startSourceConversion(id, source.root_path, mode, scope));
});
app.post("/api/sources/:id/conversion/cancel", async (request) => {
  const { id } = sourceIdInput.parse(request.params);
  return cancelSourceConversion(id);
});
app.addHook("onClose", async () => {
  try {
    cancelPeopleRepair();
    await waitForPeopleRepair();
    await cancelAllSourceScans();
    await cancelAllMusicScans();
    const sources = database.prepare("SELECT id FROM sources").all() as Array<{ id: number }>;
    await Promise.all(sources.map(({ id }) => cancelSourceConversion(id)));
  } finally { await stopBackgroundProcesses(); }
});

const sourceSummaryQuery = `
  SELECT
    s.*,
    COUNT(CASE WHEN m.indexed = 1 THEN 1 END) AS item_count,
    COUNT(CASE WHEN m.indexed = 1 AND m.media_type = 'comic' THEN 1 END) AS comic_count,
    COUNT(CASE WHEN m.indexed = 1 AND m.media_type = 'video' THEN 1 END) AS video_count,
    COUNT(CASE WHEN m.indexed = 1 AND m.media_type = 'story' THEN 1 END) AS story_count
  FROM sources s
  LEFT JOIN media_items m ON m.source_id = s.id
  GROUP BY s.id
`;

app.get("/api/health", async () => ({ ok: true }));
app.get("/api/activity", async () => getBackgroundActivity());
app.get("/api/system/resources", async () => getSystemResources());

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
    updateConnection.run(connected, source.id, connected);
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
        INSERT INTO sources (name, root_path, normalized_path, media_type, prefix_grouping, directory_grouping, filename_metadata_matching, hash_favorite_markers, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'idle')
      `).run(name, resolvedPath, normalizedPath, input.mediaType ?? "mixed", input.prefixGrouping === false ? 0 : 1, input.directoryGrouping === false ? 0 : 1,
        input.filenameMetadataMatching === false ? 0 : 1, input.hashFavoriteMarkers === false ? 0 : 1);
      sourceId = Number(result.lastInsertRowid);
      setSourceAttributes(sourceId, input);
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
    void scanSource(sourceId, resolvedPath, { englishAttributes: true }).catch((error) => app.log.error(error, "Source scan failed"));
    const source = database.prepare(`${sourceSummaryQuery} HAVING s.id = ?`).get(sourceId);
    return reply.code(201).send({ ...(source as Record<string, unknown>), ...sourceAttributes(sourceId) });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      return reply.code(409).send({ message: "That folder is already in your library." });
    }
    throw error;
  }
});

const scanOptionsInput = z.object({ englishAttributes: z.boolean().default(true), mediaType: z.enum(sourceMediaTypes).optional(), refactorFilenames: z.boolean().default(false), confirmFilenameChanges: z.boolean().default(false) });
app.post("/api/sources/scan", async (request, reply) => {
  const scanOptions = scanOptionsInput.parse(request.body ?? {});
  if (scanOptions.refactorFilenames && !scanOptions.confirmFilenameChanges) return reply.code(400).send({ message: "Confirm filename changes before running filename refactoring." });
  const sources = database.prepare("SELECT * FROM sources WHERE enabled = 1 AND (? IS NULL OR media_type = ?) ORDER BY id")
    .all(scanOptions.mediaType ?? null, scanOptions.mediaType ?? null) as unknown as SourceRow[];
  if (sources.some((source) => isSourceConverting(source.id))) return reply.code(409).send({ message: "Wait for video conversion to finish before rescanning." });
  for (const source of sources) void scanSource(source.id, source.root_path, { generateThumbnails: true, ...scanOptions }).catch((error) => app.log.error(error, "Source scan failed"));
  return reply.code(202).send({ status: "scanning", count: sources.length });
});

app.post("/api/sources/:id/scan", async (request, reply) => {
  const scanOptions = scanOptionsInput.parse(request.body ?? {});
  if (scanOptions.refactorFilenames && !scanOptions.confirmFilenameChanges) return reply.code(400).send({ message: "Confirm filename changes before running filename refactoring." });
  const { id } = sourceIdInput.parse(request.params);
  const source = database.prepare("SELECT * FROM sources WHERE id = ?").get(id) as SourceRow | undefined;
  if (!source) return reply.code(404).send({ message: "Library source not found." });
  if (!source.enabled) return reply.code(409).send({ message: "Enable this source before scanning." });
  if (scanOptions.refactorFilenames && !source.filename_refactoring) return reply.code(409).send({ message: "Enable filename refactoring for this source first." });
  if (isSourceConverting(id)) return reply.code(409).send({ message: "Wait for video conversion to finish before rescanning." });
  void scanSource(source.id, source.root_path, { generateThumbnails: true, ...scanOptions }).catch((error) => app.log.error(error, "Source scan failed"));
  return reply.code(202).send({ status: "scanning" });
});

app.post("/api/sources/scan/cancel", async () => ({ count: await cancelAllSourceScans() }));

app.patch("/api/sources/:id/filename-refactoring", async (request, reply) => {
  const { id } = sourceIdInput.parse(request.params);
  const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body);
  const source = database.prepare("SELECT * FROM sources WHERE id = ?").get(id) as SourceRow | undefined;
  if (!source) return reply.code(404).send({ message: "Library source not found." });
  if (source.status === "scanning" || isSourceConverting(id)) return reply.code(409).send({ message: "Wait for this source's tasks to finish before changing filename refactoring." });
  database.prepare("UPDATE sources SET filename_refactoring = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(enabled ? 1 : 0, id);
  return { enabled };
});

app.post("/api/sources/:id/scan/cancel", async (request, reply) => {
  const { id } = sourceIdInput.parse(request.params);
  if (!database.prepare("SELECT id FROM sources WHERE id = ?").get(id)) {
    return reply.code(404).send({ message: "Library source not found." });
  }
  return { cancelled: await cancelSourceScan(id) };
});

app.patch("/api/sources/:id/enabled", async (request, reply) => {
  const { id } = sourceIdInput.parse(request.params);
  const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body);
  const source = database.prepare("SELECT * FROM sources WHERE id = ?").get(id) as SourceRow | undefined;
  if (!source) return reply.code(404).send({ message: "Library source not found." });
  // Hide immediately, before waiting for native processes and queued scans to stop.
  if (!enabled) {
    database.prepare("UPDATE sources SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    await Promise.all([cancelSourceScan(id), cancelSourceConversion(id)]);
  } else {
    let connected = 0;
    try { connected = (await stat(source.root_path)).isDirectory() ? 1 : 0; } catch { /* Drive is offline. */ }
    database.prepare("UPDATE sources SET enabled = 1, connected = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(connected, id);
  }
  return database.prepare("SELECT * FROM sources WHERE id = ?").get(id);
});

app.patch("/api/sources/:id", async (request, reply) => {
  const { id } = sourceIdInput.parse(request.params);
  if (isSourceConverting(id)) return reply.code(409).send({ message: "Cancel video conversion before relocating this source." });
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
    database.prepare(`UPDATE sources SET name = ?, root_path = ?, normalized_path = ?, media_type = ?, prefix_grouping = ?, directory_grouping = ?, filename_metadata_matching = ?, hash_favorite_markers = ?, connected = 1,
      status = 'idle', last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(name, resolvedPath, normalizedPath, input.mediaType ?? source.media_type,
        input.prefixGrouping === undefined ? source.prefix_grouping : Number(input.prefixGrouping),
        input.directoryGrouping === undefined ? source.directory_grouping : Number(input.directoryGrouping),
        input.filenameMetadataMatching === undefined ? source.filename_metadata_matching : Number(input.filenameMetadataMatching),
        input.hashFavoriteMarkers === undefined ? source.hash_favorite_markers : Number(input.hashFavoriteMarkers), id);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      return reply.code(409).send({ message: "That folder is already used by another source." });
    }
    throw error;
  }
  if (source.enabled) void scanSource(id, resolvedPath, { englishAttributes: true }).catch((error) => app.log.error(error, "Source scan failed"));
  return reply.code(202).send({ id, name, root_path: resolvedPath, status: source.enabled ? "scanning" : "idle" });
});

app.delete("/api/sources/:id", async (request, reply) => {
  const sourceId = sourceIdInput.parse(request.params).id;
  if (isSourceConverting(sourceId)) return reply.code(409).send({ message: "Cancel video conversion before removing this source." });
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
  enableAutomaticPeopleRepair();
  return { app, address };
}
