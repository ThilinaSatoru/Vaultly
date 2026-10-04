import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ScanProgress, type SourceScanProgress } from "./ScanProgress";

const progress: SourceScanProgress = {
  phase: "discovering", elapsedMs: 64000, directoriesScanned: 20, directoriesFound: 50,
  filesChecked: 2400, comicPages: 2200, comicsFound: 25, pdfsFound: 10, videosFound: 5,
  itemsProcessed: 0, itemsTotal: 40, collectionsProcessed: 0, collectionsTotal: 0,
  thumbnailsProcessed: 0, thumbnailsTotal: 0, thumbnailErrors: 0, currentPath: "Comics/Issue 01",
};

test("discovery shows counters, comic pages and elapsed time without a guessed percentage", () => {
  const html = renderToStaticMarkup(<ScanProgress progress={progress} />);
  expect(html).toContain("Reading folders");
  expect(html).toContain("20 / 50 discovered folders checked");
  expect(html).toContain("2,200 comic pages");
  expect(html).toContain("1m 04s elapsed");
  expect(html).toContain("Comics/Issue 01");
  expect(html).not.toContain("aria-valuenow");
});

test.each([
  ["indexing", "Categorizing media", { itemsProcessed: 10, itemsTotal: 40 }],
  ["collections", "Grouping collections", { collectionsProcessed: 10, collectionsTotal: 40 }],
  ["thumbnails", "Preparing thumbnails", { thumbnailsProcessed: 10, thumbnailsTotal: 40 }],
] as const)("%s shows progress for that stage", (phase, label, counts) => {
  const html = renderToStaticMarkup(<ScanProgress progress={{ ...progress, ...counts, phase }} />);
  expect(html).toContain(label);
  expect(html).toContain('aria-valuenow="25"');
  expect(html).toContain("10 / 40");
});
