import { expect, test, vi } from "vitest";
import { adjacentMusicTrack, musicQuery, trackLabel } from "./music";

test("music text search replaces the artist scope and keeps playlist order otherwise", () => {
  const scope = { kind: "artist" as const, id: 42, name: "Artist" };
  const searched = new URLSearchParams(musicQuery(scope, "night"));
  expect(searched.has("artist")).toBe(false); expect(searched.get("q")).toBe("night");
  expect(new URLSearchParams(musicQuery(scope, "")).get("artist")).toBe("42");
  const playlist = new URLSearchParams(musicQuery({ kind: "playlist", id: 8, name: "Mix" }, ""));
  expect(playlist.get("playlist")).toBe("8"); expect(playlist.get("sort")).toBe("playlist");
});
test("track labels follow the Artist - Song convention", () => {
  expect(trackLabel({ artist: "Daft Punk", title: "Digital Love" })).toBe("Daft Punk - Digital Love");
  expect(trackLabel({ artist: "Unknown artist", title: "Loose" })).toBe("Loose");
});
test("music queue advances, stops, wraps and shuffles without crossing its scope", () => {
  expect(adjacentMusicTrack([1,2,3],2,1,"off",false)).toBe(3);
  expect(adjacentMusicTrack([1,2,3],3,1,"off",false)).toBeNull();
  expect(adjacentMusicTrack([1,2,3],3,1,"all",false)).toBe(1);
  expect(adjacentMusicTrack([1,2,3],1,-1,"all",false)).toBe(3);
  const random = vi.spyOn(Math,"random").mockReturnValue(.9);
  expect(adjacentMusicTrack([1,2,3],2,1,"off",true)).toBe(3);
  expect(adjacentMusicTrack([],2,1,"all",true)).toBeNull();
  random.mockRestore();
});
