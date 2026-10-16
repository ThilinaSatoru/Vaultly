import { VideoPlayer } from "./VideoPlayer";
import { mediaAnalyser, resumeMasterAudio } from "./audio-output";
import { PersistentDetails } from "./PersistentDetails";
import { MusicQueueDialog } from "./MusicQueueDialog";
import { ClearableInput } from "./ClearableField";
import { flushSync, createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Disc3, FolderPlus, Grid2X2, List, ListMusic, Music2, Pause, Play, Plus, RefreshCw, Repeat, Repeat1, Search, Shuffle, SkipBack, SkipForward, Star, Trash2, Volume2, X } from "lucide-react";
import { api, formatCount, formatDuration, formatSize } from "./media";
import { vaultUrl } from "./vault-session";
import { useUiState } from "./ui-state";
import { adjacentMusicTrack, musicQuery, type MusicAttribute, type MusicLibrary, type MusicPage, type MusicScope, type MusicTrack } from "./music";
import { MusicVisualizer } from "./MusicVisualizers";
import "./music.css";

interface MusicBridge {
  musicState?(state: { enabled: boolean; playing: boolean; title: string }): void;
  minimizeToTray?(): void;
  onMusicCommand?(handler: (command: string) => void): () => void;
}
const bridge = () => (window as Window & { vaultlyWindow?: MusicBridge }).vaultlyWindow;
const empty: MusicLibrary = { sources: [], artists: [], albums: [], playlists: [], attributes: [], stats: { tracks: 0, duration: 0, size_bytes: 0 } };
const allScope: MusicScope = { kind: "all", name: "All tracks" };
function Cover({ track, id, className = "" }: { track?: MusicTrack | null; id?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const coverId = id ?? (track?.has_cover ? track.id : undefined);
  useEffect(() => setFailed(false), [coverId, track?.modified_at_ms]);
  return <span className={`music-cover ${className}`}>{coverId && !failed ? <img src={vaultUrl(`/api/music/tracks/${coverId}/cover?v=${track?.modified_at_ms ?? 0}`)} alt="Album cover" loading="lazy" onError={() => setFailed(true)} /> : <Disc3 aria-hidden="true" />}</span>;
}
function Rating({ value, onChange }: { value: number; onChange: (rating: number) => void }) {
  return <span className="music-rating" aria-label={`${value} of 5 stars`}>{[1,2,3,4,5].map((star) => <button type="button" key={star} title={value === star ? "Clear rating" : `Rate ${star} stars`} aria-label={`Rate ${star} stars`} aria-pressed={value >= star} onClick={() => onChange(value === star ? 0 : star)}><Star size={13} fill={value >= star ? "currentColor" : "none"} /></button>)}</span>;
}
function Divider({ label, value, onChange, reverse = false }: { label: string; value: number; onChange: (value: number) => void; reverse?: boolean }) {
  const drag = useRef<{ x: number; value: number } | null>(null);
  return <div className="music-divider" role="separator" tabIndex={0} aria-label={label} aria-orientation="vertical" aria-valuemin={180} aria-valuemax={480} aria-valuenow={value}
    onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, value }; }}
    onPointerMove={(event) => { if (drag.current) onChange(Math.max(180, Math.min(480, drag.current.value + (event.clientX - drag.current.x) * (reverse ? -1 : 1)))); }}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
    onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); onChange(Math.max(180, Math.min(480, value + (event.key === "ArrowRight" ? 10 : -10) * (reverse ? -1 : 1)))); } }} />;
}

