import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: any }[], cursor: 0, refCursor: 0,
  effectCursor: 0, effects: [] as { deps: unknown[]; cleanup?: () => void }[], jobs: [] as (() => void)[], fields: {} as Record<string, unknown> }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useContext: () => ({ entry: { breadcrumbs: [], fields: hooks.fields }, current: { current: { fields: hooks.fields } } }),
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
import { TagCombobox } from "./TagCombobox";
import { DeleteMediaDialog } from "./DeleteMediaDialog";
import { ActionMenu } from "./ActionMenu";

const props = { view: "browse" as const, type: "story" as const, search: "", categories: [], tags: [], people: [], sources: [], queuedVideoIds: [], refreshKey: 0,
  onTagCreated: vi.fn(), onCategoryCreated: vi.fn(), onPersonCreated: vi.fn(), onChanged: vi.fn(), onOpen: vi.fn(), onQueueVideo: vi.fn(), onOpenSeries: vi.fn(), onAddSource: vi.fn() };
function render(extra: Partial<Parameters<typeof GalleryView>[0]> = {}) {
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

test("filter dropdowns follow the selected media type and hide sets and circles without matching media", async () => {
  const storyOptions = { tags: [{ id: 1, name: "Story tag" }], categories: [{ id: 2, name: "Story category" }], people: [{ id: 3, name: "Story artist" }] };
  const videoOptions = { tags: [{ id: 4, name: "Video tag" }], categories: [], people: [{ id: 5, name: "Video cast" }] };
  vi.mocked(api).mockImplementation(async (url) => url.startsWith("/api/attributes/filter-options")
    ? url.endsWith("type=story") ? storyOptions : videoOptions
    : url === "/api/series" ? [{ id: 1, title: "Story set", story_count: 1, video_count: 0 }, { id: 2, title: "Video set", story_count: 0, video_count: 1 }, { id: 3, title: "Empty set", story_count: 0, video_count: 0 }]
    : url === "/api/circles" ? [{ id: 1, title: "Story circle", story_count: 1, video_count: 0 }, { id: 2, title: "Video circle", story_count: 0, video_count: 1 }]
    : url.startsWith("/api/items?") ? { items: [], total: 0, pageSize: 48 } : []);
  hooks.fields["gallery.all.browse.selectedType"] = "story";
  hooks.fields["gallery.all.browse.advancedOpen"] = true;
  render({ type: undefined }); await settle();
  let node = render({ type: undefined });
  const combo = (label: string) => find(node, (element) => element.type === TagCombobox && element.props.label.startsWith(label))!;
  expect(combo("Tags").props.options).toEqual(storyOptions.tags);
  expect(combo("Categories").props.options).toEqual(storyOptions.categories);
  expect(combo("Artists").props.options).toEqual(storyOptions.people);
  expect(find(node, (element) => element.type === "option" && element.props.children === "Story set")).toBeDefined();
  expect(find(node, (element) => element.type === "option" && element.props.children === "Video set")).toBeUndefined();
  expect(find(node, (element) => element.type === "option" && element.props.children === "Empty set")).toBeUndefined();
  expect(find(node, (element) => element.type === "option" && element.props.children === "Story circle")).toBeDefined();
  hooks.fields["gallery.all.browse.selectedType"] = "video";
  node = render({ type: undefined });
  expect(combo("Tags").props.options).toEqual([]);
  expect(combo("Tags").props.disabled).toBe(true);
  await settle(); node = render({ type: undefined });
  expect(combo("Tags").props.options).toEqual(videoOptions.tags);
  expect(combo("Cast").props.options).toEqual(videoOptions.people);
  expect(find(node, (element) => element.type === "option" && element.props.children === "Story circle")).toBeUndefined();
  expect(find(node, (element) => element.type === "option" && element.props.children === "Video circle")).toBeDefined();
});

test("a collection-only e-book page renders its cards and paginates by visible cards", async () => {
  vi.mocked(api).mockImplementation(async (url) => url.startsWith("/api/items?")
    ? { items: [], cards: [{ kind: "series", id: 1 }, { kind: "series", id: 2 }], total: 2, mediaTotal: 120, pageSize: 48, page: 0 }
    : url === "/api/series" ? [{ id: 1, title: "First" }, { id: 2, title: "Second" }] : []);
  render(); await settle(); const node = render();
  expect(find(node, (element) => element.props.className === "media-grid")!.props.children).toHaveLength(2);
  expect(find(node, (element) => element.type === "button" && element.props.children === "Next")).toBeUndefined();
  expect(find(node, (element) => element.props.className === "result-count")!.props.children).toBe("2 cards · 120 items");
  expect(vi.mocked(api).mock.calls.some(([url]) => url.startsWith("/api/items?") && new URLSearchParams(url.split("?")[1]).get("groupSeries") === "1")).toBe(true);
});

test("pagination controls appear only when results span several pages", async () => {
  vi.mocked(api).mockImplementation(async (url) => url.startsWith("/api/items?")
    ? { items: [{ id: 7, title: "An item", media_type: "story", tags: [], categories: [], cast: [], artists: [] }], total: 100, pageSize: 48, page: 0 } : []);
  render(); await settle(); const node = render();
  expect(find(node, (element) => element.type === "button" && element.props.children === "Next")!.props.disabled).toBe(false);
});

test("gallery layout can be switched and is saved in the current gallery navigation state", async () => {
  vi.mocked(api).mockImplementation(async (url) => url.startsWith("/api/items?")
    ? { items: [{ id: 7, title: "An item", media_type: "story", tags: [], categories: [], cast: [], artists: [] }], total: 1, pageSize: 48 } : []);
  render(); await settle();
  let node = render();
  const toggle = find(node, (element) => element.props["aria-label"] === "List view")!;
  toggle.props.onClick();
  node = render();
  expect(hooks.fields["gallery.story.browse.layout"]).toBe("list");
  expect(find(node, (element) => element.props.className === "media-grid media-grid-list")).toBeDefined();
  expect(find(node, (element) => element.props["aria-label"] === "List view")!.props["aria-pressed"]).toBe(true);
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

test("media card menus open deletion confirmation and refresh after deletion", async () => {
  vi.mocked(api).mockImplementation(async (url) => url.startsWith("/api/items?")
    ? { items: [{ id: 7, title: "Delete me", media_type: "story", tags: [], categories: [], cast: [], artists: [] }], total: 1, pageSize: 48, page: 0 } : []);
  const onDeleted = vi.fn();
  props.onChanged.mockClear();
  render({ onDeleted }); await settle();
  let node = render({ onDeleted });
  const card = find(node, (element) => element.props.className === "media-grid")!.props.children[0];
  const menu = find(card.type(card.props), (element) => element.type === ActionMenu)!;
  const action = menu.props.actions.find((action: { danger?: boolean }) => action.danger);
  expect(action.label).toBe("Delete permanently…");
  action.onSelect();
  node = render({ onDeleted });
  const dialog = find(node, (element) => element.type === DeleteMediaDialog)!;
  expect(dialog.props.itemIds).toEqual([7]);
  expect(dialog.props.title).toBe("Delete me");
  dialog.props.onDeleted([7]);
  expect(onDeleted).toHaveBeenCalledWith([7]);
  expect(props.onChanged).toHaveBeenCalledOnce();
});

test("text and sorting stay primary while advanced attribute filters retain their selections when collapsed", async () => {
  vi.mocked(api).mockImplementation(async (url) => url.startsWith("/api/items?") ? { items: [], total: 0, pageSize: 48 } : []);
  const onSearchChange = vi.fn();
  let node = render({ onSearchChange });
  const textFilter = find(node, (element) => element.props["aria-label"] === "Filter media text")!;
  textFilter.props.onChange({ target: { value: "night" } });
  expect(onSearchChange).toHaveBeenCalledWith("night");
  expect(find(node, (element) => element.props["aria-label"] === "Sort media")).toBeDefined();
  expect(find(node, (element) => element.type === TagCombobox)).toBeUndefined();
  expect(find(node, (element) => element.props["aria-label"] === "File name contains")).toBeUndefined();
  const toggle = () => find(node, (element) => element.type === "button" && element.props["aria-controls"] === "media-advanced-filters")!;
  expect(toggle().props["aria-expanded"]).toBe(false);
  toggle().props.onClick(); node = render({ onSearchChange });
  find(node, (element) => element.type === TagCombobox && element.props.attributeKind === "category")!.props.onChange([27]);
  node = render({ onSearchChange });
  toggle().props.onClick(); node = render({ onSearchChange });
  expect(find(node, (element) => element.type === TagCombobox)).toBeUndefined();
  expect(hooks.fields["gallery.story.browse.selectedCategoryIds"]).toEqual([27]);
  toggle().props.onClick(); node = render({ onSearchChange });
  expect(find(node, (element) => element.type === TagCombobox && element.props.attributeKind === "category")!.props.selectedIds).toEqual([27]);
});
