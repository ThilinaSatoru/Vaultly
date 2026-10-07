import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const hooks = vi.hoisted(() => ({ contexts: new Map<unknown, unknown>(), pending: null as unknown, setPending: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useContext: (context: unknown) => hooks.contexts.get(context),
  useState: () => [hooks.pending, hooks.setPending],
  useEffect: vi.fn(),
}));
import { AttributeBadge, AttributeBrowseContext, AttributeBrowseProvider, AttributeMediaContext } from "./AttributeBadge";
import { NavigationContext } from "./navigation";

const attribute = { kind: "tag" as const, id: 7, name: "Travel" };
function setup(section: string) {
  const push = vi.fn();
  hooks.contexts.set(NavigationContext, { entry: { id: "page" }, current: { current: { fields: { section } } }, push });
  const provider = AttributeBrowseProvider({ children: null });
  return { push, browse: provider.props.value };
}
beforeEach(() => { hooks.contexts.clear(); hooks.pending = null; hooks.setPending.mockReset(); });

describe("attribute badge browsing", () => {
  it("runs the optional navigation callback before showing an unscoped media chooser", () => {
    hooks.contexts.set(NavigationContext, { entry: { id: "page" }, current: { current: { fields: { section: "home" } } }, push: vi.fn() });
    const onNavigate = vi.fn();
    const provider = AttributeBrowseProvider({ children: null, onNavigate });
    provider.props.value(attribute);
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(hooks.setPending).toHaveBeenCalledWith(attribute);
    expect(onNavigate.mock.invocationCallOrder[0]).toBeLessThan(hooks.setPending.mock.invocationCallOrder[0]);
  });
  it("uses the clicked item's media type even when browsing a different library", () => {
    const { browse, push } = setup("comic");
    hooks.contexts.set(AttributeBrowseContext, browse);
    hooks.contexts.set(AttributeMediaContext, "story");
    const badge = AttributeBadge({ ...attribute, mediaType: "video" });
    const stopPropagation = vi.fn();
    badge.props.onClick({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ section: "video", "gallery.video.browse.selectedTagIds": [7] }), "Videos · Travel");
    expect(hooks.setPending).toHaveBeenCalledWith(null);
  });

  it("uses a viewer's media scope and the current library for unscoped badges", () => {
    const { browse, push } = setup("video");
    hooks.contexts.set(AttributeBrowseContext, browse);
    hooks.contexts.set(AttributeMediaContext, "comic");
    AttributeBadge(attribute).props.onClick({ stopPropagation: vi.fn() });
    expect(push.mock.calls[0][0].section).toBe("comic");
    browse(attribute);
    expect(push.mock.calls[1][0].section).toBe("video");
  });

  it.each(["tags", "categories", "people", "sources", "all", "home"])("asks for media on the %s page and navigates only after selection", (section) => {
    const { browse, push } = setup(section);
    browse(attribute);
    expect(push).not.toHaveBeenCalled();
    expect(hooks.setPending).toHaveBeenCalledWith(attribute);
    hooks.pending = attribute;
    const provider = AttributeBrowseProvider({ children: null });
    const picker = provider.props.children[1] as ReactElement<{ onChoose: (type: string) => void; onClose: () => void }>;
    picker.props.onClose();
    expect(push).not.toHaveBeenCalled();
    picker.props.onChoose("story");
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ section: "story", "gallery.story.browse.selectedTagIds": [7] }), "Stories · Travel");
  });
});
