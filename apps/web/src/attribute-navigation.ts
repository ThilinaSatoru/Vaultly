import type { MediaType } from "./media";

export type AttributeKind = "tag" | "category" | "cast" | "artist" | "series" | "circle";
export interface BrowseAttribute { kind: AttributeKind; id: number; name: string }
export type AttributeMediaType = MediaType | "all";

export const mediaLabels: Record<AttributeMediaType, string> = { video: "Videos", comic: "Comics", story: "Stories", all: "All media" };

export function attributeGalleryFields(attribute: BrowseAttribute, mediaType: AttributeMediaType): Record<string, unknown> {
  const prefix = `gallery.${mediaType}.browse.`;
  const filters: Record<string, unknown> = {
    selectedCategoryIds: [], selectedTagIds: [], selectedCastIds: [], selectedArtistIds: [],
    filename: "", pathText: "", selectedType: "", sourceId: "", extension: "", seriesFilter: "", circleFilter: "",
    minMb: "", maxMb: "", modifiedFrom: "", modifiedTo: "", uncategorized: false, untagged: false,
    browseCategory: null, page: 0, sort: "title", advancedOpen: ["cast", "artist", "series", "circle"].includes(attribute.kind),
  };
  const key = { tag: "selectedTagIds", category: "selectedCategoryIds", cast: "selectedCastIds", artist: "selectedArtistIds", series: "seriesFilter", circle: "circleFilter" }[attribute.kind];
  filters[key] = attribute.kind === "series" || attribute.kind === "circle" ? String(attribute.id) : [attribute.id];
  return {
    section: mediaType, libraryView: "browse", search: "", selectedItemId: null, selectedSeriesId: null,
    "SeriesView.selectedId": null, "CircleView.selectedId": null,
    viewerSeriesContext: null, viewerGalleryContext: null, viewerFloating: false,
    ...Object.fromEntries(Object.entries(filters).map(([name, value]) => [prefix + name, value])),
  };
}
