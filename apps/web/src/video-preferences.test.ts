import { expect, test } from "vitest";
import { preferredSubtitle, preferredTrack, subtitleLanguage, trackPreference, videoCardOrientation } from "./video-preferences";

test("language preferences follow changed stream ordering and subtitle names", () => {
  const stored = JSON.stringify(trackPreference({ index: 3, language: "jpn", title: "Original" }));
  expect(preferredTrack([{ index: 1, language: "eng", title: "Dub" }, { index: 6, language: "ja", title: "Original" }], stored, 1)).toBe(6);
  const subtitle = JSON.stringify(trackPreference({ index: 0, language: subtitleLanguage("Episode 1.English.SDH.srt"), title: "Episode 1.English.SDH.srt" }));
  expect(preferredTrack([{ index: 0, language: "eng", title: "Episode 2.eng.srt" }, { index: 2, language: "en", title: "Episode 2.en.SDH.vtt" }], subtitle, -1)).toBe(2);
  expect(preferredTrack([{ index: 1, language: "fr", title: "French" }], stored, 1)).toBe(1);
  expect(preferredTrack([{ index: 1, language: "en", title: "English" }], "off", -1)).toBe(-1);
  expect(preferredTrack([], "invalid", -1)).toBe(-1);
  expect(subtitleLanguage("Series.S01E02.jp.srt")).toBe("und");
});

test("artwork orientation prefers covers over video dimensions", () => {
  expect(videoCardOrientation({ has_cover: 1, cover_width: 600, cover_height: 900, video_width: 1920, video_height: 1080 })).toBe("portrait");
  expect(videoCardOrientation({ has_cover: 1, cover_width: 900, cover_height: 600, video_width: 1080, video_height: 1920 })).toBe("landscape");
  expect(videoCardOrientation({ video_width: 1080, video_height: 1920 })).toBe("portrait");
  expect(videoCardOrientation({})).toBe("landscape");
});


test("new videos enable subtitles with a preferred language or an available default", () => {
  const tracks = [{ index: 0, language: "eng", title: "English" }, { index: 1, language: "jpn", title: "Japanese", default: true }];
  expect(preferredSubtitle(tracks, null)).toBe(1);
  expect(preferredSubtitle(tracks, "off")).toBe(1);
  expect(preferredSubtitle(tracks, JSON.stringify(trackPreference(tracks[0]!)))).toBe(0);
  expect(preferredSubtitle(tracks, JSON.stringify({ language: "fr" }))).toBe(1);
  expect(preferredSubtitle([tracks[0]!], "off")).toBe(0);
  expect(preferredSubtitle([], "off")).toBe(-1);
  expect(subtitleLanguage("Movie.English.SDH.ass")).toBe("en");
});
