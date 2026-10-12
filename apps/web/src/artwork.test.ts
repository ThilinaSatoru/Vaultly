import { expect, test } from "vitest";
import { artworkOrientation, mediaCardOrientation } from "./artwork";

test("every media type follows its assigned cover before its default shape", () => {
  for (const media_type of ["video", "comic", "story"] as const) {
    expect(mediaCardOrientation({ media_type, has_cover: 1, cover_width: 600, cover_height: 900, video_width: 1920, video_height: 1080 })).toBe("portrait");
    expect(mediaCardOrientation({ media_type, has_cover: 1, cover_width: 900, cover_height: 600, video_width: 1080, video_height: 1920 })).toBe("landscape");
  }
  expect(mediaCardOrientation({ media_type: "comic" })).toBe("portrait");
  expect(mediaCardOrientation({ media_type: "story" })).toBe("portrait");
  expect(mediaCardOrientation({ media_type: "video", video_width: 1080, video_height: 1920 })).toBe("portrait");
  expect(mediaCardOrientation({ media_type: "video" })).toBe("landscape");
});

test("loaded artwork and older collection covers use valid natural dimensions", () => {
  expect(artworkOrientation(120, 180, "landscape")).toBe("portrait");
  expect(artworkOrientation(180, 120)).toBe("landscape");
  expect(artworkOrientation(120, 120)).toBe("landscape");
  expect(artworkOrientation(0, 180, "landscape")).toBe("landscape");
  expect(artworkOrientation(Infinity, 180)).toBe("portrait");
});
