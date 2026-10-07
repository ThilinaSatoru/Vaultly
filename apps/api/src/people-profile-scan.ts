import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { database, runtimeDirectory } from "./database.js";
import { downloadProfileImage, normalizeProfileImage, storeProfileImage, removeProfileImage, type ProfileImageFetch } from "./profile-images.js";

export const peopleDirectories = ["https://xhamster.com/pornstars", "https://xhamster.com/shemale/pornstars"];
export interface ProfileCandidate { name: string; aliases: string[]; profileUrl: string; imageUrl: string }
export interface PeopleProfileBrowser {
  findPerson: (name: string, signal: AbortSignal) => Promise<ProfileCandidate[]>;
  close: () => Promise<void>;
}
export type PeopleProfileBrowserFactory = () => Promise<PeopleProfileBrowser>;
export const normalizePersonName = (name: string) => name.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
export function matchingProfiles(name: string, candidates: ProfileCandidate[]) {
  const key = normalizePersonName(name);
  return [...new Map(candidates.filter((candidate) => [candidate.name, ...candidate.aliases].some((alias) => normalizePersonName(alias) === key))
    .map((candidate) => [candidate.profileUrl, candidate])).values()];
}
type Outcome = "updated" | "existing" | "not-found" | "ambiguous" | "error" | "changed";
interface ScanRow { id: number; name: string; outcome: Outcome; message?: string; profileUrl?: string }
export interface PeopleProfileScanReport {
  status: "idle" | "running" | "completed" | "cancelled" | "failed";
  total: number; processed: number; updated: number; currentName: string | null;
  startedAt?: string; finishedAt?: string; error?: string; results: ScanRow[];
}

export function createPeopleProfileScanner(options: { createBrowser?: PeopleProfileBrowserFactory; fetchProfileImage?: ProfileImageFetch }) {
  const reportPath = path.join(runtimeDirectory, "people-profile-scan.json");
  let report: PeopleProfileScanReport = { status: "idle", total: 0, processed: 0, updated: 0, currentName: null, results: [] };
  let controller: AbortController | null = null;
  let task: Promise<void> | null = null;
  let loading: Promise<void> | null = null;
  const persist = async () => {
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(`${reportPath}.tmp`, JSON.stringify(report, null, 2));
    await rename(`${reportPath}.tmp`, reportPath);
  };
  const status = async () => {
    loading ??= (async () => {
      try {
        const previous = JSON.parse(await readFile(reportPath, "utf8")) as PeopleProfileScanReport;
        if (Array.isArray(previous.results) && typeof previous.total === "number") report = previous;
        if (report.status === "running") { report.status = "cancelled"; report.currentName = null; report.error = "The app closed before this scan finished. Start a new scan to continue checking missing photos."; }
      } catch { /* No previous report. */ }
    })();
    await loading;
    return { ...structuredClone(report), available: Boolean(options.createBrowser) };
  };
  const run = async (people: Array<{ id: number; name: string; profile_image: string | null }>, signal: AbortSignal) => {
    let browser: PeopleProfileBrowser | undefined;
    try {
      await persist();
      if (people.some((person) => !person.profile_image)) browser = await options.createBrowser!();
      for (const person of people) {
        signal.throwIfAborted();
        report.currentName = person.name;
        await persist();
        let row: ScanRow = { id: person.id, name: person.name, outcome: "existing" };
        if (!person.profile_image) {
          try {
            const matches = matchingProfiles(person.name, await browser!.findPerson(person.name, signal));
            signal.throwIfAborted();
            if (matches.length === 0) row.outcome = "not-found";
            else if (matches.length > 1) { row.outcome = "ambiguous"; row.message = "Multiple exact matches; choose a photo manually."; }
            else {
              const match = matches[0]!;
              const data = await normalizeProfileImage(await downloadProfileImage(match.imageUrl, match.profileUrl, options.fetchProfileImage, signal));
              signal.throwIfAborted();
              const filename = await storeProfileImage(data);
              try {
                signal.throwIfAborted();
                const changed = database.prepare("UPDATE people SET profile_image = ? WHERE id = ? AND name = ? AND profile_image IS NULL").run(filename, person.id, person.name).changes;
                row = { ...row, outcome: changed ? "updated" : "changed", profileUrl: match.profileUrl };
                if (!changed) await removeProfileImage(filename);
                else report.updated += 1;
              } catch (error) { await removeProfileImage(filename); throw error; }
            }
          } catch (error) {
            if (signal.aborted) throw error;
            row = { ...row, outcome: "error", message: error instanceof Error ? error.message : "Could not check this person." };
          }
        }
        report.results.push(row); report.processed += 1;
        await persist();
      }
      report.status = "completed";
    } catch (error) {
      report.status = signal.aborted ? "cancelled" : "failed";
      if (!signal.aborted) report.error = error instanceof Error ? error.message : "Profile scan failed.";
    } finally {
      await browser?.close().catch(() => undefined);
      report.currentName = null; report.finishedAt = new Date().toISOString();
      await persist().catch(() => undefined);
      controller = null;
    }
  };
  const start = async () => {
    await status();
    if (controller) throw new Error("A profile scan is already running.");
    if (!options.createBrowser) throw new Error("Profile scans are available in the desktop app.");
    const people = database.prepare("SELECT id, name, profile_image FROM people ORDER BY name COLLATE NOCASE").all() as Array<{ id: number; name: string; profile_image: string | null }>;
    report = { status: "running", total: people.length, processed: 0, updated: 0, currentName: null, startedAt: new Date().toISOString(), results: [] };
    controller = new AbortController();
    task = run(people, controller.signal);
    return status();
  };
  const cancel = async () => { controller?.abort(); await task; return status(); };
  return { status, start, cancel };
}

export async function registerPeopleProfileScanRoutes(app: FastifyInstance, options: { createBrowser?: PeopleProfileBrowserFactory; fetchProfileImage?: ProfileImageFetch }) {
  const scanner = createPeopleProfileScanner(options);
  app.get("/api/people/profile-scan", scanner.status);
  app.post("/api/people/profile-scan", async (_request, reply) => {
    try { return reply.code(202).send(await scanner.start()); }
    catch (error) { return reply.code(options.createBrowser ? 409 : 501).send({ message: error instanceof Error ? error.message : "Could not start profile scan." }); }
  });
  app.post("/api/people/profile-scan/cancel", scanner.cancel);
  app.addHook("onClose", async () => { await scanner.cancel(); });
}
