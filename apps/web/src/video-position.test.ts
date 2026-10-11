import { afterEach, beforeEach, expect, test, vi } from "vitest";
const values = vi.hoisted(() => new Map<string, string>());
vi.mock("./vault-session", () => ({ vaultStorage: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
} }));
import { trackVideoPosition } from "./video-position";
const key = "vaultly.video.position.7";
let cleanup: (() => void) | undefined;
let video: HTMLVideoElement;
const events = new EventTarget();
beforeEach(() => {
  values.clear();
  video = Object.assign(new EventTarget(), { currentTime: 0, duration: 120, readyState: 0 }) as unknown as HTMLVideoElement;
  vi.stubGlobal("window", events);
});
afterEach(() => { cleanup?.(); cleanup = undefined; vi.unstubAllGlobals(); });
test("remembering is opt-in; stored positions do not affect playback while disabled", () => {
  values.set(key, "32"); cleanup = trackVideoPosition(video, 7);
  video.dispatchEvent(new Event("loadedmetadata")); expect(video.currentTime).toBe(0);
  video.currentTime = 45; video.dispatchEvent(new Event("pause")); expect(values.get(key)).toBe("32");
});
test("enabled videos resume and save on pause, including a live global preference change", () => {
  values.set("vaultly.video.rememberPosition", "true"); values.set(key, "32");
  cleanup = trackVideoPosition(video, 7); video.dispatchEvent(new Event("loadedmetadata")); expect(video.currentTime).toBe(32);
  video.currentTime = 45; video.dispatchEvent(new Event("pause")); expect(values.get(key)).toBe("45");
  values.set("vaultly.video.rememberPosition", "false"); video.currentTime = 60; video.dispatchEvent(new Event("pause")); expect(values.get(key)).toBe("45");
  values.set("vaultly.video.rememberPosition", "true"); events.dispatchEvent(new Event("vaultly-preferences-changed")); expect(values.get(key)).toBe("60");
});
test("completed and invalid positions start from the beginning; completing playback clears resume", () => {
  values.set("vaultly.video.rememberPosition", "true"); values.set(key, "119");
  cleanup = trackVideoPosition(video, 7); video.dispatchEvent(new Event("loadedmetadata")); expect(video.currentTime).toBe(0);
  video.currentTime = 120; video.dispatchEvent(new Event("ended")); expect(values.has(key)).toBe(false);
});
test("switching src saves the last observed time for the previous item", () => {
  values.set("vaultly.video.rememberPosition", "true");
  cleanup = trackVideoPosition(video, 7); video.dispatchEvent(new Event("loadedmetadata"));
  video.currentTime = 48; video.dispatchEvent(new Event("timeupdate"));
  video.currentTime = 49; video.dispatchEvent(new Event("timeupdate"));
  video.currentTime = 0; cleanup(); cleanup = undefined;
  expect(values.get(key)).toBe("49"); expect(values.has("vaultly.video.position.8")).toBe(false);
});
