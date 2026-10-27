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
  playlists: Array<{ id: number; name: string; track_count: number }>;
  stats: { tracks: number; duration: number; size_bytes: number };
}
export interface MusicPage { items: MusicTrack[]; total: number; page: number; pageSize: number }
export type MusicScope = { kind: "all" | "artist" | "playlist"; id?: number; name: string };
/** Text search covers artist and file name only and spans the whole library, so it replaces the artist/playlist scope. */
export const musicSorts = [["", "Default order"], ["rating", "Rating"], ["title", "Title"], ["artist", "Artist"], ["album", "Album"], ["duration", "Longest"], ["bitrate", "Bitrate"], ["size", "Size"]] as const;
export function musicQuery(scope: MusicScope, search: string, sort = "", minRating = 0) {
  const params = new URLSearchParams({ q: search, sort: scope.kind === "playlist" ? "playlist" : "artist" });
  if (scope.kind !== "all" && scope.id && !search.trim()) params.set(scope.kind, String(scope.id));
  if (search.trim()) params.set("sort", "artist");
  if (sort) params.set("sort", sort);
  if (minRating > 0) params.set("rating", String(minRating));
  return params.toString();
}
/** "Artist - Song", as in foobar2000-style file names. */
export const trackLabel = (track: Pick<MusicTrack, "artist" | "title">) => !track.artist || track.artist === "Unknown artist" ? track.title : `${track.artist} - ${track.title}`;
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
