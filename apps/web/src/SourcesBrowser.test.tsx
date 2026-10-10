import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { matchesSource, sourceMediaGroup, SourcesBrowser } from "./SourcesBrowser";

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

test("source groups collapse independently and source details start compact", () => {
  const html = renderToStaticMarkup(<SourcesBrowser sources={[base, { ...base, id: 2, name: "Books", video_count: 0, story_count: 5 }]} renderSource={(source, expanded) => <article data-expanded={expanded}>{source.name}</article>} />);
  expect(html).toContain('aria-label="Search sources"');
  expect(html).toContain('aria-label="Filter sources by status"');
  expect(html).toContain('aria-label="Filter sources by media type"');
  expect(html).toContain('class="source-group" open=""');
  expect(html).toContain('data-expanded="false"');
  expect(html).toContain("Expand all");
  expect(html).toContain("Collapse all");
});
