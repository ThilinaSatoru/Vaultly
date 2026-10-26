import { VideoPlayer } from "./VideoPlayer";
import { mediaAnalyser, resumeMasterAudio } from "./audio-output";
import { PersistentDetails } from "./PersistentDetails";
import { MusicQueueDialog } from "./MusicQueueDialog";
import { ClearableInput } from "./ClearableField";
import { flushSync, createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, FolderPlus, ListMusic, Music2, Pause, Play, Plus, Repeat, Repeat1, Search, Shuffle, SkipBack, SkipForward, Trash2, Volume2, X } from "lucide-react";
import { api, formatCount, formatDuration, formatSize } from "./media";
import { vaultUrl } from "./vault-session";
import { useUiState } from "./ui-state";
import { adjacentMusicTrack, musicQuery, trackLabel, type MusicLibrary, type MusicPage, type MusicScope, type MusicTrack } from "./music";
import "./music.css";

interface MusicBridge {
  musicState?(state: { enabled: boolean; playing: boolean; title: string }): void;
  minimizeToTray?(): void;
  onMusicCommand?(handler: (command: string) => void): () => void;
}
const bridge = () => (window as Window & { vaultlyWindow?: MusicBridge }).vaultlyWindow;
const empty: MusicLibrary = { sources: [], artists: [], playlists: [], stats: { tracks: 0, duration: 0, size_bytes: 0 } };
const allScope: MusicScope = { kind: "all", name: "All tracks" };
function Divider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const drag = useRef<{ x: number; value: number } | null>(null);
  return <div className="music-divider" role="separator" tabIndex={0} aria-label={label} aria-orientation="vertical" aria-valuemin={180} aria-valuemax={480} aria-valuenow={value}
    onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, value }; }}
    onPointerMove={(event) => { if (drag.current) onChange(Math.max(180, Math.min(480, drag.current.value - (event.clientX - drag.current.x)))); }}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
    onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); onChange(Math.max(180, Math.min(480, value + (event.key === "ArrowLeft" ? 10 : -10)))); } }} />;
}

