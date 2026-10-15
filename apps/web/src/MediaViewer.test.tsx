import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

const hooks = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0, jobs: [] as Array<() => void> }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.states[index], (value: unknown) => { hooks.states[index] = typeof value === "function" ? value(hooks.states[index]) : value; }];
  },
  useRef: (initial: unknown) => ({ current: initial }), useContext: () => null,
  useEffect: (effect: () => void, deps: unknown[]) => { if (deps?.[0] === "vaultly.video.sidebarVisible") hooks.jobs.push(effect); },
  useLayoutEffect: vi.fn(),
}));
import { MediaViewer } from "./MediaViewer";
import { VideoPlayer } from "./VideoPlayer";
import { readLastPlayed } from "./last-played";
import { setActiveProfile, vaultStorage } from "./vault-session";

const item = { id: 3, title: "Episode 3", media_type: "video", source_name: "Shows", size_bytes: 42, tags: [], categories: [], cast: [], artists: [] };
const props = { itemId: 3, seriesContext: { seriesId: 5, seriesTitle: "Show", items: [{ id: 3, title: item.title }] }, galleryContext: null,
  playlist: [], floating: false, categories: [], tags: [], people: [], onClose: vi.fn(), onChanged: vi.fn(), onToggleFloating: vi.fn(),
  onRemoveFromPlaylist: vi.fn(), onClearPlaylist: vi.fn(), onNavigateItem: vi.fn(), onNavigatePlaylistItem: vi.fn(), onCategoryCreated: vi.fn(), onTagCreated: vi.fn(), onPersonCreated: vi.fn(), onOpenSeries: vi.fn() };
function find(node: ReactNode, predicate: (node: ReactElement<any>) => boolean): ReactElement<any> | undefined {
  if (isValidElement<any>(node)) return predicate(node) ? node : find(node.props.children, predicate);
  if (Array.isArray(node)) for (const child of node) { const found = find(child, predicate); if (found) return found; }
}
function render() {
  hooks.cursor = 0;
  const view = MediaViewer(props);
  hooks.jobs.splice(0).forEach((job) => job());
  return view;
}
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }, history: { state: null, replaceState: vi.fn() }, dispatchEvent: vi.fn() });
  setActiveProfile({ id: "default", name: "Default" });
  hooks.states = [item]; hooks.jobs = [];
});
afterEach(() => vi.unstubAllGlobals());

test("full player side panel can be hidden and the choice survives reopening", () => {
  const initial = render();
  find(initial, (node) => node.props["aria-label"] === "Hide side panel")!.props.onClick();
  expect(find(render(), (node) => node.type === "section")!.props.className).toContain("viewer-sidebar-hidden");
  expect(vaultStorage.getItem("vaultly.video.sidebarVisible")).toBe("false");
  hooks.states = [item];
  expect(find(render(), (node) => node.props["aria-label"] === "Show side panel")!.props["aria-expanded"]).toBe(false);
});

test("only actual video playback records the series and episode", () => {
  vaultStorage.setItem("vaultly.video.rememberLastPlayed", "true");
  const player = find(render(), (node) => node.type === VideoPlayer)!;
  expect(readLastPlayed()).toBeNull();
  player.props.onPlaybackStarted();
  expect(readLastPlayed()).toEqual({ itemId: 3, title: "Episode 3", seriesId: 5, seriesTitle: "Show" });
});
