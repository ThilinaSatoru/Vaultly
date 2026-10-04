import { formatCount } from "./media";

export interface SourceScanProgress {
  phase: "discovering" | "indexing" | "collections" | "thumbnails";
  elapsedMs: number;
  directoriesScanned: number;
  directoriesFound: number;
  filesChecked: number;
  comicPages: number;
  comicsFound: number;
  videosFound: number;
  pdfsFound: number;
  itemsProcessed: number;
  itemsTotal: number;
  collectionsProcessed: number;
  collectionsTotal: number;
  thumbnailsProcessed: number;
  thumbnailsTotal: number;
  thumbnailErrors: number;
  currentPath: string;
}

const phaseLabels = {
  discovering: "Reading folders", indexing: "Categorizing media",
  collections: "Grouping collections", thumbnails: "Preparing thumbnails",
};

export function ScanProgress({ progress }: { progress: SourceScanProgress }) {
  const label = phaseLabels[progress.phase];
  const [processed, total] = progress.phase === "indexing" ? [progress.itemsProcessed, progress.itemsTotal]
    : progress.phase === "collections" ? [progress.collectionsProcessed, progress.collectionsTotal]
      : [progress.thumbnailsProcessed, progress.thumbnailsTotal];
  // The directory tree's size is unknown until discovery finishes. Show counts without inventing a percentage.
  const percent = progress.phase === "discovering" || total === 0 ? undefined : Math.min(100, Math.floor(processed / total * 100));
  const seconds = Math.floor(progress.elapsedMs / 1000);
  const elapsed = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
  return <section className="scan-progress" aria-label="Scan progress">
    <div className="scan-progress-heading"><strong>{label}</strong><span>{elapsed} elapsed</span></div>
    <div className={`scan-progress-track${percent === undefined ? " indeterminate" : ""}`} role="progressbar"
      aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <span style={percent === undefined ? undefined : { width: `${percent}%` }} />
    </div>
    <p className="scan-progress-counts">{progress.phase === "discovering"
      ? `${formatCount(progress.directoriesScanned)} / ${formatCount(progress.directoriesFound)} discovered folders checked · ${formatCount(progress.filesChecked)} files checked`
      : `${formatCount(processed)} / ${formatCount(total)} ${progress.phase === "indexing" ? "items categorized" : progress.phase === "collections" ? "groups checked" : "thumbnails processed"}${percent === undefined ? "" : ` · ${percent}%`}`}</p>
    <p className="scan-progress-media">{formatCount(progress.comicsFound)} comics · {formatCount(progress.pdfsFound)} PDFs · {formatCount(progress.videosFound)} videos{progress.comicPages > 0 && ` · ${formatCount(progress.comicPages)} comic pages`}</p>
    {progress.currentPath && <p className="scan-progress-path" title={progress.currentPath}>{progress.currentPath === "." ? "Source folder" : progress.currentPath}</p>}
    {progress.thumbnailErrors > 0 && <p className="scan-progress-warning">{formatCount(progress.thumbnailErrors)} thumbnails could not be generated.</p>}
  </section>;
}
