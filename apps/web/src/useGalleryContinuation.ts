import { useEffect, useState } from "react";
import { api, type ItemPage } from "./media";
import type { GalleryVideoContext, SuggestedVideo } from "./video-playlist";

interface Continuation {
  context: GalleryVideoContext | null;
  later: SuggestedVideo[];
  nextPage: number;
  hasMore: boolean;
}

const fresh = (context: GalleryVideoContext | null): Continuation => ({ context, later: [], nextPage: (context?.page ?? -1) + 1, hasMore: Boolean(context) });

/** Append the videos of `incoming` that are not already listed. */
export function mergeGalleryVideos(existing: SuggestedVideo[], incoming: SuggestedVideo[]): SuggestedVideo[] {
  const seen = new Set(existing.map((video) => video.id));
  const added = incoming.filter((video) => !seen.has(video.id) && seen.add(video.id));
  return added.length ? [...existing, ...added] : existing;
}

export function toSuggestedVideos(items: ItemPage["items"]): SuggestedVideo[] {
  return items.filter((entry) => entry.media_type === "video")
    .map(({ id, title, filename, source_name, duration_seconds }) => ({ id, title, filename, source_name, duration_seconds }));
}

/**
 * Extends the opened gallery page with the following pages as playback nears the end.
 * State is tied to the context object, so moving between videos keeps loaded pages and
 * only opening from a different gallery view starts over.
 */
export function useGalleryContinuation(context: GalleryVideoContext | null, itemId: number): { videos: SuggestedVideo[] | undefined; loading: boolean } {
  const [stored, setStored] = useState(() => fresh(context));
  const [loading, setLoading] = useState(false);
  const state = stored.context === context ? stored : fresh(context);
  const videos = context ? mergeGalleryVideos(context.videos, state.later) : undefined;
  const index = videos?.findIndex((video) => video.id === itemId) ?? -1;
  const needsMore = Boolean(context && videos && state.hasMore && index >= 0 && index >= videos.length - 2);

  useEffect(() => {
    if (!context || !needsMore) return;
    const controller = new AbortController();
    const page = state.nextPage;
    setLoading(true);
    api<ItemPage>(`/api/items?${context.query}${context.query ? "&" : ""}page=${page}`, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setStored((current) => {
          const base = current.context === context ? current : fresh(context);
          return { context, later: mergeGalleryVideos(base.later, toSuggestedVideos(result.items)), nextPage: page + 1, hasMore: result.items.length > 0 && (page + 1) * result.pageSize < result.total };
        });
      })
      .catch(() => { if (!controller.signal.aborted) setStored((current) => ({ ...(current.context === context ? current : fresh(context)), hasMore: false })); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [context, needsMore, state.nextPage]);

  return { videos, loading };
}
