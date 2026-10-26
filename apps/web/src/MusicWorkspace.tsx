import { VideoPlayer } from "./VideoPlayer";
import { Halo, Scope, Spectrum, VisualizerOverlay, useAudioFeed } from "./MusicVisualizer";
import { mediaAnalyser, resumeMasterAudio } from "./audio-output";
import { PersistentDetails } from "./PersistentDetails";
import { MusicQueueDialog } from "./MusicQueueDialog";
import { ClearableInput } from "./ClearableField";
import { flushSync, createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, FolderPlus, ListMusic, Maximize2, Minimize2, Music2, Pause, Play, Plus, Repeat, Repeat1, Search, Shuffle, SkipBack, Star, SkipForward, Trash2, Volume2, X } from "lucide-react";
import { api, formatCount, formatDuration, formatSize } from "./media";
import { vaultUrl } from "./vault-session";
import { useUiState } from "./ui-state";
import { adjacentMusicTrack, musicQuery, musicSorts, trackLabel, type MusicLibrary, type MusicPage, type MusicScope, type MusicTrack } from "./music";
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

function Cover({ track }: { track: MusicTrack }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [track.id]);
  return <div className="music-cover-large">{track.has_cover && !failed
    ? <img key={track.id} src={vaultUrl(`/api/music/tracks/${track.id}/cover`)} alt={`Cover art for ${track.album || track.title}`} onError={() => setFailed(true)}/>
    : <div className="music-cover-empty" aria-hidden="true"><Music2 size={64}/></div>}</div>;
}

function CoverThumb({ track }: { track: MusicTrack }) {
  const [failed, setFailed] = useState(false);
  return <span className="music-thumb">{track.has_cover && !failed
    ? <img src={vaultUrl(`/api/music/tracks/${track.id}/cover`)} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)}/>
    : <Music2 size={14} aria-hidden="true"/>}</span>;
}

function Stars({ value, onChange, size = 13, label }: { value: number; onChange: (value: number) => void; size?: number; label: string }) {
  const [hover, setHover] = useState(0), shown = hover || value;
  return <span className="music-stars" role="radiogroup" aria-label={label} onMouseLeave={() => setHover(0)} onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
    {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} title={value === n ? "Clear rating" : `${n} star${n > 1 ? "s" : ""}`} className={n <= shown ? "on" : ""} onMouseEnter={() => setHover(n)} onClick={() => onChange(value === n ? 0 : n)}><Star size={size} fill={n <= shown ? "currentColor" : "none"}/></button>)}
  </span>;
}

