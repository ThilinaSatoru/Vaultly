import { setImmediate as yieldToRequests } from "node:timers/promises";
import { database, onVaultChanged } from "./database.js";
import { withAttributePatterns } from "./attribute-routes.js";
import { PeopleMatcher } from "./people-matching.js";

export interface PeopleRepairProgress { status: "running" | "completed" | "failed"; processed: number; total: number; removed: number; added: number; error?: string }
let progress: PeopleRepairProgress | null = null;
let pending: Promise<PeopleRepairProgress> | null = null;
let automatic = false;
let controller: AbortController | undefined;
export function cancelPeopleRepair() { controller?.abort(new Error("People repair stopped because Vaultly is closing.")); }
function repairIfRequired() { if (!database.prepare("SELECT name FROM maintenance_versions WHERE name = 'strict-people'").get()) void repairPeopleMatches(); }
export function enableAutomaticPeopleRepair() { automatic = true; repairIfRequired(); }
onVaultChanged(() => { progress = null; if (automatic) repairIfRequired(); });
export const getPeopleRepairProgress = () => progress;
export const waitForPeopleRepair = () => pending ?? Promise.resolve();

export function repairPeopleMatches(): Promise<PeopleRepairProgress> {
  if (pending) return pending;
  controller = new AbortController();
  const signal = controller.signal;
  progress = { status: "running", processed: 0, total: Number((database.prepare("SELECT COUNT(*) AS count FROM media_items WHERE indexed = 1").get() as { count: number }).count), removed: 0, added: 0 };
  const current = progress;
  pending = (async () => {
    await yieldToRequests();
    try {
      const matcher = new PeopleMatcher(withAttributePatterns("people", database.prepare("SELECT id, name FROM people").all() as Array<{ id: number; name: string }>));
      const credits = database.prepare("SELECT person_id FROM item_people WHERE item_id = ? AND origin IN ('legacy', 'filename')");
      const remove = database.prepare("DELETE FROM item_people WHERE item_id = ? AND person_id = ? AND origin IN ('legacy', 'filename')");
      const mark = database.prepare("UPDATE item_people SET origin = 'filename' WHERE item_id = ? AND person_id = ? AND origin = 'legacy'");
      const add = database.prepare("INSERT OR IGNORE INTO item_people(item_id, person_id, role, origin) VALUES (?, ?, ?, 'filename')");
      let cursor = 0;
      const last = Number((database.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM media_items").get() as { id: number }).id);
      while (cursor < last) {
        signal.throwIfAborted();
        const batch = database.prepare("SELECT id, filename, file_extension, media_type FROM media_items WHERE indexed = 1 AND id > ? AND id <= ? ORDER BY id LIMIT 250").all(cursor, last) as Array<{ id: number; filename: string; file_extension: string; media_type: string }>;
        if (!batch.length) break;
        database.exec("BEGIN IMMEDIATE");
        try {
          for (const item of batch) {
            const matches = matcher.match(item.filename, item.file_extension);
            const ids = new Set(matches.map((person) => person.id));
            for (const credit of credits.all(item.id) as Array<{ person_id: number }>) {
              if (!ids.has(credit.person_id)) current.removed += Number(remove.run(item.id, credit.person_id).changes);
              else mark.run(item.id, credit.person_id);
            }
            for (const person of matches) current.added += Number(add.run(item.id, person.id, item.media_type === "video" ? "cast" : "artist").changes);
            cursor = item.id; current.processed++;
          }
          database.exec("COMMIT");
        } catch (error) { database.exec("ROLLBACK"); throw error; }
        await yieldToRequests();
      }
      database.prepare("INSERT OR REPLACE INTO maintenance_versions(name, version) VALUES ('strict-people', 1)").run();
      current.status = "completed";
    } catch (error) { current.status = "failed"; current.error = error instanceof Error ? error.message : String(error); }
    return current;
  })().finally(() => { pending = null; });
  return pending;
}
