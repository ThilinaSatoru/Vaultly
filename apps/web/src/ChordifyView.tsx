import { ArrowDown, ArrowLeft, ArrowUp, ExternalLink, Guitar, ListMusic, LoaderCircle, Pencil, Plus, Trash2, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "./media";

interface PlaylistSummary { id: number; name: string; song_count: number; }
interface Song { id: number; title: string; url: string; position: number; }
interface Playlist extends PlaylistSummary { songs: Song[]; }

function titleFromUrl(value: string) {
  try {
    const slug = new URL(value).pathname.split("/").filter(Boolean).at(-1) ?? "";
    return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  } catch { return ""; }
}

function PlaylistDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (playlist: Playlist) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setError("");
    try { onCreated(await api<Playlist>("/api/chordify/playlists", { method: "POST", body: JSON.stringify({ name: name.trim() }) })); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not create the playlist."); }
    finally { setBusy(false); }
  };
  return <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="chordify-playlist-title" onMouseDown={(event) => event.stopPropagation()}>
      <button className="icon-button dialog-close" type="button" onClick={onClose} aria-label="Close"><X size={20} /></button>
      <div className="dialog-icon"><ListMusic size={24} /></div>
      <h2 id="chordify-playlist-title">Create a local playlist</h2>
      <p className="dialog-intro">This playlist lives only in Vaultly and does not change your Chordify account.</p>
      <form onSubmit={submit}>
        <label htmlFor="chordify-playlist-name">Playlist name</label>
        <input id="chordify-playlist-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Acoustic practice" autoFocus />
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={busy || !name.trim()}>{busy ? <LoaderCircle className="spin" size={18} /> : <Plus size={18} />} Create playlist</button></div>
      </form>
    </section>
  </div>;
}

