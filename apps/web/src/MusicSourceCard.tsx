import { useState } from "react";
import { ChevronDown, ChevronRight, FolderOpen, Music2, RefreshCw, Trash2, X } from "lucide-react";
import { api } from "./media";
import type { MusicSource } from "./music";

export function MusicSourceCard({ source, expanded, onToggle, onChanged }: {
  source: MusicSource; expanded: boolean; onToggle: () => void; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const action = async (method: string, suffix = "") => {
    setBusy(true); setError("");
    try { await api(`/api/music/sources/${source.id}${suffix}`, { method }); onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update music source."); }
    finally { setBusy(false); }
  };
  return <article className="music-source-card">
    <button className="music-source-heading" type="button" aria-expanded={expanded} onClick={onToggle}>
      {expanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}<FolderOpen size={22} />
      <span><strong>{source.name}</strong><small>{source.root_path}</small></span><span><Music2 size={15} /> Music · {source.track_count} tracks · {source.path_available === false ? "Unavailable" : source.status}</span>
    </button>
    {expanded && <div className="music-source-details"><p>Audio and music videos share the music library. Source files stay in this folder.</p>
      {source.progress && <p role="status">{source.progress.processed} indexed · {source.progress.errors} errors · {source.progress.current}</p>}
      {(error || source.last_error) && <p className="form-error" role="alert">{error || source.last_error}</p>}
      <button className="secondary-button" type="button" disabled={busy} onClick={() => void action("POST", source.status === "scanning" ? "/cancel" : "/scan")}>
        {source.status === "scanning" ? <X size={16} /> : <RefreshCw size={16} />}{source.status === "scanning" ? "Cancel scan" : "Rescan"}</button>
      <button className="secondary-button" type="button" disabled={busy} onClick={() => { if (window.confirm(`Remove ${source.name} from the music index? Original files will be kept.`)) void action("DELETE"); }}><Trash2 size={16} /> Remove source</button>
    </div>}
  </article>;
}
