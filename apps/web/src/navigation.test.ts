import { afterEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ effects: [] as Array<() => unknown>, context: null as unknown }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, vi.fn()],
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: (effect: () => unknown) => { hooks.effects.push(effect); },
  useContext: () => hooks.context,
}));
import { useNavigation, useNavigationField } from "./navigation";

function setup() {
  hooks.effects = [];
  const listeners = new Map<string, (event: { state: unknown }) => void>();
  let index = 0;
  const entries: Array<{ vaultly?: unknown }> = [{}];
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
    addEventListener: (name: string, listener: (event: { state: unknown }) => void) => listeners.set(name, listener),
    removeEventListener: vi.fn(),
  });
  const navigation = useNavigation();
  hooks.effects[0]();
  hooks.context = navigation;
  return { navigation, history, entries };
}

afterEach(() => vi.unstubAllGlobals());

describe("navigation history", () => {
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