export function MusicWorkspace({ visible, search, sidebarHost = null, playerHost = null, onOpenSources, onAddSource, sourceRevision = "" }: { visible: boolean; search: string; sidebarHost?: HTMLElement | null; playerHost?: HTMLElement | null; onOpenSources: () => void; onAddSource: () => void; sourceRevision?: string }) {
  const [library, setLibrary] = useState<MusicLibrary>(empty);
  const [scope, setScope] = useUiState<MusicScope>("vaultly.music.scope", allScope);
  const [view, setView] = useUiState("vaultly.music.view", "list");
  const [sort, setSort] = useUiState("vaultly.music.sort", "album");
  const [inspectorVisible, setInspectorVisible] = useUiState("vaultly.music.inspectorVisible", true);
  const [inspectorSide, setInspectorSide] = useUiState("vaultly.music.inspectorSide", "right");
  const [panelOrder, setPanelOrder] = useUiState<string[]>("vaultly.music.panelOrder", ["spectrum", "scope", "info"]);
  const [hiddenPanels, setHiddenPanels] = useUiState<string[]>("vaultly.music.hiddenPanels", []);
  const [showQueue, setShowQueue] = useState(false);
  const [queueName, setQueueName] = useState("Playback queue");
  const [videoVisible, setVideoVisible] = useUiState("vaultly.music.videoVisible", true);
  const [rightWidth, setRightWidth] = useUiState("vaultly.music.rightWidth", 280);
  const [volume, setVolume] = useUiState("vaultly.music.volume", .8);
  const [trayEnabled, setTrayEnabled] = useUiState("vaultly.music.tray", true);
  const [repeat, setRepeat] = useUiState("vaultly.music.repeat", "off");
  const [shuffle, setShuffle] = useUiState("vaultly.music.shuffle", false);
  const [wholeLibrary, setWholeLibrary] = useState(true);
  const [ratingFilter, setRatingFilter] = useState(0);
  const [codecFilter, setCodecFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [albumGrid, setAlbumGrid] = useState(false);
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
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [dialog, setDialog] = useState<"playlist" | "attribute" | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftPatterns, setDraftPatterns] = useState("");
  const [draftKind, setDraftKind] = useState<"tag" | "category">("category");
  const [saving, setSaving] = useState(false);
  const [playlistTarget, setPlaylistTarget] = useState("");
  const audio = useRef<HTMLVideoElement>(null);
  const playRequest = useRef(0);
  const currentRef = useRef(current); currentRef.current = current;
  const effectiveSearch = visible ? search : "";
  const query = musicQuery(scope, effectiveSearch, wholeLibrary, { rating: ratingFilter, codec: codecFilter, source: sourceFilter, sort });
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
    bridge()?.musicState?.({ enabled: trayEnabled, playing, title: current ? `${current.title} · ${current.artist}` : "" });
  }, [trayEnabled, playing, current]);
  useEffect(() => () => { playRequest.current++; audio.current?.pause(); bridge()?.musicState?.({ enabled: false, playing: false, title: "" }); }, []);

  const ensureGraph = async () => {
    await resumeMasterAudio();
    if (audio.current) setAnalyser(mediaAnalyser(audio.current));
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
    try { await ensureGraph(); const ids = await api<number[]>(`/api/music/queue?${query}`); if (ids.length) { setQueueName(scope.name); await startTrack(id ?? ids[0]!, ids); } }
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
    navigator.mediaSession.metadata = new MediaMetadata({ title: current.title, artist: current.artist, album: current.album,
      artwork: current.has_cover ? [{ src: new URL(vaultUrl(`/api/music/tracks/${current.id}/cover`), location.origin).href, type: "image/jpeg" }] : [] });
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    const actions: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ["play", () => { void ensureGraph().then(() => audio.current?.play()).catch(report); }], ["pause", () => audio.current?.pause()],
      ["nexttrack", () => next()], ["previoustrack", () => next(-1)],
      ["seekto", (event) => { if (audio.current && event.seekTime !== undefined) audio.current.currentTime = event.seekTime; }],
    ];
    for (const [action, handler] of actions) { try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Optional platform media key. */ } }
    return () => { for (const [action] of actions) { try { navigator.mediaSession.setActionHandler(action, null); } catch { /* Unsupported. */ } } };
  }, [current, playing, queue, repeat, shuffle]);
  const setRating = async (track: MusicTrack, rating: number) => {
    await mutate(`/api/music/tracks/${track.id}`, "PATCH", { rating });
    if (current?.id === track.id) setCurrent({ ...current, rating });
  };
  const chooseScope = (nextScope: MusicScope) => { setScope(nextScope); if (sort === "playlist" && nextScope.kind !== "playlist") setSort("album"); setPage(1); setAlbumGrid(false); setChecked([]); };
  const showDialog = (kind: typeof dialog) => { setDraftName(""); setDraftPatterns(""); setDialog(kind); };
  const saveDialog = async () => {
    setSaving(true);
    try {
      if (dialog === "playlist") { const p = await api<{ id: number; name: string }>("/api/music/playlists", { method: "POST", body: JSON.stringify({ name: draftName }) }); chooseScope({ kind: "playlist", id: p.id, name: p.name }); }
      if (dialog === "attribute") await api("/api/music/attributes", { method: "POST", body: JSON.stringify({ kind: draftKind, name: draftName, patterns: draftPatterns.split(";").map((p) => p.trim()).filter(Boolean) }) });
      setDialog(null); setRevision((v) => v + 1); await refresh();
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
  const scopeTitle = effectiveSearch.trim() && wholeLibrary ? "Search music library" : scope.name;
  const updateAttribute = (attribute: MusicAttribute, enabled: boolean) => {
    if (!selected) return;
    void mutate(`/api/music/tracks/${selected.id}`, "PATCH", { attributes: enabled ? [...selected.attributes.map((a) => a.id), attribute.id] : selected.attributes.filter((a) => a.id !== attribute.id).map((a) => a.id) });
  };

  const movePanel = (panel: string, direction: number) => setPanelOrder((order) => {
    const next = [...order], index = next.indexOf(panel), to = index + direction;
    if (index < 0 || to < 0 || to >= next.length) return order;
    [next[index], next[to]] = [next[to]!, next[index]!]; return next;
  });
  const panelNames: Record<string, string> = { spectrum: "Spectrum", scope: "Oscilloscope", info: "File information" };
  const musicFileInfo = (<div className="music-file-info"><h2>File information</h2>{selected ? <><Cover track={selected} className="music-detail-cover"/><h3>{selected.title}</h3><p>{selected.artist}</p><Rating value={selected.rating} onChange={(rating) => void setRating(selected,rating)}/><dl>{Object.entries({ Album: selected.album, "Album artist": selected.album_artist, "Track / disc": `${selected.track_number || "—"} / ${selected.disc_number || "—"}`, Year: selected.year || "—", Duration: formatDuration(selected.duration), Codec: selected.codec.toUpperCase(), Bitrate: selected.bitrate ? `${selected.bitrate} kbps` : "—", "Sample rate": selected.sample_rate ? `${selected.sample_rate} Hz` : "—", "Bit depth": selected.bit_depth ? `${selected.bit_depth} bit` : "—", Channels: selected.channels || "—", Size: formatSize(selected.size_bytes), Filename: selected.filename, Folder: selected.relative_path, Source: selected.source_name, Modified: new Date(selected.modified_at_ms).toLocaleString() }).map(([name,value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
          <details><summary>Embedded metadata</summary><dl>{Object.entries(selected.metadata ?? {}).map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></details><details open><summary>Categories & tags</summary><div className="music-attribute-checks">{library.attributes.map((a) => <label key={a.id}><input type="checkbox" checked={selected.attributes.some((s) => s.id === a.id)} onChange={(event) => updateAttribute(a,event.target.checked)}/><span>{a.name}</span><small>{a.kind}</small></label>)}</div><button onClick={() => showDialog("attribute")}><Plus size={13}/> New category / tag</button></details></> : <p className="music-muted">Select a track for detailed audio properties, embedded metadata, artwork, and attributes.</p>}</div>);
  const musicPlayer = <>
    {(visible || current) && <div className="music-player" aria-label="Music playback">
      <Cover track={current} /><div className="music-now"><strong>{current?.title ?? "Your music, in its own space"}</strong><span>{current ? `${current.artist} · ${current.album}` : "Choose a track to start listening"}</span><small>{current ? `${current.codec.toUpperCase()} · ${current.bitrate ?? "—"} kbps · ${current.sample_rate ? `${current.sample_rate / 1000} kHz` : "—"}` : `${formatCount(library.stats.tracks)} tracks in your music library`}</small></div>
      <div className="music-transport"><div><button title="Shuffle" aria-label="Shuffle" aria-pressed={shuffle} onClick={() => setShuffle(!shuffle)}><Shuffle size={16}/></button><button title="Previous track" aria-label="Previous track" onClick={() => next(-1)} disabled={!current}><SkipBack size={18}/></button><button className="music-play-button" aria-label={playing ? "Pause music" : "Play music"} onClick={() => void togglePlay()} disabled={!current && !tracks.total}>{playing ? <Pause size={20}/> : <Play size={20}/>}</button><button title="Next track" aria-label="Next track" onClick={() => next()} disabled={!current}><SkipForward size={18}/></button><button title={`Repeat: ${repeat}`} aria-label={`Repeat: ${repeat}`} aria-pressed={repeat !== "off"} onClick={() => setRepeat(repeat === "off" ? "all" : repeat === "all" ? "one" : "off")}>{repeat === "one" ? <Repeat1 size={16}/> : <Repeat size={16}/>}</button></div>
        <label className="music-seek"><small>{formatDuration(position)}</small><input aria-label="Seek music" type="range" min={0} max={duration || 1} step={.1} value={Math.min(position, duration || 1)} disabled={!current} onChange={(event) => { if (audio.current) { audio.current.currentTime = Number(event.target.value); setPosition(Number(event.target.value)); } }}/><small>{formatDuration(duration)}</small></label></div>
      <MusicVisualizer analyser={analyser} mode="spectrum" active={playing} compact />
      <button type="button" title="Open current active playlist" aria-label="Open current active playlist" aria-expanded={showQueue} onClick={() => setShowQueue(true)}><ListMusic size={19} /><span className="music-queue-count">{queue.length}</span></button>
      <label className="music-volume"><Volume2 size={17}/><input aria-label="Music volume" type="range" min={0} max={1} step={.01} value={volume} onChange={(event) => setVolume(Number(event.target.value))}/></label>
      {current && <button title="Stop music and clear queue" aria-label="Stop music" onClick={() => { ++playRequest.current; audio.current?.pause(); audio.current?.removeAttribute("src"); audio.current?.load(); setCurrent(null); setQueue([]); setAudioError(""); }}><X size={17}/></button>}
    </div>}
    {audioError && <div className="music-error" role="status">{audioError}</div>}
  </>;
  const musicNavigation = (
<aside className="music-sidebar"><label className="music-side-search"><Search size={15}/><ClearableInput aria-label="Search music artists, albums and playlists" placeholder="Find artist, album, playlist…" value={sidebarSearch} onChange={(event) => setSidebarSearch(event.target.value)}/></label>
          <button className={scope.kind === "all" && !albumGrid ? "active" : ""} onClick={() => chooseScope(allScope)}><Music2 size={17}/> All tracks <small>{library.stats.tracks}</small></button>
          <button className={albumGrid ? "active" : ""} onClick={() => { setAlbumGrid(true); setScope(allScope); }}><Disc3 size={17}/> Browse albums <small>{library.albums.length}</small></button>
          <PersistentDetails className="music-nav-group" stateKey="music.artists" open><summary>Artists <small>{library.artists.length}</small></summary><div className="music-nav-list">{library.artists.filter((a) => searchSide(a.name)).map((a) => <button key={a.id} className={scope.kind === "artist" && scope.id === a.id ? "active" : ""} onClick={() => chooseScope({ kind: "artist", id: a.id, name: a.name })}><span className="music-artist-initial">{a.name.slice(0,1)}</span><span>{a.name}</span><small>{a.track_count}</small></button>)}{!library.artists.length && <p className="music-muted">Artists appear after scanning.</p>}</div></PersistentDetails>
          <PersistentDetails className="music-nav-group" stateKey="music.albums" open><summary>Albums</summary><div className="music-nav-list">{library.albums.filter((a) => searchSide(`${a.title} ${a.artist}`)).map((a) => <button key={a.id} className={scope.kind === "album" && scope.id === a.id ? "active" : ""} onClick={() => chooseScope({ kind: "album", id: a.id, name: a.title })}><Disc3 size={14}/><span>{a.title}</span><small>{a.track_count}</small></button>)}</div></PersistentDetails>
          <PersistentDetails className="music-nav-group" stateKey="music.playlists" open><summary>Custom playlists <button aria-label="Create music playlist" title="Create playlist" onClick={() => showDialog("playlist")}><Plus size={15}/></button></summary><div className="music-nav-list">{library.playlists.filter((p) => searchSide(p.name)).map((p) => <button key={p.id} className={scope.kind === "playlist" && scope.id === p.id ? "active" : ""} onClick={() => { chooseScope({ kind: "playlist", id: p.id, name: p.name }); setSort("playlist"); }}><ListMusic size={15}/><span>{p.name}</span><small>{p.track_count}</small></button>)}</div></PersistentDetails>
          <PersistentDetails className="music-nav-group" stateKey="music.attributes" open><summary>Categories & tags <button aria-label="Create music attribute" title="Create category or tag" onClick={() => showDialog("attribute")}><Plus size={15}/></button></summary><div className="music-nav-list">{library.attributes.filter((a) => searchSide(a.name)).map((a) => <button key={a.id} className={scope.kind === "attribute" && scope.id === a.id ? "active" : ""} onClick={() => chooseScope({ kind: "attribute", id: a.id, name: a.name })}><span className="music-kind">{a.kind === "category" ? "C" : "#"}</span><span>{a.name}</span><small>{a.track_count}</small></button>)}</div></PersistentDetails>
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
      <div className={`music-layout${inspectorVisible ? "" : " music-layout--no-inspector"}${inspectorSide === "left" ? " music-layout--inspector-left" : ""}`} style={{ "--music-right": `${Math.max(180, Math.min(480,rightWidth))}px` } as CSSProperties}>
        <div className="music-browser"><header className="music-scope-heading"><div><h1>{albumGrid && !effectiveSearch ? "Albums" : scopeTitle}</h1><span>{formatCount(tracks.total)} tracks{current ? ` · ${queue.length} in playback queue` : ""}</span></div><div className="music-scope-actions"><button className="music-accent-button" onClick={() => onAddSource()}><FolderPlus size={14}/> Add music folder</button><button className="music-accent-button" disabled={!tracks.total} onClick={() => void playScope()}><Play size={14}/> Play all</button></div></header>
          <div className="music-toolbar"><label>Sort <select aria-label="Sort music" value={sort} onChange={(event) => setSort(event.target.value)}><option value="album">Album / track</option><option value="title">Title</option><option value="artist">Artist</option><option value="rating">Stars: highest first</option><option value="duration">Duration</option><option value="bitrate">Bitrate</option><option value="size">File size</option>{scope.kind === "playlist" && <option value="playlist">Playlist order</option>}</select></label><details className="music-layout-options"><summary>Layout</summary><div><label><input type="checkbox" checked={inspectorVisible} onChange={(event) => setInspectorVisible(event.target.checked)}/> Show side panel</label><label>Side <select aria-label="Music panel position" value={inspectorSide} onChange={(event) => setInspectorSide(event.target.value)}><option value="left">Left</option><option value="right">Right</option></select></label>{["spectrum", "scope", "info"].map((panel) => <label key={panel}><input type="checkbox" checked={!hiddenPanels.includes(panel)} onChange={(event) => setHiddenPanels((current) => event.target.checked ? current.filter((entry) => entry !== panel) : [...current, panel])}/>{panelNames[panel]}</label>)}<label><input type="checkbox" checked={videoVisible} onChange={(event) => setVideoVisible(event.target.checked)}/> Music video picture</label><button type="button" onClick={() => { setPanelOrder(["spectrum", "scope", "info"]); setHiddenPanels([]); setInspectorVisible(true); setInspectorSide("right"); }}>Reset layout</button></div></details><div className="music-view-toggle"><button aria-label="Music list view" aria-pressed={view === "list"} onClick={() => setView("list")}><List size={16}/></button><button aria-label="Music card view" aria-pressed={view === "cards"} onClick={() => setView("cards")}><Grid2X2 size={16}/></button></div></div>
          <div className="music-search-options"><details className="music-advanced"><summary>Advanced filters</summary><div>{effectiveSearch && <label><input type="checkbox" checked={wholeLibrary} onChange={(event) => setWholeLibrary(event.target.checked)}/> Search entire music library</label>}<label>Minimum stars<select value={ratingFilter} onChange={(event) => setRatingFilter(Number(event.target.value))}><option value={0}>Any rating</option>{[1,2,3,4,5].map((r) => <option key={r} value={r}>{r}+ stars</option>)}</select></label><label>Codec<ClearableInput value={codecFilter} onChange={(event) => setCodecFilter(event.target.value)} placeholder="e.g. flac"/></label><label>Folder<select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="">All folders</option>{library.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><button onClick={() => { setRatingFilter(0); setCodecFilter(""); setSourceFilter(""); }}>Reset</button></div></details></div>
          <div className="music-playlist-tools"><select aria-label="Add selected music to playlist" value={playlistTarget} onChange={(event) => setPlaylistTarget(event.target.value)}><option value="">Choose playlist…</option>{library.playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button disabled={!playlistTarget || (!checked.length && !selected)} onClick={() => void addToPlaylist()}><Plus size={13}/> Add {checked.length || (selected ? 1 : 0)}</button>{scope.kind === "playlist" && <><button title="Rename playlist" onClick={() => { const name = window.prompt("Playlist name", scope.name); if (name?.trim()) { void mutate(`/api/music/playlists/${scope.id}`, "PATCH", { name }); setScope({ ...scope, name }); } }}>Rename</button><button aria-label="Delete playlist" onClick={() => { if (window.confirm(`Delete playlist “${scope.name}”? Music files will be kept.`)) { void mutate(`/api/music/playlists/${scope.id}`, "DELETE"); chooseScope(allScope); } }}><Trash2 size={14}/></button></>}</div>
          <div className="music-track-scroll" aria-busy={loading}>
          {albumGrid && !effectiveSearch ? <div className="music-albums">{library.albums.filter((a) => searchSide(`${a.title} ${a.artist}`)).map((album) => <button key={album.id} onClick={() => chooseScope({ kind: "album", id: album.id, name: album.title })}><Cover id={album.cover_track_id}/><strong>{album.title}</strong><span>{album.artist}</span><small>{album.year} · {album.track_count} tracks · {formatDuration(album.duration)}</small></button>)}</div> : view === "list" ? <table className="music-table"><thead><tr><th><input aria-label="Select all music on this page" type="checkbox" checked={tracks.items.length > 0 && checked.length === tracks.items.length} onChange={(event) => setChecked(event.target.checked ? tracks.items.map((t) => t.id) : [])}/></th><th>Track / artist / album</th><th>Audio</th><th>Time / size</th><th>Stars</th><th>Attributes</th>{scope.kind === "playlist" && <th>Order</th>}</tr></thead><tbody>{tracks.items.map((track) => <tr key={track.id} className={`${selected?.id === track.id ? "selected " : ""}${current?.id === track.id ? "playing" : ""}`} onClick={() => setSelected(track)} onDoubleClick={() => void playScope(track.id)}>
            <td><input aria-label={`Select ${track.title}`} type="checkbox" checked={checked.includes(track.id)} onChange={(event) => setChecked((ids) => event.target.checked ? [...ids, track.id] : ids.filter((id) => id !== track.id))}/></td><td><div className="music-track-name"><button className="music-track-play" aria-label={`Play ${track.title}`} onClick={() => void playScope(track.id)}><Cover track={track}/><Play size={13}/></button><div><button onClick={() => setSelected(track)}>{track.track_number ? <small>{String(track.track_number).padStart(2,"0")} </small> : null}{track.title}</button><span>{track.artist}</span><small>{track.album}</small></div></div></td><td><strong>{track.codec.toUpperCase() || "—"}</strong><small>{track.bitrate ?? "—"} kbps</small><small>{track.sample_rate ? `${track.sample_rate / 1000} kHz` : "—"}{track.bit_depth ? ` · ${track.bit_depth} bit` : ""}</small></td><td>{formatDuration(track.duration)}<small>{formatSize(track.size_bytes)}</small></td><td><Rating value={track.rating} onChange={(rating) => void setRating(track,rating)}/></td><td><div className="music-chips">{track.attributes.slice(0,3).map((a) => <span key={a.id} title={a.kind}>{a.name}</span>)}{track.attributes.length > 3 && <span>+{track.attributes.length - 3}</span>}</div></td>{scope.kind === "playlist" && <td><div className="music-order"><button aria-label={`Move ${track.title} up`} onClick={() => void moveTrack(track.id,-1)}><ArrowUp size={13}/></button><button aria-label={`Move ${track.title} down`} onClick={() => void moveTrack(track.id,1)}><ArrowDown size={13}/></button><button aria-label={`Remove ${track.title} from playlist`} onClick={() => void mutate(`/api/music/playlists/${scope.id}/tracks/${track.id}`,"DELETE")}><X size={13}/></button></div></td>}</tr>)}</tbody></table> : <div className="music-cards">{tracks.items.map((track) => <article key={track.id} className={selected?.id === track.id ? "selected" : ""}><button className="music-card-art" onClick={() => setSelected(track)} onDoubleClick={() => void playScope(track.id)}><Cover track={track}/></button><button className="music-card-title" onClick={() => setSelected(track)}>{track.title}</button><span>{track.artist}</span><small>{track.album}</small><small>{track.codec.toUpperCase()} · {track.bitrate ?? "—"} kbps · {formatDuration(track.duration)} · {formatSize(track.size_bytes)}</small><div className="music-chips">{track.attributes.map((a) => <span key={a.id}>{a.name}</span>)}</div><div className="music-card-actions"><Rating value={track.rating} onChange={(rating) => void setRating(track,rating)}/><button aria-label={`Play ${track.title}`} onClick={() => void playScope(track.id)}><Play size={15}/></button><input type="checkbox" aria-label={`Select ${track.title}`} checked={checked.includes(track.id)} onChange={(event) => setChecked((ids) => event.target.checked ? [...ids,track.id] : ids.filter((id) => id !== track.id))}/></div></article>)}</div>}
          {!loading && !tracks.total && <div className="music-empty"><Music2 size={40}/><h3>{library.stats.tracks ? "No tracks in this view" : "Make room for your music"}</h3><p>{library.stats.tracks ? "Try another scope or clear the search filters." : "Add a folder to index tracks, embedded artwork, artists and albums."}</p>{!library.stats.tracks && <button className="secondary-button" onClick={() => onAddSource()}>Add music folder</button>}</div>}
          </div><footer className="music-pagination"><span>{loading ? "Reading music…" : `${formatCount(tracks.total)} tracks`}{checked.length ? ` · ${checked.length} selected` : ""}</span><button aria-label="First music page" disabled={page <= 1} onClick={() => setPage(1)}>First</button><button aria-label="Previous music page" disabled={page <= 1} onClick={() => setPage((p) => p-1)}><ChevronLeft size={15}/></button><span>{page} / {Math.max(1,Math.ceil(tracks.total / 100))}</span><button aria-label="Next music page" disabled={page * 100 >= tracks.total} onClick={() => setPage((p) => p+1)}><ChevronRight size={15}/></button></footer>
        </div>{inspectorVisible && <Divider label="Resize music file information" value={rightWidth} onChange={setRightWidth} reverse={inspectorSide !== "left"}/>}
        <aside className="music-inspector" hidden={!inspectorVisible}>{panelOrder.filter((panel) => !hiddenPanels.includes(panel)).map((panel) => <PersistentDetails className="music-inspector-panel" key={panel} stateKey={`music.panel.${panel}`} open><summary>{panelNames[panel]}<span><button type="button" aria-label={`Move ${panelNames[panel]} up`} disabled={panelOrder.indexOf(panel) === 0} onClick={(event) => { event.preventDefault(); movePanel(panel, -1); }}><ArrowUp size={13}/></button><button type="button" aria-label={`Move ${panelNames[panel]} down`} disabled={panelOrder.indexOf(panel) === panelOrder.length - 1} onClick={(event) => { event.preventDefault(); movePanel(panel, 1); }}><ArrowDown size={13}/></button><button type="button" aria-label={`Hide ${panelNames[panel]}`} onClick={(event) => { event.preventDefault(); setHiddenPanels((current) => [...current, panel]); }}><X size={13}/></button></span></summary>{panel === "info" ? musicFileInfo : <MusicVisualizer analyser={analyser} mode={panel === "scope" ? "scope" : "spectrum"} active={visible && playing}/>}</PersistentDetails>)}

        </aside>
      </div>
      {dialog && <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !saving) setDialog(null); }}><form className="music-dialog" onSubmit={(event) => { event.preventDefault(); void saveDialog(); }}><header><h2>{dialog === "playlist" ? "New music playlist" : "Music category / tag"}</h2><button type="button" aria-label="Close dialog" disabled={saving} onClick={() => setDialog(null)}><X size={20}/></button></header><label>Name<ClearableInput autoFocus required maxLength={200} value={draftName} onChange={(event) => setDraftName(event.target.value)}/></label>{dialog === "attribute" && <><label>Type<select value={draftKind} onChange={(event) => setDraftKind(event.target.value as "tag" | "category")}><option value="category">Category</option><option value="tag">Tag</option></select></label><label>Automatic matching patterns<ClearableInput value={draftPatterns} onChange={(event) => setDraftPatterns(event.target.value)} placeholder="Separate aliases with semicolons"/></label><p>Names and aliases match filenames, folders and embedded tags during scans, using English word forms. Genres become categories automatically. Save an existing name to update its patterns, then rescan.</p></>}{error && <p className="music-error" role="alert">{error}</p>}<footer><button className="secondary-button" type="button" disabled={saving} onClick={() => setDialog(null)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save"}</button></footer></form></div>}
    </section>
  </div>;
}

