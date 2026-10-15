import { lstat, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { database } from "./database.js";
import { pictureExtensions } from "./source-media.js";
import { isSourceConverting } from "./source-conversion.js";
import { clearThumbnailCache } from "./thumbnails.js";

interface DeletionItem { id: number; source_id: number; root_path: string; relative_path: string; media_type: string; status: string }
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

// Check every component so junctions and symlinks cannot redirect deletion.
async function checkedPath(root: string, relative: string) {
  const target = path.resolve(root, relative);
  const local = path.relative(root, target);
  if (local === ".." || local.startsWith(`..${path.sep}`) || path.isAbsolute(local)) throw new Error("Media path escapes its library source.");
  let current = root;
  for (const part of local.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error("Redirected media paths cannot be permanently deleted.");
      const resolvedLocal = path.relative(root, await realpath(current));
      if (resolvedLocal === ".." || resolvedLocal.startsWith(`..${path.sep}`) || path.isAbsolute(resolvedLocal)) throw new Error("Media path escapes its library source.");
    } catch (error) { if (missing(error)) return target; throw error; }
  }
  return target;
}

async function deleteItem(item: DeletionItem) {
  if (item.status === "scanning" || isSourceConverting(item.source_id)) throw new Error("Wait for the source scan or conversion to finish before deleting media.");
  // An offline source is not evidence that its media is gone.
  const root = await realpath(item.root_path);
  const target = await checkedPath(root, item.relative_path);
  let info;
  try { info = await lstat(target); } catch (error) { if (!missing(error)) throw error; }
  if (info?.isDirectory()) {
    if (item.media_type !== "comic") throw new Error("This media item unexpectedly points to a directory.");
    const pages = (await readdir(target, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && pictureExtensions.has(path.extname(entry.name).toLowerCase()));
    for (const page of pages) {
      const pagePath = await checkedPath(root, path.relative(root, path.join(target, page.name)));
      await unlink(pagePath).catch((error) => { if (!missing(error)) throw error; });
    }
    // Other media may share this folder; only remove it if it is empty.
    if (target !== root) await rmdir(target).catch((error: NodeJS.ErrnoException) => {
      if (!["ENOTEMPTY", "EEXIST", "ENOENT"].includes(error.code ?? "")) throw error;
    });
  } else if (info) {
    if (target === root || !info.isFile()) throw new Error("Only media files can be permanently deleted.");
    await unlink(target).catch((error) => { if (!missing(error)) throw error; });
  }
  // Cascades remove metadata assignments and collection memberships too.
  database.prepare("DELETE FROM media_items WHERE id = ?").run(item.id);
}

export async function registerMediaDeletionRoutes(app: FastifyInstance) {
  const remove = async (itemIds: number[]) => {
    const deletedIds: number[] = [];
    const failures: Array<{ id: number; message: string }> = [];
    for (const id of new Set(itemIds)) {
      const item = database.prepare(`SELECT m.id, m.source_id, m.relative_path, m.media_type, s.root_path, s.status
        FROM media_items m JOIN sources s ON s.id = m.source_id WHERE m.id = ?`).get(id) as DeletionItem | undefined;
      if (!item) { deletedIds.push(id); continue; }
      try { await deleteItem(item); deletedIds.push(id); }
      catch (error) { failures.push({ id, message: error instanceof Error ? error.message : "Could not delete media." }); }
    }
    await clearThumbnailCache(deletedIds);
    return { deletedIds, failures };
  };
  app.delete("/api/items/:id", async (request) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    return remove([id]);
  });
  app.post("/api/items/bulk-delete", async (request) => {
    const { itemIds } = z.object({ itemIds: z.array(z.number().int().positive()).min(1).max(500) }).parse(request.body);
    return remove(itemIds);
  });
}
