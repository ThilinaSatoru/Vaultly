import { constants } from "node:fs";
import { copyFile, link, lstat, readdir, realpath, unlink, utimes } from "node:fs/promises";
import path from "node:path";
import { database } from "./database.js";
import { withAttributePatterns } from "./attribute-routes.js";
import { FilenameMetadataMatcher, normalizeMetadataPhrase } from "./filename-metadata.js";

interface Attribute { id: number; name: string; patterns?: string[] }
interface FileEntry { id: number; item: { filename: string; relativePath: string; fileExtension: string; title: string } }
class RefactoringSyncError extends Error {}
const safeText = (value: string) => value.normalize("NFC").replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "");
const cleaners = new WeakMap<Attribute[], { matcher: FilenameMetadataMatcher<Attribute>; maxWords: number }>();

export function refactoredFilename(filename: string, casts: Attribute[], tags: Attribute[], attributes: Attribute[]) {
  const extension = path.extname(filename);
  const stem = filename.slice(0, -extension.length);
  const words = stem.replace(/[._]+/g, " ").match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
  let cleaner = cleaners.get(attributes);
  if (!cleaner) {
    cleaner = { matcher: new FilenameMetadataMatcher(attributes), maxWords: attributes.reduce((max, entry) =>
      [entry.name, ...(entry.patterns ?? [])].reduce((length, name) => Math.max(length, normalizeMetadataPhrase(name).split(" ").length), max), 1) };
    cleaners.set(attributes, cleaner);
  }
  const { matcher, maxWords } = cleaner;
  const titleWords: string[] = [];
  for (let i = 0; i < words.length;) {
    let matched = 0;
    for (let length = Math.min(maxWords, words.length - i); length > 0; length--) {
      if (matcher.matchNormalized(normalizeMetadataPhrase(words.slice(i, i + length).join(" ")), true).length) { matched = length; break; }
    }
    if (matched) i += matched;
    else titleWords.push(words[i++]);
  }
  const title = safeText(titleWords.join(" ")) || "Untitled";
  const credits = casts.map((entry) => safeText(entry.name)).filter(Boolean).join(", ");
  const hashtags = tags.map((entry) => safeText(entry.name).replace(/^#+/, "").replace(/[\s#]+/g, "_")).filter(Boolean).map((name) => `#${name}`).join(" ");
  const prefix = credits ? `${credits} - ` : "";
  const suffix = `${hashtags ? ` ${hashtags}` : ""}${extension}`;
  // Keep every filename within the common 255-byte filesystem limit.
  const available = 240 - Buffer.byteLength(prefix + suffix);
  if (available < 8) throw new Error("Assigned attributes are too long for a filename.");
  let shortened = title;
  while (Buffer.byteLength(shortened) > available) shortened = [...shortened].slice(0, -1).join("");
  const result = `${prefix}${shortened.trim()}${suffix}`;
  return { filename: /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result) ? `_${result}` : result, title };
}

const within = (root: string, file: string) => {
  const relative = path.relative(root, file);
  return !!relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

async function stageFile(oldPath: string, nextPath: string) {
  const info = await lstat(oldPath);
  if (!info.isFile()) throw new Error("Symbolic links cannot be refactored.");
  try { await link(oldPath, nextPath); }
  catch (error) {
    if (!["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV", "ENOSYS"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    // FAT/exFAT sources do not support hard links. Keep the original until sync succeeds.
    await copyFile(oldPath, nextPath, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
    try { await utimes(nextPath, info.atime, info.mtime); }
    catch (copyError) { await unlink(nextPath); throw copyError; }
  }
}

/** Synchronize each file with its existing row before honoring cancellation. Never overwrite a destination. */
export async function refactorSourceFilenames(sourceId: number, rootPath: string, entries: FileEntry[], signal: AbortSignal, log: (message: string) => void) {
  const root = await realpath(rootPath);
  const attributes = [
    ...withAttributePatterns("people", database.prepare("SELECT id, name FROM people").all() as unknown as Attribute[]),
    ...withAttributePatterns("tags", database.prepare("SELECT id, name FROM tags").all() as unknown as Attribute[]),
    ...withAttributePatterns("categories", database.prepare("SELECT id, name FROM categories").all() as unknown as Attribute[]),
  ];
  const castsQuery = database.prepare("SELECT DISTINCT p.id, p.name FROM item_people ip JOIN people p ON p.id = ip.person_id WHERE ip.item_id = ? ORDER BY p.name COLLATE NOCASE, p.id");
  const tagsQuery = database.prepare("SELECT t.id, t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = ? ORDER BY t.name COLLATE NOCASE, t.id");
  const rowQuery = database.prepare("SELECT title, relative_path FROM media_items WHERE id = ? AND source_id = ?");
  const destinationQuery = database.prepare("SELECT id FROM media_items WHERE source_id = ? AND relative_path = ? COLLATE NOCASE AND id <> ?");
  const update = database.prepare("UPDATE media_items SET filename = ?, relative_path = ?, title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND source_id = ? AND relative_path = ?");
  let renamed = 0;
  let skipped = 0;
  for (const { id, item } of entries) {
    signal.throwIfAborted();
    if (!item.fileExtension) continue; // Image collections are folders, not filenames.
    try {
      const next = refactoredFilename(item.filename, castsQuery.all(id) as unknown as Attribute[], tagsQuery.all(id) as unknown as Attribute[], attributes);
      if (next.filename === item.filename) continue;
      const oldPath = path.resolve(rootPath, item.relativePath);
      const resolved = await realpath(oldPath);
      const info = await lstat(oldPath);
      if (!within(root, resolved) || !info.isFile()) throw new Error("File is outside the source or is a symbolic link.");
      const relativePath = path.join(path.dirname(item.relativePath), next.filename);
      const nextPath = path.join(path.dirname(oldPath), next.filename);
      if (destinationQuery.get(sourceId, relativePath, id)) throw new Error("The destination is already indexed.");
      const oldStem = path.basename(item.filename, path.extname(item.filename));
      const nextStem = path.basename(next.filename, path.extname(next.filename));
      const sidecars = (await readdir(path.dirname(oldPath), { withFileTypes: true })).filter((entry) => entry.isFile()
        && /\.(?:srt|vtt|ass|ssa|sub|sbv|smi|sami|lrc|mpl|stl)$/i.test(entry.name)
        && entry.name.toLowerCase().startsWith(oldStem.toLowerCase())
        && /^[ ._-]/.test(entry.name.slice(oldStem.length)))
        .map((entry) => ({ oldPath: path.join(path.dirname(oldPath), entry.name), nextPath: path.join(path.dirname(oldPath), nextStem + entry.name.slice(oldStem.length)) }));
      const staged: Array<{ oldPath: string; nextPath: string }> = [];
      let synced = false;
      try {
        // Stage every destination exclusively before committing any path change.
        for (const file of [{ oldPath, nextPath }, ...sidecars]) {
          await stageFile(file.oldPath, file.nextPath);
          staged.push(file);
        }
        signal.throwIfAborted();
        const row = rowQuery.get(id, sourceId) as { title: string; relative_path: string } | undefined;
        if (!row || row.relative_path !== item.relativePath) throw new Error("Library item changed during refactoring.");
        const defaultTitle = path.basename(item.filename, path.extname(item.filename)).replace(/[._]+/g, " ").trim();
        const title = row.title === defaultTitle ? next.title : row.title;
        update.run(next.filename, relativePath, title, id, sourceId, item.relativePath);
        synced = true;
        const removed: typeof staged = [];
        try {
          for (const file of staged) { await unlink(file.oldPath); removed.push(file); }
        }
        catch (error) {
          for (const file of removed) await stageFile(file.nextPath, file.oldPath);
          update.run(item.filename, item.relativePath, row.title, id, sourceId, relativePath);
          synced = false;
          throw error;
        }
        item.filename = next.filename;
        item.relativePath = relativePath;
        item.title = title;
        renamed++;
      } catch (error) {
        // If rollback itself fails, keep the new files and their synchronized
        // database path. Never delete the only remaining copy of a sidecar.
        if (synced) throw new RefactoringSyncError(`Could not finish syncing ${next.filename}: ${String(error)}`);
        for (const file of staged) await unlink(file.nextPath);
        throw error;
      }
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof RefactoringSyncError) throw error;
      skipped++; log(`Skipped ${item.filename}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  log(`Filename refactoring finished: ${renamed} renamed, ${skipped} skipped; library paths synchronized.`);
  return { renamed, skipped };
}
