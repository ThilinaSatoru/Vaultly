import { afterEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ effects: [] as Array<() => unknown>, context: null as unknown }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, vi.fn()],
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: (effect: () => unknown) => { hooks.effects.push(effect); },
  useLayoutEffect: (effect: () => unknown) => { hooks.effects.push(effect); },
  useContext: () => hooks.context,
}));
import { persistNavigation, restoredNavigation, useNavigation, useNavigationField } from "./navigation";
import { exportVaultPreferences, restoreVaultPreferences, setActiveProfile } from "./vault-session";

function setup(savedScroll?: number) {
  vi.useFakeTimers();
  hooks.effects = [];
  const listeners = new Map<string, (event: { state: unknown }) => void>();
  const stored = new Map<string, string>();
  let index = 0;
  const entries: Array<{ vaultly?: unknown; vaultProfile?: string }> = [savedScroll === undefined ? { vaultProfile: "default" } : {
    vaultProfile: "default",
    vaultly: { id: "saved-page", label: "Videos", fields: {}, scroll: { x: 0, y: savedScroll }, breadcrumbs: [] },
  }];
  const history = {
    get state() { return entries[index]; },
    scrollRestoration: "auto",
    replaceState: (state: { vaultly?: unknown }) => { entries[index] = structuredClone(state); },
    pushState: (state: { vaultly?: unknown }) => { entries.splice(index + 1); entries.push(structuredClone(state)); index++; },
    go: (delta: number) => { index += delta; listeners.get("popstate")?.({ state: entries[index] }); },
    back: () => history.go(-1),
  };
  vi.stubGlobal("window", {
    history, scrollX: 0, scrollY: 640,
    localStorage: { get length() { return stored.size; }, key: (index: number) => [...stored.keys()][index] ?? null, getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) },
    addEventListener: (name: string, listener: (event: { state: unknown }) => void) => listeners.set(name, listener),
    removeEventListener: vi.fn(),
  });
  setActiveProfile({ id: "default", name: "Default" });
  const navigation = useNavigation();
  hooks.effects[0]();
  hooks.context = navigation;
  return { navigation, history, entries, listeners };
}

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("navigation history", () => {
  it("does not overwrite restored backup navigation when the old window closes", () => {
    const { navigation, listeners } = setup();
    navigation.update({ section: "video", search: "old session" });
    restoreVaultPreferences({ "vaultly.ui.navigation": JSON.stringify({ label: "Books", fields: { section: "story", search: "restored" }, scroll: { x: 0, y: 300 } }) });
    listeners.get("pagehide")?.({ state: null });
    vi.runAllTimers();
    expect(restoredNavigation()).toMatchObject({ label: "Books", fields: { section: "story", search: "restored" }, scroll: { y: 300 } });
  });
  it("restores profile filters, pages, collection and scroll after a new window without opening a video", () => {
    const { navigation } = setup();
    setActiveProfile({ id: "default", name: "Default" });
    navigation.push({ section: "video", libraryView: "series", "SeriesView.selectedId": 12, "gallery.video.browse.page": 4, search: "holiday" }, "Holiday collection");
    navigation.push({ selectedItemId: 33, viewerSeriesContext: { seriesId: 12 } }, "Holiday file");
    persistNavigation(navigation.current.current);
    const restored = restoredNavigation();
    expect(restored).toMatchObject({ label: "Holiday collection", fields: { section: "video", "SeriesView.selectedId": 12, "gallery.video.browse.page": 4, search: "holiday", selectedItemId: null, viewerSeriesContext: null }, breadcrumbs: [] });
    expect(restored.id).not.toBe(navigation.current.current.id);
    expect(exportVaultPreferences()["vaultly.ui.navigation"]).toBeTruthy();
    setActiveProfile({ id: "other", name: "Other" });
    expect(restoredNavigation().fields).toEqual({});
    setActiveProfile({ id: "default", name: "Default" });
    expect(restoredNavigation().fields.search).toBe("holiday");
  });
  it("starts a fresh trail and releases carried-over fields on Home and menu gallery visits", () => {
    const { navigation, entries } = setup();
    navigation.push({ section: "video", "gallery.video.browse.page": 8, viewerGalleryContext: { videos: [1, 2, 3] } }, "Videos");
    navigation.push({ selectedItemId: 2 }, "File");
    navigation.reset({ section: "home", libraryView: "browse", search: "" }, "Home");
    expect(navigation.current.current.breadcrumbs).toEqual([]);
    expect(navigation.current.current.fields).toEqual({ section: "home", libraryView: "browse", search: "" });
    expect(navigation.current.current.scroll).toEqual({ x: 0, y: 0 });
    const count = entries.length;
    navigation.back();
    expect(entries).toHaveLength(count);
    expect(navigation.current.current.label).toBe("Home");

    navigation.reset({ section: "comic", libraryView: "browse" }, "Comics");
    const galleryId = navigation.current.current.id;
    navigation.push({ selectedItemId: 4 }, "Comic");
    expect(navigation.current.current.breadcrumbs).toEqual([{ id: galleryId, label: "Comics" }]);
    navigation.back();
    expect(navigation.current.current.id).toBe(galleryId);
    expect(navigation.current.current.fields.selectedItemId).toBeUndefined();
    expect(navigation.current.current.breadcrumbs).toEqual([]);
  });

  it("keeps menu roots bounded over repeated navigation and resets the current gallery too", () => {
    const { navigation } = setup();
    for (let visit = 0; visit < 100; visit++) {
      navigation.reset({ section: "all", libraryView: "browse" }, "All media");
      navigation.update({ "gallery.all.browse.page": 12, search: "movie" });
      navigation.push({ selectedItemId: visit + 1 }, "File");
    }
    navigation.reset({ section: "all", libraryView: "browse" }, "All media");
    expect(navigation.current.current.breadcrumbs).toEqual([]);
    expect(navigation.current.current.fields).toEqual({ section: "all", libraryView: "browse" });
  });

  it("restores the exact gallery page, filters, search and scroll after opening a collection and file", () => {
    const { navigation, history } = setup();
    navigation.push({ section: "video", libraryView: "browse" }, "Videos");
    navigation.update({ "gallery.video.browse.page": 4, "gallery.video.browse.selectedTagIds": [7], "gallery.video.browse.extension": "mp4", search: "holiday" });
    const galleryId = navigation.current.current.id;
    navigation.push({ libraryView: "series", "SeriesView.selectedId": 12 }, "Holiday collection");
    const collectionPageId = navigation.current.current.pageId;
    navigation.push({ selectedItemId: 33 }, "Holiday file");
    expect(navigation.current.current.pageId).toBe(collectionPageId);
    navigation.back();
    expect(navigation.current.current.fields["SeriesView.selectedId"]).toBe(12);
    expect(navigation.current.current.fields.selectedItemId).toBeUndefined();
    navigation.back();
    expect(navigation.current.current.id).toBe(galleryId);
    expect(navigation.current.current.fields).toMatchObject({ libraryView: "browse", "gallery.video.browse.page": 4, "gallery.video.browse.selectedTagIds": [7], "gallery.video.browse.extension": "mp4", search: "holiday" });
    expect(navigation.current.current.scroll.y).toBe(640);
    history.go(1);
    expect(navigation.current.current.label).toBe("Holiday collection");
  });

  it("jumps to a breadcrumb and discards forward history when a new destination opens", () => {
    const { navigation, entries } = setup();
    const homeId = navigation.current.current.id;
    navigation.push({ section: "video" }, "Videos");
    navigation.push({ selectedItemId: 2 }, "File");
    navigation.goTo(homeId);
    expect(navigation.current.current.label).toBe("Home");
    navigation.push({ section: "comic" }, "Comics");
    expect(entries).toHaveLength(2);
    expect(navigation.current.current.breadcrumbs).toEqual([{ id: homeId, label: "Home" }]);
  });

  it("updates filters without adding history and respects explicitly cleared selections", () => {
    const { navigation, entries } = setup();
    navigation.update({ selectedId: null, page: 5 });
    hooks.context = { ...navigation, entry: navigation.current.current };
    expect(useNavigationField("selectedId", 42)[0]).toBeNull();
    const [, setPage] = useNavigationField("page", 0);
    setPage((page) => page + 1);
    expect(navigation.current.current.fields.page).toBe(6);
    expect(entries).toHaveLength(1);
  });
});

