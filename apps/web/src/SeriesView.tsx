import { ArrowDown, ArrowLeft, ArrowUp, BookOpen, Clapperboard, Heart, Image, Layers3, LoaderCircle, Pencil, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { TagCombobox } from "./TagCombobox";
import { api, type Category, type ItemPage, type MediaType, type SeriesDetail, type SeriesSummary, type SeriesViewerContext, type Tag } from "./media";
import type { LibraryView } from "./App";

interface SeriesViewProps {
  view: LibraryView;
  mediaType?: MediaType;
  initialSeriesId?: number | null;
  categories: Category[];
  tags: Tag[];
  onCategoryCreated: (name: string) => Promise<Category>;
  onTagCreated: (name: string) => Promise<Tag>;
  onCategoriesChanged: () => void;
  onTagsChanged: () => void;
  onOpenItem: (id: number, context: SeriesViewerContext) => void;
}

function PreviewImage({ src, retry }: { src: string; retry: boolean }) {
  const [attempt, setAttempt] = useState(0);
  const [hidden, setHidden] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    setAttempt(0);
    setHidden(false);
    return () => { if (timer.current !== null) window.clearTimeout(timer.current); };
  }, [src]);
  if (hidden) return null;
  const url = retry ? `${src}${src.includes("?") ? "&" : "?"}attempt=${attempt}` : src;
  return <img key={url} src={url} alt="" onError={() => {
    if (!retry || attempt >= 8) { setHidden(true); return; }
    setHidden(true);
    timer.current = window.setTimeout(() => { timer.current = null; setAttempt((value) => value + 1); setHidden(false); }, 3000);
  }} />;
}

function Cover({ series, version = 0 }: { series: SeriesSummary; version?: number }) {
  const fallback = series.cover_item_id === null || !series.cover_item_type ? null
    : itemArtwork(series.cover_item_id, series.cover_item_type, series.cover_item_path ?? "");
  const cover = series.has_cover ? `/api/series/${series.id}/cover?v=${version}` : fallback;
  return <div className="series-cover">
    <Layers3 size={48} />
    {cover && <PreviewImage src={cover} retry={!series.has_cover && series.cover_item_type === "story"} />}
  </div>;
}

function itemArtwork(id: number, type: MediaType, relativePath: string) {
  if (type === "comic" && !/\.(cbz|zip)$/i.test(relativePath)) return `/api/items/${id}/pages/0`;
  return `/api/items/${id}/thumbnail`;
}

type SetType = MediaType | "mixed";
const setSections: Array<{ type: SetType; title: string }> = [
  { type: "video", title: "Video sets" }, { type: "comic", title: "Comic sets" },
  { type: "story", title: "Story sets" }, { type: "mixed", title: "Mixed sets" },
];

function setType(entry: SeriesSummary): SetType {
  if (!entry.item_count) return entry.preferred_type;
  const types = [entry.video_count > 0, entry.comic_count > 0, entry.story_count > 0].filter(Boolean).length;
  if (types > 1) return "mixed";
  return entry.video_count ? "video" : entry.comic_count ? "comic" : "story";
}

function SeriesCard({ entry, version, onOpen, onFavorite }: { entry: SeriesSummary; version: number; onOpen: () => void; onFavorite: () => void }) {
  return <article className="series-card-wrap">
    <button type="button" className="series-card" onClick={onOpen}>
      <Cover series={entry} version={version} />
      <div className="series-card-body"><h2>{entry.title}</h2><p>{setSections.find((value) => value.type === setType(entry))?.title} · {entry.item_count} {entry.item_count === 1 ? "item" : "items"}</p><div className="media-card-tags">{entry.tags.slice(0, 4).map((tag) => <span className="tag-badge" key={tag.id}>{tag.name}</span>)}</div></div>
    </button>
    <button className={`series-card-favorite${entry.favorite ? " is-favorite" : ""}`} type="button" onClick={onFavorite} aria-label={entry.favorite ? `Remove ${entry.title} from favorites` : `Add ${entry.title} to favorites`}><Heart size={17} fill={entry.favorite ? "currentColor" : "none"} /></button>
  </article>;
}

