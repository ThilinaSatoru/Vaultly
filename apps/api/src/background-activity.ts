import { database } from "./database.js";
import { getConversionActivity } from "./source-conversion.js";
import { getScanProgress } from "./scanner.js";
import { getThumbnailActivity } from "./thumbnails.js";
import { getProfileScanActivity } from "./people-profile-scan.js";

export interface BackgroundTask {
  id: string; label: string; detail: string; processed: number | null; total: number | null;
  target: "sources" | "people";
}

export function getBackgroundActivity(): BackgroundTask[] {
  const tasks: BackgroundTask[] = getConversionActivity();
  const sources = database.prepare("SELECT id, name FROM sources WHERE status = 'scanning'").all() as Array<{ id: number; name: string }>;
  for (const source of sources) {
    const progress = getScanProgress(source.id);
    const counts = !progress || progress.phase === "discovering" ? null
      : progress.phase === "indexing" ? [progress.itemsProcessed, progress.itemsTotal]
        : progress.phase === "collections" ? [progress.collectionsProcessed, progress.collectionsTotal]
          : progress.phase === "metadata" ? [progress.videoMetadataProcessed, progress.videoMetadataTotal]
            : [progress.thumbnailsProcessed, progress.thumbnailsTotal];
    const phase = progress?.phase ?? "discovering";
    const labels = { discovering: "Reading folders", indexing: "Categorizing media", collections: "Grouping collections", metadata: "Reading video quality", thumbnails: "Preparing thumbnails" };
    tasks.push({ id: `source-${source.id}`, label: source.name, detail: progress?.waitingForResources ? "Waiting for scan slot / resources" : labels[phase], processed: counts?.[0] ?? null, total: counts?.[1] ?? null, target: "sources" });
  }
  for (const profile of getProfileScanActivity()) {
    tasks.push({ id: profile.id, label: "Profile photos", detail: profile.currentName ?? "Checking directories", processed: profile.processed, total: profile.total, target: "people" });
  }
  const thumbnails = getThumbnailActivity();
  if (thumbnails.thumbnails > 0) tasks.push({ id: "thumbnails", label: "Thumbnails", detail: `${thumbnails.thumbnails} pending · ${thumbnails.running} active`, processed: null, total: null, target: "sources" });
  if (thumbnails.metadata > 0 && thumbnails.thumbnails === 0 && !sources.some((source) => getScanProgress(source.id)?.phase === "metadata")) {
    tasks.push({ id: "video-metadata", label: "Video metadata", detail: `${thumbnails.metadata} pending`, processed: null, total: null, target: "sources" });
  }
  return tasks;
}
