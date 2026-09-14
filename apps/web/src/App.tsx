import {
  BookOpen,
  Check,
  ChevronRight,
  Clapperboard,
  Folder,
  FolderOpen,
  Grid2X2,
  HardDrive,
  Image,
  Library,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CategoriesView } from "./CategoriesView";
import { GalleryView } from "./GalleryView";
import { MediaViewer } from "./MediaViewer";
import { api, formatCount, type Category, type MediaType } from "./media";

type SourceStatus = "idle" | "scanning" | "ready" | "error";

interface LibrarySource {
  id: number;
  name: string;
  root_path: string;
  status: SourceStatus;
  last_error: string | null;
  last_scanned_at: string | null;
  item_count: number;
  comic_count: number;
  video_count: number;
  story_count: number;
}

type Section = "all" | MediaType | "categories" | "sources";

const formatScanDate = (value: string | null) => {
  if (!value) return "Not scanned yet";
  const date = new Date(`${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return "Scan date unavailable";
  const minutes = Math.round((date.getTime() - Date.now()) / 60000);
  const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(minutes) < 60) return relativeTime.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relativeTime.format(hours, "hour");
  return relativeTime.format(Math.round(hours / 24), "day");
};

function AddSourceDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [rootPath, setRootPath] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);

  const chooseFolder = async () => {
    setPicking(true);
    setError("");
    try {
      const result = await api<{ path: string | null }>("/api/system/pick-directory", { method: "POST" });
      if (result.path) setRootPath(result.path);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not open the folder picker.");
    } finally {
      setPicking(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!rootPath.trim()) {
      setError("Choose or enter a folder path.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api("/api/sources", {
        method: "POST",
        body: JSON.stringify({ rootPath: rootPath.trim(), name: name.trim() || undefined }),
      });
      onAdded();
      onClose();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not add this folder.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="add-source-title" onMouseDown={(e) => e.stopPropagation()}>
        <button className="icon-button dialog-close" type="button" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
        <div className="dialog-icon"><FolderOpen size={24} /></div>
        <h2 id="add-source-title">Add a library source</h2>
        <p className="dialog-intro">Choose a root folder. Vaultly will find comics, videos, and PDFs inside it without moving your files.</p>

        <form onSubmit={submit}>
          <label htmlFor="source-path">Folder path</label>
          <div className="path-control">
            <input
              id="source-path"
              value={rootPath}
              onChange={(event) => setRootPath(event.target.value)}
              placeholder="D:\\Media"
              autoFocus
            />
            <button className="browse-button" type="button" onClick={chooseFolder} disabled={picking}>
              {picking ? <LoaderCircle className="spin" size={17} /> : <FolderOpen size={17} />}
              Browse
            </button>
          </div>

          <label htmlFor="source-name">Display name <span>Optional</span></label>
          <input
            id="source-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Uses the folder name by default"
          />

          <div className="mixed-note">
            <Grid2X2 size={18} />
            <div><strong>Mixed media is supported</strong><span>Every nested folder is scanned and classified automatically.</span></div>
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}

          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? <LoaderCircle className="spin" size={18} /> : <Plus size={18} />}
              Add & scan
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function SourceCard({ source, onChanged }: { source: LibrarySource; onChanged: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState("");

  const rescan = async () => {
    setWorking(true);
    setMenuOpen(false);
    setActionError("");
    try {
      await api(`/api/sources/${source.id}/scan`, { method: "POST" });
      onChanged();
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Could not scan this source.");
    } finally {
      setWorking(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Remove “${source.name}” from Vaultly? Your files will not be deleted.`)) return;
    setWorking(true);
    setActionError("");
    try {
      await api(`/api/sources/${source.id}`, { method: "DELETE" });
      onChanged();
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Could not remove this source.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <article className="source-card">
      <div className="source-card-top">
        <div className="drive-icon"><HardDrive size={23} /></div>
        <div className="source-heading">
          <div className="source-title-line">
            <h3>{source.name}</h3>
            <span className={`status status-${source.status}`}>
              {source.status === "scanning" ? <LoaderCircle className="spin" size={13} /> : source.status === "ready" ? <Check size={13} /> : null}
              {source.status}
            </span>
          </div>
          <p title={source.root_path}>{source.root_path}</p>
        </div>
        <div className="menu-wrap">
          <button className="icon-button" type="button" aria-label={`Actions for ${source.name}`} onClick={() => setMenuOpen(!menuOpen)} disabled={working}>
            <MoreHorizontal size={20} />
          </button>
          {menuOpen && (
            <div className="source-menu">
              <button type="button" onClick={rescan}><RefreshCw size={16} /> Scan again</button>
              <button className="danger" type="button" onClick={remove} disabled={source.status === "scanning"}><Trash2 size={16} /> Remove source</button>
            </div>
          )}
        </div>
      </div>

      <div className="source-stats">
        <div><Image size={17} /><span>Comics</span><strong>{formatCount(source.comic_count)}</strong></div>
        <div><Clapperboard size={17} /><span>Videos</span><strong>{formatCount(source.video_count)}</strong></div>
        <div><BookOpen size={17} /><span>Stories</span><strong>{formatCount(source.story_count)}</strong></div>
      </div>

      <footer>
        <span>{source.status === "scanning" ? "Scanning folders…" : formatScanDate(source.last_scanned_at)}</span>
        <strong>{formatCount(source.item_count)} items</strong>
      </footer>
      {source.last_error && <p className="scan-error">{source.last_error}</p>}
      {actionError && <p className="scan-error" role="alert">{actionError}</p>}
    </article>
  );
}