export function MusicWorkspace({ visible, search, sidebarHost = null, playerHost = null, onOpenSources, onAddSource, sourceRevision = "" }: { visible: boolean; search: string; sidebarHost?: HTMLElement | null; playerHost?: HTMLElement | null; onOpenSources: () => void; onAddSource: () => void; sourceRevision?: string }) {
  const [library, setLibrary] = useState<MusicLibrary>(empty);
  const [scope, setScope] = useUiState<MusicScope>("vaultly.music.scope", allScope);
  const [showQueue, setShowQueue] = useState(false);
  const [queueName, setQueueName] = useState("Playback queue");
  const [videoVisible] = useUiState("vaultly.music.videoVisible", true);
  const [rightWidth, setRightWidth] = useUiState("vaultly.music.rightWidth", 300);
  const [volume, setVolume] = useUiState("vaultly.music.volume", .8);
  const [trayEnabled, setTrayEnabled] = useUiState("vaultly.music.tray", true);
  const [repeat, setRepeat] = useUiState("vaultly.music.repeat", "off");
  const [shuffle, setShuffle] = useUiState("vaultly.music.shuffle", false);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [page, setPage] = useState(1);
  const [tracks, setTracks] = useState<MusicPage>({ items: [], total: 0, page: 1, pageSize: 100 });
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<MusicTrack | null>(null);
  const [checked, setChecked] = useState<number[]>([]);
  const [current, setCurrent] = useState<MusicTrack | null>(null);
  const [queue, setQueue] = useState<number[]>([]);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioError, setAudioError] = useState("");
  const [error, setError] = useState("");
  const [compatible, setCompatible] = useState(false);
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [saving, setSaving] = useState(false);
  const [playlistTarget, setPlaylistTarget] = useState("");
  const audio = useRef<HTMLVideoElement>(null);
  const playRequest = useRef(0);
  const currentRef = useRef(current); currentRef.current = current;
  const effectiveSearch = visible ? search : "";
  const query = musicQuery(scope, effectiveSearch);
  const report = (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason));
  const refresh = useCallback(async () => { setLibrary(await api<MusicLibrary>("/api/music/library")); }, []);
  const mutate = async (url: string, method: string, body?: unknown) => {
    try { await api(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); setError(""); setRevision((v) => v + 1); await refresh(); }
    catch (reason) { report(reason); }
  };
  useEffect(() => { void refresh().catch(report); }, [refresh, revision, sourceRevision]);
  const scanning = library.sources.some((s) => s.status === "scanning");
  useEffect(() => {
    if (!scanning) return;
    const timer = window.setInterval(() => { void refresh().then(() => setRevision((v) => v + 1)).catch(report); }, 1500);
    return () => clearInterval(timer);
  }, [scanning, refresh]);
  useEffect(() => { setPage(1); setChecked([]); }, [query]);
  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api<MusicPage>(`/api/music/tracks?${query}&page=${page}`, { signal: controller.signal }).then((result) => {
        if (!controller.signal.aborted) { setTracks(result); setChecked([]); const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize)); if (page > lastPage) setPage(lastPage); }
      }).catch((reason) => { if (!controller.signal.aborted) report(reason); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, page, revision, visible, sourceRevision]);
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    void api<MusicTrack>(`/api/music/tracks/${selected.id}`).then((track) => { if (!cancelled) setSelected(track); }).catch(report);
    return () => { cancelled = true; };
  }, [selected?.id, revision]);
  useEffect(() => { if (audio.current) audio.current.volume = Math.max(0, Math.min(1, volume)); }, [volume]);
  useEffect(() => {
    bridge()?.musicState?.({ enabled: trayEnabled, playing, title: current ? trackLabel(current) : "" });
  }, [trayEnabled, playing, current]);
  useEffect(() => () => { playRequest.current++; audio.current?.pause(); bridge()?.musicState?.({ enabled: false, playing: false, title: "" }); }, []);

  const ensureGraph = async () => {
    await resumeMasterAudio();
    if (audio.current) mediaAnalyser(audio.current);
  };
  const startTrack = async (id: number, nextQueue?: number[]) => {
    const request = ++playRequest.current;
    try {
      // Resume the audio context in the original click gesture, before fetching.
      await ensureGraph();
      const track = await api<MusicTrack>(`/api/music/tracks/${id}`);
      if (request !== playRequest.current) return;
      if (!track.available) throw new Error("This music file is unavailable. Rescan its source.");
      if (nextQueue) setQueue(nextQueue);
      flushSync(() => { setCurrent(track); setSelected(track); setPosition(0); setDuration(track.duration ?? 0); setCompatible(false); setAudioError(""); });
      const element = audio.current!;
      element.load(); await element.play();
    } catch (reason) { if (request === playRequest.current) setAudioError(reason instanceof Error ? reason.message : "Could not play this track."); }
  };
  const playScope = async (id?: number) => {
    try { await ensureGraph(); const ids = await api<number[]>(`/api/music/queue?${query}`); if (ids.length) { setQueueName(effectiveSearch.trim() ? "Search results" : scope.name); await startTrack(id ?? ids[0]!, ids); } }
    catch (reason) { report(reason); }
  };
  const togglePlay = async () => {
    if (!current) { await playScope(); return; }
    if (!audio.current) return;
    if (audio.current.paused) { try { await ensureGraph(); await audio.current.play(); } catch (reason) { setAudioError(String(reason)); } }
    else audio.current.pause();
  };
  const next = (direction = 1) => {
    if (!current) return;
    if (direction < 0 && audio.current && audio.current.currentTime > 3) { audio.current.currentTime = 0; return; }
    const id = adjacentMusicTrack(queue, current.id, direction, repeat, shuffle);
    if (id !== null) void startTrack(id);
  };
  useEffect(() => {
    const command = (value: string) => { if (value === "toggle") void togglePlay(); else if (value === "next") next(); else if (value === "previous") next(-1); };
    return bridge()?.onMusicCommand?.(command);
  }, [current, queue, repeat, shuffle]);
  useEffect(() => {
    if (!("mediaSession" in navigator) || !current) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: current.title, artist: current.artist, album: current.album });
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    const actions: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ["play", () => { void ensureGraph().then(() => audio.current?.play()).catch(report); }], ["pause", () => audio.current?.pause()],
      ["nexttrack", () => next()], ["previoustrack", () => next(-1)],
      ["seekto", (event) => { if (audio.current && event.seekTime !== undefined) audio.current.currentTime = event.seekTime; }],
    ];
    for (const [action, handler] of actions) { try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Optional platform media key. */ } }
    return () => { for (const [action] of actions) { try { navigator.mediaSession.setActionHandler(action, null); } catch { /* Unsupported. */ } } };
  }, [current, playing, queue, repeat, shuffle]);
  const chooseScope = (nextScope: MusicScope) => { setScope(nextScope); setPage(1); setChecked([]); };
  const createPlaylist = async () => {
    setSaving(true);
    try {
      const p = await api<{ id: number; name: string }>("/api/music/playlists", { method: "POST", body: JSON.stringify({ name: draftName }) });
      chooseScope({ kind: "playlist", id: p.id, name: p.name });
      setCreatingPlaylist(false); setRevision((v) => v + 1); await refresh();
    } catch (reason) { report(reason); } finally { setSaving(false); }
  };
  const addToPlaylist = async () => {
    const ids = checked.length ? checked : selected ? [selected.id] : [];
    if (playlistTarget && ids.length) await mutate(`/api/music/playlists/${playlistTarget}/tracks`, "POST", { trackIds: ids });
  };
  const moveTrack = async (id: number, direction: number) => {
    try {
      const ids = await api<number[]>(`/api/music/queue?playlist=${scope.id}&sort=playlist`), index = ids.indexOf(id), destination = index + direction;
      if (index < 0 || destination < 0 || destination >= ids.length) return;
      [ids[index], ids[destination]] = [ids[destination]!, ids[index]!];
      await mutate(`/api/music/playlists/${scope.id}/order`, "PUT", { trackIds: ids });
    } catch (reason) { report(reason); }
  };
  const searchSide = (text: string) => text.toLowerCase().includes(sidebarSearch.toLowerCase());
  const searching = effectiveSearch.trim().length > 0;
  const scopeTitle = searching ? `Search: ${effectiveSearch.trim()}` : scope.name;
  const inPlaylist = scope.kind === "playlist" && !searching;

  const info = selected && <dl>{Object.entries({
    Title: selected.title, Artist: selected.artist, Album: selected.album, "Album artist": selected.album_artist,
    "Track / disc": `${selected.track_number || "—"} / ${selected.disc_number || "—"}`, Year: selected.year || "—",
    Duration: formatDuration(selected.duration), Codec: selected.codec.toUpperCase(), Bitrate: selected.bitrate ? `${selected.bitrate} kbps` : "—",
    "Sample rate": selected.sample_rate ? `${selected.sample_rate} Hz` : "—", "Bit depth": selected.bit_depth ? `${selected.bit_depth} bit` : "—",
    Channels: selected.channels || "—", Size: formatSize(selected.size_bytes), "Genre & tags": selected.attributes.map((a) => a.name).join(", ") || "—",
    Filename: selected.filename, Folder: selected.relative_path, Source: selected.source_name, Modified: new Date(selected.modified_at_ms).toLocaleString(),
  }).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>;
  const embedded = Object.entries(selected?.metadata ?? {});
  const musicPlayer = <>
    {(visible || current) && <div className="music-player" aria-label="Music playback">
      <div className="music-now"><strong>{current ? trackLabel(current) : "Nothing playing"}</strong><small>{current ? `${current.codec.toUpperCase()} · ${current.bitrate ?? "—"} kbps · ${current.sample_rate ? `${current.sample_rate / 1000} kHz` : "—"}` : `${formatCount(library.stats.tracks)} tracks in your music library`}</small></div>
      <div className="music-transport"><div><button title="Shuffle" aria-label="Shuffle" aria-pressed={shuffle} onClick={() => setShuffle(!shuffle)}><Shuffle size={16}/></button><button title="Previous track" aria-label="Previous track" onClick={() => next(-1)} disabled={!current}><SkipBack size={18}/></button><button className="music-play-button" aria-label={playing ? "Pause music" : "Play music"} onClick={() => void togglePlay()} disabled={!current && !tracks.total}>{playing ? <Pause size={20}/> : <Play size={20}/>}</button><button title="Next track" aria-label="Next track" onClick={() => next()} disabled={!current}><SkipForward size={18}/></button><button title={`Repeat: ${repeat}`} aria-label={`Repeat: ${repeat}`} aria-pressed={repeat !== "off"} onClick={() => setRepeat(repeat === "off" ? "all" : repeat === "all" ? "one" : "off")}>{repeat === "one" ? <Repeat1 size={16}/> : <Repeat size={16}/>}</button></div>
        <label className="music-seek"><small>{formatDuration(position)}</small><input aria-label="Seek music" type="range" min={0} max={duration || 1} step={.1} value={Math.min(position, duration || 1)} disabled={!current} onChange={(event) => { if (audio.current) { audio.current.currentTime = Number(event.target.value); setPosition(Number(event.target.value)); } }}/><small>{formatDuration(duration)}</small></label></div>
      <button type="button" title="Open current active playlist" aria-label="Open current active playlist" aria-expanded={showQueue} onClick={() => setShowQueue(true)}><ListMusic size={19} /><span className="music-queue-count">{queue.length}</span></button>
      <label className="music-volume"><Volume2 size={17}/><input aria-label="Music volume" type="range" min={0} max={1} step={.01} value={volume} onChange={(event) => setVolume(Number(event.target.value))}/></label>
      {current && <button title="Stop music and clear queue" aria-label="Stop music" onClick={() => { ++playRequest.current; audio.current?.pause(); audio.current?.removeAttribute("src"); audio.current?.load(); setCurrent(null); setQueue([]); setAudioError(""); }}><X size={17}/></button>}
    </div>}
    {audioError && <div className="music-error" role="status">{audioError}</div>}
  </>;
  const musicNavigation = (
    <aside className="music-sidebar"><label className="music-side-search"><Search size={15}/><ClearableInput aria-label="Filter artists and playlists" placeholder="Filter artists, playlists…" value={sidebarSearch} onChange={(event) => setSidebarSearch(event.target.value)}/></label>
      <button className={scope.kind === "all" ? "active" : ""} onClick={() => chooseScope(allScope)}><Music2 size={17}/> All tracks <small>{library.stats.tracks}</small></button>
      <PersistentDetails className="music-nav-group" stateKey="music.artists" open><summary>Artists <small>{library.artists.length}</small></summary><div className="music-nav-list">{library.artists.filter((a) => searchSide(a.name)).map((a) => <button key={a.id} className={scope.kind === "artist" && scope.id === a.id ? "active" : ""} onClick={() => chooseScope({ kind: "artist", id: a.id, name: a.name })}><span>{a.name}</span><small>{a.track_count}</small></button>)}{!library.artists.length && <p className="music-muted">Artists appear after scanning.</p>}</div></PersistentDetails>
      <PersistentDetails className="music-nav-group" stateKey="music.playlists" open><summary>Playlists <button aria-label="Create music playlist" title="Create playlist" onClick={() => { setDraftName(""); setCreatingPlaylist(true); }}><Plus size={15}/></button></summary><div className="music-nav-list">{library.playlists.filter((p) => searchSide(p.name)).map((p) => <button key={p.id} className={scope.kind === "playlist" && scope.id === p.id ? "active" : ""} onClick={() => chooseScope({ kind: "playlist", id: p.id, name: p.name })}><ListMusic size={15}/><span>{p.name}</span><small>{p.track_count}</small></button>)}</div></PersistentDetails>
      <button className="music-manage-sources" type="button" onClick={onOpenSources}><FolderPlus size={16} /> Sources · {library.sources.length} music folders</button>
      {bridge() && <div className="music-tray"><label><input type="checkbox" checked={trayEnabled} onChange={(event) => setTrayEnabled(event.target.checked)}/> Close to system tray</label><button onClick={() => { setTrayEnabled(true); bridge()?.minimizeToTray?.(); }}>Keep playing in tray</button><small>Use Quit Vaultly in the tray menu to exit.</small></div>}
    </aside>
  );

  return <div className={`music-root${visible ? " is-visible" : ""}`}>
    <div className="music-video-player" hidden={!visible || !current?.is_video || !videoVisible || compatible}>
      <VideoPlayer mediaRef={audio} src={current ? vaultUrl(`/api/music/tracks/${current.id}/audio${compatible ? "?compatible=1" : ""}`) : ""}
        autoPlay={false} audioOnly={!current?.is_video || compatible} loopOverride={false} playbackOwner="music" controlledVolume={volume} onVolumeChange={setVolume}
        shortcutsEnabled={visible && Boolean(current?.is_video) && videoVisible && !compatible}
        onPlaybackState={(state) => { setPlaying(state.playing); setPosition(state.position); if (state.duration) setDuration(state.duration); }}
        onEnded={() => { if (repeat === "one" && audio.current) { audio.current.currentTime = 0; void audio.current.play().catch(report); } else next(); }}
        onError={() => {
          if (audio.current?.error?.code === 1) return;
          if (currentRef.current && !compatible && audio.current) {
            const track = currentRef.current; setCompatible(true); setAudioError("Preparing compatible audio…");
            audio.current.src = vaultUrl(`/api/music/tracks/${track.id}/audio?compatible=1`);
            void audio.current.play().then(() => setAudioError("")).catch((reason) => setAudioError(String(reason)));
          } else setAudioError("This file could not be played. Check its source and rescan.");
        }} />
    </div>
    {playerHost ? createPortal(musicPlayer, playerHost) : musicPlayer}
    {sidebarHost && visible && createPortal(musicNavigation, sidebarHost)}
    {showQueue && <MusicQueueDialog queue={queue} currentId={current?.id} name={queueName} onPlay={(id) => void startTrack(id)} onClose={() => setShowQueue(false)} />}
    <section className="music-workspace" hidden={!visible} aria-label="Music library">
      {error && <div className="music-error" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError("")}><X size={14}/></button></div>}
      <div className="music-layout" style={{ "--music-right": `${Math.max(180, Math.min(480, rightWidth))}px` } as CSSProperties}>
        <div className="music-browser">
          <header className="music-scope-heading"><div><h1>{scopeTitle}</h1><span>{formatCount(tracks.total)} tracks{current ? ` · ${queue.length} in playback queue` : ""}</span></div>
            <div className="music-scope-actions"><button className="music-accent-button" onClick={() => onAddSource()}><FolderPlus size={14}/> Add music folder</button><button className="music-accent-button" disabled={!tracks.total} onClick={() => void playScope()}><Play size={14}/> Play all</button></div></header>
          <div className="music-playlist-tools"><select aria-label="Add selected music to playlist" value={playlistTarget} onChange={(event) => setPlaylistTarget(event.target.value)}><option value="">Add to playlist…</option>{library.playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button disabled={!playlistTarget || (!checked.length && !selected)} onClick={() => void addToPlaylist()}><Plus size={13}/> Add {checked.length || (selected ? 1 : 0)}</button>
            {inPlaylist && <><button title="Rename playlist" onClick={() => { const name = window.prompt("Playlist name", scope.name); if (name?.trim()) { void mutate(`/api/music/playlists/${scope.id}`, "PATCH", { name }); setScope({ ...scope, name }); } }}>Rename</button><button aria-label="Delete playlist" onClick={() => { if (window.confirm(`Delete playlist “${scope.name}”? Music files will be kept.`)) { void mutate(`/api/music/playlists/${scope.id}`, "DELETE"); chooseScope(allScope); } }}><Trash2 size={14}/></button></>}</div>
          <div className="music-track-scroll" aria-busy={loading}>
            <table className="music-table"><thead><tr><th><input aria-label="Select all music on this page" type="checkbox" checked={tracks.items.length > 0 && checked.length === tracks.items.length} onChange={(event) => setChecked(event.target.checked ? tracks.items.map((t) => t.id) : [])}/></th><th>#</th><th>Artist - Title</th><th>Time</th>{inPlaylist && <th>Order</th>}</tr></thead>
              <tbody>{tracks.items.map((track, index) => <tr key={track.id} className={`${selected?.id === track.id ? "selected " : ""}${current?.id === track.id ? "playing" : ""}`} onClick={() => setSelected(track)} onDoubleClick={() => void playScope(track.id)}>
                <td><input aria-label={`Select ${trackLabel(track)}`} type="checkbox" checked={checked.includes(track.id)} onChange={(event) => setChecked((ids) => event.target.checked ? [...ids, track.id] : ids.filter((id) => id !== track.id))}/></td>
                <td className="music-index">{current?.id === track.id && playing ? <Play size={12}/> : (page - 1) * tracks.pageSize + index + 1}</td>
                <td className="music-track-title"><span>{trackLabel(track)}</span></td><td className="music-time">{formatDuration(track.duration)}</td>
                {inPlaylist && <td><div className="music-order"><button aria-label={`Move ${track.title} up`} onClick={() => void moveTrack(track.id, -1)}><ArrowUp size={13}/></button><button aria-label={`Move ${track.title} down`} onClick={() => void moveTrack(track.id, 1)}><ArrowDown size={13}/></button><button aria-label={`Remove ${track.title} from playlist`} onClick={() => void mutate(`/api/music/playlists/${scope.id}/tracks/${track.id}`, "DELETE")}><X size={13}/></button></div></td>}</tr>)}</tbody></table>
            {!loading && !tracks.total && <div className="music-empty"><Music2 size={40}/><h3>{library.stats.tracks ? "No tracks found" : "Make room for your music"}</h3><p>{library.stats.tracks ? "Search matches artist and file names only." : "Add a folder of files named “Artist - Song”."}</p>{!library.stats.tracks && <button className="secondary-button" onClick={() => onAddSource()}>Add music folder</button>}</div>}
          </div>
          <footer className="music-pagination"><span>{loading ? "Reading music…" : `${formatCount(tracks.total)} tracks`}{checked.length ? ` · ${checked.length} selected` : ""}</span><button aria-label="Previous music page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={15}/></button><span>{page} / {Math.max(1, Math.ceil(tracks.total / 100))}</span><button aria-label="Next music page" disabled={page * 100 >= tracks.total} onClick={() => setPage((p) => p + 1)}><ChevronRight size={15}/></button></footer>
        </div>
        <Divider label="Resize music file information" value={rightWidth} onChange={setRightWidth}/>
        <aside className="music-inspector"><div className="music-file-info"><h2>Info</h2>{selected ? <><h3>{trackLabel(selected)}</h3>{info}{embedded.length > 0 && <details open><summary>Embedded metadata</summary><dl>{embedded.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></details>}</> : <p className="music-muted">Select a track to see its file details and embedded metadata.</p>}</div></aside>
      </div>
      {creatingPlaylist && <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !saving) setCreatingPlaylist(false); }}><form className="music-dialog" onSubmit={(event) => { event.preventDefault(); void createPlaylist(); }}><header><h2>New playlist</h2><button type="button" aria-label="Close dialog" disabled={saving} onClick={() => setCreatingPlaylist(false)}><X size={20}/></button></header><label>Name<ClearableInput autoFocus required maxLength={200} value={draftName} onChange={(event) => setDraftName(event.target.value)}/></label>{error && <p className="music-error" role="alert">{error}</p>}<footer><button className="secondary-button" type="button" disabled={saving} onClick={() => setCreatingPlaylist(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save"}</button></footer></form></div>}
    </section>
  </div>;
}
