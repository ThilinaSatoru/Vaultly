import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowLeft, ExternalLink, Pencil, Play, Plus, Trash2, Youtube, ListVideo, LoaderCircle, ClipboardPaste, Search } from "lucide-react";
import { AttributeEditorDialog } from "./AttributeEditorDialog";
import { ActionMenu } from "./ActionMenu";
import { Select } from "./Select";
import { api } from "./media";
import { ClearableInput } from "./ClearableField";
import { registerExternalVolume } from "./audio-output";

interface Playlist { id: number; name: string; remote_id: string | null; item_count: number }
interface Video { id: number; video_id: string; title: string; author: string; entry_id?: number; position?: number }
interface VideoPage { items: Video[]; total: number; page: number; pageSize: number }
interface EmbedPlayer {
  destroy(): void; pauseVideo(): void; setVolume(value: number): void;
  getVideoUrl(): string;
  loadPlaylist(options: { listType: string; list: string } | string[], index?: number, startSeconds?: number): void;
}
interface YoutubeApi { Player: new (element: HTMLElement, options: unknown) => EmbedPlayer }
type YoutubeWindow = Window & { YT?: YoutubeApi; onYouTubeIframeAPIReady?: () => void };
let apiPromise: Promise<YoutubeApi> | null = null;
function loadYoutube() {
  const scope = window as YoutubeWindow;
  if (scope.YT?.Player) return Promise.resolve(scope.YT);
  if (!apiPromise) apiPromise = new Promise<YoutubeApi>((resolve, reject) => {
    const previous = scope.onYouTubeIframeAPIReady;
    const script = document.createElement("script"); script.src = "https://www.youtube.com/iframe_api";
    const timer = window.setTimeout(() => { apiPromise = null; script.remove(); reject(new Error("YouTube did not load. Check your connection or content blocker.")); }, 20000);
    scope.onYouTubeIframeAPIReady = () => { previous?.(); clearTimeout(timer); if (scope.YT) resolve(scope.YT); };
    script.onerror = () => { clearTimeout(timer); apiPromise = null; script.remove(); reject(new Error("Could not connect to YouTube.")); };
    document.head.append(script);
  });
  return apiPromise;
}
interface Playback { key: number; name: string; remoteId?: string; videos?: string[]; index?: number }
export function YoutubeEmbed({ playback }: { playback: Playback }) {
  const host = useRef<HTMLDivElement>(null), player = useRef<EmbedPlayer | null>(null);
  const [error, setError] = useState("");
  const [link, setLink] = useState(playback.remoteId ? `https://www.youtube.com/playlist?list=${playback.remoteId}` : `https://www.youtube.com/watch?v=${playback.videos?.[playback.index ?? 0]}`);
  useEffect(() => {
    let cancelled = false, unsubscribe = () => {};
    const syncLink = () => {
      if (!player.current) return;
      try { const url = new URL(player.current.getVideoUrl()); if (url.protocol === "https:" && ["www.youtube.com", "youtube.com"].includes(url.hostname)) setLink(url.href); } catch { /* Keep the saved playlist/video link until the player exposes a video. */ }
    };
    const pause = (event: Event) => { if ((event as CustomEvent).detail !== "youtube") player.current?.pauseVideo(); };
    window.addEventListener("vaultly-playback-start", pause);
    setError("");
    void loadYoutube().then((youtube) => {
      if (cancelled || !host.current) return;
      const target = document.createElement("div"); host.current.replaceChildren(target);
      player.current = new youtube.Player(target, {
        width: "100%", height: "100%", host: "https://www.youtube-nocookie.com",
        videoId: playback.videos?.[playback.index ?? 0],
        playerVars: { origin: location.origin, playsinline: 1, autoplay: 1, ...(playback.remoteId ? { listType: "playlist", list: playback.remoteId } : {}) },
        events: {
          onReady: () => {
            if (cancelled || !player.current) return;
            unsubscribe = registerExternalVolume((volume) => player.current?.setVolume(Math.round(volume * 100)));
            if (playback.remoteId) player.current.loadPlaylist({ listType: "playlist", list: playback.remoteId });
            else player.current.loadPlaylist(playback.videos ?? [], playback.index ?? 0, 0);
          },
          onStateChange: (event: { data: number }) => { syncLink(); if (event.data === 1) { setError(""); window.dispatchEvent(new CustomEvent("vaultly-playback-start", { detail: "youtube" })); } },
          onAutoplayBlocked: () => setError("Press Play inside the YouTube player to begin playback."),
          onError: (event: { data: number }) => { syncLink(); setError(`YouTube cannot play this item in an embed (${event.data}). It may be private, removed, restricted, or unavailable for embedding.`); },
        },
      });
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { cancelled = true; unsubscribe(); window.removeEventListener("vaultly-playback-start", pause); player.current?.destroy(); player.current = null; };
  }, [playback]);
  return <section className="youtube-player"><div className="youtube-embed" ref={host} />{error && <p role="alert" className="form-error">{error}</p>}<div><strong>{playback.name}</strong><a href={link} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open on YouTube</a></div></section>;
}

export function YoutubeLibrary({ search, onSearchChange }: { search: string; onSearchChange: (value: string) => void }) {
  const [addDialog, setAddDialog] = useState(false), [addPlaylist, setAddPlaylist] = useState(""), [newPlaylist, setNewPlaylist] = useState("");
  const [channels, setChannels] = useState<Array<{ name: string; video_count: number }>>([]), [channel, setChannel] = useState("");
  const [playlists, setPlaylists] = useState<Playlist[]>([]), [selected, setSelected] = useState<number | null>(null);
  const [view, setView] = useState<"videos" | "playlists">("videos"), [page, setPage] = useState(1), [sort, setSort] = useState("added");
  const [videos, setVideos] = useState<VideoPage>({ items: [], total: 0, page: 1, pageSize: 60 });
  const [checked, setChecked] = useState<number[]>([]), [playlistTarget, setPlaylistTarget] = useState("");
  const [playback, setPlayback] = useState<Playback | null>(null), [videoUrl, setVideoUrl] = useState(""), [name, setName] = useState("");
  const [rename, setRename] = useState<{ kind: "video" | "playlist"; id: number; title: string } | null>(null);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [revision, setRevision] = useState(0);
  const current = playlists.find((playlist) => playlist.id === selected);
  const query = new URLSearchParams({ search, sort, ...(channel ? { channel: channel === "__unknown" ? "" : channel } : {}), ...(selected ? { playlist: String(selected) } : {}) }).toString();
  const report = (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason));
  useEffect(() => { setPage(1); setChecked([]); }, [query, view]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([api<Playlist[]>("/api/youtube/playlists", { signal: controller.signal }), api<Array<{ name: string; video_count: number }>>("/api/youtube/channels", { signal: controller.signal })]).then(([playlists, channels]) => { if (!controller.signal.aborted) { setPlaylists(playlists); setChannels(channels); } }).catch((reason) => { if (!controller.signal.aborted) report(reason); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true);
    void api<VideoPage>(`/api/youtube/videos?${query}&page=${page}`, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setVideos(result); setChecked([]);
      const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize)); if (page > lastPage) setPage(lastPage);
    }).catch((reason) => { if (!controller.signal.aborted) report(reason); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, page, revision]);
  const mutate = async (work: () => Promise<unknown>) => {
    setBusy(true); setError(""); setNotice("");
    try { await work(); return true; }
    catch (reason) { report(reason); return false; } finally { setBusy(false); setRevision((value) => value + 1); }
  };
  const send = (path: string, method: string, body?: unknown) => api(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  const openVideo = (video: Video) => {
    setPlayback({ key: Date.now(), name: video.title, videos: [video.video_id] });
  };
  const playPlaylist = async () => {
    if (!current) return;
    if (current.remote_id) { setPlayback({ key: Date.now(), name: current.name, remoteId: current.remote_id }); return; }
    try { const queue = await api<Video[]>(`/api/youtube/queue?${new URLSearchParams({ playlist: String(current.id), sort: "playlist" })}`); if (queue.length) setPlayback({ key: Date.now(), name: current.name, videos: queue.map((video) => video.video_id) }); }
    catch (reason) { report(reason); }
  };
  const move = (video: Video, direction: number) => {
    void mutate(async () => {
      const entries = await api<Array<{ id: number }>>(`/api/youtube/playlists/${selected}/entries`);
      const ids = entries.map((entry) => entry.id), index = ids.indexOf(video.entry_id!), target = index + direction;
      if (index < 0 || target < 0 || target >= ids.length) return;
      [ids[index], ids[target]] = [ids[target]!, ids[index]!];
      await send(`/api/youtube/playlists/${selected}/order`, "PUT", { ids });
    });
  };
  const choosePlaylist = (playlist: Playlist) => { setSelected(playlist.id); setView("videos"); setSort("playlist"); setError(""); setNotice(""); };
  const addToPlaylist = () => {
    void mutate(async () => {
      // Skip existing memberships so bulk adds are safe to repeat.
      const existing = new Set((await api<Array<{ video_id: string }>>(`/api/youtube/playlists/${playlistTarget}/entries`)).map((entry) => entry.video_id));
      const chosen = videos.items.filter((video) => checked.includes(video.id));
      for (const video of chosen) if (!existing.has(video.video_id)) await send(`/api/youtube/playlists/${playlistTarget}/entries`, "POST", { videoId: video.id });
      setChecked([]); setNotice(`Saved to ${playlists.find((playlist) => playlist.id === Number(playlistTarget))?.name ?? "playlist"}.`);
    });
  };
  const pasteVideo = async () => {
    setVideoUrl(""); setNewPlaylist(""); setAddPlaylist(current && !current.remote_id ? String(current.id) : ""); setAddDialog(true); setError(""); setNotice("");
    try { setVideoUrl((await navigator.clipboard.readText()).trim()); }
    catch { setNotice("Clipboard access is unavailable. Paste the video link into the dialog."); }
  };
  const addVideo = () => {
    void mutate(async () => {
      const video = await api<Video>("/api/youtube/videos", { method: "POST", body: JSON.stringify({ url: videoUrl }) });
      let playlist = addPlaylist;
      if (playlist === "__new") { const created = await api<Playlist>("/api/youtube/playlists", { method: "POST", body: JSON.stringify({ name: newPlaylist }) }); playlist = String(created.id); }
      if (playlist !== "__library") {
        const existing = await api<Array<{ video_id: string }>>(`/api/youtube/playlists/${playlist}/entries`);
        if (!existing.some((entry) => entry.video_id === video.video_id)) await send(`/api/youtube/playlists/${playlist}/entries`, "POST", { videoId: video.id });
      }
      setAddDialog(false); setVideoUrl(""); setNotice(`Saved “${video.title}”.`);
    });
  };
  return <section className="youtube-library youtube-gallery">
    <header className="youtube-library-heading"><div><h1><Youtube size={24} />{current?.name ?? "YouTube library"}</h1><p>{current ? "Custom playlist" : "Save a link. Open a video. Build your playlists."}</p></div>
      {current && <><button className="secondary-button" onClick={() => { setSelected(null); setView("playlists"); }}><ArrowLeft size={15} /> Playlists</button><button className="primary-button" disabled={busy || !current.remote_id && !current.item_count} onClick={() => void playPlaylist()}><Play size={15} /> Play playlist</button><ActionMenu label="Playlist actions" actions={[{ label: "Rename playlist", icon: <Pencil size={15} />, onSelect: () => setRename({ kind: "playlist", id: current.id, title: current.name }) }, { label: "Delete playlist", icon: <Trash2 size={15} />, danger: true, onSelect: () => { if (confirm(`Delete “${current.name}”? Its videos will stay in your library.`)) void mutate(() => send(`/api/youtube/playlists/${current.id}`, "DELETE")).then((saved) => { if (saved) { setSelected(null); setView("playlists"); } }); } }]} /></>}
      <button className="primary-button" onClick={() => void pasteVideo()} disabled={busy}><ClipboardPaste size={15} /> Add video</button>
    </header>
    <nav className="youtube-tabs" aria-label="YouTube library views"><button className={view === "videos" && !selected ? "active" : ""} aria-pressed={view === "videos" && !selected} onClick={() => { setSelected(null); setView("videos"); }}>Videos</button><button className={view === "playlists" || selected ? "active" : ""} aria-pressed={view === "playlists" || Boolean(selected)} onClick={() => { setSelected(null); setView("playlists"); }}>Playlists <span>{playlists.length}</span></button></nav>
    {error && <p role="alert" className="form-error">{error}</p>}{notice && <p role="status" className="youtube-notice">{notice}</p>}
    {view === "playlists" ? <>
      <form className="gallery-toolbar youtube-add-playlist" onSubmit={(event) => { event.preventDefault(); void mutate(async () => { await send("/api/youtube/playlists", "POST", { name }); setName(""); }); }}><label>Playlist name<ClearableInput value={name} required maxLength={200} placeholder="New playlist" onChange={(event) => setName(event.target.value)} /></label><button className="primary-button" disabled={busy || !name.trim()}><Plus size={15} /> Create playlist</button></form>
      <div className="media-grid youtube-grid">{playlists.filter((playlist) => playlist.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map((playlist) => <article className="media-card media-card-video youtube-playlist-card" key={playlist.id}><button className="media-card-open" aria-label={`Open playlist ${playlist.name}`} onClick={() => choosePlaylist(playlist)}><span className="media-art media-art-video"><ListVideo size={46} /><span className="media-type-badge">{playlist.remote_id ? "Saved YouTube link" : `${playlist.item_count} ${playlist.item_count === 1 ? "video" : "videos"}`}</span></span></button><div className="media-card-body"><h3><button className="card-title-open" onClick={() => choosePlaylist(playlist)}>{playlist.name}</button></h3><p>{playlist.remote_id ? "Saved YouTube playlist" : "Custom playlist"}</p></div></article>)}</div>
      {!playlists.length && <div className="empty-state"><ListVideo size={38} /><h2>Your playlists</h2><p>Create a playlist, then select videos from your library to add them.</p></div>}
    </> : <>
      {current?.remote_id ? <div className="empty-state"><Youtube size={38} /><h2>Saved YouTube playlist</h2><p>This saved playlist is managed on YouTube.</p><button className="primary-button" onClick={() => void playPlaylist()}><Play size={15} /> Open player</button></div> : <>
        <div className="youtube-library-tools"><label className="youtube-search"><Search size={15} /><ClearableInput aria-label="Search YouTube videos by title or channel" value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search by title or channel" /></label><label>Channel<Select aria-label="Filter YouTube channel" value={channel} onChange={(event) => setChannel(event.target.value)}><option value="">All channels</option>{channels.map((channel) => <option key={channel.name} value={channel.name || "__unknown"}>{channel.name || "Unknown channel"} ({channel.video_count})</option>)}</Select></label>{(channel || search) && <button className="secondary-button" onClick={() => { setChannel(""); onSearchChange(""); }}>Clear filters</button>}<span>{loading ? "Loading…" : `${videos.total} ${videos.total === 1 ? "video" : "videos"}`}</span><label>Sort<Select aria-label="Sort YouTube videos" value={sort} onChange={(event) => setSort(event.target.value)}><option value="added">Recently added</option><option value="title">Title</option>{selected && <option value="playlist">Playlist order</option>}</Select></label>
          {checked.length > 0 && <><span>{checked.length} selected</span><Select aria-label="Add YouTube videos to playlist" value={playlistTarget} onChange={(event) => setPlaylistTarget(event.target.value)}><option value="">Choose playlist…</option>{playlists.filter((playlist) => !playlist.remote_id).map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}</Select><button className="secondary-button" disabled={busy || !playlistTarget} onClick={addToPlaylist}>Add to playlist</button><button className="secondary-button" onClick={() => setChecked([])}>Clear selection</button></>}
        </div>
        <div className="media-grid youtube-grid">{videos.items.map((video) => <article key={video.id} className={`media-card media-card-selectable media-card-video${checked.includes(video.id) ? " is-selected" : ""}`}>
          <label className="media-card-select"><input type="checkbox" aria-label={`Select ${video.title}`} checked={checked.includes(video.id)} onChange={(event) => setChecked((ids) => event.target.checked ? [...ids, video.id] : ids.filter((id) => id !== video.id))} /></label>
          <div className="media-card-menu"><ActionMenu label={`Actions for ${video.title}`} actions={[
            { label: "Open video", icon: <Play size={15} />, onSelect: () => openVideo(video) },
            { label: "Rename video", icon: <Pencil size={15} />, onSelect: () => setRename({ kind: "video", id: video.id, title: video.title }) },
            ...(selected ? [{ label: "Move up", icon: <ArrowUp size={15} />, disabled: busy || video.position === 0, onSelect: () => move(video, -1) }, { label: "Move down", icon: <ArrowDown size={15} />, disabled: busy, onSelect: () => move(video, 1) }, { label: "Remove from playlist", icon: <Trash2 size={15} />, danger: true, onSelect: () => { void mutate(() => send(`/api/youtube/playlists/${selected}/entries/${video.entry_id}`, "DELETE")); } }] : []),
            { label: "Remove from library", icon: <Trash2 size={15} />, danger: true, onSelect: () => { if (confirm(`Remove “${video.title}” from your library and playlists?`)) void mutate(() => send(`/api/youtube/videos/${video.id}`, "DELETE")); } },
          ]} /></div>
          <button className="media-card-open" aria-label={`Open ${video.title}`} onClick={() => openVideo(video)}><span className="media-art media-art-video"><img src={`https://i.ytimg.com/vi/${video.video_id}/hqdefault.jpg`} alt="" loading="lazy" /><span className="youtube-open-overlay"><Play size={30} /></span><span className="media-type-badge">YouTube</span></span></button>
          <div className="media-card-body"><h3 title={video.title}><button className="card-title-open" onClick={() => openVideo(video)}>{video.title}</button></h3><p>{video.author || "YouTube"}</p></div>
        </article>)}</div>
        {!loading && !videos.total && <div className="empty-state"><Youtube size={38} /><h2>{search ? "No matching videos" : selected ? "This playlist is empty" : "Your YouTube videos"}</h2><p>{selected ? "Use Add video or select videos in your library to add to this playlist." : "Use Add video to paste a YouTube link. Its title and channel are fetched automatically."}</p></div>}
        <nav className="pagination" aria-label="YouTube pages"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>{page} / {Math.max(1, Math.ceil(videos.total / videos.pageSize))}</span><button disabled={page * videos.pageSize >= videos.total} onClick={() => setPage((value) => value + 1)}>Next</button></nav>
      </>}
    </>}
    {addDialog && <AttributeEditorDialog title="Add YouTube video" busy={busy} onClose={() => setAddDialog(false)}><form className="youtube-add-dialog" onSubmit={(event) => { event.preventDefault(); addVideo(); }}><label>YouTube video link<ClearableInput required type="url" maxLength={2000} value={videoUrl} placeholder="Paste a YouTube video link" onChange={(event) => setVideoUrl(event.target.value)} /></label><label>Save to playlist<Select required aria-label="Save YouTube video to playlist" value={addPlaylist} onChange={(event) => setAddPlaylist(event.target.value)}><option value="" disabled>Choose a playlist…</option><option value="__library">Library only</option>{playlists.filter((playlist) => !playlist.remote_id).map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}<option value="__new">Create a new playlist…</option></Select></label>{addPlaylist === "__new" && <label>New playlist name<ClearableInput value={newPlaylist} required maxLength={200} onChange={(event) => setNewPlaylist(event.target.value)} /></label>}<p>The title and channel are read from YouTube when you add the video.</p>{notice && <p role="status">{notice}</p>}{error && <p role="alert" className="form-error">{error}</p>}<button className="primary-button" disabled={busy || !videoUrl.trim() || !addPlaylist || addPlaylist === "__new" && !newPlaylist.trim()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />}{busy ? "Reading YouTube…" : "Add video"}</button></form></AttributeEditorDialog>}
    {playback && <AttributeEditorDialog title={playback.name} className="youtube-video-dialog" backdropClassName="youtube-player-backdrop" focusSelector=".dialog-close" onClose={() => setPlayback(null)}><YoutubeEmbed key={playback.key} playback={playback} /></AttributeEditorDialog>}
    {rename && <AttributeEditorDialog title={rename.kind === "playlist" ? "Rename playlist" : "Rename video"} busy={busy} onClose={() => setRename(null)}><form className="youtube-rename-form" onSubmit={(event) => { event.preventDefault(); void mutate(() => send(`/api/youtube/${rename.kind === "playlist" ? "playlists" : "videos"}/${rename.id}`, "PATCH", { [rename.kind === "playlist" ? "name" : "title"]: rename.title })).then((saved) => { if (saved) setRename(null); }); }}><label>Name<ClearableInput required maxLength={200} value={rename.title} onChange={(event) => setRename({ ...rename, title: event.target.value })} /></label><button className="primary-button" disabled={busy || !rename.title.trim()}>Save name</button></form></AttributeEditorDialog>}
  </section>;
}

