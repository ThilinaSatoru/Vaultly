import { ArrowDown, ArrowLeft, ArrowUp, ExternalLink, FileJson, FolderInput, Guitar, ListMusic, LoaderCircle, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "./media";

interface PlaylistSummary { id: number; name: string; song_count: number; }
interface Song { id: number; title: string; url: string; position: number; }
interface Playlist extends PlaylistSummary { songs: Song[]; }
interface DumpSong {
  link?: unknown;
  slug?: unknown;
  renamedTitle?: unknown;
  songInfo?: { title?: unknown } | null;
}

function titleFromUrl(value: string) {
  try {
    const slug = new URL(value).pathname.split("/").filter(Boolean).at(-1) ?? "";
    return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  } catch { return ""; }
}

function songsFromDump(text: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(text.replace(/,\s*([}\]])/g, "$1")); }
  catch { throw new Error("This is not a complete JSON dump. Copy the full response, including its closing ] or }."); }
  const candidate = Array.isArray(parsed) ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { songs?: unknown }).songs) ? (parsed as { songs: unknown[] }).songs
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { data?: unknown }).data) ? (parsed as { data: unknown[] }).data
    : null;
  if (!candidate) throw new Error("The dump must be a song array, or an object containing a songs array.");
  const songs = candidate.flatMap((raw): Array<{ title: string; url: string }> => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as DumpSong;
    const path = typeof item.link === "string" ? item.link : typeof item.slug === "string" ? `/chords/${item.slug}` : "";
    if (!path) return [];
    let url: URL;
    try { url = new URL(path, "https://chordify.net"); } catch { return []; }
    if (url.hostname !== "chordify.net" && !url.hostname.endsWith(".chordify.net")) return [];
    const title = typeof item.renamedTitle === "string" && item.renamedTitle.trim()
      ? item.renamedTitle.trim()
      : typeof item.songInfo?.title === "string" && item.songInfo.title.trim()
        ? item.songInfo.title.trim()
        : titleFromUrl(url.toString());
    return title ? [{ title, url: url.toString() }] : [];
  });
  if (!songs.length) throw new Error("No songs with a Chordify link and title were found in this dump.");
  return songs;
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
  const [importingDump, setImportingDump] = useState(false);
  const [movingSong, setMovingSong] = useState<Song | null>(null);
  const [moveTargetId, setMoveTargetId] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState("");
  const [songTitle, setSongTitle] = useState("");
  const [songUrl, setSongUrl] = useState("");
  const [dumpText, setDumpText] = useState("");
  const [importMessage, setImportMessage] = useState("");
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
  const importDump = async (event: FormEvent) => {
    event.preventDefault();
    if (!playlist || !dumpText.trim()) return;
    setBusy(true); setError(""); setImportMessage("");
    try {
      const songs = songsFromDump(dumpText);
      const result = await api<{ playlist: Playlist; added: number; skipped: number }>(`/api/chordify/playlists/${playlist.id}/import`, { method: "POST", body: JSON.stringify({ songs }) });
      setPlaylist(result.playlist); setDumpText(""); setImportingDump(false);
      setImportMessage(`Imported ${result.added} ${result.added === 1 ? "song" : "songs"}${result.skipped ? `; skipped ${result.skipped} already in this playlist` : ""}.`);
      await loadPlaylists();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not import the dump."); }
    finally { setBusy(false); }
  };
  const loadDumpFile = async (file: File | undefined) => {
    if (!file) return;
    try { setDumpText(await file.text()); setError(""); }
    catch { setError("Could not read that JSON file."); }
  };
  const startMove = (song: Song) => {
    const firstTarget = playlists.find((entry) => entry.id !== playlist?.id);
    setMovingSong(song);
    setMoveTargetId(firstTarget ? String(firstTarget.id) : "");
    setError("");
  };
  const moveToPlaylist = async (event: FormEvent) => {
    event.preventDefault();
    if (!playlist || !movingSong || !moveTargetId) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ source: Playlist; moved: number }>(`/api/chordify/playlists/${playlist.id}/move-songs`, {
        method: "POST",
        body: JSON.stringify({ songIds: [movingSong.id], targetPlaylistId: Number(moveTargetId) }),
      });
      const destination = playlists.find((entry) => entry.id === Number(moveTargetId));
      setPlaylist(result.source); setMovingSong(null); setMoveTargetId("");
      setImportMessage(`Moved “${movingSong.title}” to “${destination?.name ?? "the selected playlist"}”.`);
      await loadPlaylists();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not move the song."); }
    finally { setBusy(false); }
  };

  if (selectedId !== null && playlist) return <section className="chordify-view">
    <button className="series-back" type="button" onClick={() => setSelectedId(null)}><ArrowLeft size={17} /> All Chordify playlists</button>
    <div className="chordify-detail-heading">
      <div><p className="eyebrow">Chordify · Local playlist</p>
        {editingName ? <form className="chordify-rename" onSubmit={rename}><input value={name} onChange={(event) => setName(event.target.value)} autoFocus /><button className="primary-button" type="submit" disabled={busy}>Save</button><button className="secondary-button" type="button" onClick={() => { setName(playlist.name); setEditingName(false); }}>Cancel</button></form> : <h1>{playlist.name}</h1>}
        <p>{playlist.songs.length} {playlist.songs.length === 1 ? "song" : "songs"} saved locally. Playing opens Chordify in a new tab.</p></div>
      <div className="page-heading-actions"><button className="secondary-button" type="button" onClick={() => setImportingDump(true)}><FileJson size={17} /> Import dump</button><button className="secondary-button" type="button" onClick={() => setEditingName(true)}><Pencil size={17} /> Rename</button><button className="secondary-button chordify-danger" type="button" onClick={() => void removePlaylist()} disabled={busy}><Trash2 size={17} /> Delete</button><button className="primary-button" type="button" onClick={() => setAddingSong(true)}><Plus size={18} /> Add song</button></div>
    </div>
    {error && <div className="page-error" role="alert">{error}</div>}
    {importMessage && <div className="chordify-import-success" role="status">{importMessage}</div>}
    {importingDump && <form className="chordify-import" onSubmit={importDump}>
      <div className="chordify-import-heading"><div><strong>Import a Chordify playlist dump</strong><span>Paste the complete JSON response or select a downloaded .json file. Only the title and Chordify link are kept.</span></div><button className="icon-button" type="button" onClick={() => { setImportingDump(false); setDumpText(""); }} aria-label="Cancel import"><X size={19} /></button></div>
      <textarea value={dumpText} onChange={(event) => setDumpText(event.target.value)} placeholder={'[{ "link": "/chords/...", "songInfo": { "title": "Song title" } }]'} autoFocus />
      <div className="chordify-import-actions"><label className="secondary-button"><Upload size={17} /> Choose JSON<input type="file" accept="application/json,.json" onChange={(event) => void loadDumpFile(event.target.files?.[0])} /></label><button className="primary-button" type="submit" disabled={busy || !dumpText.trim()}>{busy ? <LoaderCircle className="spin" size={18} /> : <FileJson size={18} />} Import songs</button></div>
    </form>}
    {addingSong && <form className="chordify-add-song" onSubmit={addSong}>
      <div><label htmlFor="chordify-song-url">Chordify song URL</label><input id="chordify-song-url" type="url" value={songUrl} onChange={(event) => { const value = event.target.value; setSongUrl(value); if (!songTitle) setSongTitle(titleFromUrl(value)); }} placeholder="https://chordify.net/chords/..." autoFocus /></div>
      <div><label htmlFor="chordify-song-title">Song title</label><input id="chordify-song-title" value={songTitle} onChange={(event) => setSongTitle(event.target.value)} placeholder="Artist — Song" /></div>
      <button className="primary-button" type="submit" disabled={busy || !songUrl.trim()}>{busy ? <LoaderCircle className="spin" size={18} /> : <Plus size={18} />} Add</button><button className="icon-button" type="button" onClick={() => setAddingSong(false)} aria-label="Cancel adding song"><X size={19} /></button>
    </form>}
    {playlist.songs.length ? <div className="chordify-songs">{playlist.songs.map((song, index) => <article className="chordify-song" key={song.id}>
      <span className="chordify-song-number">{index + 1}</span><div className="chordify-song-info"><strong>{song.title}</strong><span>{new URL(song.url).pathname}</span></div>
      <button className="secondary-button chordify-play" type="button" onClick={() => window.open(song.url, "_blank", "noopener,noreferrer")}><ExternalLink size={16} /> Play on Chordify</button>
      <div className="chordify-song-controls"><button type="button" onClick={() => startMove(song)} disabled={busy || playlists.length < 2} aria-label={`Move ${song.title} to another playlist`} title={playlists.length < 2 ? "Create another playlist before moving songs" : "Move to another playlist"}><FolderInput size={17} /></button><button type="button" onClick={() => void moveSong(index, -1)} disabled={busy || index === 0} aria-label={`Move ${song.title} up`}><ArrowUp size={17} /></button><button type="button" onClick={() => void moveSong(index, 1)} disabled={busy || index === playlist.songs.length - 1} aria-label={`Move ${song.title} down`}><ArrowDown size={17} /></button><button className="chordify-danger" type="button" onClick={() => void removeSong(song)} disabled={busy} aria-label={`Remove ${song.title}`}><Trash2 size={17} /></button></div>
    </article>)}</div> : <div className="gallery-empty"><Guitar size={45} /><h2>No songs in this playlist</h2><p>Add a Chordify link to start building your practice list.</p><button className="primary-button" type="button" onClick={() => setAddingSong(true)}><Plus size={18} /> Add your first song</button></div>}
    {movingSong && <div className="dialog-backdrop" role="presentation" onMouseDown={() => setMovingSong(null)}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="move-chordify-song-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="icon-button dialog-close" type="button" onClick={() => setMovingSong(null)} aria-label="Close"><X size={20} /></button>
        <div className="dialog-icon"><FolderInput size={24} /></div>
        <h2 id="move-chordify-song-title">Move song</h2>
        <p className="dialog-intro">Move “{movingSong.title}” from this playlist to another local playlist.</p>
        <form onSubmit={moveToPlaylist}>
          <label htmlFor="chordify-move-target">Destination playlist</label>
          <select id="chordify-move-target" value={moveTargetId} onChange={(event) => setMoveTargetId(event.target.value)} autoFocus>
            {playlists.filter((entry) => entry.id !== playlist.id).map((entry) => <option value={entry.id} key={entry.id}>{entry.name} ({entry.song_count} {entry.song_count === 1 ? "song" : "songs"})</option>)}
          </select>
          <div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setMovingSong(null)}>Cancel</button><button className="primary-button" type="submit" disabled={busy || !moveTargetId}>{busy ? <LoaderCircle className="spin" size={18} /> : <FolderInput size={18} />} Move song</button></div>
        </form>
      </section>
    </div>}
  </section>;

  return <section className="chordify-view">
    <div className="page-heading"><div><p className="eyebrow">Separate service</p><h1>Chordify</h1><p>Organize your Chordify songs into local playlists. Vaultly stores only playlist names, song titles, and Chordify links.</p></div><button className="primary-button" type="button" onClick={() => setShowCreate(true)}><Plus size={18} /> New playlist</button></div>
    <div className="chordify-note"><Guitar size={20} /><div><strong>Your Chordify account stays unchanged</strong><span>Use your existing Chordify playlist for access. These local playlists are only for organizing what to play.</span></div></div>
    {error && <div className="page-error" role="alert">{error}</div>}
    {loading ? <div className="loading-state"><LoaderCircle className="spin" size={28} /><span>Loading playlists…</span></div> : playlists.length ? <div className="chordify-grid">{playlists.map((entry) => <button className="chordify-card" type="button" key={entry.id} onClick={() => setSelectedId(entry.id)}><span><ListMusic size={26} /></span><div><h2>{entry.name}</h2><p>{entry.song_count} {entry.song_count === 1 ? "song" : "songs"}</p></div></button>)}</div> : <div className="gallery-empty"><ListMusic size={48} /><h2>No local playlists yet</h2><p>Create one, then add the Chordify links you already have access to.</p><button className="primary-button" type="button" onClick={() => setShowCreate(true)}><Plus size={18} /> Create a playlist</button></div>}
    {showCreate && <PlaylistDialog onClose={() => setShowCreate(false)} onCreated={(created) => { setShowCreate(false); void loadPlaylists(); setSelectedId(created.id); }} />}
  </section>;
}
