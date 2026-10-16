export interface MusicAttribute { id: number; kind: "tag" | "category"; name: string; patterns?: string[]; track_count?: number }
export interface MusicTrack {
  id: number; source_id: number; title: string; artist: string; album: string; album_id: number; album_artist: string;
  filename: string; relative_path: string; source_name: string; year: string; track_number: number; disc_number: number;
  duration: number | null; bitrate: number | null; sample_rate: number | null; channels: string; bit_depth: number | null;
  codec: string; size_bytes: number; modified_at_ms: number; rating: number; available: number; has_cover: number;
  attributes: MusicAttribute[]; metadata?: Record<string, string>; is_video?: boolean;
}
export interface MusicSource {
  id: number; name: string; root_path: string; status: string; last_error: string | null; track_count: number;
  path_available?: boolean; progress: { current: string; processed: number; errors: number } | null;
  last_scanned_at?: string | null;
}
export interface MusicLibrary {
  sources: MusicSource[];
  artists: Array<{ id: number; name: string; track_count: number }>;
  albums: Array<{ id: number; title: string; artist: string; year: string; track_count: number; duration: number; cover_track_id: number }>;
  playlists: Array<{ id: number; name: string; track_count: number }>;
  attributes: MusicAttribute[];
  stats: { tracks: number; duration: number; size_bytes: number };
}
export interface MusicPage { items: MusicTrack[]; total: number; page: number; pageSize: number }
export type MusicScope = { kind: "all" | "artist" | "album" | "playlist" | "attribute"; id?: number; name: string };
export function musicQuery(scope: MusicScope, search: string, wholeLibrary: boolean, filters: { rating: number; codec: string; source: string; sort: string }) {
  const params = new URLSearchParams({ q: search, rating: String(filters.rating), codec: filters.codec, sort: filters.sort });
  if (filters.source) params.set("source", filters.source);
  if (scope.kind !== "all" && scope.id && !(search.trim() && wholeLibrary)) params.set(scope.kind, String(scope.id));
  return params.toString();
}
export function adjacentMusicTrack(queue: number[], current: number, direction: number, repeat: string, shuffle: boolean) {
  if (!queue.length) return null;
  if (shuffle && queue.length > 1) {
    const candidates = queue.filter((id) => id !== current);
    return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
  }
  const index = queue.indexOf(current) + direction;
  if (index >= 0 && index < queue.length) return queue[index]!;
  return repeat === "all" ? queue[(index + queue.length) % queue.length]! : null;
}
