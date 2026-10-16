import { expect, test, vi } from "vitest";
import { adjacentMusicTrack, musicQuery } from "./music";

test("music text search can cross artist and playlist scopes while retaining advanced filters", () => {
  const scope = { kind: "artist" as const, id: 42, name: "Artist" };
  const filters = { rating: 4, codec: "flac", source: "2", sort: "rating" };
  const global = new URLSearchParams(musicQuery(scope,"night",true,filters));
  expect(global.has("artist")).toBe(false);
  expect(global.get("q")).toBe("night"); expect(global.get("rating")).toBe("4"); expect(global.get("codec")).toBe("flac");
  expect(new URLSearchParams(musicQuery(scope,"night",false,filters)).get("artist")).toBe("42");
  expect(new URLSearchParams(musicQuery(scope,"",true,filters)).get("artist")).toBe("42");
  expect(new URLSearchParams(musicQuery({ kind: "playlist", id: 8, name: "Mix" },"",true,filters)).get("playlist")).toBe("8");
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
