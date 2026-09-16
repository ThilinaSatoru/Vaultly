import { ArrowLeft, BookOpen, Check, ChevronDown, Clapperboard, Folder, FolderPlus, Heart, Image, Layers3, ListPlus, LoaderCircle, Play, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TagCombobox } from "./TagCombobox";
import { BulkActionDialog } from "./BulkActionDialog";
import { api, formatCount, formatDuration, formatSize, type Category, type ItemPage, type MediaItem, type MediaType, type Person, type SeriesSummary, type Tag } from "./media";
import type { LibraryView } from "./App";

interface GalleryViewProps {
  view: LibraryView;
  type?: MediaType;
  search: string;
  categories: Category[];
  tags: Tag[];
  people: Person[];
  onTagCreated: (name: string) => Promise<Tag>;
  onCategoryCreated: (name: string) => Promise<Category>;
  onPersonCreated: (name: string) => Promise<Person>;
  onChanged: () => void;
  sources: Array<{ id: number; name: string }>;
  onOpen: (id: number) => void;
  onQueueVideo: (item: MediaItem) => void;
  queuedVideoIds: number[];
  onOpenSeries: (id: number) => void;
  onAddSource: () => void;
  refreshKey: number;
}

const galleryNames: Record<MediaType, string> = {
  comic: "Comics",
  video: "Videos",
  story: "Stories",
};

