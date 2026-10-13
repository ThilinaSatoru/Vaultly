import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSourceTree, matchesSource, sourceMediaGroup, SourcesBrowser } from "./SourcesBrowser";

const base = { id: 1, name: "Films", root_path: "D:/Library/Films", comic_count: 0, video_count: 12, story_count: 0, item_count: 12, status: "ready", path_available: true };

test("mixed sources appear in each matching media filter and search combines with status", () => {
  const mixed = { ...base, comic_count: 4, name: "Mixed collection" };
  expect(sourceMediaGroup(mixed)).toBe("Mixed media");
  expect(matchesSource(mixed, "comic", "ready", "LIBRARY")).toBe(true);
  expect(matchesSource(mixed, "video", "all", "mixed")).toBe(true);
  expect(matchesSource(mixed, "story", "all", "")).toBe(false);
  expect(matchesSource(base, "mixed", "all", "")).toBe(false);
  expect(matchesSource({ ...base, path_available: false }, "video", "unavailable", "Films")).toBe(true);
  expect(matchesSource({ ...base, path_available: false }, "video", "ready", "Films")).toBe(false);
  expect(sourceMediaGroup({ ...base, video_count: 0, item_count: 0 })).toBe("No indexed media");
});

test("sources follow drive paths and source details start compact with source type filtering", () => {
  const html = renderToStaticMarkup(<SourcesBrowser sources={[base, { ...base, id: 2, name: "Books", video_count: 0, story_count: 5 }]} renderSource={(source, expanded) => <article data-expanded={expanded}>{source.name}</article>} />);
  expect(html).toContain('aria-label="Search sources"');
  expect(html).toContain('aria-label="Filter sources by status"');
  expect(html).toContain('aria-label="Filter sources by media type"');
  expect(html).toContain('class="source-tree-branch" open=""');
  expect(html).toContain('aria-label="Filter sources by source type"');
  expect(html).not.toContain('All categories');
  expect(html).not.toContain('class="source-group"');
  expect(html).toContain('data-expanded="false"');
  expect(html).toContain("Expand all");
  expect(html).toContain("Collapse all");
});

test("drive tree combines Windows paths without combining different drives or network shares", () => {
  const tree = buildSourceTree([
    base,
    { ...base, id: 2, root_path: "d:\\library\\Books" },
    { ...base, id: 3, root_path: "E:/Library/Films" },
    { ...base, id: 4, root_path: "D:/Library" },
    { ...base, id: 5, root_path: "\\\\server\\share\\Films" },
    { ...base, id: 6, root_path: "/mnt/media" },
  ]);
  expect(tree.map((node) => node.label)).toEqual(expect.arrayContaining(["D:/", "E:/", "//server/share", "/"]));
  const drive = tree.find((node) => node.label === "D:/")!;
  expect(drive.children).toHaveLength(1);
  expect(drive.children[0].sources.map((source) => source.id)).toEqual([4]);
  expect(drive.children[0].children.map((node) => node.label)).toEqual(["Books", "Films"]);
  expect(buildSourceTree([{ ...base, root_path: "C:\\" }])[0].sources).toHaveLength(1);
});

test("disabled is separate from drive availability and excludes ready and scanning status filters", () => {
  const source = { ...base, enabled: 0 };
  expect(matchesSource(source, "video", "disabled", "")).toBe(true);
  expect(matchesSource(source, "all", "ready", "")).toBe(false);
  expect(matchesSource({ ...source, path_available: false }, "all", "unavailable", "")).toBe(false);
  expect(matchesSource(source, "video", "all", "")).toBe(true);
});
