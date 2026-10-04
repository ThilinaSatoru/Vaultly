import { SourceAttributesDialog, SourceAttributeFields, type SourceAttributeOptions } from "./SourceAttributesDialog";
import { AttributeBadge, AttributeBrowseProvider } from "./AttributeBadge";
import { NavigationContext, useNavigation, useNavigationField } from "./navigation";
import type { GalleryVideoContext } from "./video-playlist";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Clapperboard,
  Folder,
  FolderOpen,
  Grid2X2,
  HardDrive,
  Heart,
  Home,
  Image,
  Library,
  Layers3,
  ListVideo,
  LoaderCircle,
  MoreHorizontal,
  Orbit,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Tag as TagIcon,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { type FormEvent, type ReactNode, useContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CategoriesView } from "./CategoriesView";
import { GalleryView } from "./GalleryView";
import { MediaViewer } from "./MediaViewer";
import { PeopleView } from "./PeopleView";
import { SeriesView } from "./SeriesView";
import { SettingsView } from "./SettingsView";
import { ScanProgress, type SourceScanProgress } from "./ScanProgress";
import { TagsView } from "./TagsView";
import { api, formatCount, type Category, type MediaItem, type MediaType, type Person, type SeriesViewerContext, type Tag } from "./media";

type SourceStatus = "idle" | "scanning" | "ready" | "error";

interface LibrarySource {
  id: number;
  name: string;
  root_path: string;
  status: SourceStatus;
  last_error: string | null;
  last_scanned_at: string | null;
  scan_progress: SourceScanProgress | null;
  item_count: number;
  comic_count: number;
  video_count: number;
  story_count: number;
  tags?: Tag[];
  categories?: Category[];
  path_available: boolean;
  path_error: string | null;
}

type Section = "home" | "all" | MediaType | "categories" | "tags" | "people" | "sources" | "settings";
export type LibraryView = "browse" | "categories" | "favorites" | "series" | "circles";

function LibraryNav({ active, view, icon, label, count, onBrowse, onView }: { active: boolean; view: LibraryView; icon: ReactNode; label: string; count?: string; onBrowse: () => void; onView: (view: LibraryView) => void }) {
  return <div className={`library-nav-group${active ? " is-active" : ""}`}>
    <button className={active && view === "browse" ? "nav-active" : "nav-link"} type="button" onClick={onBrowse}>{icon} {label}{count && <span>{count}</span>}</button>
    {active && <div className="library-submenu">
      <button className={view === "categories" ? "active" : ""} type="button" onClick={() => onView("categories")}><Folder size={14} /> Categories</button>
      <button className={view === "favorites" ? "active" : ""} type="button" onClick={() => onView("favorites")}><Heart size={14} /> Favorites</button>
      <button className={view === "series" ? "active" : ""} type="button" onClick={() => onView("series")}><Layers3 size={14} /> Series & sets</button>
      <button className={view === "circles" ? "active" : ""} type="button" onClick={() => onView("circles")}><Orbit size={14} /> Circles</button>
    </div>}
  </div>;
}

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

