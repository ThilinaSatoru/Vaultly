import { ClearableInput } from "./ClearableField";
import { Select } from "./Select";
import { mediaCardOrientation, useArtworkOrientation } from "./artwork";
import { vaultUrl } from "./vault-session";
import { ArrowLeft, BookOpen, Check, Clapperboard, Folder, FolderPlus, Grid2X2, Heart, Image, Layers3, List, ListPlus, LoaderCircle, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useContext, type Dispatch, type SetStateAction } from "react";
import { NavigationContext, useNavigationField } from "./navigation";
import { TagCombobox } from "./TagCombobox";
import { AttributeBadge, AttributeMediaContext } from "./AttributeBadge";
import { BulkActionDialog } from "./BulkActionDialog";
import { DeleteMediaDialog } from "./DeleteMediaDialog";
import { api, formatCount, formatDuration, formatSize, formatVideoQuality, type Category, type CircleSummary, type ItemPage, type MediaItem, type MediaType, type Person, type SeriesSummary, type Tag } from "./media";
import { useLastPlayed } from "./last-played";
import type { LibraryView } from "./App";
import { galleryVideoContext, type GalleryVideoContext } from "./video-playlist";
import { ActionMenu } from "./ActionMenu";
import { PersonProfileHeader } from "./PersonProfile";

interface GalleryViewProps {
  view: LibraryView;
  type?: MediaType;
  search: string;
  onSearchChange?: (search: string) => void;
  categories: Category[];
  tags: Tag[];
  people: Person[];
  onTagCreated: (name: string) => Promise<Tag>;
  onCategoryCreated: (name: string) => Promise<Category>;
  onPersonCreated: (name: string) => Promise<Person>;
  onChanged: () => void;
  onDeleted?: (ids: number[]) => void;
  sources: Array<{ id: number; name: string }>;
  onOpen: (id: number, context: GalleryVideoContext | null) => void;
  onQueueVideo: (item: MediaItem) => void;
  queuedVideoIds: number[];
  onOpenSeries: (id: number) => void;
  onAddSource: () => void;
  refreshKey: number;
}

const galleryNames: Record<MediaType, string> = {
  comic: "Comics & pictures",
  video: "Videos",
  story: "E-books",
};

const previewClipSeconds = 3;
const maximumPreviewClips = 6;

function distributedPreviewPoints(duration: number): number[] {
  const maximumStart = Math.max(0, duration - previewClipSeconds);
  if (maximumStart === 0) return [0];
  const count = Math.min(maximumPreviewClips, Math.max(2, Math.floor(duration / previewClipSeconds)));
  const bandWidth = maximumStart / count;
  const points = Array.from({ length: count }, (_, index) => (
    Math.min(maximumStart, index * bandWidth + Math.random() * bandWidth)
  ));
  for (let index = points.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [points[index], points[swapIndex]] = [points[swapIndex], points[index]];
  }
  return points;
}

function VideoHoverPreview({ itemId, knownDuration }: { itemId: number; knownDuration: number | null }) {
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pointsRef = useRef<number[]>([]);
  const pointIndexRef = useRef(0);
  const segmentEndRef = useRef(0);
  const changingSegmentRef = useRef(false);

  const playPoint = (index: number) => {
    const video = videoRef.current;
    const points = pointsRef.current;
    if (!video || points.length === 0) return;
    pointIndexRef.current = index % points.length;
    const start = points[pointIndexRef.current];
    segmentEndRef.current = Math.min(video.duration, start + previewClipSeconds);
    changingSegmentRef.current = true;
    video.pause();
    if (Math.abs(video.currentTime - start) < 0.05) {
      changingSegmentRef.current = false;
      void video.play().catch(() => undefined);
    } else {
      video.currentTime = start;
    }
  };

  const advance = () => {
    if (changingSegmentRef.current) return;
    playPoint(pointIndexRef.current + 1);
  };

  if (failed) return <img src={vaultUrl(`/api/items/${itemId}/thumbnail`)} alt="" />;
  return <video
    ref={videoRef}
    src={vaultUrl(`/api/items/${itemId}/file`)}
    muted
    playsInline
    preload="metadata"
    onLoadedMetadata={(event) => {
      const mediaDuration = knownDuration && knownDuration > 0 ? knownDuration : event.currentTarget.duration;
      if (!Number.isFinite(mediaDuration) || mediaDuration <= 0) return;
      pointsRef.current = distributedPreviewPoints(mediaDuration);
      playPoint(0);
    }}
    onSeeked={(event) => {
      changingSegmentRef.current = false;
      void event.currentTarget.play().catch(() => undefined);
    }}
    onTimeUpdate={(event) => {
      if (event.currentTarget.currentTime >= segmentEndRef.current - 0.04) advance();
    }}
    onEnded={advance}
    onError={() => setFailed(true)}
  />;
}

