import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

const { video, playback } = vi.hoisted(() => ({
  video: { currentTime: 42, pause: vi.fn() },
  playback: { src: "/api/items/1/file", preparing: false, queued: false, percent: 0, error: "", compatible: false, fallback: vi.fn(), retry: vi.fn() },
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, vi.fn()],
  useRef: (initial: unknown) => ({ current: initial === null ? video : initial }),
  useEffect: vi.fn(),
}));
vi.mock("./useVideoPlayback", () => ({ useVideoPlayback: () => playback }));
vi.mock("./preferences", () => ({ readNumberPreference: (_key: string, fallback: number) => fallback, matchesShortcut: () => false }));
import { VideoPlayer } from "./VideoPlayer";

function find(node: ReactNode, predicate: (element: ReactElement<any>) => boolean): ReactElement<any> {
  if (isValidElement<any>(node)) {
    if (predicate(node)) return node;
    return find((node.props as { children?: ReactNode }).children, predicate);
  }
  if (Array.isArray(node)) for (const child of node) {
    try { return find(child, predicate); } catch { /* Check the next sibling. */ }
  }
  throw new Error("Control not found");
}
beforeEach(() => {
  vi.clearAllMocks(); playback.compatible = false;
  vi.stubGlobal("window", { localStorage: { getItem: () => null } });
});
afterEach(() => { vi.unstubAllGlobals(); });

test("native errors and audio-only decoding automatically request compatible playback", () => {
  const onError = vi.fn();
  const view = VideoPlayer({ itemId: 1, fileExtension: "mp4", src: playback.src, autoPlay: true, onError });
  const element = find(view, (node) => node.type === "video");
  element.props.onLoadedMetadata({ currentTarget: { videoWidth: 320 } });
  expect(playback.fallback).not.toHaveBeenCalled();
  element.props.onLoadedMetadata({ currentTarget: { videoWidth: 0 } });
  expect(playback.fallback).toHaveBeenCalledOnce();
  expect(video.pause).toHaveBeenCalledOnce();
  expect(onError).toHaveBeenCalledWith("");
  element.props.onError();
  expect(playback.fallback).toHaveBeenCalledTimes(2);
});

test("manual compatibility mode handles missing audio, and a failed compatible stream does not retry endlessly", () => {
  const onError = vi.fn();
  const view = VideoPlayer({ itemId: 1, src: playback.src, autoPlay: false, onError });
  find(view, (node) => node.props["aria-label"] === "Use compatibility mode").props.onClick();
  expect(playback.fallback).toHaveBeenCalledOnce();
  playback.compatible = true;
  const compatible = VideoPlayer({ itemId: 1, src: playback.src, autoPlay: false, onError });
  find(compatible, (node) => node.type === "video").props.onError();
  expect(playback.fallback).toHaveBeenCalledOnce();
  expect(onError).toHaveBeenLastCalledWith("This video could not be played. Try downloading the original file.");
});
