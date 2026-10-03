import { describe, expect, it } from "vitest";
import { galleryVideoContext, viewerNavigationItems } from "./video-playlist";
import type { ItemPage, MediaItem } from "./media";

function item(id: number, media_type: MediaItem["media_type"] = "video"): MediaItem {
  return {
    id, media_type, title: `Item ${id}`, filename: `file-${id}.mp4`, source_id: 1,
    source_name: "Videos", relative_path: `file-${id}.mp4`, file_extension: "mp4",
    size_bytes: 1, modified_at_ms: 0, duration_seconds: 30, file_count: 1,
    category_names: "", favorite: 0, categories: [], series_ids: [], tags: [], cast: [], artists: [],
  };
}

describe("gallery video playlist", () => {
  it("uses only videos from the current result page and preserves its filtered sort order", () => {
    const result: ItemPage = { page: 3, pageSize: 4, total: 100, items: [item(8), item(2, "comic"), item(5), item(1, "story")] };
    const context = galleryVideoContext(result, 5)!;
    expect(context.page).toBe(3);
    expect(context.videos.map((video) => video.id)).toEqual([8, 5]);
    // Subsequent gallery changes must not change the playlist of the open player.
    result.items[0].title = "Changed";
    result.items = [item(99)];
    expect(context.videos[0].title).toBe("Item 8");
    expect(context.videos.map((video) => video.id)).toEqual([8, 5]);
  });

  it("does not create a video context for reading items, missing items or unloaded pages", () => {
    const result: ItemPage = { page: 0, pageSize: 2, total: 2, items: [item(1), item(2, "comic")] };
    expect(galleryVideoContext(result, 2)).toBeNull();
    expect(galleryVideoContext(result, 3)).toBeNull();
    expect(galleryVideoContext(null, 1)).toBeNull();
  });

  it("keeps gallery playback within the page even when queued or similar videos exist", () => {
    const context = galleryVideoContext({ page: 2, pageSize: 2, total: 40, items: [item(3), item(4)] }, 3)!;
    const entries = viewerNavigationItems(3, context, [item(3), item(99)], null, [item(3), item(100)])!;
    expect(entries.map((entry) => entry.id)).toEqual([3, 4]);
    const lastIndex = entries.findIndex((entry) => entry.id === 4);
    expect(entries[lastIndex + 1]).toBeUndefined();
    expect(entries[lastIndex - 1].id).toBe(3);
  });

  it("retains explicit temporary queues, collections and similarity fallback outside the gallery", () => {
    const queue = [item(8), item(9)];
    const series = { seriesId: 1, seriesTitle: "Set", items: [item(7), item(8)] };
    const fallback = [item(10), item(11)];
    expect(viewerNavigationItems(8, null, queue, series, fallback)).toBe(queue);
    expect(viewerNavigationItems(7, null, queue, series, fallback)).toBe(series.items);
    expect(viewerNavigationItems(10, null, queue, null, fallback)).toBe(fallback);
  });
});
