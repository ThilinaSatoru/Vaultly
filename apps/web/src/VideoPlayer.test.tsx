import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

const { video, hooks } = vi.hoisted(() => ({
  video: { currentTime: 42, pause: vi.fn(), querySelector: vi.fn(), focus: vi.fn() },
  hooks: { states: [] as unknown[], cursor: 0, refs: [] as Array<{ current: unknown }>, refCursor: 0 },
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.states[index], (value: unknown) => { hooks.states[index] = typeof value === "function" ? value(hooks.states[index]) : value; }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.refCursor++;
    return hooks.refs[index] ??= { current: index < 2 ? video : initial };
  },
  useEffect: vi.fn(),
}));
vi.mock("./media", () => ({ api: vi.fn() }));
vi.mock("./preferences", () => ({ readNumberPreference: (_key: string, fallback: number) => fallback, readBooleanPreference: (_key: string, fallback: boolean) => fallback, writePreference: vi.fn(), matchesShortcut: () => false }));
import { writePreference } from "./preferences";
import { api } from "./media";
import { VideoPlayer } from "./VideoPlayer";
import { Select } from "./Select";

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
  hooks.cursor = 0; hooks.refCursor = 0;
  return VideoPlayer({ itemId: 1, src: "/api/items/1/file", autoPlay: true, onError: vi.fn() });
}
beforeEach(() => {
  vi.clearAllMocks(); hooks.states = []; hooks.refs = [];
  video.querySelector.mockReset();
  vi.stubGlobal("window", { localStorage: { getItem: () => null } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

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


test("track switchers are directly on the toolbar and subtitle size persists from the menu", () => {
  const view = render();
  const toolbar = find(view, (node) => node.props.className === "video-controls-row");
  expect(find(toolbar, (node) => node.props["aria-label"] === "Audio track").type).toBe(Select);
  const subtitles = find(toolbar, (node) => node.props["aria-label"] === "Subtitles");
  expect(subtitles.type).toBe(Select);
  subtitles.props.onChange({ target: { value: "-1" } });
  expect(writePreference).not.toHaveBeenCalled();
  find(view, (node) => node.props["aria-label"] === "Player options").props.onClick();
  const menu = find(render(), (node) => node.props.className === "video-options");
  expect(() => find(menu, (node) => node.props["aria-label"] === "Subtitles")).toThrow();
  const size = find(menu, (node) => node.props["aria-label"] === "Subtitle size");
  size.props.onChange({ target: { value: "150" } });
  expect(writePreference).toHaveBeenCalledWith("vaultly.video.subtitleSize", 150);
  expect(render().props.style["--subtitle-scale"]).toBe(1.5);
});


test.each([false, true])("controls hide after mouse inactivity even with focused controls (fullscreen=%s)", (fullscreen) => {
  vi.useFakeTimers();
  window.setTimeout = globalThis.setTimeout as typeof window.setTimeout;
  window.clearTimeout = globalThis.clearTimeout as typeof window.clearTimeout;
  vi.stubGlobal("document", { activeElement: {}, fullscreenElement: fullscreen ? video : null });
  video.querySelector.mockImplementation((selector) => selector === ".video-controls" ? { contains: () => true } : null);
  render().props.onMouseMove();
  expect(render().props.className).toContain("controls-visible");
  vi.advanceTimersByTime(1400);
  render().props.onMouseMove();
  vi.advanceTimersByTime(1400);
  expect(render().props.className).toContain("controls-visible");
  vi.advanceTimersByTime(100);
  expect(render().props.className).toContain("controls-hidden");
  const indicator = find(render(), (node) => node.props.className === "video-idle-progress");
  expect(indicator.props["aria-hidden"]).toBe("true");
  expect(find(render(), (node) => node.props.className === "video-controls").props.inert).toBe(true);
  expect(video.focus).toHaveBeenCalled();
});

test("shortcut help keeps controls visible until the guide closes", () => {
  vi.useFakeTimers();
  window.setTimeout = globalThis.setTimeout as typeof window.setTimeout;
  window.clearTimeout = globalThis.clearTimeout as typeof window.clearTimeout;
  vi.stubGlobal("document", { activeElement: {}, fullscreenElement: null });
  let helpOpen = true;
  video.querySelector.mockImplementation((selector) => selector === ".shortcut-help-popover" && helpOpen ? {} : null);
  render().props.onMouseMove();
  vi.advanceTimersByTime(4500);
  expect(render().props.className).toContain("controls-visible");
  render().props.onMouseLeave();
  expect(render().props.className).toContain("controls-visible");
  helpOpen = false;
  vi.advanceTimersByTime(1500);
  expect(render().props.className).toContain("controls-hidden");
});