export function SeriesView({ view, mediaType, initialSeriesId = null, categories, tags, onCategoryCreated, onTagCreated, onCategoriesChanged, onTagsChanged, onOpenItem }: SeriesViewProps) {
  const [seriesList, setSeriesList] = useState<SeriesSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(initialSeriesId);
  const [detail, setDetail] = useState<SeriesDetail | null>(null);
  const [search, setSearch] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const [groupFilter, setGroupFilter] = useState<"all" | SetType>("all");
  const [preferredType, setPreferredType] = useState<SetType>("mixed");
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [editing, setEditing] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [candidates, setCandidates] = useState<ItemPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [coverVersion, setCoverVersion] = useState(0);

  useEffect(() => { if (initialSeriesId !== null) setSelectedId(initialSeriesId); }, [initialSeriesId]);

  const loadList = useCallback(async () => {
    try {
      setSeriesList(await api<SeriesSummary[]>(view === "favorites" ? "/api/series?favorite=1" : "/api/series"));
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load series and sets.");
    } finally { setLoading(false); }
  }, [view]);

  const loadDetail = useCallback(async (id: number) => {
    try {
      const result = await api<SeriesDetail>(`/api/series/${id}`);
      setDetail(result);
      setTitle(result.title);
      setDescription(result.description);
      setPreferredType(result.preferred_type);
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not open this set.");
    }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { if (selectedId !== null) void loadDetail(selectedId); else setDetail(null); }, [selectedId, loadDetail]);
  useEffect(() => {
    if (!detail || !itemSearch.trim()) { setCandidates(null); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api<ItemPage>(`/api/items?q=${encodeURIComponent(itemSearch.trim())}&sort=title`, { signal: controller.signal })
        .then(setCandidates)
        .catch((requestError) => { if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : "Could not search media."); });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [detail?.id, itemSearch]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true); setError("");
    try {
      const created = await api<SeriesSummary>("/api/series", { method: "POST", body: JSON.stringify({ title: title.trim(), description: description.trim(), preferredType }) });
      await loadList();
      setShowCreate(false);
      setSelectedId(created.id);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not create this set."); }
    finally { setBusy(false); }
  };

  const updateDetails = async (event: FormEvent) => {
    event.preventDefault();
    if (!detail) return;
    setBusy(true); setError("");
    try {
      await api(`/api/series/${detail.id}`, { method: "PATCH", body: JSON.stringify({ title: title.trim(), description: description.trim(), preferredType }) });
      await Promise.all([loadDetail(detail.id), loadList()]);
      setEditing(false);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not update this set."); }
    finally { setBusy(false); }
  };

  const updateItems = async (itemIds: number[]) => {
    if (!detail) return;
    setBusy(true); setError("");
    try {
      await api(`/api/series/${detail.id}/items`, { method: "PUT", body: JSON.stringify({ itemIds }) });
      await Promise.all([loadDetail(detail.id), loadList()]);
      setItemSearch(""); setCandidates(null);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not update the set order."); }
    finally { setBusy(false); }
  };

  const updateTags = async (tagIds: number[]) => {
    if (!detail) return;
    setBusy(true); setError("");
    try {
      await api(`/api/series/${detail.id}/tags`, { method: "PUT", body: JSON.stringify({ tagIds }) });
      await Promise.all([loadDetail(detail.id), loadList()]);
      onTagsChanged();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not update set tags."); }
    finally { setBusy(false); }
  };

  const updateCategories = async (categoryIds: number[]) => {
    if (!detail) return;
    setBusy(true); setError("");
    try {
      await api(`/api/series/${detail.id}/categories`, { method: "PUT", body: JSON.stringify({ categoryIds }) });
      await Promise.all([loadDetail(detail.id), loadList()]);
      onCategoriesChanged();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not update set categories."); }
    finally { setBusy(false); }
  };

  const toggleFavorite = async (entry: SeriesSummary) => {
    const favorite = entry.favorite ? 0 : 1;
    try {
      await api(`/api/series/${entry.id}/favorite`, { method: "PUT", body: JSON.stringify({ favorite: Boolean(favorite) }) });
      setSeriesList((current) => view === "favorites" && !favorite
        ? current.filter((value) => value.id !== entry.id)
        : current.map((value) => value.id === entry.id ? { ...value, favorite } : value));
      if (detail?.id === entry.id) setDetail({ ...detail, favorite });
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not update favorite."); }
  };

  const uploadCover = async (file: File | undefined) => {
    if (!detail || !file) return;
    if (file.size > 5 * 1024 * 1024) { setError("Cover image must be under 5 MB."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/series/${detail.id}/cover`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: file });
      if (!response.ok) throw new Error((await response.json()).message || "Could not save cover.");
      setCoverVersion(Date.now());
      await Promise.all([loadDetail(detail.id), loadList()]);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not save cover."); }
    finally { setBusy(false); }
  };

  const deleteCover = async () => {
    if (!detail) return;
    setBusy(true); setError("");
    try {
      await api(`/api/series/${detail.id}/cover`, { method: "DELETE" });
      await Promise.all([loadDetail(detail.id), loadList()]);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not remove cover."); }
    finally { setBusy(false); }
  };

  const deleteSeries = async () => {
    if (!detail || !window.confirm(`Remove “${detail.title}”? The media files will stay in your library.`)) return;
    setBusy(true); setError("");
    try {
      await api(`/api/series/${detail.id}`, { method: "DELETE" });
      setSelectedId(null);
      await loadList();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not remove this set."); }
    finally { setBusy(false); }
  };

  const visible = seriesList.filter((entry) => view !== "browse" || (
    (entry.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()) || entry.description.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    && selectedTagIds.every((id) => entry.tags.some((tag) => tag.id === id))
    && selectedCategoryIds.every((id) => (entry.categories ?? []).some((category) => category.id === id))
    && (groupFilter === "all" || setType(entry) === groupFilter)
    && (!mediaType || (mediaType === "video" ? entry.video_count : mediaType === "comic" ? entry.comic_count : entry.story_count) > 0)));
  const categorySections = [
    ...categories.map((category) => ({
      id: `category-${category.id}`,
      title: category.name,
      entries: visible.filter((entry) => (entry.categories ?? []).some((value) => value.id === category.id)),
    })).filter((section) => section.entries.length > 0),
    { id: "uncategorized", title: "Uncategorized", entries: visible.filter((entry) => (entry.categories ?? []).length === 0) },
  ].filter((section) => section.entries.length > 0);

  if (selectedId !== null) return <section className="series-view">
    <button className="series-back" type="button" onClick={() => { setSelectedId(null); setEditing(false); setItemSearch(""); }}><ArrowLeft size={17} /> All series & sets</button>
    {error && <p className="page-error" role="alert">{error}</p>}
    {!detail || detail.id !== selectedId ? <div className="loading-state"><LoaderCircle className="spin" size={25} /> Loading set…</div> : <>
      <div className="series-hero">
        <Cover series={detail} version={coverVersion} />
        <div className="series-hero-body">
          <p className="eyebrow">{setSections.find((section) => section.type === setType(detail))?.title} · {detail.item_count} items</p>
          {editing ? <form className="series-edit" onSubmit={updateDetails}>
            <input aria-label="Set title" value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} required />
            <textarea aria-label="Set description" value={description} maxLength={3000} onChange={(event) => setDescription(event.target.value)} placeholder="Description" />
            <select aria-label="Preferred content type" value={preferredType} onChange={(event) => setPreferredType(event.target.value as SetType)}><option value="video">Videos</option><option value="comic">Comics</option><option value="story">Stories</option><option value="mixed">Mixed media</option></select>
            <div><button className="primary-button" type="submit" disabled={busy}>Save</button><button className="secondary-button" type="button" onClick={() => setEditing(false)}>Cancel</button></div>
          </form> : <><h1>{detail.title}</h1><p>{detail.description || "A set for related comics, videos, PDFs, and sequels."}</p></>}
          <div className="series-actions">
            <button className={`secondary-button${detail.favorite ? " is-favorite" : ""}`} type="button" onClick={() => void toggleFavorite(detail)}><Heart size={15} fill={detail.favorite ? "currentColor" : "none"} /> {detail.favorite ? "Favorited" : "Add favorite"}</button>
            <button className="secondary-button" type="button" onClick={() => setEditing(true)} disabled={busy}><Pencil size={15} /> Edit details</button>
            <label className="secondary-button series-upload"><Upload size={15} /> {detail.has_cover ? "Change cover" : "Add cover"}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => { void uploadCover(event.target.files?.[0]); event.target.value = ""; }} /></label>
            {Boolean(detail.has_cover) && <button className="secondary-button" type="button" onClick={() => void deleteCover()} disabled={busy}>Remove cover</button>}
            <button className="secondary-button series-danger" type="button" onClick={() => void deleteSeries()} disabled={busy}><Trash2 size={15} /> Delete set</button>
          </div>
          <TagCombobox label="Set tags" tags={tags} selectedIds={detail.tags.map((tag) => tag.id)} onChange={(ids) => void updateTags(ids)} onCreate={onTagCreated} disabled={busy} placeholder="Search or create tags" />
          <TagCombobox label="Set categories" tags={categories} selectedIds={(detail.categories ?? []).map((category) => category.id)} onChange={(ids) => void updateCategories(ids)} onCreate={onCategoryCreated} disabled={busy} placeholder="Search or create categories" />
        </div>
      </div>

      <div className="series-content-heading"><div><h2>In this set</h2><p>Use the arrows to put sequels in reading or viewing order.</p></div></div>
      <div className="series-members">
        {detail.items.length === 0 && <p className="series-empty-members">No media added yet. Search your library below to add the first item.</p>}
        {detail.items.map((item, index) => <div className="series-member" key={item.id}>
          <span className="series-member-number">{index + 1}</span>
          <div className="series-member-art">{item.media_type === "video" ? <Clapperboard size={20} /> : item.media_type === "story" ? <BookOpen size={20} /> : <Image size={20} />}<PreviewImage src={itemArtwork(item.id, item.media_type, item.relative_path)} retry={item.media_type === "story"} /></div>
          <button className="series-member-title" type="button" onClick={() => onOpenItem(item.id, { seriesId: detail.id, seriesTitle: detail.title, items: detail.items.map((entry) => ({ id: entry.id, title: entry.title })) })}><strong>{item.title}</strong><span>{item.media_type} · {item.source_name}</span></button>
          <div className="series-member-controls">
            <button type="button" title="Move earlier" aria-label={`Move ${item.title} earlier`} disabled={busy || index === 0} onClick={() => { const ids = detail.items.map((entry) => entry.id); [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]; void updateItems(ids); }}><ArrowUp size={16} /></button>
            <button type="button" title="Move later" aria-label={`Move ${item.title} later`} disabled={busy || index === detail.items.length - 1} onClick={() => { const ids = detail.items.map((entry) => entry.id); [ids[index + 1], ids[index]] = [ids[index], ids[index + 1]]; void updateItems(ids); }}><ArrowDown size={16} /></button>
            <button type="button" title="Remove from set" aria-label={`Remove ${item.title} from set`} disabled={busy} onClick={() => void updateItems(detail.items.filter((entry) => entry.id !== item.id).map((entry) => entry.id))}><X size={16} /></button>
          </div>
        </div>)}
      </div>
      <div className="series-add"><h2>Add media</h2><p>Search indexed files and add videos, comics, or PDFs to this set.</p>
        <div className="series-search"><Search size={17} /><input aria-label="Search media to add" value={itemSearch} onChange={(event) => setItemSearch(event.target.value)} placeholder="Search by title or path" /></div>
        {candidates && <div className="series-candidates">{candidates.items.filter((item) => !detail.items.some((member) => member.id === item.id)).map((item) =>
          <button key={item.id} type="button" disabled={busy} onClick={() => void updateItems([...detail.items.map((entry) => entry.id), item.id])}><Plus size={16} /><span>{item.title}</span><small>{item.media_type} · {item.source_name}</small></button>)}
          {candidates.total === 0 && <p>No indexed media matches this search.</p>}
          {candidates.total > candidates.pageSize && <p>Showing the first {candidates.pageSize} matches. Refine your search to find more.</p>}
        </div>}
      </div>
    </>}
  </section>;

  return <section className="series-view">
    <div className="page-heading"><div><p className="eyebrow">Your library</p><h1>{mediaType ? `${mediaType === "story" ? "Story" : mediaType[0].toUpperCase() + mediaType.slice(1)} series & sets` : view === "categories" ? "Series & sets by category" : view === "favorites" ? "Favorite series & sets" : "Series & sets"}</h1><p>{view === "categories" ? "Browse sets in dedicated category sections." : view === "favorites" ? "Your favorite collections, kept separate from library filters." : `Collections containing ${mediaType ? `${mediaType} items` : "related media"}, kept in viewing order.`}</p></div>
      {view === "browse" && <button className="primary-button" type="button" onClick={() => { setTitle(""); setDescription(""); setPreferredType(groupFilter === "all" ? "mixed" : groupFilter); setError(""); setShowCreate(true); }}><Plus size={18} /> New set</button>}</div>
    {view === "browse" && <div className="series-filters"><div className="series-search"><Search size={17} /><input aria-label="Search series and sets" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search series and sets" /></div>
      <TagCombobox label="Filter set categories (match all)" tags={categories} selectedIds={selectedCategoryIds} onChange={setSelectedCategoryIds} placeholder="All categories" />
      <TagCombobox label="Filter set tags (match all)" tags={tags} selectedIds={selectedTagIds} onChange={setSelectedTagIds} placeholder="All tags" /></div>}
    {view === "browse" && !mediaType && <div className="series-type-tabs" role="group" aria-label="Set content type">{(["all", "video", "comic", "story", "mixed"] as const).map((value) =>
      <button key={value} type="button" className={groupFilter === value ? "active" : ""} onClick={() => setGroupFilter(value)}>{value === "all" ? "All" : value === "story" ? "Stories" : value === "comic" ? "Comics" : value === "video" ? "Videos" : "Mixed"}</button>)}</div>}
    {error && <p className="page-error" role="alert">{error}</p>}
    {loading ? <div className="loading-state"><LoaderCircle className="spin" size={25} /> Loading sets…</div> : visible.length ? (view === "categories" ? categorySections.map((section) =>
      <section className="category-card-section" key={section.id}><div className="category-card-heading"><h2>{section.title}</h2><span>{section.entries.length}</span></div><div className="series-grid">{section.entries.map((entry) =>
        <SeriesCard key={`${section.id}-${entry.id}`} entry={entry} version={coverVersion} onOpen={() => setSelectedId(entry.id)} onFavorite={() => void toggleFavorite(entry)} />)}</div></section>) : setSections.map((section) => {
          const entries = visible.filter((entry) => setType(entry) === section.type);
          if (!entries.length) return null;
          return <section className="series-type-section" key={section.type}><h2>{section.title} <span>{entries.length}</span></h2><div className="series-grid">{entries.map((entry) => <SeriesCard key={entry.id} entry={entry} version={coverVersion} onOpen={() => setSelectedId(entry.id)} onFavorite={() => void toggleFavorite(entry)} />)}</div></section>;
        }))
      : <div className="gallery-empty"><Layers3 size={38} /><h2>{seriesList.length ? "No matching sets" : "No series or sets yet"}</h2><p>{seriesList.length ? "Try another search or tag combination." : "Create a set, then add related media in the order you want."}</p></div>}
    {showCreate && <div className="dialog-backdrop" role="presentation" onMouseDown={() => setShowCreate(false)}><section className="dialog" role="dialog" aria-modal="true" aria-label="Create series or set" onMouseDown={(event) => event.stopPropagation()}>
      <button className="icon-button dialog-close" type="button" onClick={() => setShowCreate(false)} aria-label="Close"><X size={19} /></button><div className="dialog-icon"><Layers3 size={24} /></div><h2>New series or set</h2><p className="dialog-intro">Group any mix of videos, comics, and PDFs without moving your files.</p>
      <form onSubmit={create}><label htmlFor="series-title">Title</label><input id="series-title" value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} autoFocus required />
        <label htmlFor="series-description">Description</label><textarea id="series-description" value={description} maxLength={3000} onChange={(event) => setDescription(event.target.value)} placeholder="Optional" />
        <label htmlFor="series-type">Content type</label><select id="series-type" value={preferredType} onChange={(event) => setPreferredType(event.target.value as SetType)}><option value="video">Videos</option><option value="comic">Comics</option><option value="story">Stories</option><option value="mixed">Mixed media</option></select>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setShowCreate(false)}>Cancel</button><button className="primary-button" type="submit" disabled={busy}>Create set</button></div></form>
    </section></div>}
  </section>;
}