export function ChordifyView() {
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [addingSong, setAddingSong] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState("");
  const [songTitle, setSongTitle] = useState("");
  const [songUrl, setSongUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadPlaylists = useCallback(async () => {
    try { setPlaylists(await api<PlaylistSummary[]>("/api/chordify/playlists")); setError(""); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not load Chordify playlists."); }
    finally { setLoading(false); }
  }, []);
  const loadPlaylist = useCallback(async (id: number) => {
    try { const result = await api<Playlist>(`/api/chordify/playlists/${id}`); setPlaylist(result); setName(result.name); setError(""); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not open the playlist."); }
  }, []);
  useEffect(() => { void loadPlaylists(); }, [loadPlaylists]);
  useEffect(() => { if (selectedId === null) setPlaylist(null); else void loadPlaylist(selectedId); }, [selectedId, loadPlaylist]);

  const addSong = async (event: FormEvent) => {
    event.preventDefault();
    if (!playlist || !songUrl.trim()) return;
    const title = songTitle.trim() || titleFromUrl(songUrl.trim());
    if (!title) { setError("Enter a song title."); return; }
    setBusy(true); setError("");
    try {
      setPlaylist(await api<Playlist>(`/api/chordify/playlists/${playlist.id}/songs`, { method: "POST", body: JSON.stringify({ title, url: songUrl.trim() }) }));
      setSongTitle(""); setSongUrl(""); setAddingSong(false); await loadPlaylists();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not add the song."); }
    finally { setBusy(false); }
  };
  const rename = async (event: FormEvent) => {
    event.preventDefault();
    if (!playlist || !name.trim()) return;
    setBusy(true); setError("");
    try { setPlaylist(await api<Playlist>(`/api/chordify/playlists/${playlist.id}`, { method: "PATCH", body: JSON.stringify({ name: name.trim() }) })); setEditingName(false); await loadPlaylists(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not rename the playlist."); }
    finally { setBusy(false); }
  };
  const removePlaylist = async () => {
    if (!playlist || !window.confirm(`Delete “${playlist.name}”? The songs remain on Chordify.`)) return;
    setBusy(true); setError("");
    try { await api(`/api/chordify/playlists/${playlist.id}`, { method: "DELETE" }); setSelectedId(null); await loadPlaylists(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not delete the playlist."); }
    finally { setBusy(false); }
  };
  const removeSong = async (song: Song) => {
    if (!playlist) return;
    setBusy(true); setError("");
    try { await api(`/api/chordify/playlists/${playlist.id}/songs/${song.id}`, { method: "DELETE" }); await Promise.all([loadPlaylist(playlist.id), loadPlaylists()]); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not remove the song."); }
    finally { setBusy(false); }
  };
  const moveSong = async (index: number, direction: -1 | 1) => {
    if (!playlist) return;
    const target = index + direction;
    if (target < 0 || target >= playlist.songs.length) return;
    const previous = playlist;
    const songs = [...playlist.songs];
    [songs[index], songs[target]] = [songs[target], songs[index]];
    setPlaylist({ ...playlist, songs }); setBusy(true); setError("");
    try { setPlaylist(await api<Playlist>(`/api/chordify/playlists/${playlist.id}/songs`, { method: "PUT", body: JSON.stringify({ songIds: songs.map((song) => song.id) }) })); }
    catch (requestError) { setPlaylist(previous); setError(requestError instanceof Error ? requestError.message : "Could not reorder the songs."); }
    finally { setBusy(false); }
  };

  if (selectedId !== null && playlist) return <section className="chordify-view">
    <button className="series-back" type="button" onClick={() => setSelectedId(null)}><ArrowLeft size={17} /> All Chordify playlists</button>
    <div className="chordify-detail-heading">
      <div><p className="eyebrow">Chordify · Local playlist</p>
        {editingName ? <form className="chordify-rename" onSubmit={rename}><input value={name} onChange={(event) => setName(event.target.value)} autoFocus /><button className="primary-button" type="submit" disabled={busy}>Save</button><button className="secondary-button" type="button" onClick={() => { setName(playlist.name); setEditingName(false); }}>Cancel</button></form> : <h1>{playlist.name}</h1>}
        <p>{playlist.songs.length} {playlist.songs.length === 1 ? "song" : "songs"} saved locally. Playing opens Chordify in a new tab.</p></div>
      <div className="page-heading-actions"><button className="secondary-button" type="button" onClick={() => setEditingName(true)}><Pencil size={17} /> Rename</button><button className="secondary-button chordify-danger" type="button" onClick={() => void removePlaylist()} disabled={busy}><Trash2 size={17} /> Delete</button><button className="primary-button" type="button" onClick={() => setAddingSong(true)}><Plus size={18} /> Add song</button></div>
    </div>
    {error && <div className="page-error" role="alert">{error}</div>}
    {addingSong && <form className="chordify-add-song" onSubmit={addSong}>
      <div><label htmlFor="chordify-song-url">Chordify song URL</label><input id="chordify-song-url" type="url" value={songUrl} onChange={(event) => { const value = event.target.value; setSongUrl(value); if (!songTitle) setSongTitle(titleFromUrl(value)); }} placeholder="https://chordify.net/chords/..." autoFocus /></div>
      <div><label htmlFor="chordify-song-title">Song title</label><input id="chordify-song-title" value={songTitle} onChange={(event) => setSongTitle(event.target.value)} placeholder="Artist — Song" /></div>
      <button className="primary-button" type="submit" disabled={busy || !songUrl.trim()}>{busy ? <LoaderCircle className="spin" size={18} /> : <Plus size={18} />} Add</button><button className="icon-button" type="button" onClick={() => setAddingSong(false)} aria-label="Cancel adding song"><X size={19} /></button>
    </form>}
    {playlist.songs.length ? <div className="chordify-songs">{playlist.songs.map((song, index) => <article className="chordify-song" key={song.id}>
      <span className="chordify-song-number">{index + 1}</span><div className="chordify-song-info"><strong>{song.title}</strong><span>{new URL(song.url).pathname}</span></div>
      <button className="secondary-button chordify-play" type="button" onClick={() => window.open(song.url, "_blank", "noopener,noreferrer")}><ExternalLink size={16} /> Play on Chordify</button>
      <div className="chordify-song-controls"><button type="button" onClick={() => void moveSong(index, -1)} disabled={busy || index === 0} aria-label={`Move ${song.title} up`}><ArrowUp size={17} /></button><button type="button" onClick={() => void moveSong(index, 1)} disabled={busy || index === playlist.songs.length - 1} aria-label={`Move ${song.title} down`}><ArrowDown size={17} /></button><button className="chordify-danger" type="button" onClick={() => void removeSong(song)} disabled={busy} aria-label={`Remove ${song.title}`}><Trash2 size={17} /></button></div>
    </article>)}</div> : <div className="gallery-empty"><Guitar size={45} /><h2>No songs in this playlist</h2><p>Add a Chordify link to start building your practice list.</p><button className="primary-button" type="button" onClick={() => setAddingSong(true)}><Plus size={18} /> Add your first song</button></div>}
  </section>;

  return <section className="chordify-view">
    <div className="page-heading"><div><p className="eyebrow">Separate service</p><h1>Chordify</h1><p>Organize your Chordify songs into local playlists. Vaultly stores only playlist names, song titles, and Chordify links.</p></div><button className="primary-button" type="button" onClick={() => setShowCreate(true)}><Plus size={18} /> New playlist</button></div>
    <div className="chordify-note"><Guitar size={20} /><div><strong>Your Chordify account stays unchanged</strong><span>Use your existing Chordify playlist for access. These local playlists are only for organizing what to play.</span></div></div>
    {error && <div className="page-error" role="alert">{error}</div>}
    {loading ? <div className="loading-state"><LoaderCircle className="spin" size={28} /><span>Loading playlists…</span></div> : playlists.length ? <div className="chordify-grid">{playlists.map((entry) => <button className="chordify-card" type="button" key={entry.id} onClick={() => setSelectedId(entry.id)}><span><ListMusic size={26} /></span><div><h2>{entry.name}</h2><p>{entry.song_count} {entry.song_count === 1 ? "song" : "songs"}</p></div></button>)}</div> : <div className="gallery-empty"><ListMusic size={48} /><h2>No local playlists yet</h2><p>Create one, then add the Chordify links you already have access to.</p><button className="primary-button" type="button" onClick={() => setShowCreate(true)}><Plus size={18} /> Create a playlist</button></div>}
    {showCreate && <PlaylistDialog onClose={() => setShowCreate(false)} onCreated={(created) => { setShowCreate(false); void loadPlaylists(); setSelectedId(created.id); }} />}
  </section>;
}