function MediaCard({ item, selected, queued, onSelect, onOpen, onFavorite, onQueue, onDelete }: { item: MediaItem; selected: boolean; queued: boolean; onSelect: () => void; onOpen: () => void; onFavorite: () => void; onQueue: () => void; onDelete: () => void }) {
  const cardRef = useRef<HTMLElement>(null);
  const [hovered, setHovered] = useState(false);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const [thumbnailAttempt, setThumbnailAttempt] = useState(0);
  const thumbnail = `/api/items/${item.id}/thumbnail?modified=${item.modified_at_ms}&cover=${encodeURIComponent(item.cover_signature ?? "")}&attempt=${thumbnailAttempt}`;
  const { orientation, onLoad: artworkLoaded } = useArtworkOrientation(thumbnail, mediaCardOrientation(item));
  const [duration, setDuration] = useState(item.duration_seconds);
  const hoverTimer = useRef<number | null>(null);
  const retryTimer = useRef<number | null>(null);

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

  useEffect(() => { setThumbnailFailed(false); setThumbnailAttempt(0); }, [item.id, item.cover_signature, item.video_width, item.video_height]);

  const handleThumbnailError = () => {
    if (item.file_extension !== "pdf" || thumbnailAttempt >= 8) {
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
    <article ref={cardRef} tabIndex={0} onClick={(event) => { if ((event.target as HTMLElement).closest("button, a, input, select, textarea, label, [role=button], [role=menu], [role=menuitem], .tag-combobox")) return; onOpen(); }} onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }} className={`media-card media-card-clickable media-card-selectable media-card-${orientation}${item.media_type === "video" ? " media-card-video" : ""}${selected ? " is-selected" : ""}`}>
      <div className="media-card-menu"><ActionMenu label={`Actions for ${item.title}`} contextTarget={cardRef} actions={[{ label: "Open media", icon: <BookOpen size={16} />, onSelect: onOpen }, { label: item.favorite ? "Remove from favorites" : "Add to favorites", icon: <Heart size={16} />, onSelect: onFavorite }, { label: selected ? "Deselect item" : "Select item", icon: <Check size={16} />, onSelect }, ...(item.media_type === "video" ? [{ label: queued ? "Already in playlist" : "Add to playlist", icon: <ListPlus size={16} />, onSelect: onQueue, disabled: queued }] : []), { label: "Delete permanently…", icon: <Trash2 size={16} />, onSelect: onDelete, danger: true }]} /></div>
      <label className="media-card-select" title={`Select ${item.title}`}><input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Select ${item.title}`} /></label>
      <button className={`media-card-favorite${item.favorite ? " is-favorite" : ""}`} type="button" onClick={onFavorite} aria-label={item.favorite ? `Remove ${item.title} from favorites` : `Add ${item.title} to favorites`}><Heart size={17} fill={item.favorite ? "currentColor" : "none"} /></button>
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
      <div className={`media-art media-art-${item.media_type} media-art-${orientation}`}>
        {item.media_type === "comic" && !thumbnailFailed ? (
          <img src={vaultUrl(thumbnail)} alt="" loading="lazy" onLoad={artworkLoaded} onError={handleThumbnailError} />
        ) : item.media_type === "video" && hovered ? (
          <VideoHoverPreview itemId={item.id} knownDuration={duration} />
        ) : (item.media_type === "video" || item.media_type === "story") && !thumbnailFailed ? (
          <img
            src={vaultUrl(thumbnail)}
            alt=""
            loading="lazy"
            onError={handleThumbnailError}
            onLoad={artworkLoaded}
          />
        ) : (
          item.media_type === "video" ? <Clapperboard size={42} /> : item.media_type === "story" ? <BookOpen size={42} /> : <Image size={42} />
        )}
        <span className="media-type-badge">{item.media_type === "video" ? formatDuration(duration) : item.media_type === "story" ? "E-book" : item.media_type}</span>
      </div>
      </button>
      <div className="media-card-body">
        <h3 title={item.title}><button className="card-title-open" type="button" onClick={onOpen}>{item.title}</button></h3>
        <p className="media-card-source-path" title={item.source_path ?? item.source_name}>{item.source_path ?? item.source_name}</p>
        <div className="media-card-tags">
          {item.tags.map((tag) => <AttributeBadge key={`tag-${tag.id}`} kind="tag" {...tag} mediaType={item.media_type} />)}
          {item.categories.map((category) => <AttributeBadge key={`category-${category.id}`} kind="category" {...category} mediaType={item.media_type} />)}
          {item.cast.map((person) => <AttributeBadge key={`cast-${person.id}`} kind="cast" {...person} mediaType={item.media_type}>Cast: {person.name}</AttributeBadge>)}
          {item.artists.map((person) => <AttributeBadge key={`artist-${person.id}`} kind="artist" {...person} mediaType={item.media_type}>Artist: {person.name}</AttributeBadge>)}
        </div>
        <div className="media-card-meta"><span className="media-card-file-info">{formatSize(item.size_bytes)}{item.media_type === "video" && formatVideoQuality(item.video_width, item.video_height) && <span className="media-quality-badge" title={`Video resolution: ${item.video_width} × ${item.video_height}`}>{formatVideoQuality(item.video_width, item.video_height)}</span>}</span><div className="media-card-footer-actions"><span>{item.media_type === "comic" ? `${item.file_count} ${item.file_count === 1 ? "file" : "pages"}` : item.categories.length ? "" : "Uncategorized"}</span>{item.media_type === "video" && <button className={`media-card-queue${queued ? " is-queued" : ""}`} type="button" onClick={onQueue} aria-label={queued ? `${item.title} is in temporary playlist` : `Add ${item.title} to temporary playlist`} title={queued ? "In temporary playlist" : "Add to temporary playlist"}>{queued ? <Check size={17} /> : <ListPlus size={17} />}</button>}</div></div>
      </div>
    </article>
  );
}

function CollectionCard({ series, onOpen, mediaType }: { series: SeriesSummary; onOpen: () => void; mediaType?: MediaType }) {
  const lastPlayed = useLastPlayed(series.id);
  const attributes = series.card_attributes ?? series;
  const contentTypes = (["video", "comic", "story"] as const).filter((type) => series[`${type}_count`] > 0);
  const badgeType = mediaType ?? (contentTypes.length === 1 ? contentTypes[0] : contentTypes.length === 0 && series.preferred_type !== "mixed" ? series.preferred_type : undefined);
  const fallback = series.cover_item_id === null ? null : `/api/items/${series.cover_item_id}/thumbnail`;
  const cover = series.has_cover ? `/api/series/${series.id}/cover` : fallback;
  const { orientation, onLoad } = useArtworkOrientation(cover, badgeType === "video" ? "landscape" : "portrait");
  return <article className={`media-card collection-media-card media-card-${orientation}${badgeType === "video" ? " media-card-video" : ""}`}>
    <button className="media-card-open" type="button" onClick={onOpen} aria-label={`Open collection ${series.title}`}>
      <div className={`media-art collection-art media-art-${orientation}${badgeType === "video" ? " collection-art-video" : ""}`}><Layers3 size={44} />{cover && <img src={vaultUrl(cover)} alt="" loading="lazy" onLoad={onLoad} />}<span className="media-type-badge">Collection</span></div>
    </button>
    <div className="media-card-body"><h3 title={series.title}><button className="card-title-open" type="button" onClick={onOpen}>{series.title}</button></h3><p>{series.item_count} {series.item_count === 1 ? "item" : "items"}</p><div className="media-card-tags">{attributes.tags.map((tag) => <AttributeBadge kind="tag" key={`tag-${tag.id}`} {...tag} mediaType={badgeType} />)}{attributes.categories.map((category) => <AttributeBadge kind="category" key={`category-${category.id}`} {...category} mediaType={badgeType} />)}{(attributes.people ?? []).map((person) => <AttributeBadge kind={badgeType === "video" ? "cast" : "artist"} key={`person-${person.id}`} {...person} mediaType={badgeType} />)}</div><div className="media-card-meta"><span>{series.video_count} videos</span><span>{series.comic_count + series.story_count} reading</span></div></div>
    {lastPlayed && <button className="collection-last-played" type="button" onClick={onOpen} title={lastPlayed.title}>Last played: {lastPlayed.title}</button>}
  </article>;
}

export function GalleryView({ view, type, search, onSearchChange, categories, tags, people, onTagCreated, onCategoryCreated, onPersonCreated, onChanged, onDeleted, sources, onOpen, onQueueVideo, queuedVideoIds, onOpenSeries, onAddSource, refreshKey }: GalleryViewProps) {
  const navigation = useContext(NavigationContext)!;
  function useGalleryField<T>(key: string, fallback: T, destination?: string): [T, Dispatch<SetStateAction<T>>] {
    return useNavigationField("gallery." + (type ?? "all") + "." + view + "." + key, fallback, destination);
  }
  const [selectedCategoryIds, setSelectedCategoryIds] = useGalleryField<number[]>("selectedCategoryIds", []);
  const [selectedTagIds, setSelectedTagIds] = useGalleryField<number[]>("selectedTagIds", []);
  const [selectedCastIds, setSelectedCastIds] = useGalleryField<number[]>("selectedCastIds", []);
  const [selectedArtistIds, setSelectedArtistIds] = useGalleryField<number[]>("selectedArtistIds", []);
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [deletingItem, setDeletingItem] = useState<MediaItem | null>(null);
  const [filename, setFilename] = useGalleryField("filename", "");
  const [pathText, setPathText] = useGalleryField("pathText", "");
  const [debouncedFilename, setDebouncedFilename] = useState(filename);
  const [debouncedPath, setDebouncedPath] = useState(pathText);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [selectedType, setSelectedType] = useGalleryField<MediaType | "">("selectedType", "");
  const [sourceType, setSourceType] = useGalleryField("sourceType", "");
  const [sourceId, setSourceId] = useGalleryField("sourceId", "");
  const [folderPath, setFolderPath] = useGalleryField("folderPath", "");
  const [extension, setExtension] = useGalleryField("extension", "");
  const [seriesFilter, setSeriesFilter] = useGalleryField("seriesFilter", "");
  const [circleFilter, setCircleFilter] = useGalleryField("circleFilter", "");
  const [minMb, setMinMb] = useGalleryField("minMb", "");
  const [maxMb, setMaxMb] = useGalleryField("maxMb", "");
  const [modifiedFrom, setModifiedFrom] = useGalleryField("modifiedFrom", "");
  const [modifiedTo, setModifiedTo] = useGalleryField("modifiedTo", "");
  const [uncategorized, setUncategorized] = useGalleryField("uncategorized", false);
  const [untagged, setUntagged] = useGalleryField("untagged", false);
  const [advancedOpen, setAdvancedOpen] = useGalleryField("advancedOpen", false);
  const [formats, setFormats] = useState<Array<{ extension: string; item_count: number }>>([]);
  const [seriesOptions, setSeriesOptions] = useState<SeriesSummary[]>([]);
  const [seriesOptionsLoading, setSeriesOptionsLoading] = useState(true);
  const [circleOptions, setCircleOptions] = useState<CircleSummary[]>([]);
  const effectiveType = type || selectedType || undefined;
  const [creditedAttributes, setCreditedAttributes] = useState<{ type?: MediaType; categories: Category[]; tags: Tag[]; people: Person[] } | null>(null);
  const filterAttributes = creditedAttributes?.type === effectiveType ? creditedAttributes : null;
  const hasMedia = (entry: SeriesSummary | CircleSummary) => (effectiveType ? entry[`${effectiveType}_count`] : entry.item_count) > 0;
  const [sort, setSort] = useGalleryField<"auto" | "folders" | "relevance" | "title" | "filename" | "recent" | "oldest" | "size" | "smallest">("sort", "auto");
  const [layout, setLayout] = useGalleryField<"grid" | "list">("layout", "grid");
  const [searchMode, setSearchMode] = useGalleryField<"literal" | "fuzzy" | "english">("searchMode", "english");
  const [page, setPage] = useGalleryField("page", 0);
  const previousPage = useRef(page);
  const galleryQuery = useRef("");
  const [result, setResult] = useState<ItemPage | null>(null);
  const [categoryOverview, setCategoryOverview] = useState<{ categories: Category[]; uncategorized_count: number } | null>(null);
  const [browseCategory, setBrowseCategory] = useGalleryField<number | "uncategorized" | null>("browseCategory", null, "Category");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (previousPage.current !== page) {
      previousPage.current = page;
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [page]);

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebouncedFilename(filename); setDebouncedPath(pathText); setDebouncedSearch(search); }, 180);
    return () => window.clearTimeout(timer);
  }, [filename, pathText, search, searchMode]);

  useEffect(() => {
    let active = true;
    setSeriesOptionsLoading(true);
    const effectiveType = type || selectedType;
    void Promise.all([
      api<Array<{ extension: string; item_count: number }>>(`/api/items/formats${effectiveType ? `?type=${effectiveType}` : ""}`),
      api<SeriesSummary[]>("/api/series"),
      api<CircleSummary[]>("/api/circles"),
    ]).then(([nextFormats, nextSeries, nextCircles]) => {
      if (!active) return;
      setFormats(nextFormats);
      setSeriesOptions(nextSeries);
      setCircleOptions(nextCircles);
    }).catch((requestError) => { if (active) setError(requestError instanceof Error ? requestError.message : "Could not load filter choices."); })
      .finally(() => { if (active) setSeriesOptionsLoading(false); });
    return () => { active = false; };
  }, [type, selectedType, refreshKey]);

  useEffect(() => {
    let active = true;
    setCreditedAttributes(null);
    api<{ categories: Category[]; tags: Tag[]; people: Person[] }>(`/api/attributes/filter-options${effectiveType ? `?type=${effectiveType}` : ""}`)
      .then((result) => { if (active) setCreditedAttributes({ type: effectiveType, categories: result.categories ?? [], tags: result.tags ?? [], people: result.people ?? [] }); })
      .catch((requestError) => { if (active) setError(requestError instanceof Error ? requestError.message : "Could not load filter attributes."); });
    return () => { active = false; };
  }, [effectiveType, refreshKey]);

  useEffect(() => {
    if (view !== "categories") return;
    let active = true;
    setCategoryOverview(null);
    api<{ categories: Category[]; uncategorized_count: number }>(`/api/categories/overview${type ? `?type=${type}` : ""}`)
      .then((data) => { if (active) { setCategoryOverview(data); setError(""); } })
      .catch((requestError) => { if (active) setError(requestError instanceof Error ? requestError.message : "Could not load categories."); });
    return () => { active = false; };
  }, [view, type, refreshKey]);


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

  const filterKey = JSON.stringify([type, view, browseCategory, debouncedSearch, debouncedFilename, debouncedPath, selectedType, sourceType, sourceId, folderPath, extension, seriesFilter, circleFilter, minMb, maxMb, modifiedFrom, modifiedTo, uncategorized, untagged, selectedCategoryIds, selectedTagIds, selectedCastIds, selectedArtistIds, sort]);
  const previousFilterKey = useRef(filterKey);
  useEffect(() => {
    if (previousFilterKey.current !== filterKey) {
      previousFilterKey.current = filterKey;
      setPage(0);
    }
  }, [filterKey, searchMode]);

  useEffect(() => {
    const controller = new AbortController();
    if (view === "categories" && browseCategory === null) {
      setResult(null);
      setLoading(false);
      return () => controller.abort();
    }
    const params = new URLSearchParams({ page: String(page), searchMode, groupSeries: "1" });
    if (sort !== "auto") params.set("sort", sort);
    if (sort === "folders") params.set("folder", folderPath);
    if (type || selectedType) params.set("type", type || selectedType);
    if (sourceType) params.set("sourceType", sourceType);
    if (view === "favorites") params.set("favorite", "1");
    if (view === "categories" && browseCategory === "uncategorized") params.set("uncategorized", "1");
    if (view === "categories" && typeof browseCategory === "number") params.set("category", String(browseCategory));
    if (view === "browse" && debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
    if (sourceId) params.set("source", sourceId);
    if (view !== "browse") {
      params.delete("page");
      galleryQuery.current = params.toString();
      params.set("page", String(page));
      setLoading(true);
      api<ItemPage>(`/api/items?${params.toString()}`, { signal: controller.signal })
        .then((data) => { if (!controller.signal.aborted) { setResult(data); setError(""); } })
        .catch((requestError) => { if (!controller.signal.aborted) { setResult(null); setError(requestError instanceof Error ? requestError.message : "Could not load media."); } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
      return () => controller.abort();
    }
    if (debouncedFilename.trim()) params.set("filename", debouncedFilename.trim());
    if (debouncedPath.trim()) params.set("path", debouncedPath.trim());
    if (sourceId) params.set("source", sourceId);
    if (extension) params.set("extension", extension);
    if (seriesFilter) params.set("series", seriesFilter);
    if (circleFilter) params.set("circle", circleFilter);
    if (minMb) params.set("minMb", minMb);
    if (maxMb) params.set("maxMb", maxMb);
    if (modifiedFrom) params.set("modifiedFrom", modifiedFrom);
    if (modifiedTo) params.set("modifiedTo", modifiedTo);
    if (uncategorized) params.set("uncategorized", "1");
    if (untagged) params.set("untagged", "1");
    if (selectedCategoryIds.length) params.set("categories", selectedCategoryIds.join(","));
    if (selectedTagIds.length) params.set("tags", selectedTagIds.join(","));
    const personIds = [...new Set([...selectedCastIds, ...selectedArtistIds])];
    if (personIds.length) params.set("people", personIds.join(","));
    params.delete("page");
    galleryQuery.current = params.toString();
    params.set("page", String(page));
    setLoading(true);
    api<ItemPage>(`/api/items?${params.toString()}`, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) { setResult(data); setError(""); } })
      .catch((requestError) => {
        if (controller.signal.aborted) return;
        setResult(null);
        setError(requestError instanceof Error ? requestError.message : "Could not load media.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [view, browseCategory, type, debouncedSearch, debouncedFilename, debouncedPath, selectedType, sourceType, sourceId, folderPath, extension, seriesFilter, circleFilter, minMb, maxMb, modifiedFrom, modifiedTo, uncategorized, untagged, selectedCategoryIds, selectedTagIds, selectedCastIds, selectedArtistIds, sort, searchMode, page, refreshKey]);

  const libraryTitle = type ? galleryNames[type] : "All media";
  const selectedCategoryName = browseCategory === "uncategorized" ? "Uncategorized" : categoryOverview?.categories.find((category) => category.id === browseCategory)?.name;
  const title = view === "categories" ? selectedCategoryName ? `${libraryTitle} · ${selectedCategoryName}` : `${libraryTitle} categories` : view === "favorites" ? `${libraryTitle} favorites` : libraryTitle;
  const folderItems = sort === "folders" ? result?.folders?.reduce((total, folder) => total + folder.item_count, 0) ?? 0 : 0;
  const resultCount = result?.cards ? `${formatCount(result.total)} cards · ${formatCount((result.mediaTotal ?? result.total) + folderItems)} items` : `${formatCount((result?.total ?? 0) + folderItems)} items`;
  const awaitingCollections = seriesOptionsLoading && Boolean(result?.cards?.some((card) => card.kind === "series" && !seriesOptions.some((series) => series.id === card.id)));
  const hasFilters = Boolean(searchMode !== "english" || filename || pathText || selectedType || sourceType || sourceId || folderPath || extension || seriesFilter || circleFilter || minMb || maxMb || modifiedFrom || modifiedTo || uncategorized || untagged || selectedCategoryIds.length || selectedTagIds.length || selectedCastIds.length || selectedArtistIds.length);
  const extraFilterCount = [searchMode !== "english", filename, pathText, selectedType, sourceType, sourceId, folderPath, extension, seriesFilter, circleFilter, minMb, maxMb, modifiedFrom, modifiedTo, uncategorized, untagged, selectedCastIds.length, selectedArtistIds.length].filter(Boolean).length;
  const clearFilters = () => {
    setSearchMode("english");
    setFilename(""); setPathText(""); setDebouncedFilename(""); setDebouncedPath("");
    setSelectedType(""); setSourceType(""); setFolderPath(""); setSourceId(""); setExtension(""); setSeriesFilter(""); setCircleFilter("");
    setMinMb(""); setMaxMb(""); setModifiedFrom(""); setModifiedTo("");
    setUncategorized(false); setUntagged(false); setSelectedCategoryIds([]); setSelectedTagIds([]); setSelectedCastIds([]); setSelectedArtistIds([]); setSort("auto");
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
        cards: view === "favorites" && !favorite ? current.cards?.filter((card) => card.kind !== "item" || card.id !== item.id) : current.cards,
        mediaTotal: view === "favorites" && !favorite && current.mediaTotal !== undefined ? Math.max(0, current.mediaTotal - 1) : current.mediaTotal,
        total: view === "favorites" && !favorite ? Math.max(0, current.total - 1) : current.total,
      } : current);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not update favorite."); }
  };
  const mediaDeleted = (ids: number[]) => {
    setSelectedItemIds((current) => current.filter((id) => !ids.includes(id)));
    onDeleted?.(ids);
    onChanged();
  };
  useEffect(() => {
    if (!loading && result) {
      const lastPage = Math.max(0, Math.ceil(result.total / result.pageSize) - 1);
      if (page > lastPage) setPage(lastPage);
    }
  }, [loading, result, page]);
  const renderCards = () => (result?.cards ?? result?.items.map((item) => ({ kind: "item" as const, id: item.id })) ?? []).map((card) => {
    if (card.kind === "series") {
      const series = seriesOptions.find((entry) => entry.id === card.id);
      return series ? <CollectionCard key={`series-${series.id}`} series={series} mediaType={type || selectedType || undefined} onOpen={() => onOpenSeries(series.id)} /> : null;
    }
    const item = result?.items.find((entry) => entry.id === card.id);
    return item ? <MediaCard key={`item-${item.id}`} item={item} selected={selectedItemIds.includes(item.id)} queued={queuedVideoIds.includes(item.id)} onSelect={() => toggleItem(item.id)} onOpen={() => onOpen(item.id, galleryVideoContext(result, item.id, galleryQuery.current))} onFavorite={() => void toggleFavorite(item)} onQueue={() => onQueueVideo(item)} onDelete={() => setDeletingItem(item)} /> : null;
  });
  const paginationControls = result && (page > 0 || result.total > result.pageSize) ? <div className="pagination">
    <button className="secondary-button" type="button" onClick={() => { setPage(0); window.scrollTo({ top: 0, behavior: "smooth" }); }}>First page</button>
    <button className="secondary-button" type="button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0}>Previous</button>
    <span>Page {page + 1} of {Math.max(1, Math.ceil(result.total / result.pageSize))}</span>
    <button className="secondary-button" type="button" onClick={() => setPage((value) => value + 1)} disabled={(page + 1) * result.pageSize >= result.total}>Next</button>
  </div> : null;

  const profile = view === "browse" ? people.find((person) => person.id === navigation.entry.fields.personProfileId && [...selectedCastIds, ...selectedArtistIds].includes(person.id)) : undefined;
  return (
    <AttributeMediaContext.Provider value={type || selectedType || undefined}><section className={`gallery-view${profile ? " gallery-view--person-profile" : ""}`}>
      {profile && <aside className="gallery-person-profile"><PersonProfileHeader person={profile} /></aside>}
      <div className="gallery-profile-content">
      <div className="page-heading gallery-heading">
        <div>{view === "categories" && browseCategory !== null && <button className="category-back" type="button" onClick={() => { if (navigation.entry.breadcrumbs.length) navigation.back(); else { setBrowseCategory(null); setSelectedItemIds([]); } }}><ArrowLeft size={16} /> All categories</button>}<p className="eyebrow">Your library</p><h1>{title}</h1><p>{view === "categories" && browseCategory === null ? "Choose a category to open its media library." : search ? `Results for “${search}”` : "Browse files indexed from your local folders."}</p></div>
        <span className="result-count">{view === "categories" && browseCategory === null ? categoryOverview ? `${formatCount(categoryOverview.categories.length + (categoryOverview.uncategorized_count ? 1 : 0))} categories` : "Loading…" : loading && !result ? "Loading…" : resultCount}</span>
      </div>

      {view === "categories" && browseCategory === null && categoryOverview && <div className="category-selection-grid">
        {categoryOverview.categories.map((category) => <button className="category-selection-card" type="button" key={category.id} onClick={() => setBrowseCategory(category.id)}><span className="category-selection-icon"><Folder size={23} /></span><strong><span className="tag-badge">{category.name}</span></strong><small>{formatCount(category.item_count)} items</small></button>)}
        {categoryOverview.uncategorized_count > 0 && <button className="category-selection-card" type="button" onClick={() => setBrowseCategory("uncategorized")}><span className="category-selection-icon"><FolderPlus size={23} /></span><strong>Uncategorized</strong><small>{formatCount(categoryOverview.uncategorized_count)} items</small></button>}
      </div>}

      {!(view === "categories" && browseCategory === null) && <div className="gallery-toolbar gallery-primary-tools">
        <label className="gallery-filter-field gallery-text-filter"><span>Text filter</span><ClearableInput aria-label="Filter media text" value={search} onChange={(event) => onSearchChange ? onSearchChange(event.target.value) : navigation.update({ search: event.target.value })} placeholder="Filter titles, filenames, tags and artists…" /></label>
        <label className="select-wrap">
          <span>Sort</span>
          <Select aria-label="Sort media" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="auto">Automatic</option>
            <option value="folders">Folders</option>
            <option value="relevance">Best match</option>
            <option value="title">Title A–Z</option>
            <option value="filename">Filename A–Z</option>
            <option value="recent">Recently modified</option>
            <option value="oldest">Oldest modified</option>
            <option value="size">Largest first</option>
            <option value="smallest">Smallest first</option>
          </Select>
        </label>
        <div className="gallery-layout-toggle" role="group" aria-label="Gallery layout">
          <button type="button" className={layout === "grid" ? "is-active" : ""} aria-label="Grid view" aria-pressed={layout === "grid"} onClick={() => setLayout("grid")}><Grid2X2 size={16} /></button>
          <button type="button" className={layout === "list" ? "is-active" : ""} aria-label="List view" aria-pressed={layout === "list"} onClick={() => setLayout("list")}><List size={17} /></button>
        </div>
        <button className={`gallery-more-button${advancedOpen ? " is-open" : ""}`} type="button" aria-expanded={advancedOpen} aria-controls="media-advanced-filters" onClick={() => setAdvancedOpen((value) => !value)}><SlidersHorizontal size={16} /> Advanced filters{extraFilterCount + selectedCategoryIds.length + selectedTagIds.length > 0 ? ` (${extraFilterCount + selectedCategoryIds.length + selectedTagIds.length})` : ""}</button>
        {hasFilters && <button className="gallery-clear-button" type="button" onClick={clearFilters}><X size={15} /> Clear filters</button>}
      </div>}

      {!(view === "categories" && browseCategory === null) && advancedOpen && <div className="gallery-advanced" id="media-advanced-filters" aria-label="Advanced filters">
        <TagCombobox attributeKind="category" label="Categories (match all)" tags={categories} options={filterAttributes?.categories ?? []} selectedIds={selectedCategoryIds} onChange={setSelectedCategoryIds} disabled={uncategorized || !filterAttributes} placeholder="All categories" />
        <TagCombobox attributeKind="tag" label="Tags (match all)" tags={tags} options={filterAttributes?.tags ?? []} selectedIds={selectedTagIds} onChange={setSelectedTagIds} disabled={untagged || !filterAttributes} placeholder="All tags" />
        <label className="gallery-filter-field"><span>Search mode</span><Select aria-label="Search mode" value={searchMode} onChange={(event) => { setSearchMode(event.target.value as typeof searchMode); setDebouncedSearch(search); setPage(0); }}><option value="english">English forms & synonyms</option><option value="literal">Literal / phrases</option><option value="fuzzy">Typo tolerant</option></Select></label>
        <label className="gallery-filter-field"><span>File name</span><ClearableInput value={filename} onChange={(event) => setFilename(event.target.value)} placeholder="Search filenames" aria-label="File name contains" /></label>
        {!type && <label className="gallery-filter-field"><span>Media type</span><Select value={selectedType} onChange={(event) => { setSelectedType(event.target.value as MediaType | ""); setExtension(""); }}><option value="">All types</option><option value="comic">Comics</option><option value="video">Videos</option><option value="story">PDF stories</option></Select></label>}
        <label className="gallery-filter-field"><span>Collection type</span><Select value={sourceType} onChange={(event) => { setSourceType(event.target.value); setSourceId(""); setFolderPath(""); }}><option value="">All collection types</option><option value="movies">Movies</option><option value="tv">TV series</option><option value="anime">Anime</option><option value="manga">Manga</option><option value="ebooks">E-books</option><option value="pictures">Pictures</option></Select></label>
        <label className="gallery-filter-field"><span>Source folder</span><Select value={sourceId} onChange={(event) => { setSourceId(event.target.value); setFolderPath(""); }}><option value="">All sources</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</Select></label>
        <label className="gallery-filter-field"><span>File format</span><Select value={extension} onChange={(event) => setExtension(event.target.value)}><option value="">All formats</option>{formats.map((format) => <option key={format.extension || "folder"} value={format.extension || "folder"}>{format.extension ? `.${format.extension.toUpperCase()}` : "Image folder"} ({format.item_count})</option>)}</Select></label>
        <label className="gallery-filter-field"><span>Series / set</span><Select value={seriesFilter} onChange={(event) => setSeriesFilter(event.target.value)}><option value="">All items</option><option value="grouped">In any set</option><option value="ungrouped">Not in a set</option>{seriesOptions.filter(hasMedia).map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</Select></label>
        <label className="gallery-filter-field"><span>Circle</span><Select value={circleFilter} onChange={(event) => setCircleFilter(event.target.value)}><option value="">All circles</option>{circleOptions.filter(hasMedia).map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</Select></label>
        <label className="gallery-filter-field"><span>Path contains</span><ClearableInput value={pathText} onChange={(event) => setPathText(event.target.value)} placeholder="Folder or relative path" /></label>
        <label className="gallery-filter-field"><span>Minimum size (MB)</span><ClearableInput type="number" min="0" step="0.1" value={minMb} onChange={(event) => setMinMb(event.target.value)} placeholder="No minimum" /></label>
        <label className="gallery-filter-field"><span>Maximum size (MB)</span><ClearableInput type="number" min="0" step="0.1" value={maxMb} onChange={(event) => setMaxMb(event.target.value)} placeholder="No maximum" /></label>
        <label className="gallery-filter-field"><span>Modified from</span><ClearableInput type="date" value={modifiedFrom} max={modifiedTo || undefined} onChange={(event) => setModifiedFrom(event.target.value)} /></label>
        <label className="gallery-filter-field"><span>Modified through</span><ClearableInput type="date" value={modifiedTo} min={modifiedFrom || undefined} onChange={(event) => setModifiedTo(event.target.value)} /></label>
        <TagCombobox attributeKind={effectiveType === "video" ? "cast" : "artist"} label={`${effectiveType === "video" ? "Cast" : effectiveType ? "Artists" : "Cast & artists"} (match all)`} tags={people} options={filterAttributes?.people ?? []} disabled={!filterAttributes} selectedIds={[...new Set([...selectedCastIds, ...selectedArtistIds])]} onChange={(ids) => { if (effectiveType && effectiveType !== "video") { setSelectedArtistIds(ids); setSelectedCastIds([]); } else { setSelectedCastIds(ids); setSelectedArtistIds([]); } }} placeholder={effectiveType === "video" ? "Any cast" : effectiveType ? "Any artist" : "Any person"} />
        <label className="gallery-filter-check"><input type="checkbox" checked={uncategorized} onChange={(event) => { setUncategorized(event.target.checked); if (event.target.checked) setSelectedCategoryIds([]); }} /> Uncategorized only</label>
        <label className="gallery-filter-check"><input type="checkbox" checked={untagged} onChange={(event) => { setUntagged(event.target.checked); if (event.target.checked) setSelectedTagIds([]); }} /> Untagged only</label>
      </div>}
      {!(view === "categories" && browseCategory === null) && <div className="gallery-selection-bar">
        <button className="secondary-button" type="button" onClick={selectPage} disabled={!result?.items.length}>Select page</button>
        {selectedItemIds.length > 0 && <><span>{selectedItemIds.length} selected{selectedItemIds.length >= 500 ? " · limit reached" : ""}</span><button className="primary-button" type="button" onClick={() => setBulkOpen(true)}>Bulk actions</button><button className="gallery-clear-button" type="button" onClick={() => setSelectedItemIds([])}>Clear selection</button></>}
      </div>}

      {sort === "folders" && <div className="folder-navigation"><button type="button" className="secondary-button" onClick={() => { setSourceId(""); setFolderPath(""); }}>All source folders</button>{sourceId && <><button type="button" className="secondary-button" onClick={() => { if (folderPath) setFolderPath(folderPath.split("/").slice(0, -1).join("/")); else setSourceId(""); }}><ArrowLeft size={16} /> Up</button><span>{sources.find((source) => String(source.id) === sourceId)?.name}{folderPath ? ` / ${folderPath}` : ""}</span></>}</div>}
      {sort === "folders" && !loading && Boolean(result?.folders?.length) && <div className="folder-grid">{result?.folders?.map((folder) => <button className="folder-card" type="button" key={`${folder.source_id}:${folder.path}`} onClick={() => { navigation.push({ [`gallery.${type ?? "all"}.${view}.sourceId`]: String(folder.source_id), [`gallery.${type ?? "all"}.${view}.folderPath`]: folder.path, [`gallery.${type ?? "all"}.${view}.page`]: 0 }, folder.name); }}><Folder size={30} /><strong>{folder.name}</strong><span>{formatCount(folder.item_count)} items</span></button>)}</div>}
      {error && <p className="page-error" role="alert">{error}</p>}
      {view === "categories" && browseCategory === null ? (!categoryOverview && !error ? <div className="loading-state"><LoaderCircle className="spin" size={28} /><span>Loading categories…</span></div> : categoryOverview && categoryOverview.categories.length === 0 && categoryOverview.uncategorized_count === 0 ? <div className="gallery-empty"><Folder size={34} /><h2>No categorized media</h2><p>Assign categories to media, then return here.</p></div> : null) : (!result && loading) || awaitingCollections ? (
        <div className="loading-state"><LoaderCircle className="spin" size={28} /><span>Loading media…</span></div>
      ) : result && (result.cards?.length ?? result.items.length) > 0 ? (
        <>
          {paginationControls}
          <div className={`media-grid${layout === "list" ? " media-grid-list" : ""}`}>{renderCards()}</div>
          {paginationControls}
        </>
      ) : sort === "folders" && Boolean(result?.folders?.length) ? null : (
        <div className="gallery-empty">
          {search ? <Search size={34} /> : <FolderPlus size={34} />}
          <h2>{search || hasFilters ? "No matching media" : `No ${type ? title.toLowerCase() : "media"} indexed yet`}</h2>
          <p>{search || hasFilters ? "Try adjusting the filename, category, tag, or other filters." : "Add a source folder, or scan an existing source again."}</p>
          {!search && !hasFilters && <button className="primary-button" type="button" onClick={onAddSource}>Add source</button>}
        </div>
      )}
      {bulkOpen && <BulkActionDialog itemIds={selectedItemIds} mediaType={type} tags={tags} categories={categories} people={people} series={seriesOptions} onTagCreated={onTagCreated} onCategoryCreated={onCategoryCreated} onPersonCreated={onPersonCreated} onSeriesCreated={createSeries} onClose={() => setBulkOpen(false)} onDeleted={mediaDeleted} onDone={() => { setBulkOpen(false); setSelectedItemIds([]); onChanged(); }} />}
      {deletingItem && <DeleteMediaDialog itemIds={[deletingItem.id]} title={deletingItem.title} onDeleted={mediaDeleted} onClose={() => setDeletingItem(null)} />}
      </div>
    </section></AttributeMediaContext.Provider>
  );
}
