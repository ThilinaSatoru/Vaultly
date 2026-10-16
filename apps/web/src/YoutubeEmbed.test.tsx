import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
const state = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, refs: [] as Array<{ current: unknown }>, refCursor: 0, effects: [] as Array<() => void | (() => void)> }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const index = state.cursor++; if (!(index in state.values)) state.values[index] = initial; return [state.values[index], (value: unknown) => { state.values[index] = value; }]; },
  useRef: () => { const index = state.refCursor++; return state.refs[index] ??= { current: index === 0 ? { replaceChildren: vi.fn() } : null }; },
  useEffect: (effect: () => void | (() => void)) => state.effects.push(effect),
}));
const controls = vi.hoisted(() => ({ volume: null as ((value: number) => void) | null, unsubscribe: vi.fn() }));
vi.mock("./audio-output", () => ({ registerExternalVolume: (listener: (value: number) => void) => { controls.volume = listener; listener(.4); return controls.unsubscribe; } }));
import { YoutubeEmbed } from "./YoutubeLibrary";
let options: any;
const player = { destroy: vi.fn(), pauseVideo: vi.fn(), setVolume: vi.fn(), loadPlaylist: vi.fn(), getVideoUrl: vi.fn(() => "https://www.youtube.com/watch?v=lmnopqrstuv") };
beforeEach(() => {
  vi.clearAllMocks(); state.values = []; state.cursor = 0; state.refs = []; state.refCursor = 0; state.effects = [];
  const scope = new EventTarget();
  Object.assign(scope, { YT: { Player: class { constructor(_target: unknown, input: unknown) { options = input; return player; } } } });
  vi.stubGlobal("window", scope); vi.stubGlobal("location", { origin: "http://127.0.0.1:4419" }); vi.stubGlobal("document", { createElement: vi.fn(() => ({})) });
});
afterEach(() => vi.unstubAllGlobals());
function find(node: ReactNode, predicate: (element: ReactElement<any>) => boolean): ReactElement<any> | undefined {
  if (isValidElement<any>(node)) return predicate(node) ? node : find(node.props.children, predicate);
  if (Array.isArray(node)) for (const child of node) { const result = find(child, predicate); if (result) return result; }
}
const playback = { key: 1, name: "Local", videos: ["abcdefghijk", "lmnopqrstuv"], index: 1 };
test("local playlist embeds start with a real video ID and queue the array using the supported API", async () => {
  YoutubeEmbed({ playback }); const cleanup = state.effects[0]!(); await Promise.resolve();
  expect(options.videoId).toBe("lmnopqrstuv"); expect(options.playerVars.origin).toBe(location.origin);
  options.events.onReady();
  expect(player.loadPlaylist).toHaveBeenCalledWith(playback.videos, 1, 0);
  expect(player.setVolume).toHaveBeenLastCalledWith(40);
  controls.volume?.(0); expect(player.setVolume).toHaveBeenLastCalledWith(0);
  options.events.onStateChange({ data: 1 }); expect(player.pauseVideo).not.toHaveBeenCalled();
  window.dispatchEvent(new CustomEvent("vaultly-playback-start", { detail: "music" })); expect(player.pauseVideo).toHaveBeenCalledOnce();
  if (cleanup) cleanup(); expect(player.destroy).toHaveBeenCalledOnce(); expect(controls.unsubscribe).toHaveBeenCalledOnce();
});
test("saved playlists use the playlist ID and restricted items link to the current video", async () => {
  const saved = { key: 2, name: "Remote", remoteId: "PLabcdefghijklmn" };
  YoutubeEmbed({ playback: saved }); const cleanup = state.effects[0]!(); await Promise.resolve(); options.events.onReady();
  expect(options.playerVars.list).toBe(saved.remoteId);
  expect(player.loadPlaylist).toHaveBeenCalledWith({ listType: "playlist", list: saved.remoteId });
  options.events.onError({ data: 150 }); state.cursor = 0; state.refCursor = 0;
  const view = YoutubeEmbed({ playback: saved });
  expect(find(view, (element) => element.type === "a")!.props.href).toBe("https://www.youtube.com/watch?v=lmnopqrstuv");
  expect(find(view, (element) => element.props.role === "alert")).toBeDefined();
  if (cleanup) cleanup();
});