export function MusicWorkspace({ visible, search, sidebarHost = null, onOpenSources, onAddSource, sourceRevision = "" }: { visible: boolean; search: string; sidebarHost?: HTMLElement | null; onOpenSources: () => void; onAddSource: () => void; sourceRevision?: string }) {
  const [library, setLibrary] = useState<MusicLibrary>(empty);
  const [scope, setScope] = useUiState<MusicScope>("vaultly.music.scope", allScope);
  const [showQueue, setShowQueue] = useState(false);
  const [showViz, setShowViz] = useState(false);
  const [sort, setSort] = useUiState("vaultly.music.sort", "");
  const [minRating, setMinRating] = useUiState("vaultly.music.minRating", 0);
  const [collapsed, setCollapsed] = useUiState("vaultly.music.dockCollapsed", false);
  const [listIds, setListIds] = useState<number[]>([]);
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
  const feed = useAudioFeed(audio, playing);
  const dock = useRef<HTMLDivElement>(null);
  const floatRoot = useRef<HTMLDivElement>(null);
  const playRequest = useRef(0);
  const currentRef = useRef(current); currentRef.current = current;
  const effectiveSearch = visible ? search : "";
  const query = musicQuery(scope, effectiveSearch, sort, minRating);
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

  useEffect(() => feed.subscribe((data) => { dock.current?.style.setProperty("--lvl", Math.min(1, data.bass * .8 + data.level * .5).toFixed(3)); }), [feed, collapsed, current, visible]);
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
    try { await ensureGraph(); const ids = await api<number[]>(`/api/music/queue?${query}`); if (ids.length) { await startTrack(id ?? ids[0]!, ids); } }
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
  // Keep the dock centred in the page area and the collapsed puck against the sidebar edge, following it as it hides.
  useEffect(() => {
    const shell = document.querySelector<HTMLElement>(".app-shell"), sidebar = shell?.querySelector<HTMLElement>(":scope > .sidebar"), root = floatRoot.current;
    if (!shell || !root) return;
    let raf = 0, until = 0;
    const place = () => {
      const hidden = shell.classList.contains("app-shell--sidebar-hidden") || window.innerWidth <= 700;
      const edge = hidden || !sidebar ? 0 : Math.max(0, Math.round(sidebar.getBoundingClientRect().right));
      root.style.setProperty("--dock-left", `${edge}px`);
      if (performance.now() < until) raf = requestAnimationFrame(place);
    };
    const settle = () => { until = performance.now() + 450; cancelAnimationFrame(raf); place(); };
    const mutations = new MutationObserver(settle); mutations.observe(shell, { attributes: true, attributeFilter: ["class", "style"] });
    window.addEventListener("resize", settle); settle();
    return () => { cancelAnimationFrame(raf); mutations.disconnect(); window.removeEventListener("resize", settle); };
  }, [visible, current]);
  const openPlaylist = async () => {
    try { setListIds(await api<number[]>(`/api/music/queue?${query}`)); setShowQueue(true); } catch (reason) { report(reason); }
  };
  const stopPlayback = () => { ++playRequest.current; audio.current?.pause(); audio.current?.removeAttribute("src"); audio.current?.load(); setCurrent(null); setQueue([]); setAudioError(""); setShowViz(false); };
  const seekTo = (seconds: number) => { if (audio.current) { audio.current.currentTime = seconds; setPosition(seconds); } };
  const progress = `${duration ? Math.min(100, (position / duration) * 100) : 0}%`;
  const rate = async (track: MusicTrack, rating: number) => {
    try {
      await api(`/api/music/tracks/${track.id}`, { method: "PATCH", body: JSON.stringify({ rating }) });
      const patch = <T extends MusicTrack | null>(item: T): T => (item && item.id === track.id ? { ...item, rating } : item);
      setTracks((page) => ({ ...page, items: page.items.map((item) => patch(item)) })); setSelected(patch); setCurrent(patch);
    } catch (reason) { report(reason); }
  };
  const customOrder = !sort;
  const openViz = () => { if (current) setShowViz(true); };
  const musicPlayer = <div ref={floatRoot} className={`music-root music-float${current ? " has-dock" : ""}`}>
    {(visible || current) && (collapsed
      ? <button ref={dock as unknown as React.RefObject<HTMLButtonElement>} type="button" className="music-puck" title={current ? `${trackLabel(current)} — click to expand, double-click for visualizer` : "Expand music player"} aria-label="Expand music player" onClick={() => setCollapsed(false)} onDoubleClick={openViz}>
          <Halo feed={feed} /><span className="music-puck-core">{playing ? <Pause size={18}/> : <Music2 size={18}/>}</span>{queue.length > 0 && <span className="music-puck-badge">{queue.length}</span>}
        </button>
      : <div ref={dock} className={`music-dock${playing ? " is-playing" : ""}`} role="region" aria-label="Music playback">
          <div className="music-dock-corner"><button type="button" title="Collapse player to corner" aria-label="Collapse player" onClick={() => setCollapsed(true)}><Minimize2 size={13}/></button></div>
          <div className="music-dock-main">
            <div className="music-deck">
              <button title="Previous track" aria-label="Previous track" onClick={() => next(-1)} disabled={!current}><SkipBack size={18}/></button>
              <div className="music-orb"><Halo feed={feed} /><button className="music-play-button" aria-label={playing ? "Pause music" : "Play music"} onClick={() => void togglePlay()} disabled={!current && !tracks.total}>{playing ? <Pause size={19}/> : <Play size={19}/>}</button></div>
              <button title="Next track" aria-label="Next track" onClick={() => next()} disabled={!current}><SkipForward size={18}/></button>
            </div>
            <div className="music-now" title={current ? "Double-click for the full-screen visualizer" : undefined} onDoubleClick={openViz}>
              <div className="music-now-text"><strong>{current ? trackLabel(current) : "Nothing playing"}</strong><small>{current ? `${current.codec.toUpperCase()} · ${current.bitrate ?? "—"} kbps · ${current.sample_rate ? `${current.sample_rate / 1000} kHz` : "—"}` : `${formatCount(library.stats.tracks)} tracks in your music library`}</small></div>
              <Spectrum feed={feed} bars={28} variant="mini" />
            </div>
            <div className="music-tools">
              <button title="Shuffle" aria-label="Shuffle" aria-pressed={shuffle} onClick={() => setShuffle(!shuffle)}><Shuffle size={16}/></button>
              <button title={`Repeat: ${repeat}`} aria-label={`Repeat: ${repeat}`} aria-pressed={repeat !== "off"} onClick={() => setRepeat(repeat === "off" ? "all" : repeat === "all" ? "one" : "off")}>{repeat === "one" ? <Repeat1 size={16}/> : <Repeat size={16}/>}</button>
              <button type="button" title={`Open ${scopeTitle}`} aria-label="Open active music playlist" aria-expanded={showQueue} disabled={!tracks.total} onClick={() => void openPlaylist()}><ListMusic size={18} /><span className="music-queue-count">{tracks.total}</span></button>
              <label className="music-volume"><Volume2 size={17}/><input aria-label="Music volume" type="range" min={0} max={1} step={.01} value={volume} onChange={(event) => setVolume(Number(event.target.value))}/></label>
              <button title="Full-screen visualizer (or double-click the track)" aria-label="Open full-screen visualizer" onClick={openViz} disabled={!current}><Maximize2 size={16}/></button>
              {current && <button title="Stop music and clear queue" aria-label="Stop music" onClick={stopPlayback}><X size={17}/></button>}
            </div>
          </div>
          <label className="music-seek"><small>{formatDuration(position)}</small><input aria-label="Seek music" type="range" min={0} max={duration || 1} step={.1} value={Math.min(position, duration || 1)} style={{ "--progress": progress } as CSSProperties} disabled={!current} onChange={(event) => seekTo(Number(event.target.value))}/><small>{formatDuration(duration)}</small></label>
        </div>)}
    {audioError && <div className="music-error" role="status">{audioError}</div>}
  </div>;
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
    {createPortal(musicPlayer, document.body)}
    {showViz && current && <VisualizerOverlay feed={feed} track={current} playing={playing} position={position} duration={duration} onSeek={seekTo} onToggle={() => void togglePlay()} onPrevious={() => next(-1)} onNext={() => next()} onClose={() => setShowViz(false)} />}
    {sidebarHost && visible && createPortal(musicNavigation, sidebarHost)}
    {showQueue && <MusicQueueDialog queue={listIds} currentId={current?.id} name={scopeTitle} onPlay={(id) => void playScope(id)} onClose={() => setShowQueue(false)} />}
    <section className="music-workspace" hidden={!visible} aria-label="Music library">
      {error && <div className="music-error" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError("")}><X size={14}/></button></div>}
      <div className="music-layout" style={{ "--music-right": `${Math.max(180, Math.min(480, rightWidth))}px` } as CSSProperties}>
        <div className="music-browser">
          <div className="music-scopes" aria-label="Audio analyzers">
        <section className="music-scope-panel"><span>Spectrum</span><Spectrum feed={feed} bars={48} /></section>
        <section className="music-scope-panel"><span>Oscilloscope</span><Scope feed={feed} /></section>
      </div>
          <header className="music-scope-heading"><div><h1>{scopeTitle}</h1><span>{formatCount(tracks.total)} tracks{current ? ` · ${queue.length} in playback queue` : ""}</span></div>
            <div className="music-scope-actions"><button className="music-accent-button" onClick={() => onAddSource()}><FolderPlus size={14}/> Add music folder</button><button className="music-accent-button" disabled={!tracks.total} onClick={() => void playScope()}><Play size={14}/> Play all</button></div></header>
          <div className="music-playlist-tools"><select aria-label="Sort tracks" title="Sort tracks" value={sort} onChange={(event) => setSort(event.target.value)}>{musicSorts.map(([value, label]) => <option key={value} value={value}>Sort: {label}</option>)}</select><select aria-label="Minimum rating" title="Minimum rating" value={minRating} onChange={(event) => setMinRating(Number(event.target.value))}><option value={0}>Any rating</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}★ and up</option>)}</select><select aria-label="Add selected music to playlist" value={playlistTarget} onChange={(event) => setPlaylistTarget(event.target.value)}><option value="">Add to playlist…</option>{library.playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button disabled={!playlistTarget || (!checked.length && !selected)} onClick={() => void addToPlaylist()}><Plus size={13}/> Add {checked.length || (selected ? 1 : 0)}</button>
            {inPlaylist && <><button title="Rename playlist" onClick={() => { const name = window.prompt("Playlist name", scope.name); if (name?.trim()) { void mutate(`/api/music/playlists/${scope.id}`, "PATCH", { name }); setScope({ ...scope, name }); } }}>Rename</button><button aria-label="Delete playlist" onClick={() => { if (window.confirm(`Delete playlist “${scope.name}”? Music files will be kept.`)) { void mutate(`/api/music/playlists/${scope.id}`, "DELETE"); chooseScope(allScope); } }}><Trash2 size={14}/></button></>}</div>
          <div className="music-track-scroll" aria-busy={loading}>
            <table className="music-table"><thead><tr><th><input aria-label="Select all music on this page" type="checkbox" checked={tracks.items.length > 0 && checked.length === tracks.items.length} onChange={(event) => setChecked(event.target.checked ? tracks.items.map((t) => t.id) : [])}/></th><th className="music-col-thumb" aria-label="Cover"></th><th className="music-col-artist">Artist</th><th className="music-col-title">Title</th><th className="music-col-spacer" aria-hidden="true"></th><th><button type="button" className="music-th-sort" aria-pressed={sort === "rating"} title="Sort by rating" onClick={() => setSort(sort === "rating" ? "" : "rating")}>Rating</button></th><th><button type="button" className="music-th-sort" aria-pressed={sort === "bitrate"} title="Sort by bitrate" onClick={() => setSort(sort === "bitrate" ? "" : "bitrate")}>Bitrate</button></th><th><button type="button" className="music-th-sort" aria-pressed={sort === "duration"} title="Sort by length" onClick={() => setSort(sort === "duration" ? "" : "duration")}>Time</button></th><th>Format</th>{inPlaylist && customOrder && <th>Order</th>}</tr></thead>
              <tbody>{tracks.items.map((track, index) => <tr key={track.id} className={`${selected?.id === track.id ? "selected " : ""}${current?.id === track.id ? "playing" : ""}`} onClick={() => setSelected(track)} onDoubleClick={() => void playScope(track.id)}>
                <td><input aria-label={`Select ${trackLabel(track)}`} type="checkbox" checked={checked.includes(track.id)} onChange={(event) => setChecked((ids) => event.target.checked ? [...ids, track.id] : ids.filter((id) => id !== track.id))}/></td>
                <td className="music-col-thumb"><CoverThumb key={track.id} track={track}/></td><td className="music-track-artist"><span>{current?.id === track.id && <span className={`music-eq${playing ? "" : " is-paused"}`} aria-label="Now playing"><i/><i/><i/></span>}{track.artist && track.artist !== "Unknown artist" ? track.artist : "—"}</span></td><td className="music-track-title"><span>{track.title}</span></td><td className="music-col-spacer"></td>
                <td className="music-rating-cell"><Stars value={track.rating} onChange={(value) => void rate(track, value)} label={`Rating for ${track.title}`}/></td>
                <td className="music-time">{track.bitrate ? `${track.bitrate} kbps` : "—"}</td><td className="music-time">{formatDuration(track.duration)}</td><td className="music-format">{track.codec.toUpperCase()}</td>
                {inPlaylist && customOrder && <td><div className="music-order"><button aria-label={`Move ${track.title} up`} onClick={() => void moveTrack(track.id, -1)}><ArrowUp size={13}/></button><button aria-label={`Move ${track.title} down`} onClick={() => void moveTrack(track.id, 1)}><ArrowDown size={13}/></button><button aria-label={`Remove ${track.title} from playlist`} onClick={() => void mutate(`/api/music/playlists/${scope.id}/tracks/${track.id}`, "DELETE")}><X size={13}/></button></div></td>}</tr>)}</tbody></table>
            {!loading && !tracks.total && <div className="music-empty"><Music2 size={40}/><h3>{library.stats.tracks ? "No tracks found" : "Make room for your music"}</h3><p>{library.stats.tracks ? "Search matches artist and file names only." : "Add a folder of files named “Artist - Song”."}</p>{!library.stats.tracks && <button className="secondary-button" onClick={() => onAddSource()}>Add music folder</button>}</div>}
          </div>
          <footer className="music-pagination"><span>{loading ? "Reading music…" : `${formatCount(tracks.total)} tracks`}{checked.length ? ` · ${checked.length} selected` : ""}</span><button aria-label="Previous music page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={15}/></button><span>{page} / {Math.max(1, Math.ceil(tracks.total / 100))}</span><button aria-label="Next music page" disabled={page * 100 >= tracks.total} onClick={() => setPage((p) => p + 1)}><ChevronRight size={15}/></button></footer>
        </div>
        <Divider label="Resize music file information" value={rightWidth} onChange={setRightWidth}/>
        <aside className="music-inspector">{selected && <Cover track={selected}/>}<div className="music-file-info">{selected ? <><h3>{trackLabel(selected)}</h3><Stars value={selected.rating} size={18} onChange={(value) => void rate(selected, value)} label="Rating"/>{info}{embedded.length > 0 && <details open><summary>Embedded metadata</summary><dl>{embedded.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></details>}</> : <p className="music-muted">Select a track to see its file details and embedded metadata.</p>}</div></aside>
      </div>
      {creatingPlaylist && <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !saving) setCreatingPlaylist(false); }}><form className="music-dialog" onSubmit={(event) => { event.preventDefault(); void createPlaylist(); }}><header><h2>New playlist</h2><button type="button" aria-label="Close dialog" disabled={saving} onClick={() => setCreatingPlaylist(false)}><X size={20}/></button></header><label>Name<ClearableInput autoFocus required maxLength={200} value={draftName} onChange={(event) => setDraftName(event.target.value)}/></label>{error && <p className="music-error" role="alert">{error}</p>}<footer><button className="secondary-button" type="button" disabled={saving} onClick={() => setCreatingPlaylist(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save"}</button></footer></form></div>}
    </section>
  </div>;
}
