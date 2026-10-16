import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { AttributeEditorDialog } from "./AttributeEditorDialog";
import { api } from "./media";
import type { MusicPage, MusicTrack } from "./music";

export function MusicQueueDialog({ queue, currentId, name, onPlay, onClose }: {
  queue: number[]; currentId?: number; name: string; onPlay: (id: number) => void; onClose: () => void;
}) {
  const [page, setPage] = useState(() => Math.max(0, Math.floor(queue.indexOf(currentId ?? 0) / 50)));
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [error, setError] = useState("");
  const pages = Math.max(1, Math.ceil(queue.length / 50));
  useEffect(() => {
    const controller = new AbortController();
    const ids = queue.slice(page * 50, page * 50 + 50);
    setTracks([]); setError("");
    if (ids.length) void api<MusicPage>(`/api/music/tracks?ids=${ids.join(",")}&pageSize=50`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setTracks(ids.flatMap((id) => result.items.find((track) => track.id === id) ?? [])); })
      .catch((reason) => { if (!controller.signal.aborted) setError(String(reason)); });
    return () => controller.abort();
  }, [queue, page]);
  return <AttributeEditorDialog title="Active music playlist" onClose={onClose}>
    <p>{name} · {queue.length} tracks</p>{error && <p role="alert">{error}</p>}
    <ol className="music-queue-list" start={page * 50 + 1}>{tracks.map((track) => <li key={track.id}>
      <button type="button" aria-current={track.id === currentId ? "true" : undefined} onClick={() => onPlay(track.id)}><Play size={15} />{track.title}<small>{track.artist}</small></button>
    </li>)}</ol>{!queue.length && <p>Play a track or playlist to start a queue.</p>}
    <nav className="music-queue-pages" aria-label="Music queue pages"><button type="button" disabled={!page} onClick={() => setPage(0)}>First</button><button type="button" disabled={!page} onClick={() => setPage(page - 1)}>Previous</button><span>{page + 1} / {pages}</span><button type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button></nav>
  </AttributeEditorDialog>;
}
