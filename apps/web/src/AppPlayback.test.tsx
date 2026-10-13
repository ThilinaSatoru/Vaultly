import { beforeEach, expect, test, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

const state = vi.hoisted(() => ({ fields: {} as Record<string, unknown>, states: [] as unknown[], cursor: 0 }));
const nav = vi.hoisted(() => ({
  get current() { return { current: { fields: state.fields } }; },
  entry: { fields: state.fields, breadcrumbs: [], id: "page" },
  update: (fields: Record<string, unknown>) => { Object.assign(state.fields, fields); },
  push: (fields: Record<string, unknown>) => { Object.assign(state.fields, fields); },
  reset: (fields: Record<string, unknown>) => { state.fields = fields; nav.entry.fields = fields; },
  goTo: vi.fn(), back: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = state.cursor++;
    if (!(index in state.states)) state.states[index] = typeof initial === "function" ? initial() : initial;
    return [state.states[index], (value: unknown) => { state.states[index] = typeof value === "function" ? value(state.states[index]) : value; }];
  },
  useContext: () => nav,
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: vi.fn(),
  useCallback: (callback: unknown) => callback,
  useMemo: (factory: () => unknown) => factory(),
}));
vi.mock("./navigation", async (original) => ({
  ...await original<typeof import("./navigation")>(),
  useNavigation: () => nav,
  useNavigationField: (key: string, fallback: unknown) => [key in state.fields ? state.fields[key] : fallback, (value: unknown) => { state.fields[key] = typeof value === "function" ? value(state.fields[key] ?? fallback) : value; }],
}));
import { App } from "./App";
import { MediaViewer } from "./MediaViewer";
import { ManagementDrawer } from "./ManagementDrawer";
function viewers(node: ReactNode): ReactElement<any>[] {
  if (isValidElement<any>(node)) return node.type === MediaViewer ? [node] : viewers(node.props.children);
  return Array.isArray(node) ? node.flatMap(viewers) : [];
}
function render() {
  state.cursor = 0;
  const app = App({ profiles: { activeId: "default", profiles: [{ id: "default", name: "Default" }] } });
  const child = app.props.children as ReactElement<any>;
  return viewers((child.type as (props: any) => ReactNode)(child.props));
}
beforeEach(() => { state.states = []; state.fields = {}; nav.entry.fields = state.fields; });
test("opening people management defaults to the current library and updates on reopening", () => {
  const findDrawer = (node: ReactNode): ReactElement<any> | undefined => {
    if (isValidElement<any>(node)) return node.type === ManagementDrawer ? node : findDrawer(node.props.children);
    if (Array.isArray(node)) for (const child of node) { const found = findDrawer(child); if (found) return found; }
  };
  const drawer = () => {
    state.cursor = 0;
    const app = App({ profiles: { activeId: "default", profiles: [{ id: "default", name: "Default" }] } });
    const child = app.props.children as ReactElement<any>;
    return findDrawer((child.type as (props: any) => ReactNode)(child.props))!;
  };
  for (const [section, expected] of [["video", "cast"], ["comic", "artist"], ["story", "artist"], ["all", "all"]]) {
    nav.reset({ section });
    drawer().props.onOpen("people");
    expect(drawer().props.panels.people.props.creditFilterRequest.filter).toBe(expected);
  }
  nav.reset({ section: "all", "gallery.all.browse.selectedType": "video" });
  drawer().props.onOpen("people");
  expect(drawer().props.panels.people.props.creditFilterRequest.filter).toBe("cast");
});
test("floating playback and its playlist survive back navigation, library navigation, and opening another file until manually closed", () => {
  const gallery = { page: 0, videos: [{ id: 10, title: "Episode 1" }, { id: 11, title: "Episode 2" }] };
  nav.update({ selectedItemId: 10, viewerGalleryContext: gallery });
  render()[0].props.onToggleFloating();
  expect(render()[0].props.floating).toBe(true);
  // A popstate restores the gallery; it clears the viewer in navigation history.
  nav.reset({ section: "video", selectedItemId: null, viewerGalleryContext: null });
  expect(render()[0].props).toMatchObject({ itemId: 10, floating: true, galleryContext: gallery });
  nav.reset({ section: "story" });
  expect(render()[0].props.itemId).toBe(10);
  nav.push({ selectedItemId: 20 });
  expect(render().map((viewer) => [viewer.props.itemId, viewer.props.floating])).toEqual([[10, true], [20, false]]);
  render()[1].props.onClose();
  expect(render()).toHaveLength(1);
  render()[0].props.onClose();
  expect(render()).toHaveLength(0);
});
test("floating next-item actions keep the browsing page and full view restores the current episode", () => {
  nav.update({ selectedItemId: 10 }); render()[0].props.onToggleFloating();
  nav.reset({ section: "comic" });
  render()[0].props.onNavigateItem(11);
  expect(state.fields.selectedItemId).toBeUndefined();
  expect(render()[0].props.itemId).toBe(11);
  render()[0].props.onToggleFloating();
  expect(render()[0].props).toMatchObject({ itemId: 11, floating: false });
});

test("floating next and playlist navigation never reopen the original file", () => {
  nav.update({ selectedItemId: 10 });
  render()[0].props.onToggleFloating();
  expect(state.fields.selectedItemId).toBeNull();
  render()[0].props.onNavigateItem(11);
  expect(render().map((viewer) => [viewer.props.itemId, viewer.props.floating])).toEqual([[11, true]]);
  render()[0].props.onNavigatePlaylistItem(12);
  expect(render().map((viewer) => [viewer.props.itemId, viewer.props.floating])).toEqual([[12, true]]);
  render()[0].props.onClose();
  expect(render()).toHaveLength(0);
});

test("floating a second normal viewer clears its navigation selection", () => {
  nav.update({ selectedItemId: 10 });
  render()[0].props.onToggleFloating();
  nav.push({ selectedItemId: 20 });
  render()[1].props.onToggleFloating();
  render()[0].props.onNavigateItem(21);
  expect(render().map((viewer) => [viewer.props.itemId, viewer.props.floating])).toEqual([[21, true]]);
});
