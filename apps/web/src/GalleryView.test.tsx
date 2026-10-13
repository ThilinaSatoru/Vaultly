import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: any }[], cursor: 0, refCursor: 0,
  effectCursor: 0, effects: [] as { deps: unknown[]; cleanup?: () => void }[], jobs: [] as (() => void)[], fields: {} as Record<string, unknown> }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useContext: () => ({ entry: { breadcrumbs: [] }, current: { current: { fields: hooks.fields } } }),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.states[index], (value: unknown) => { hooks.states[index] = typeof value === "function" ? value(hooks.states[index]) : value; }];
  },
  useRef: (initial: unknown) => hooks.refs[hooks.refCursor++] ??= { current: initial },
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    const index = hooks.effectCursor++;
    const previous = hooks.effects[index];
    if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
    hooks.jobs.push(() => { previous?.cleanup?.(); hooks.effects[index] = { deps, cleanup: effect() }; });
  },
}));
vi.mock("./navigation", () => ({
  NavigationContext: {},
  useNavigationField: (key: string, fallback: unknown) => {
    if (!(key in hooks.fields)) hooks.fields[key] = fallback;
    return [hooks.fields[key], (value: unknown) => { hooks.fields[key] = typeof value === "function" ? value(hooks.fields[key]) : value; }];
  },
}));
vi.mock("./media", async (original) => ({ ...await original<typeof import("./media")>(), api: vi.fn() }));
import { api, type SeriesSummary } from "./media";
import { GalleryView } from "./GalleryView";

const props = { view: "browse" as const, type: "story" as const, search: "", categories: [], tags: [], people: [], sources: [], queuedVideoIds: [], refreshKey: 0,
  onTagCreated: vi.fn(), onCategoryCreated: vi.fn(), onPersonCreated: vi.fn(), onChanged: vi.fn(), onOpen: vi.fn(), onQueueVideo: vi.fn(), onOpenSeries: vi.fn(), onAddSource: vi.fn() };
function render(extra: { view?: "browse" | "favorites" } = {}) {
  hooks.cursor = 0; hooks.refCursor = 0; hooks.effectCursor = 0;
  const node = GalleryView({ ...props, ...extra });
  hooks.jobs.splice(0).forEach((job) => job());
  return node;
}
function find(node: ReactNode, predicate: (element: ReactElement<any>) => boolean): ReactElement<any> | undefined {
  if (isValidElement<any>(node)) return predicate(node) ? node : find(node.props.children, predicate);
  if (Array.isArray(node)) for (const child of node) { const match = find(child, predicate); if (match) return match; }
}
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
beforeEach(() => {
  hooks.states = []; hooks.refs = []; hooks.fields = {}; hooks.effects = []; hooks.jobs = [];
  vi.mocked(api).mockReset();
  vi.stubGlobal("window", { setTimeout: vi.fn(), clearTimeout: vi.fn() });
});
afterEach(() => { hooks.effects.forEach((effect) => effect.cleanup?.()); vi.unstubAllGlobals(); });

test("a collection-only e-book page renders its cards and paginates by visible cards", async () => {
  vi.mocked(api).mockImplementation(async (url) => url.startsWith("/api/items?")
    ? { items: [], cards: [{ kind: "series", id: 1 }, { kind: "series", id: 2 }], total: 2, mediaTotal: 120, pageSize: 48, page: 0 }
    : url === "/api/series" ? [{ id: 1, title: "First" }, { id: 2, title: "Second" }] : []);
  render(); await settle(); const node = render();
  expect(find(node, (element) => element.props.className === "media-grid")!.props.children).toHaveLength(2);
  expect(find(node, (element) => element.type === "button" && element.props.children === "Next")!.props.disabled).toBe(true);
  expect(find(node, (element) => element.props.className === "result-count")!.props.children).toBe("2 cards · 120 items");
  expect(vi.mocked(api).mock.calls.some(([url]) => url.startsWith("/api/items?") && new URLSearchParams(url.split("?")[1]).get("groupSeries") === "1")).toBe(true);
});

test("the grid waits for collection details instead of showing a temporarily sparse page", async () => {
  let resolveSeries!: (series: SeriesSummary[]) => void;
  const series = new Promise<SeriesSummary[]>((resolve) => { resolveSeries = resolve; });
  vi.mocked(api).mockImplementation((url) => url === "/api/series" ? series : Promise.resolve(url.startsWith("/api/items?")
    ? { items: [], cards: [{ kind: "series", id: 1 }], total: 1, mediaTotal: 50, pageSize: 48, page: 0 } : []));
  render(); await settle();
  expect(find(render(), (element) => element.props.className === "media-grid")).toBeUndefined();
  expect(find(render(), (element) => element.props.className === "loading-state")).toBeDefined();
  resolveSeries([{ id: 1, title: "Loaded collection" } as SeriesSummary]);
  await settle();
  expect(find(render(), (element) => element.props.className === "media-grid")!.props.children).toHaveLength(1);
});

test("removing a standalone favorite updates both the card count and media count", async () => {
  vi.mocked(api).mockImplementation(async (url) => url.startsWith("/api/items?")
    ? { items: [{ id: 7, favorite: 1 }], cards: [{ kind: "item", id: 7 }], total: 1, mediaTotal: 1, pageSize: 48, page: 0 } : []);
  render({ view: "favorites" }); await settle();
  const node = render({ view: "favorites" });
  await find(node, (element) => element.props.className === "media-grid")!.props.children[0].props.onFavorite();
  expect(find(render({ view: "favorites" }), (element) => element.props.className === "result-count")!.props.children).toBe("0 cards · 0 items");
});
