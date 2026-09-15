export type MediaType = "comic" | "video" | "story";

export interface MediaItem {
  id: number;
  source_id: number;
  source_name: string;
  media_type: MediaType;
  title: string;
  filename: string;
  file_extension: string;
  relative_path: string;
  size_bytes: number;
  modified_at_ms: number;
  file_count: number;
  category_names: string;
  favorite: number;
  categories: Array<{ id: number; name: string }>;
  series_ids: number[];
  tags: Tag[];
  cast: Person[];
  artists: Person[];
}

export interface MediaDetail extends MediaItem {
  category_ids: number[];
}

export interface Category {
  id: number;
  name: string;
  item_count: number;
}

export interface Tag {
  id: number;
  name: string;
  item_count?: number;
}

export interface Person {
  id: number;
  name: string;
  cast_count?: number;
  artist_count?: number;
}

export interface ItemPage {
  items: MediaItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SeriesSummary {
  id: number;
  title: string;
  description: string;
  item_count: number;
  video_count: number;
  comic_count: number;
  story_count: number;
  preferred_type: MediaType | "mixed";
  cover_item_id: number | null;
  cover_item_type: MediaType | null;
  cover_item_path: string | null;
  has_cover: number;
  favorite: number;
  tags: Tag[];
  categories: Array<{ id: number; name: string }>;
}

export interface SeriesItem {
  id: number;
  title: string;
  media_type: MediaType;
  relative_path: string;
  size_bytes: number;
  modified_at_ms: number;
  file_count: number;
  source_name: string;
  position: number;
}

export interface SeriesDetail extends SeriesSummary {
  items: SeriesItem[];
}

export interface SeriesViewerContext {
  seriesId: number;
  seriesTitle: string;
  items: Array<{ id: number; title: string }>;
}

export const api = async <T,>(url: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...options,
    headers: options?.body ? { "Content-Type": "application/json", ...options.headers } : options?.headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: "The request failed." }));
    throw new Error(body.message || "The request failed.");
  }
  if (response.status === 204) return undefined as T;
  return response.json();
};

export const formatCount = (count: number) => new Intl.NumberFormat().format(count);

export const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
};