function MediaCard({ item, selected, queued, onSelect, onOpen, onFavorite, onQueue }: { item: MediaItem; selected: boolean; queued: boolean; onSelect: () => void; onOpen: () => void; onFavorite: () => void; onQueue: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const [thumbnailAttempt, setThumbnailAttempt] = useState(0);
  const [duration, setDuration] = useState(item.duration_seconds);
  const hoverTimer = useRef<number | null>(null);
  const retryTimer = useRef<number | null>(null);
  const archive = /\.(cbz|zip)$/i.test(item.relative_path);

  const startPreview = () => {
    if (item.media_type !== "video") return;
    hoverTimer.current = window.setTimeout(() => setHovered(true), 350);
  };
  const stopPreview = () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setHovered(false);
  };

  useEffect(() => () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
  }, []);

  useEffect(() => {
    if (item.media_type !== "video" || duration) return;
    let active = true;
    api<{ duration_seconds: number | null }>(`/api/items/${item.id}/video-metadata`)
      .then((metadata) => { if (active) setDuration(metadata.duration_seconds); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [item.id, item.media_type, duration]);

  const handleThumbnailError = () => {
    if (item.media_type !== "story" || thumbnailAttempt >= 8) {
      setThumbnailFailed(true);
      return;
    }
    if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    retryTimer.current = window.setTimeout(() => {
      retryTimer.current = null;
      setThumbnailAttempt((value) => value + 1);
    }, 3000);
  };

  return (
    <article className={`media-card media-card-selectable${selected ? " is-selected" : ""}`}>
      <label className="media-card-select" title={`Select ${item.title}`}><input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Select ${item.title}`} /></label>
      <button className={`media-card-favorite${item.favorite ? " is-favorite" : ""}`} type="button" onClick={onFavorite} aria-label={item.favorite ? `Remove ${item.title} from favorites` : `Add ${item.title} to favorites`}><Heart size={17} fill={item.favorite ? "currentColor" : "none"} /></button>
      {item.media_type === "video" && <button className={`media-card-queue${queued ? " is-queued" : ""}`} type="button" onClick={onQueue} aria-label={queued ? `${item.title} is in temporary playlist` : `Add ${item.title} to temporary playlist`} title={queued ? "In temporary playlist" : "Add to temporary playlist"}>{queued ? <Check size={17} /> : <ListPlus size={17} />}</button>}
      <button
      className="media-card-open"
      type="button"
      onClick={onOpen}
      onMouseEnter={startPreview}
      onMouseLeave={stopPreview}
      onFocus={startPreview}
      onBlur={stopPreview}
      aria-label={`Open ${item.title}`}
    >
      <div className={`media-art media-art-${item.media_type}`}>
        {item.media_type === "comic" && !archive ? (
          <img src={`/api/items/${item.id}/pages/0`} alt="" loading="lazy" />
        ) : item.media_type === "video" && hovered ? (
          <video src={`/api/items/${item.id}/file`} autoPlay muted playsInline loop preload="metadata" />
        ) : (item.media_type === "video" || item.media_type === "story") && !thumbnailFailed ? (
          <img
            src={`/api/items/${item.id}/thumbnail?modified=${item.modified_at_ms}&attempt=${thumbnailAttempt}`}
            alt=""
            loading="lazy"
            onError={handleThumbnailError}
          />
        ) : (
          item.media_type === "video" ? <Clapperboard size={42} /> : item.media_type === "story" ? <BookOpen size={42} /> : <Image size={42} />
        )}
        <span className="media-type-badge">{item.media_type === "video" ? formatDuration(duration) : item.media_type}</span>
        {item.media_type === "video" && <span className="play-overlay"><Play size={19} fill="currentColor" /></span>}
      </div>
      <div className="media-card-body">
        <h3 title={item.title}>{item.title}</h3>
        <p title={item.relative_path}>{item.source_name} · {item.relative_path}</p>
        {item.tags.length > 0 && <div className="media-card-tags" title={item.tags.map((tag) => tag.name).join(", ")}>{item.tags.slice(0, 3).map((tag) => <span className="tag-badge" key={tag.id}>{tag.name}</span>)}{item.tags.length > 3 && <span className="tag-badge">+{item.tags.length - 3}</span>}</div>}
        {(item.cast.length > 0 || item.artists.length > 0) && <div className="media-card-people" title={[...item.cast.map((person) => `Cast: ${person.name}`), ...item.artists.map((person) => `Artist: ${person.name}`)].join(" · ")}>{item.cast.length > 0 && <span>Cast: {item.cast.map((person) => person.name).join(", ")}</span>}{item.artists.length > 0 && <span>Artists: {item.artists.map((person) => person.name).join(", ")}</span>}</div>}
        <div className="media-card-meta"><span>{formatSize(item.size_bytes)}</span><span>{item.media_type === "comic" ? `${item.file_count} ${item.file_count === 1 ? "file" : "pages"}` : item.category_names || "Uncategorized"}</span></div>
      </div>
      </button>
    </article>
  );
}

function CollectionCard({ series, onOpen }: { series: SeriesSummary; onOpen: () => void }) {
  const fallback = series.cover_item_id === null || !series.cover_item_type ? null
    : series.cover_item_type === "comic" && !/\.(cbz|zip)$/i.test(series.cover_item_path ?? "")
      ? `/api/items/${series.cover_item_id}/pages/0`
      : `/api/items/${series.cover_item_id}/thumbnail`;
  const cover = series.has_cover ? `/api/series/${series.id}/cover` : fallback;
  return <article className="media-card collection-media-card">
    <button className="media-card-open" type="button" onClick={onOpen} aria-label={`Open collection ${series.title}`}>
      <div className="media-art collection-art"><Layers3 size={44} />{cover && <img src={cover} alt="" loading="lazy" />}<span className="media-type-badge">Collection</span></div>
      <div className="media-card-body"><h3 title={series.title}>{series.title}</h3><p>{series.item_count} {series.item_count === 1 ? "item" : "items"}</p><div className="media-card-tags">{series.tags.slice(0, 3).map((tag) => <span className="tag-badge" key={tag.id}>{tag.name}</span>)}</div><div className="media-card-meta"><span>{series.video_count} videos</span><span>{series.comic_count + series.story_count} reading</span></div></div>
    </button>
  </article>;
}

export function GalleryView({ view, type, search, categories, tags, people, onTagCreated, onCategoryCreated, onPersonCreated, onChanged, sources, onOpen, onQueueVideo, queuedVideoIds, onOpenSeries, onAddSource, refreshKey }: GalleryViewProps) {
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [selectedCastIds, setSelectedCastIds] = useState<number[]>([]);
  const [selectedArtistIds, setSelectedArtistIds] = useState<number[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [filename, setFilename] = useState("");
  const [pathText, setPathText] = useState("");
  const [debouncedFilename, setDebouncedFilename] = useState("");
  const [debouncedPath, setDebouncedPath] = useState("");
  const [selectedType, setSelectedType] = useState<MediaType | "">("");
  const [sourceId, setSourceId] = useState("");
  const [extension, setExtension] = useState("");
  const [seriesFilter, setSeriesFilter] = useState("");
  const [minMb, setMinMb] = useState("");
  const [maxMb, setMaxMb] = useState("");
  const [modifiedFrom, setModifiedFrom] = useState("");
  const [modifiedTo, setModifiedTo] = useState("");
  const [uncategorized, setUncategorized] = useState(false);
  const [untagged, setUntagged] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [formats, setFormats] = useState<Array<{ extension: string; item_count: number }>>([]);
  const [seriesOptions, setSeriesOptions] = useState<SeriesSummary[]>([]);
  const [sort, setSort] = useState<"title" | "filename" | "recent" | "oldest" | "size" | "smallest">("title");
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<ItemPage | null>(null);
  const [categoryOverview, setCategoryOverview] = useState<{ categories: Category[]; uncategorized_count: number } | null>(null);
  const [browseCategory, setBrowseCategory] = useState<number | "uncategorized" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebouncedFilename(filename); setDebouncedPath(pathText); }, 180);
    return () => window.clearTimeout(timer);
  }, [filename, pathText]);

  useEffect(() => {
    let active = true;
    const effectiveType = type || selectedType;
    void Promise.all([
      api<Array<{ extension: string; item_count: number }>>(`/api/items/formats${effectiveType ? `?type=${effectiveType}` : ""}`),
      api<SeriesSummary[]>("/api/series"),
    ]).then(([nextFormats, nextSeries]) => {
      if (!active) return;
      setFormats(nextFormats);
      setSeriesOptions(nextSeries);
    }).catch((requestError) => { if (active) setError(requestError instanceof Error ? requestError.message : "Could not load filter choices."); });
    return () => { active = false; };
  }, [type, selectedType, refreshKey]);

  useEffect(() => {
    if (view !== "categories") return;
    let active = true;
    setCategoryOverview(null);
    api<{ categories: Category[]; uncategorized_count: number }>(`/api/categories/overview${type ? `?type=${type}` : ""}`)
      .then((data) => { if (active) { setCategoryOverview(data); setError(""); } })
      .catch((requestError) => { if (active) setError(requestError instanceof Error ? requestError.message : "Could not load categories."); });
    return () => { active = false; };
  }, [view, type, refreshKey]);

  useEffect(() => { setExtension(""); if (type) setSelectedType(""); }, [type]);
  useEffect(() => { setSelectedItemIds([]); }, [type]);
  useEffect(() => { if (sourceId && !sources.some((source) => String(source.id) === sourceId)) setSourceId(""); }, [sourceId, sources]);

  useEffect(() => {
    setSelectedCategoryIds((current) => current.every((id) => categories.some((category) => category.id === id))
      ? current
      : current.filter((id) => categories.some((category) => category.id === id)));
  }, [categories]);

  useEffect(() => {
    setSelectedTagIds((current) => current.every((id) => tags.some((tag) => tag.id === id))
      ? current
      : current.filter((id) => tags.some((tag) => tag.id === id)));
  }, [tags]);

  useEffect(() => {
    setSelectedCastIds((current) => current.filter((id) => people.some((person) => person.id === id)));
    setSelectedArtistIds((current) => current.filter((id) => people.some((person) => person.id === id)));
  }, [people]);

  useEffect(() => { setPage(0); }, [type, view, browseCategory, search, debouncedFilename, debouncedPath, selectedType, sourceId, extension, seriesFilter, minMb, maxMb, modifiedFrom, modifiedTo, uncategorized, untagged, selectedCategoryIds, selectedTagIds, selectedCastIds, selectedArtistIds, sort]);

  useEffect(() => {
    const controller = new AbortController();
    if (view === "categories" && browseCategory === null) {
      setResult(null);
      setLoading(false);
      return () => controller.abort();
    }
    const params = new URLSearchParams({ page: String(page), sort });
    if (type || selectedType) params.set("type", type || selectedType);
    if (view === "favorites") params.set("favorite", "1");
    if (view === "categories" && browseCategory === "uncategorized") params.set("uncategorized", "1");
    if (view === "categories" && typeof browseCategory === "number") params.set("category", String(browseCategory));
    if (view === "browse" && search.trim()) params.set("q", search.trim());
    if (view !== "browse") {
      setLoading(true);
      api<ItemPage>(`/api/items?${params.toString()}`, { signal: controller.signal })
        .then((data) => { setResult(data); setError(""); })
        .catch((requestError) => { if (!controller.signal.aborted) { setResult(null); setError(requestError instanceof Error ? requestError.message : "Could not load media."); } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
      return () => controller.abort();
    }
    if (debouncedFilename.trim()) params.set("filename", debouncedFilename.trim());
    if (debouncedPath.trim()) params.set("path", debouncedPath.trim());
    if (sourceId) params.set("source", sourceId);
    if (extension) params.set("extension", extension);
    if (seriesFilter) params.set("series", seriesFilter);
    if (minMb) params.set("minMb", minMb);
    if (maxMb) params.set("maxMb", maxMb);
    if (modifiedFrom) params.set("modifiedFrom", modifiedFrom);
    if (modifiedTo) params.set("modifiedTo", modifiedTo);
    if (uncategorized) params.set("uncategorized", "1");
    if (untagged) params.set("untagged", "1");
    if (selectedCategoryIds.length) params.set("categories", selectedCategoryIds.join(","));
    if (selectedTagIds.length) params.set("tags", selectedTagIds.join(","));
    if (selectedCastIds.length) params.set("cast", selectedCastIds.join(","));
    if (selectedArtistIds.length) params.set("artists", selectedArtistIds.join(","));
    setLoading(true);
    api<ItemPage>(`/api/items?${params.toString()}`, { signal: controller.signal })
      .then((data) => { setResult(data); setError(""); })
      .catch((requestError) => {
        if (controller.signal.aborted) return;
        setResult(null);
        setError(requestError instanceof Error ? requestError.message : "Could not load media.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [view, browseCategory, type, search, debouncedFilename, debouncedPath, selectedType, sourceId, extension, seriesFilter, minMb, maxMb, modifiedFrom, modifiedTo, uncategorized, untagged, selectedCategoryIds, selectedTagIds, selectedCastIds, selectedArtistIds, sort, page, refreshKey]);

  const libraryTitle = type ? galleryNames[type] : "All media";
  const selectedCategoryName = browseCategory === "uncategorized" ? "Uncategorized" : categoryOverview?.categories.find((category) => category.id === browseCategory)?.name;
  const title = view === "categories" ? selectedCategoryName ? `${libraryTitle} · ${selectedCategoryName}` : `${libraryTitle} categories` : view === "favorites" ? `${libraryTitle} favorites` : libraryTitle;
  const hasFilters = Boolean(filename || pathText || selectedType || sourceId || extension || seriesFilter || minMb || maxMb || modifiedFrom || modifiedTo || uncategorized || untagged || selectedCategoryIds.length || selectedTagIds.length || selectedCastIds.length || selectedArtistIds.length);
  const extraFilterCount = [pathText, selectedType, sourceId, extension, seriesFilter, minMb, maxMb, modifiedFrom, modifiedTo, uncategorized, untagged, selectedCastIds.length, selectedArtistIds.length].filter(Boolean).length;
  const clearFilters = () => {
    setFilename(""); setPathText(""); setDebouncedFilename(""); setDebouncedPath("");
    setSelectedType(""); setSourceId(""); setExtension(""); setSeriesFilter("");
    setMinMb(""); setMaxMb(""); setModifiedFrom(""); setModifiedTo("");
    setUncategorized(false); setUntagged(false); setSelectedCategoryIds([]); setSelectedTagIds([]); setSelectedCastIds([]); setSelectedArtistIds([]); setSort("title");
  };
  const toggleItem = (id: number) => setSelectedItemIds((current) => current.includes(id)
    ? current.filter((value) => value !== id) : current.length < 500 ? [...current, id] : current);
  const selectPage = () => setSelectedItemIds((current) => [...new Set([...current, ...(result?.items.map((item) => item.id) ?? [])])].slice(0, 500));
  const createSeries = async (name: string) => {
    const created = await api<SeriesSummary>("/api/series", { method: "POST", body: JSON.stringify({ title: name }) });
    setSeriesOptions((current) => [...current, created].sort((a, b) => a.title.localeCompare(b.title)));
    return created;
  };
  const toggleFavorite = async (item: MediaItem) => {
    const favorite = item.favorite ? 0 : 1;
    try {
      await api(`/api/items/${item.id}/favorite`, { method: "PUT", body: JSON.stringify({ favorite: Boolean(favorite) }) });
      setResult((current) => current ? {
        ...current,
        items: view === "favorites" && !favorite ? current.items.filter((entry) => entry.id !== item.id) : current.items.map((entry) => entry.id === item.id ? { ...entry, favorite } : entry),
        total: view === "favorites" && !favorite ? Math.max(0, current.total - 1) : current.total,
      } : current);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not update favorite."); }
  };
  const renderCards = (items: MediaItem[], keyPrefix = "") => {
    const shownSeries = new Set<number>();
    return items.flatMap((item) => {
      const memberships = (item.series_ids ?? []).map((id) => seriesOptions.find((series) => series.id === id)).filter((series): series is SeriesSummary => Boolean(series));
      if (!memberships.length) return [<MediaCard key={`${keyPrefix}item-${item.id}`} item={item} selected={selectedItemIds.includes(item.id)} queued={queuedVideoIds.includes(item.id)} onSelect={() => toggleItem(item.id)} onOpen={() => onOpen(item.id)} onFavorite={() => void toggleFavorite(item)} onQueue={() => onQueueVideo(item)} />];
      return memberships.filter((series) => !shownSeries.has(series.id)).map((series) => {
        shownSeries.add(series.id);
        return <CollectionCard key={`${keyPrefix}series-${series.id}`} series={series} onOpen={() => onOpenSeries(series.id)} />;
      });
    });
  };
  const paginationControls = result ? <div className="pagination">
    <button className="secondary-button" type="button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0}>Previous</button>
    <span>Page {page + 1} of {Math.max(1, Math.ceil(result.total / result.pageSize))}</span>
    <button className="secondary-button" type="button" onClick={() => setPage((value) => value + 1)} disabled={(page + 1) * result.pageSize >= result.total}>Next</button>
  </div> : null;

  return (
    <section className="gallery-view">
      <div className="page-heading gallery-heading">
        <div>{view === "categories" && browseCategory !== null && <button className="category-back" type="button" onClick={() => { setBrowseCategory(null); setSelectedItemIds([]); }}><ArrowLeft size={16} /> All categories</button>}<p className="eyebrow">Your library</p><h1>{title}</h1><p>{view === "categories" && browseCategory === null ? "Choose a category to open its media library." : search ? `Results for “${search}”` : "Browse files indexed from your local folders."}</p></div>
        <span className="result-count">{view === "categories" && browseCategory === null ? categoryOverview ? `${formatCount(categoryOverview.categories.length + (categoryOverview.uncategorized_count ? 1 : 0))} categories` : "Loading…" : loading && !result ? "Loading…" : `${formatCount(result?.total ?? 0)} items`}</span>
      </div>

      {view === "categories" && browseCategory === null && categoryOverview && <div className="category-selection-grid">
        {categoryOverview.categories.map((category) => <button className="category-selection-card" type="button" key={category.id} onClick={() => setBrowseCategory(category.id)}><span className="category-selection-icon"><Folder size={23} /></span><strong>{category.name}</strong><small>{formatCount(category.item_count)} items</small></button>)}
        {categoryOverview.uncategorized_count > 0 && <button className="category-selection-card" type="button" onClick={() => setBrowseCategory("uncategorized")}><span className="category-selection-icon"><FolderPlus size={23} /></span><strong>Uncategorized</strong><small>{formatCount(categoryOverview.uncategorized_count)} items</small></button>}
      </div>}

      {view === "browse" && <div className="gallery-toolbar">
        <label className="gallery-filter-field"><span>File name</span><input value={filename} onChange={(event) => setFilename(event.target.value)} placeholder="Search filenames" aria-label="File name contains" /></label>
        <TagCombobox label="Categories (match all)" tags={categories} selectedIds={selectedCategoryIds} onChange={setSelectedCategoryIds} disabled={uncategorized} placeholder="All categories" />
        <TagCombobox label="Tags (match all)" tags={tags} selectedIds={selectedTagIds} onChange={setSelectedTagIds} disabled={untagged} placeholder="All tags" />
        <label className="select-wrap">
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="title">Title A–Z</option>
            <option value="filename">Filename A–Z</option>
            <option value="recent">Recently modified</option>
            <option value="oldest">Oldest modified</option>
            <option value="size">Largest first</option>
            <option value="smallest">Smallest first</option>
          </select>
          <ChevronDown size={16} />
        </label>
        <button className={`gallery-more-button${advancedOpen ? " is-open" : ""}`} type="button" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((value) => !value)}><SlidersHorizontal size={16} /> More filters{extraFilterCount > 0 ? ` (${extraFilterCount})` : ""}</button>
        {hasFilters && <button className="gallery-clear-button" type="button" onClick={clearFilters}><X size={15} /> Clear filters</button>}
      </div>}

      {view === "browse" && advancedOpen && <div className="gallery-advanced" aria-label="More filters">
        {!type && <label className="gallery-filter-field"><span>Media type</span><select value={selectedType} onChange={(event) => { setSelectedType(event.target.value as MediaType | ""); setExtension(""); }}><option value="">All types</option><option value="comic">Comics</option><option value="video">Videos</option><option value="story">PDF stories</option></select></label>}
        <label className="gallery-filter-field"><span>Source folder</span><select value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">All sources</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
        <label className="gallery-filter-field"><span>File format</span><select value={extension} onChange={(event) => setExtension(event.target.value)}><option value="">All formats</option>{formats.map((format) => <option key={format.extension || "folder"} value={format.extension || "folder"}>{format.extension ? `.${format.extension.toUpperCase()}` : "Image folder"} ({format.item_count})</option>)}</select></label>
        <label className="gallery-filter-field"><span>Series / set</span><select value={seriesFilter} onChange={(event) => setSeriesFilter(event.target.value)}><option value="">All items</option><option value="grouped">In any set</option><option value="ungrouped">Not in a set</option>{seriesOptions.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select></label>
        <label className="gallery-filter-field"><span>Path contains</span><input value={pathText} onChange={(event) => setPathText(event.target.value)} placeholder="Folder or relative path" /></label>
        <label className="gallery-filter-field"><span>Minimum size (MB)</span><input type="number" min="0" step="0.1" value={minMb} onChange={(event) => setMinMb(event.target.value)} placeholder="No minimum" /></label>
        <label className="gallery-filter-field"><span>Maximum size (MB)</span><input type="number" min="0" step="0.1" value={maxMb} onChange={(event) => setMaxMb(event.target.value)} placeholder="No maximum" /></label>
        <label className="gallery-filter-field"><span>Modified from</span><input type="date" value={modifiedFrom} max={modifiedTo || undefined} onChange={(event) => setModifiedFrom(event.target.value)} /></label>
        <label className="gallery-filter-field"><span>Modified through</span><input type="date" value={modifiedTo} min={modifiedFrom || undefined} onChange={(event) => setModifiedTo(event.target.value)} /></label>
        <TagCombobox label="Cast (match all)" tags={people} selectedIds={selectedCastIds} onChange={setSelectedCastIds} placeholder="Any cast" />
        <TagCombobox label="Artists (match all)" tags={people} selectedIds={selectedArtistIds} onChange={setSelectedArtistIds} placeholder="Any artist" />
        <label className="gallery-filter-check"><input type="checkbox" checked={uncategorized} onChange={(event) => { setUncategorized(event.target.checked); if (event.target.checked) setSelectedCategoryIds([]); }} /> Uncategorized only</label>
        <label className="gallery-filter-check"><input type="checkbox" checked={untagged} onChange={(event) => { setUntagged(event.target.checked); if (event.target.checked) setSelectedTagIds([]); }} /> Untagged only</label>
      </div>}

      {!(view === "categories" && browseCategory === null) && <div className="gallery-selection-bar">
        <button className="secondary-button" type="button" onClick={selectPage} disabled={!result?.items.length}>Select page</button>
        {selectedItemIds.length > 0 && <><span>{selectedItemIds.length} selected{selectedItemIds.length >= 500 ? " · limit reached" : ""}</span><button className="primary-button" type="button" onClick={() => setBulkOpen(true)}>Bulk actions</button><button className="gallery-clear-button" type="button" onClick={() => setSelectedItemIds([])}>Clear selection</button></>}
      </div>}

      {error && <p className="page-error" role="alert">{error}</p>}
      {view === "categories" && browseCategory === null ? (!categoryOverview && !error ? <div className="loading-state"><LoaderCircle className="spin" size={28} /><span>Loading categories…</span></div> : categoryOverview && categoryOverview.categories.length === 0 && categoryOverview.uncategorized_count === 0 ? <div className="gallery-empty"><Folder size={34} /><h2>No categorized media</h2><p>Assign categories to media, then return here.</p></div> : null) : loading ? (
        <div className="loading-state"><LoaderCircle className="spin" size={28} /><span>Loading media…</span></div>
      ) : result && result.items.length > 0 ? (
        <>
          {paginationControls}
          <div className="media-grid">{renderCards(result.items)}</div>
          {paginationControls}
        </>
      ) : (
        <div className="gallery-empty">
          {search ? <Search size={34} /> : <FolderPlus size={34} />}
          <h2>{search || hasFilters ? "No matching media" : `No ${type ? title.toLowerCase() : "media"} indexed yet`}</h2>
          <p>{search || hasFilters ? "Try adjusting the filename, category, tag, or other filters." : "Add a source folder, or scan an existing source again."}</p>
          {!search && !hasFilters && <button className="primary-button" type="button" onClick={onAddSource}>Add source</button>}
        </div>
      )}
      {bulkOpen && <BulkActionDialog itemIds={selectedItemIds} tags={tags} categories={categories} people={people} series={seriesOptions} onTagCreated={onTagCreated} onCategoryCreated={onCategoryCreated} onPersonCreated={onPersonCreated} onSeriesCreated={createSeries} onClose={() => setBulkOpen(false)} onDone={() => { setBulkOpen(false); setSelectedItemIds([]); onChanged(); }} />}
    </section>
  );
}
