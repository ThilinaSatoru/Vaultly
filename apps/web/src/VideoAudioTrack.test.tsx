import { afterEach, beforeEach, expect, test, vi } from "vitest";
const hooks = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)>, audio: null as unknown }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useRef: () => ({ current: hooks.audio }),
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
}));
import { VideoAudioTrack } from "./VideoAudioTrack";

function media(paused: boolean) {
  const listeners = new Map<string, () => void>();
  const element = {
    paused, readyState: 3, currentTime: 42, volume: 1, muted: false, playbackRate: 1,
    addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
    play: vi.fn(async () => { element.paused = false; listeners.get("play")?.(); }),
    pause: vi.fn(() => { element.paused = true; listeners.get("pause")?.(); }),
  };
  return { element, emit: (name: string) => listeners.get(name)?.(), listeners };
}
let cleanup: Array<() => void> = [];
beforeEach(() => { hooks.effects = []; cleanup = []; });
afterEach(() => cleanup.forEach((dispose) => dispose()));
function mount() {
  const video = media(false), audio = media(true), wantsPlayback = { current: true };
  audio.element.currentTime = 0;
  hooks.audio = audio.element;
  const loading = vi.fn(), error = vi.fn();
  VideoAudioTrack({ src: "/audio/2", videoRef: { current: video.element as unknown as HTMLVideoElement }, wantsPlayback, volume: .4, muted: false, rate: 1.5, onError: error, onLoading: loading });
  for (const effect of hooks.effects) { const dispose = effect(); if (dispose) cleanup.push(dispose); }
  return { video, audio, wantsPlayback, loading, error };
}

test("alternate audio preserves the seek position and follows play, pause, rate and volume", () => {
  const { video, audio, loading } = mount();
  expect(video.element.paused).toBe(true);
  expect(loading).toHaveBeenLastCalledWith(true);
  audio.emit("canplay"); audio.emit("seeked");
  expect(video.element.paused).toBe(false);
  expect(audio.element).toMatchObject({ currentTime: 42, paused: false, volume: .4, playbackRate: 1.5 });
  video.element.currentTime = 120; video.emit("seeking");
  expect(audio.element.currentTime).toBe(120);
  video.element.pause(); expect(audio.element.paused).toBe(true);
  video.element.play(); expect(audio.element.paused).toBe(false);
  audio.element.currentTime = 119; video.emit("timeupdate");
  expect(audio.element.currentTime).toBe(120);
});

test("a pause request during audio preparation prevents automatic resume", () => {
  const { video, audio, wantsPlayback } = mount();
  wantsPlayback.current = false;
  audio.emit("canplay"); audio.emit("seeked");
  expect(video.element.paused).toBe(true);
  expect(audio.element.paused).toBe(true);
});

test("closing a loading player removes listeners without starting detached playback", () => {
  const { video, audio } = mount();
  cleanup.forEach((dispose) => dispose()); cleanup = [];
  expect(video.element.play).not.toHaveBeenCalled();
  expect(audio.element.paused).toBe(true);
  expect(video.listeners.size).toBe(0);
  expect(audio.listeners.size).toBe(0);
});
