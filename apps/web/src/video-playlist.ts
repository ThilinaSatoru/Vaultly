import type { ItemPage, MediaItem, SeriesViewerContext } from "./media";

export type SuggestedVideo = Pick<MediaItem, "id" | "title" | "filename" | "source_name" | "duration_seconds">;

export interface GalleryVideoContext {
  page: number;
  videos: SuggestedVideo[];
}

/** Snapshot the already filtered, sorted page that the user opened the video from. */
export function galleryVideoContext(result: ItemPage | null, itemId: number): GalleryVideoContext | null {
  if (!result?.items.some((item) => item.id === itemId && item.media_type === "video")) return null;
  return {
    page: result.page,
    videos: result.items.filter((item) => item.media_type === "video")
      .map(({ id, title, filename, source_name, duration_seconds }) => ({ id, title, filename, source_name, duration_seconds })),
  };
}

export function viewerNavigationItems(
  itemId: number,
  gallery: GalleryVideoContext | null,
  playlist: Array<{ id: number; title: string }>,
  series: SeriesViewerContext | null,
  fallback?: Array<{ id: number; title: string }>,
): Array<{ id: number; title: string }> | undefined {
  if (gallery) return gallery.videos;
  if (playlist.some((item) => item.id === itemId)) return playlist;
  return series?.items ?? fallback;
}
