import { describe, expect, it } from "vitest";
import { attributeGalleryFields, type AttributeKind } from "./attribute-navigation";
import { nextEntry, type NavigationEntry } from "./navigation";

describe("attribute gallery destinations", () => {
  it.each(["video", "comic", "story", "all"] as const)("opens the %s gallery with a fresh filter and closes the viewer", (type) => {
    const current: NavigationEntry = {
      id: "viewer", pageId: "old-gallery", label: "File", scroll: { x: 0, y: 800 }, breadcrumbs: [],
      fields: { section: "video", libraryView: "favorites", search: "old search", selectedItemId: 99,
        [`gallery.${type}.browse.page`]: 5, [`gallery.${type}.browse.selectedTagIds`]: [2],
        [`gallery.${type}.browse.selectedCategoryIds`]: [8], [`gallery.${type}.browse.extension`]: "mp4",
        [`gallery.${type}.browse.untagged`]: true, [`gallery.${type}.browse.circleFilter`]: "4" },
    };
    const next = nextEntry(current, attributeGalleryFields({ kind: "tag", id: 7, name: "Travel" }, type), "Travel");
    expect(next.fields).toMatchObject({ section: type, libraryView: "browse", search: "", selectedItemId: null,
      [`gallery.${type}.browse.page`]: 0, [`gallery.${type}.browse.selectedTagIds`]: [7],
      [`gallery.${type}.browse.selectedCategoryIds`]: [], [`gallery.${type}.browse.extension`]: "",
      [`gallery.${type}.browse.untagged`]: false, [`gallery.${type}.browse.circleFilter`]: "" });
    expect(next.pageId).toBe(next.id);
    expect(next.scroll.y).toBe(0);
    expect(current.fields.selectedItemId).toBe(99);
    expect(current.scroll.y).toBe(800);
    expect(next.breadcrumbs).toEqual([{ id: "viewer", label: "File", viewer: true }]);
  });

  it.each<[AttributeKind, string, unknown]>([
    ["category", "selectedCategoryIds", [3]], ["cast", "selectedArtistIds", [3]],
    ["artist", "selectedArtistIds", [3]], ["series", "seriesFilter", "3"], ["circle", "circleFilter", "3"],
  ])("uses the correct filter for %s badges", (kind, key, value) => {
    const fields = attributeGalleryFields({ kind, id: 3, name: "Example" }, "story");
    expect(fields[`gallery.story.browse.${key}`]).toEqual(value);
    expect(fields["gallery.story.browse.selectedTagIds"]).toEqual([]);
  });

  it.each(["cast", "artist"] as const)("browses %s as the same person across media types", (kind) => {
    for (const type of ["video", "comic", "story", "all"] as const) {
      const fields = attributeGalleryFields({ kind, id: 4, name: "Person" }, type);
      const key = type === "video" || type === "all" ? "selectedCastIds" : "selectedArtistIds";
      expect(fields[`gallery.${type}.browse.${key}`]).toEqual([4]);
    }
  });
});