export function App() {
  const [section, setSection] = useState<Section>("all");
  const [search, setSearch] = useState("");
  const [sources, setSources] = useState<LibrarySource[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAddSource, setShowAddSource] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadSources = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setSources(await api<LibrarySource[]>("/api/sources"));
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load your sources.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try { setCategories(await api<Category[]>("/api/categories")); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not load categories."); }
  }, []);

  useEffect(() => { void loadSources(); }, [loadSources]);
  useEffect(() => { void loadCategories(); }, [loadCategories]);

  const isScanning = useMemo(() => sources.some((source) => source.status === "scanning"), [sources]);
  useEffect(() => {
    if (!isScanning) return;
    const timer = window.setInterval(() => void loadSources(true), 1200);
    return () => window.clearInterval(timer);
  }, [isScanning, loadSources]);

  const totalItems = sources.reduce((total, source) => total + source.item_count, 0);
  const selectSection = (nextSection: Section) => { setSection(nextSection); setSearch(""); };
  const refreshMedia = () => { setRefreshKey((value) => value + 1); void loadCategories(); };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Library size={21} /></div><span>Vaultly</span></div>
        <nav aria-label="Main navigation">
          <p>Library</p>
          <button className={section === "all" ? "nav-active" : "nav-link"} type="button" onClick={() => selectSection("all")}><Grid2X2 size={19} /> All media <span>{formatCount(totalItems)}</span></button>
          <button className={section === "comic" ? "nav-active" : "nav-link"} type="button" onClick={() => selectSection("comic")}><Image size={19} /> Comics</button>
          <button className={section === "video" ? "nav-active" : "nav-link"} type="button" onClick={() => selectSection("video")}><Clapperboard size={19} /> Videos</button>
          <button className={section === "story" ? "nav-active" : "nav-link"} type="button" onClick={() => selectSection("story")}><BookOpen size={19} /> Stories</button>
          <p>Manage</p>
          <button className={section === "categories" ? "nav-active" : "nav-link"} type="button" onClick={() => selectSection("categories")}><Folder size={19} /> Categories</button>
          <button className={section === "sources" ? "nav-active" : "nav-link"} type="button" onClick={() => selectSection("sources")}><HardDrive size={19} /> Sources</button>
        </nav>
      </aside>

      <main>
        <header className="topbar">
          <div className="search-box"><Search size={19} /><input aria-label="Search library" placeholder="Search your library" value={search} onChange={(event) => { setSearch(event.target.value); if (event.target.value) setSection("all"); }} /></div>
          <div className="local-pill"><span /> Local only</div>
        </header>

        <div className="content">
          {section === "sources" ? <>
          <div className="page-heading">
            <div><p className="eyebrow">Library setup</p><h1>Sources</h1><p>Add folders from this computer. Vaultly scans nested folders and sorts supported media automatically.</p></div>
            <button className="primary-button" type="button" onClick={() => setShowAddSource(true)}><Plus size={18} /> Add source</button>
          </div>

          <section className="summary-strip" aria-label="Source summary">
            <div><span>Folders</span><strong>{formatCount(sources.length)}</strong></div>
            <div><span>Indexed items</span><strong>{formatCount(totalItems)}</strong></div>
            <div><span>Storage</span><strong>Local</strong></div>
            <div className="summary-message"><span className="pulse-dot" /> Your media stays on this computer</div>
          </section>

          {error && <div className="page-error" role="alert">{error}<button type="button" onClick={() => loadSources()}>Try again</button></div>}

          {loading ? (
            <div className="loading-state"><LoaderCircle className="spin" size={28} /><span>Loading sources…</span></div>
          ) : sources.length > 0 ? (
            <div className="source-grid">{sources.map((source) => <SourceCard key={source.id} source={source} onChanged={() => loadSources(true)} />)}</div>
          ) : (
            <section className="empty-state">
              <div className="empty-visual"><div className="folder-back" /><div className="folder-front"><Image size={29} /><Clapperboard size={29} /><BookOpen size={29} /></div></div>
              <h2>Connect your media folders</h2>
              <p>Add one or more folders. Each can contain a mix of comics, videos, and PDFs.</p>
              <button className="primary-button" type="button" onClick={() => setShowAddSource(true)}>Choose a folder <ChevronRight size={18} /></button>
              <span>Nothing is uploaded or moved.</span>
            </section>
          )}
          </> : section === "categories" ? (
            <CategoriesView categories={categories} onChanged={() => { void loadCategories(); setRefreshKey((value) => value + 1); }} />
          ) : (
            <GalleryView
              type={section === "all" ? undefined : section}
              search={search}
              categories={categories}
              onOpen={setSelectedItemId}
              onAddSource={() => { setSection("sources"); setShowAddSource(true); }}
              refreshKey={refreshKey}
            />
          )}
        </div>
      </main>

      {showAddSource && <AddSourceDialog onClose={() => setShowAddSource(false)} onAdded={() => { void loadSources(true); setRefreshKey((value) => value + 1); }} />}
      {selectedItemId !== null && <MediaViewer itemId={selectedItemId} categories={categories} onClose={() => setSelectedItemId(null)} onChanged={refreshMedia} />}
    </div>
  );
}