function setupRestoration() {
  let height = 1800;
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  const mutations = { callback: () => {}, disconnect: vi.fn() };
  const resize = { callback: () => {}, disconnect: vi.fn() };
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("MutationObserver", class {
    constructor(callback: () => void) { mutations.callback = callback; }
    observe() {}
    disconnect = mutations.disconnect;
  });
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize.callback = callback; }
    observe() {}
    disconnect = resize.disconnect;
  });
  vi.stubGlobal("document", { body: {} });
  const result = setup(640);
  Object.assign(window, {
    scrollY: 0,
    scrollTo: vi.fn(({ top }: ScrollToOptions) => { window.scrollY = Math.min(top ?? 0, Math.max(0, height - 800)); }),
  });
  const cleanup = hooks.effects[1]() as () => void;
  const flush = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  };
  return { ...result, flush, cleanup, mutations, resize, setHeight: (value: number) => { height = value; } };
}

describe("scroll restoration", () => {
  it("retains the target through loading collapses and later artwork resizes", () => {
    const { history, listeners, flush, cleanup, mutations, resize, setHeight } = setupRestoration();
    flush();
    expect(window.scrollY).toBe(640);

    setHeight(900);
    mutations.callback();
    flush();
    expect(window.scrollY).toBe(100);
    listeners.get("scroll")?.({ state: null });
    expect((history.state.vaultly as { scroll: { y: number } }).scroll.y).toBe(640);

    setHeight(2000);
    resize.callback();
    flush();
    expect(window.scrollY).toBe(640);
    expect(mutations.disconnect).not.toHaveBeenCalled();
    cleanup();
    expect(resize.disconnect).toHaveBeenCalledOnce();
  });

  it.each(["wheel", "pointerdown", "touchstart", "keydown"])("lets %s take control and cancels queued restoration", (event) => {
    const { history, listeners, flush, cleanup, resize } = setupRestoration();
    flush();
    resize.callback();
    listeners.get(event)?.({ state: null, key: "PageDown" } as { state: unknown });
    window.scrollY = 920;
    listeners.get("scroll")?.({ state: null });
    flush();
    expect(window.scrollY).toBe(920);
    expect((history.state.vaultly as { scroll: { y: number } }).scroll.y).toBe(920);
    cleanup();
  });
});