function AddSourceDialog({ onClose, onAdded, ...attributeOptions }: SourceAttributeOptions & { onClose: () => void; onAdded: () => void }) {
  const [rootPath, setRootPath] = useState("");
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [categoryIds, setCategoryIds] = useState<number[]>([]);
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
        body: JSON.stringify({ rootPath: rootPath.trim(), name: name.trim() || undefined, tagIds, categoryIds }),
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

          <SourceAttributeFields {...attributeOptions} tagIds={tagIds} categoryIds={categoryIds} onTagsChange={setTagIds} onCategoriesChange={setCategoryIds} disabled={saving} />

          <div className="mixed-note">
            <Grid2X2 size={18} />
            <div><strong>Mixed media is supported</strong><span>Nested folders are scanned. Existing category, tag, and known cast/artist names in filenames are added automatically.</span></div>
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

function SourceCard({ source, onChanged, ...attributeOptions }: SourceAttributeOptions & { source: LibrarySource; onChanged: () => void }) {
  const [attributesOpen, setAttributesOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState("");
  const displayStatus = source.path_available ? source.status : "unavailable";

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

  const cancelScan = async () => {
    setWorking(true);
    setMenuOpen(false);
    setActionError("");
    try {
      await api(`/api/sources/${source.id}/scan/cancel`, { method: "POST" });
      onChanged();
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Could not cancel this scan.");
    } finally { setWorking(false); }
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

  const relocate = async () => {
    setWorking(true);
    setMenuOpen(false);
    setActionError("");
    try {
      const picked = await api<{ path: string | null }>("/api/system/pick-directory", { method: "POST" });
      if (!picked.path) return;
      await api(`/api/sources/${source.id}`, {
        method: "PATCH",
        body: JSON.stringify({ rootPath: picked.path, name: source.name }),
      });
      onChanged();
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Could not relocate this source.");
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
            <span className={`status status-${displayStatus}`}>
              {displayStatus === "scanning" ? <LoaderCircle className="spin" size={13} /> : displayStatus === "ready" ? <Check size={13} /> : displayStatus === "unavailable" ? <AlertTriangle size={13} /> : null}
              {displayStatus}
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
              <button type="button" onClick={() => { setMenuOpen(false); setAttributesOpen(true); }}><TagIcon size={16} /> Common attributes</button>
              <button type="button" onClick={() => void relocate()} disabled={source.status === "scanning"}><FolderOpen size={16} /> Relocate source</button>
              {source.status === "scanning"
                ? <button type="button" onClick={() => void cancelScan()}><X size={16} /> Cancel scan</button>
                : <button type="button" onClick={rescan} disabled={!source.path_available}><RefreshCw size={16} /> Scan again</button>}
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

      <div className="source-common-attributes">
        <div className="attribute-badges">{(source.tags ?? []).map((tag) => <AttributeBadge key={`tag-${tag.id}`} kind="tag" {...tag} />)}{(source.categories ?? []).map((category) => <AttributeBadge key={`category-${category.id}`} kind="category" {...category} />)}</div>
        <button className="source-attributes-edit" type="button" onClick={() => setAttributesOpen(true)}><TagIcon size={15} />{source.tags?.length || source.categories?.length ? "Edit common attributes" : "Add common tags or categories"}</button>
      </div>
      {attributesOpen && <SourceAttributesDialog source={source} {...attributeOptions} onClose={() => setAttributesOpen(false)} onSaved={onChanged} />}
      {source.status === "scanning" && source.scan_progress && <ScanProgress progress={source.scan_progress} />}
      <footer>
        <span>{source.status === "scanning" ? "Scan in progress…" : formatScanDate(source.last_scanned_at)}</span>
        {source.status === "scanning"
          ? <button className="source-attributes-edit" type="button" onClick={() => void cancelScan()} disabled={working}>{working ? <LoaderCircle className="spin" size={15} /> : <X size={15} />}{working ? "Cancelling…" : "Cancel scan"}</button>
          : <strong>{formatCount(source.item_count)} items</strong>}
      </footer>
      {source.last_error && <p className="scan-error">{source.last_error}</p>}
      {!source.path_available && <p className="source-unavailable"><AlertTriangle size={15} /> {source.path_error || "The source path or drive is unavailable."}</p>}
      {actionError && <p className="scan-error" role="alert">{actionError}</p>}
    </article>
  );
}

function HomeView({ sources, categories, onOpenLibrary, onOpenCategories, onAddSource }: {
  sources: LibrarySource[];
  categories: Category[];
  onOpenLibrary: (type: MediaType) => void;
  onOpenCategories: () => void;
  onAddSource: () => void;
}) {
  const connectedSources = sources.filter((source) => source.path_available);
  const totals = connectedSources.reduce((result, source) => ({
    all: result.all + source.item_count,
    comic: result.comic + source.comic_count,
    video: result.video + source.video_count,
    story: result.story + source.story_count,
  }), { all: 0, comic: 0, video: 0, story: 0 });
  const libraries = [
    { type: "comic" as const, label: "Comics", description: "Issues, image folders, and archives", count: totals.comic, icon: <Image size={25} /> },
    { type: "video" as const, label: "Videos", description: "Movies, episodes, and local clips", count: totals.video, icon: <Clapperboard size={25} /> },
    { type: "story" as const, label: "Stories", description: "PDF books and documents", count: totals.story, icon: <BookOpen size={25} /> },
  ];
  const availableCategories = categories.filter((category) => category.item_count > 0);
  const visibleCategories = availableCategories.slice(0, 8);

  return <>
    <div className="page-heading home-heading">
      <div><p className="eyebrow">Your library</p><h1>Welcome home</h1><p>Pick up where you left off, or jump into a media library.</p></div>
      {!sources.length && <button className="primary-button" type="button" onClick={onAddSource}><Plus size={18} /> Add source</button>}
    </div>

    <section className="home-stats" aria-label="Library statistics">
      <div><span>Available media</span><strong>{formatCount(totals.all)}</strong></div>
      <div><span>Categories</span><strong>{formatCount(availableCategories.length)}</strong></div>
      <div><span>Connected sources</span><strong>{connectedSources.length}<small> / {sources.length}</small></strong></div>
    </section>

    <section className="home-section">
      <div className="home-section-heading"><div><p className="eyebrow">Browse</p><h2>Libraries</h2></div></div>
      <div className="home-library-grid">
        {libraries.map((library) => <button key={library.type} className={`home-library-card home-library-${library.type}`} type="button" onClick={() => onOpenLibrary(library.type)}>
          <span className="home-library-icon">{library.icon}</span>
          <span className="home-library-copy"><strong>{library.label}</strong><small>{library.description}</small></span>
          <span className="home-library-count">{formatCount(library.count)}</span>
          <ArrowRight size={19} />
        </button>)}
      </div>
    </section>

    <section className="home-section">
      <div className="home-section-heading"><div><p className="eyebrow">Organize</p><h2>Categories</h2></div><button type="button" onClick={onOpenCategories}>View all <ArrowRight size={16} /></button></div>
      {visibleCategories.length ? <div className="home-category-list">
        {visibleCategories.map((category) => <AttributeBadge key={category.id} kind="category" {...category}><Folder size={18} /><span>{category.name}</span><strong>{formatCount(category.item_count)}</strong><ChevronRight size={17} /></AttributeBadge>)}
      </div> : <div className="home-empty-categories"><Folder size={24} /><span>Categories with available media will appear here.</span></div>}
    </section>
  </>;
}

export function App() {
  const navigation = useNavigation();
  return <NavigationContext.Provider value={navigation}><LibraryApp /></NavigationContext.Provider>;
}

function LibraryApp() {
  const navigation = useContext(NavigationContext)!;
  const [section] = useNavigationField<Section>("section", "home");
  const [libraryView] = useNavigationField<LibraryView>("libraryView", "browse");
  const [search, setSearch] = useNavigationField("search", "");
  const [sources, setSources] = useState<LibrarySource[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAddSource, setShowAddSource] = useState(false);
  const [selectedItemId] = useNavigationField<number | null>("selectedItemId", null);
  const [temporaryPlaylist, setTemporaryPlaylist] = useState<MediaItem[]>([]);
  const [viewerFloating, setViewerFloating] = useNavigationField("viewerFloating", false);
  const [viewerSeriesContext, setViewerSeriesContext] = useNavigationField<SeriesViewerContext | null>("viewerSeriesContext", null);
  const [viewerGalleryContext] = useNavigationField<GalleryVideoContext | null>("viewerGalleryContext", null);
  const [selectedSeriesId] = useNavigationField<number | null>("selectedSeriesId", null);

  const [refreshKey, setRefreshKey] = useState(0);
  const [rescanningAll, setRescanningAll] = useState(false);
  const previousScanningSourceKey = useRef("");


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

  const loadTags = useCallback(async () => {
    try { setTags(await api<Tag[]>("/api/tags")); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not load tags."); }
  }, []);

  const loadPeople = useCallback(async () => {
    try { setPeople(await api<Person[]>("/api/people")); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not load people."); }
  }, []);

  const createTag = async (name: string): Promise<Tag> => {
    const created = await api<Tag>("/api/tags", { method: "POST", body: JSON.stringify({ name }) });
    setTags((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
    return created;
  };

  const createCategory = async (name: string): Promise<Category> => {
    const created = await api<Category>("/api/categories", { method: "POST", body: JSON.stringify({ name }) });
    setCategories((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
    return created;
  };

  const createPerson = async (name: string): Promise<Person> => {
    const created = await api<Person>("/api/people", { method: "POST", body: JSON.stringify({ name }) });
    setPeople((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
    return created;
  };

  useEffect(() => { void loadSources(); }, [loadSources]);
  useEffect(() => { void loadCategories(); }, [loadCategories]);
  useEffect(() => { void loadTags(); }, [loadTags]);
  useEffect(() => { void loadPeople(); }, [loadPeople]);

  const isScanning = useMemo(() => sources.some((source) => source.status === "scanning"), [sources]);
  const scanningSourceKey = useMemo(() => sources.filter((source) => source.status === "scanning").map((source) => source.id).sort((a, b) => a - b).join(","), [sources]);
  const availableSourceKey = useMemo(() => sources.filter((source) => source.path_available).map((source) => source.id).sort((a, b) => a - b).join(","), [sources]);
  const previousAvailableSourceKey = useRef<string | null>(null);
  useEffect(() => {
    if (previousAvailableSourceKey.current === null) {
      previousAvailableSourceKey.current = availableSourceKey;
      return;
    }
    if (previousAvailableSourceKey.current !== availableSourceKey) {
      previousAvailableSourceKey.current = availableSourceKey;
      setRefreshKey((value) => value + 1);
      void loadCategories(); void loadTags(); void loadPeople();
    }
  }, [availableSourceKey, loadCategories, loadTags, loadPeople]);
  useEffect(() => {
    if (previousScanningSourceKey.current && previousScanningSourceKey.current !== scanningSourceKey) {
      void loadSources(true);
      setRefreshKey((value) => value + 1);
      void loadCategories(); void loadTags(); void loadPeople();
    }
    previousScanningSourceKey.current = scanningSourceKey;
  }, [scanningSourceKey, loadSources, loadCategories, loadTags, loadPeople]);
  useEffect(() => {
    let polling = false;
    let stopped = false;
    const timer = window.setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        if (isScanning) {
          const updates = await api<Array<Pick<LibrarySource, "id" | "status" | "last_error" | "last_scanned_at" | "scan_progress">>>("/api/sources/scan/progress");
          if (stopped) return;
          const byId = new Map(updates.map((update) => [update.id, update]));
          setSources((current) => current.map((source) => ({ ...source, ...byId.get(source.id) })));
        } else await loadSources(true);
      } catch {
        if (!stopped) await loadSources(true);
      } finally { polling = false; }
    }, isScanning ? 1000 : 5000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [isScanning, loadSources]);

  const attributeOptions: SourceAttributeOptions = { tags, categories, onTagCreated: createTag, onCategoryCreated: createCategory };
  const totalItems = sources.filter((source) => source.path_available).reduce((total, source) => total + source.item_count, 0);
  const sectionNames: Record<Section, string> = { home: "Home", all: "All media", comic: "Comics", video: "Videos", story: "Stories", categories: "Categories", tags: "Tags", people: "People", sources: "Sources", settings: "Settings" };
  const selectSection = (nextSection: Section) => {
    navigation.reset({ section: nextSection, libraryView: "browse", search: "" }, sectionNames[nextSection]);
  };
  const selectLibraryView = (view: LibraryView) => {
    navigation.reset({ section, libraryView: view, search: "", "SeriesView.entityView": view === "circles" ? "circles" : "sets" }, sectionNames[section] + " · " + view);
  };
  const openSeries = (id: number) => navigation.push({ selectedSeriesId: id, "SeriesView.selectedId": id, "SeriesView.entityView": "sets", selectedItemId: null, viewerSeriesContext: null, viewerFloating: false, libraryView: "series" }, "Collection");
  const refreshMedia = () => { setRefreshKey((value) => value + 1); void loadCategories(); void loadTags(); void loadPeople(); };
  const openItem = (id: number, context: SeriesViewerContext | null = null, gallery: GalleryVideoContext | null = null) => {
    navigation.push({ selectedItemId: id, viewerSeriesContext: context, viewerGalleryContext: gallery, viewerFloating: false }, gallery?.videos.find((item) => item.id === id)?.title ?? context?.items.find((item) => item.id === id)?.title ?? `File ${id}`);
  };
  const closeViewer = () => {
    const origin = [...navigation.entry.breadcrumbs].reverse().find((crumb) => !crumb.viewer);
    if (origin) navigation.goTo(origin.id);
    else navigation.update({ selectedItemId: null, viewerSeriesContext: null, viewerGalleryContext: null, viewerFloating: false });
  };
  const queueVideo = (item: MediaItem) => {
    setTemporaryPlaylist((current) => current.some((entry) => entry.id === item.id) ? current : [...current, item]);
    if (selectedItemId === null) {
      navigation.push({ selectedItemId: item.id, viewerSeriesContext: null, viewerGalleryContext: null, viewerFloating: true }, "Temporary playlist");
    }
    setViewerFloating(true);
  };
  const rescanAll = async () => {
    setRescanningAll(true);
    setError("");
    try {
      await api("/api/sources/scan", { method: "POST" });
      await loadSources(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not rescan all sources.");
    } finally { setRescanningAll(false); }
  };

  const cancelAllScans = async () => {
    setRescanningAll(true);
    setError("");
    try {
      await api("/api/sources/scan/cancel", { method: "POST" });
      await loadSources(true);
      refreshMedia();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not cancel scans.");
    } finally { setRescanningAll(false); }
  };

  return (
    <AttributeBrowseProvider onNavigate={() => setShowAddSource(false)}><div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Library size={21} /></div><span>Vaultly</span></div>
        <nav aria-label="Main navigation">
          <p>Library</p>
          <button className={section === "home" ? "nav-active" : "nav-link"} type="button" onClick={() => selectSection("home")}><Home size={19} /> Home<span>{formatCount(totalItems)}</span></button>
          <LibraryNav active={section === "comic"} view={libraryView} icon={<Image size={19} />} label="Comics" onBrowse={() => selectSection("comic")} onView={selectLibraryView} />
          <LibraryNav active={section === "video"} view={libraryView} icon={<Clapperboard size={19} />} label="Videos" onBrowse={() => selectSection("video")} onView={selectLibraryView} />
          <LibraryNav active={section === "story"} view={libraryView} icon={<BookOpen size={19} />} label="Stories" onBrowse={() => selectSection("story")} onView={selectLibraryView} />
          <p>Manage</p>
          <button className={section === "categories" ? "nav-active" : "nav-link"} type="button" onClick={() => selectSection("categories")}><Folder size={19} /> Categories</button>
          <button className={section === "tags" ? "nav-active" : "nav-link"} type="button" onClick={() => selectSection("tags")}><TagIcon size={19} /> Tags</button>
          <button className={section === "people" ? "nav-active" : "nav-link"} type="button" onClick={() => selectSection("people")}><Users size={19} /> People</button>
          <button className={section === "sources" ? "nav-active" : "nav-link"} type="button" onClick={() => selectSection("sources")}><HardDrive size={19} /> Sources</button>
          <button className={section === "settings" ? "nav-active" : "nav-link"} type="button" onClick={() => selectSection("settings")}><Settings size={19} /> Settings</button>
        </nav>
      </aside>

      <main>
        <header className="topbar">
          <div className="search-box"><Search size={19} /><input aria-label="Search library" placeholder="Search your library" value={search} onChange={(event) => {
            const nextSearch = event.target.value;
            if (nextSearch && (section !== "all" || libraryView !== "browse")) navigation.push({ section: "all", libraryView: "browse", search: nextSearch, selectedItemId: null }, "Search results");
            else setSearch(nextSearch);
          }} /></div>
          <div className="topbar-actions">
            {temporaryPlaylist.length > 0 && <button className="playlist-launch" type="button" onClick={() => openItem(temporaryPlaylist[0].id)}><ListVideo size={17} /> Temporary playlist <strong>{temporaryPlaylist.length}</strong></button>}
            <div className="local-pill"><span /> Local only</div>
          </div>
        </header>

        <div className="content">
          <nav className="navigation-trail" aria-label="Navigation history">
            <button className="secondary-button" type="button" onClick={navigation.back} disabled={!navigation.entry.breadcrumbs.length}><ArrowLeft size={16} /> Back</button>
            {navigation.entry.breadcrumbs.map((crumb) => <span key={crumb.id}><button type="button" onClick={() => navigation.goTo(crumb.id)}>{crumb.label}</button><ChevronRight size={14} /></span>)}
            <strong aria-current="page">{navigation.entry.label}</strong>
          </nav>
          {section === "home" ? (
            <HomeView sources={sources} categories={categories} onOpenLibrary={selectSection} onOpenCategories={() => navigation.push({ section: "all", libraryView: "categories", search: "" }, "All media categories")} onAddSource={() => { selectSection("sources"); setShowAddSource(true); }} />
          ) : section === "sources" ? <>
          <div className="page-heading">
            <div><p className="eyebrow">Library setup</p><h1>Sources</h1><p>Add folders from this computer. Scans detect media and add missing metadata when existing category, tag, or known cast/artist names appear in filenames. Existing sources only rescan when you choose to; opening the app does not rescan them.</p></div>
            <div className="page-heading-actions">{isScanning
              ? <button className="secondary-button" type="button" onClick={() => void cancelAllScans()} disabled={rescanningAll}>{rescanningAll ? <LoaderCircle className="spin" size={18} /> : <X size={18} />} {rescanningAll ? "Cancelling…" : "Cancel all scans"}</button>
              : <button className="secondary-button" type="button" onClick={() => void rescanAll()} disabled={rescanningAll || sources.length === 0}>{rescanningAll ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={18} />} Rescan all</button>}<button className="primary-button" type="button" onClick={() => setShowAddSource(true)}><Plus size={18} /> Add source</button></div>
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
            <div className="source-grid">{sources.map((source) => <SourceCard key={source.id} source={source} {...attributeOptions} onChanged={() => { void loadSources(true); refreshMedia(); }} />)}</div>
          ) : (
            <section className="empty-state">
              <div className="empty-visual"><div className="folder-back" /><div className="folder-front"><Image size={29} /><Clapperboard size={29} /><BookOpen size={29} /></div></div>
              <h2>Connect your media folders</h2>
              <p>Add one or more folders. Each can contain a mix of comics, videos, and PDFs.</p>
              <button className="primary-button" type="button" onClick={() => setShowAddSource(true)}>Choose a folder <ChevronRight size={18} /></button>
              <span>Nothing is uploaded or moved.</span>
            </section>
          )}
          </> : section === "settings" ? (
            <SettingsView />
          ) : section === "categories" ? (
            <CategoriesView categories={categories} onChanged={() => { void loadCategories(); setRefreshKey((value) => value + 1); }} />
          ) : section === "tags" ? (
            <TagsView tags={tags} onChanged={() => { void loadTags(); setRefreshKey((value) => value + 1); }} />
          ) : section === "people" ? (
            <PeopleView people={people} onChanged={() => { void loadPeople(); setRefreshKey((value) => value + 1); }} />
          ) : libraryView === "series" || libraryView === "circles" ? (
            <SeriesView key={`${navigation.entry.pageId ?? navigation.entry.id}-${section}-${libraryView}-${selectedSeriesId ?? "list"}`} view="browse" initialEntityView={libraryView === "circles" ? "circles" : "sets"} mediaType={section === "all" ? undefined : section} initialSeriesId={selectedSeriesId} categories={categories} tags={tags} onCategoryCreated={createCategory} onTagCreated={createTag} onCategoriesChanged={() => void loadCategories()} onTagsChanged={() => void loadTags()} onOpenItem={(id, context) => openItem(id, context)} />
          ) : (
            <GalleryView
              key={`${navigation.entry.pageId ?? navigation.entry.id}-${section}-${libraryView}`}
              view={libraryView}
              type={section === "all" ? undefined : section}
              search={search}
              categories={categories}
              tags={tags}
              people={people}
              onTagCreated={createTag}
              onCategoryCreated={createCategory}
              onPersonCreated={createPerson}
              onChanged={refreshMedia}
              sources={sources.filter((source) => source.path_available).map((source) => ({ id: source.id, name: source.name }))}
              onOpen={(id, context) => openItem(id, null, context)}
              onQueueVideo={queueVideo}
              queuedVideoIds={temporaryPlaylist.map((item) => item.id)}
              onOpenSeries={openSeries}
              onAddSource={() => { selectSection("sources"); setShowAddSource(true); }}
              refreshKey={refreshKey}
            />
          )}
        </div>
      </main>

      {showAddSource && <AddSourceDialog {...attributeOptions} onClose={() => setShowAddSource(false)} onAdded={() => { void loadSources(true); setRefreshKey((value) => value + 1); }} />}
      {selectedItemId !== null && <MediaViewer itemId={selectedItemId} seriesContext={viewerSeriesContext} galleryContext={viewerGalleryContext} onNavigatePlaylistItem={(id) => navigation.push({ selectedItemId: id, viewerGalleryContext: null, viewerSeriesContext: null }, temporaryPlaylist.find((item) => item.id === id)?.title ?? `File ${id}`)} playlist={temporaryPlaylist.map(({ id, title }) => ({ id, title }))} floating={viewerFloating} onToggleFloating={() => setViewerFloating((value) => !value)} onRemoveFromPlaylist={(id) => setTemporaryPlaylist((current) => current.filter((item) => item.id !== id))} onClearPlaylist={() => setTemporaryPlaylist([])} onNavigateItem={(id) => navigation.push({ selectedItemId: id }, `File ${id}`)} categories={categories} tags={tags} people={people} onCategoryCreated={createCategory} onTagCreated={createTag} onPersonCreated={createPerson} onOpenSeries={openSeries} onClose={closeViewer} onChanged={refreshMedia} />}
    </div></AttributeBrowseProvider>
  );
}
