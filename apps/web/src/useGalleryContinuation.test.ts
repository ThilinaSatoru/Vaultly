import { describe, expect, it } from "vitest";
import { mergeGalleryVideos, toSuggestedVideos } from "./useGalleryContinuation";
import type { MediaItem } from "./media";

const video = (id: number) => ({ id, title: `Item ${id}`, filename: `${id}.mp4`, source_name: "Videos", duration_seconds: 30 });

describe("gallery continuation helpers", () => {
  it("appends only videos that are not already listed and keeps order", () => {
    const existing = [video(1), video(2)];
    expect(mergeGalleryVideos(existing, [video(2), video(3), video(3), video(4)]).map((entry) => entry.id)).toEqual([1, 2, 3, 4]);
  });

  it("returns the same array when nothing new arrives", () => {
    const existing = [video(1)];
    expect(mergeGalleryVideos(existing, [video(1)])).toBe(existing);
  });

  it("keeps only videos from a result page", () => {
    const items = [{ ...video(1), media_type: "video" }, { ...video(2), media_type: "comic" }] as unknown as MediaItem[];
    expect(toSuggestedVideos(items).map((entry) => entry.id)).toEqual([1]);
  });
});
