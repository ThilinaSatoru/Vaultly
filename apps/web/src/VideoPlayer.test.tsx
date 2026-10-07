import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

const { video, hooks } = vi.hoisted(() => ({
  video: { currentTime: 42, pause: vi.fn() },
  hooks: { states: [] as unknown[], cursor: 0 },
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.states[index], (value: unknown) => { hooks.states[index] = typeof value === "function" ? value(hooks.states[index]) : value; }];
  },
  useRef: (initial: unknown) => ({ current: initial === null ? video : initial }),
  useEffect: vi.fn(),
}));
vi.mock("./media", () => ({ api: vi.fn() }));
vi.mock("./preferences", () => ({ readNumberPreference: (_key: string, fallback: number) => fallback, matchesShortcut: () => false }));
import { api } from "./media";
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
function render() {
  hooks.cursor = 0;
  return VideoPlayer({ itemId: 1, src: "/api/items/1/file", autoPlay: true, onError: vi.fn() });
}
beforeEach(() => {
  vi.clearAllMocks(); hooks.states = [];
  vi.stubGlobal("window", { localStorage: { getItem: () => null } });
});
afterEach(() => { vi.unstubAllGlobals(); });

test("unsupported video and audio-only decoding show a launch action without converting or opening anything automatically", () => {
  const element = find(render(), (node) => node.type === "video");
  expect(element.props.src).toBe("/api/items/1/file");
  element.props.onLoadedMetadata({ currentTarget: { videoWidth: 0 } });
  const fallback = find(render(), (node) => node.props.className === "video-external-fallback");
  expect(find(fallback, (node) => node.type === "button").props.children).toContain("Open in default player");
  expect(vi.mocked(api)).not.toHaveBeenCalled();
  expect(video.pause).toHaveBeenCalledOnce();
  expect(find(render(), (node) => node.type === "video").props.autoPlay).toBe(false);
});

test("explicit player actions open the original item and report launch errors", async () => {
  vi.mocked(api).mockResolvedValueOnce(undefined);
  const view = render();
  const open = find(view, (node) => node.props["aria-label"] === "Open in default player");
  open.props.onClick();
  await Promise.resolve();
  expect(api).toHaveBeenCalledWith("/api/items/1/open", { method: "POST" });
  expect(find(render(), (node) => node.props.className === "video-launch-status").props.children).toBe("Opened in your default player.");
  vi.mocked(api).mockRejectedValueOnce(new Error("No video player is assigned"));
  open.props.onClick();
  await Promise.resolve();
  expect(find(render(), (node) => node.props.className === "video-launch-status").props.children).toBe("No video player is assigned");
});

test("a native playback error offers the original download and default player", () => {
  find(render(), (node) => node.type === "video").props.onError();
  const fallback = find(render(), (node) => node.props.className === "video-external-fallback");
  expect(find(fallback, (node) => node.type === "a").props.href).toBe("/api/items/1/file");
  expect(api).not.toHaveBeenCalled();
});
