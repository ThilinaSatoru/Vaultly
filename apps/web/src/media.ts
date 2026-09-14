export type MediaType = "comic" | "video" | "story";

export interface MediaItem {
  id: number;
  source_id: number;
  source_name: string;
  media_type: MediaType;
  title: string;
  relative_path: string;
  size_bytes: number;
  modified_at_ms: number;
  file_count: number;
  category_names: string;
}

export interface MediaDetail extends MediaItem {
  category_ids: number[];
}

export interface Category {
  id: number;
  name: string;
  item_count: number;
}

export interface ItemPage {
  items: MediaItem[];
  total: number;
  page: number;
  pageSize: number;
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
