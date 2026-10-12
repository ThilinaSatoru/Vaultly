import { useState, type SyntheticEvent } from "react";
import type { MediaItem } from "./media";

export type ArtworkOrientation = "portrait" | "landscape";

export function artworkOrientation(width?: number | null, height?: number | null, fallback: ArtworkOrientation = "portrait"): ArtworkOrientation {
  return width && height && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? height > width ? "portrait" : "landscape" : fallback;
}

export function mediaCardOrientation(item: Pick<MediaItem, "media_type" | "has_cover" | "cover_width" | "cover_height" | "video_width" | "video_height">): ArtworkOrientation {
  const fallback = item.media_type === "video" ? artworkOrientation(item.video_width, item.video_height, "landscape") : "portrait";
  return item.has_cover ? artworkOrientation(item.cover_width, item.cover_height, fallback) : fallback;
}

/** Loaded artwork also supports older vaults and collection covers without dimensions. */
export function useArtworkOrientation(src: string | null, fallback: ArtworkOrientation) {
  const [loaded, setLoaded] = useState<{ src: string | null; orientation: ArtworkOrientation } | null>(null);
  const onLoad = (event: SyntheticEvent<HTMLImageElement>) => setLoaded({ src, orientation: artworkOrientation(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight, fallback) });
  return { orientation: loaded?.src === src ? loaded.orientation : fallback, onLoad };
}
