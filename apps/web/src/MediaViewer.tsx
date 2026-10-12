import { Select } from "./Select";
import { MediaCoverEditor } from "./VideoCoverEditor";
import { vaultUrl } from "./vault-session";
import { vaultStorage } from "./vault-session";
import { BookOpen, ChevronLeft, ChevronRight, Download, FolderOpen, Heart, ListVideo, LoaderCircle, Maximize2, Minimize2, Minus, Pencil, PictureInPicture2, Plus, SlidersHorizontal, Trash2, X, ZoomIn } from "lucide-react";
import { lazy, Suspense, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AttributeManagerContext } from "./attribute-manager";
import { TagCombobox } from "./TagCombobox";
import { RenameMediaDialog } from "./RenameMediaDialog";
import { AttributeBadge, AttributeMediaContext } from "./AttributeBadge";
import { ReaderAutoScroll } from "./ReaderAutoScroll";
import { VideoPlayer } from "./VideoPlayer";
import { api, formatDuration, formatSize, type Category, type MediaDetail, type Person, type SeriesSummary, type SeriesViewerContext, type SimilarVideo, type Tag } from "./media";
import { matchesShortcut, readBooleanPreference, readNumberPreference } from "./preferences";
import { useContinuousReaderScroll } from "./useContinuousReaderScroll";
import { viewerNavigationItems, type GalleryVideoContext } from "./video-playlist";
import { ReaderAppearance, useReaderAppearance } from "./ReaderAppearance";
import { ActionMenu } from "./ActionMenu";
import { ShortcutHelp } from "./ShortcutHelp";

const EbookReader = lazy(async () => ({ default: (await import("./EbookReader")).EbookReader }));
const PdfReader = lazy(async () => ({ default: (await import("./PdfReader")).PdfReader }));
type ComicFit = "screen" | "width" | "custom";

const storedComicFit = (): ComicFit => {
  const value = vaultStorage.getItem("vaultly.comic.fit");
  return value === "width" || value === "custom" ? value : "screen";
};

const storedComicZoom = () => {
  return readNumberPreference("vaultly.comic.zoom", 100, 25, 400);
};

interface MediaViewerProps {
  itemId: number;
  seriesContext: SeriesViewerContext | null;
  galleryContext: GalleryVideoContext | null;
  playlist: Array<{ id: number; title: string }>;
  floating: boolean;
  onToggleFloating: () => void;
  onRemoveFromPlaylist: (id: number) => void;
  onClearPlaylist: () => void;
  onNavigateItem: (id: number) => void;
  onNavigatePlaylistItem: (id: number) => void;
  categories: Category[];
  tags: Tag[];
  people: Person[];
  onCategoryCreated: (name: string) => Promise<Category>;
  onTagCreated: (name: string) => Promise<Tag>;
  onPersonCreated: (name: string) => Promise<Person>;
  onOpenSeries: (id: number) => void;
  onClose: () => void;
  onChanged: () => void;
  attributeRevision?: number;
}

export function MediaViewer({ itemId, seriesContext, galleryContext, playlist, floating, onToggleFloating, onRemoveFromPlaylist, onClearPlaylist, onNavigateItem, onNavigatePlaylistItem, categories, tags, people, onCategoryCreated, onTagCreated, onPersonCreated, onOpenSeries, onClose, onChanged, attributeRevision = 0 }: MediaViewerProps) {
  const manager = useContext(AttributeManagerContext);
  const previousAttributeRevision = useRef(attributeRevision);
  const viewerRef = useRef<HTMLElement>(null);
  const comicScrollRef = useRef<HTMLDivElement>(null);
  const comicStageRef = useRef<HTMLDivElement>(null);
  const [item, setItem] = useState<MediaDetail | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [appearance, setAppearance] = useReaderAppearance();
  const [comicContinuous, setComicContinuous] = useState(false);
  const [archive, setArchive] = useState(false);
  const [page, setPage] = useState(0);
  const [fit, setFit] = useState<ComicFit>(storedComicFit);
  const [comicZoom, setComicZoom] = useState(storedComicZoom);
  const [comicFullscreen, setComicFullscreen] = useState(false);
  const [floatSize, setFloatSize] = useState(() => ({ width: readNumberPreference("vaultly.video.floatWidth", 520, 320, 1000), height: readNumberPreference("vaultly.video.floatHeight", 342, 160, 900) }));
  const [floatDetails, setFloatDetails] = useState(() => readBooleanPreference("vaultly.video.floatDetails", false));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [seriesOptions, setSeriesOptions] = useState<Array<{ id: number; name: string }>>([]);
  const [seriesIds, setSeriesIds] = useState<number[]>([]);
  const [sidebarTab, setSidebarTab] = useState<"playlist" | "info">(() => vaultStorage.getItem("vaultly.video.sidebarTab") === "info" ? "info" : "playlist");
  const [similarVideos, setSimilarVideos] = useState<SimilarVideo[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const lastFullscreenExit = useRef(-Infinity);
  const playlistIndex = playlist.findIndex((entry) => entry.id === itemId);
  const similarNavigation = item?.media_type === "video" ? [{ id: item.id, title: item.title }, ...similarVideos] : undefined;
  const navigationItems = viewerNavigationItems(itemId, galleryContext, playlist, seriesContext, similarNavigation);
  const suggestedVideos = galleryContext?.videos ?? similarVideos;
  const hasPlaylist = playlist.length > 0 || Boolean(galleryContext?.videos.length);
  const seriesIndex = navigationItems?.findIndex((entry) => entry.id === itemId) ?? -1;
  const previousItem = seriesIndex > 0 ? navigationItems?.[seriesIndex - 1] : undefined;
  const nextItem = navigationItems && seriesIndex >= 0 ? navigationItems[seriesIndex + 1] : undefined;
  const openPreviousItem = () => { if (previousItem) onNavigateItem(previousItem.id); };
  const openNextItem = () => { if (nextItem) onNavigateItem(nextItem.id); };
  const continuousReading = readBooleanPreference("vaultly.reader.continuous", true);
  useContinuousReaderScroll(comicScrollRef, item?.media_type === "comic" && item.file_extension !== "pdf", `${itemId}:${page}`);

  useEffect(() => {
    if (!floating || !viewerRef.current) return;
    const node = viewerRef.current;
    const observer = new ResizeObserver(() => setFloatSize({ width: node.offsetWidth, height: node.offsetHeight }));
    observer.observe(node);
    return () => observer.disconnect();
  }, [floating]);

  useEffect(() => { vaultStorage.setItem("vaultly.comic.fit", fit); }, [fit]);
  useEffect(() => { vaultStorage.setItem("vaultly.comic.zoom", String(comicZoom)); }, [comicZoom]);
  useEffect(() => { vaultStorage.setItem("vaultly.video.sidebarTab", sidebarTab); }, [sidebarTab]);
  useEffect(() => { vaultStorage.setItem("vaultly.video.floatWidth", String(floatSize.width)); vaultStorage.setItem("vaultly.video.floatHeight", String(floatSize.height)); }, [floatSize]);
  useEffect(() => { vaultStorage.setItem("vaultly.video.floatDetails", String(floatDetails)); }, [floatDetails]);

  useEffect(() => {
    if (floating) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusViewer = () => viewerRef.current?.focus({ preventScroll: true });
    const frame = window.requestAnimationFrame(focusViewer);
    const keepFocusInside = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest(".tag-combobox-menu, .select-menu, .context-menu, .dialog-backdrop, .viewer-floating")) return;
      if (viewerRef.current && event.target instanceof Node && !viewerRef.current.contains(event.target)) focusViewer();
    };
    document.addEventListener("focusin", keepFocusInside);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("focusin", keepFocusInside);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, [floating]);

  useEffect(() => {
    if (!floating && viewerRef.current && !viewerRef.current.contains(document.activeElement)) viewerRef.current.focus({ preventScroll: true });
  }, [itemId, floating]);

  useEffect(() => {
    let active = true;
    setItem(null);
    setShowRename(false);
    setPages([]);
    setArchive(false);
    setPage(0);
    setError("");
    setSeriesOptions([]);
    setSeriesIds([]);
    setSimilarVideos([]);
    setSimilarLoading(false);
    api<MediaDetail>(`/api/items/${itemId}`)
      .then(async (detail) => {
        if (!active) return;
        setItem(detail);
        if (detail.media_type === "video" && !galleryContext) {
          setSimilarLoading(true);
          api<SimilarVideo[]>(`/api/items/${itemId}/similar`)
            .then((videos) => { if (active) setSimilarVideos(videos); })
            .catch(() => { if (active) setSimilarVideos([]); })
            .finally(() => { if (active) setSimilarLoading(false); });
        }
        if (detail.media_type === "comic" && detail.file_extension !== "pdf") {
          try {
            const pageResult = await api<{ pages: string[]; archive: boolean }>(`/api/items/${itemId}/pages`);
            if (active) { setPages(pageResult.pages); setArchive(pageResult.archive); }
          } catch (reason) {
            if (active) { setArchive(true); setError(reason instanceof Error ? reason.message : "Could not read comic pages."); }
          }
        }
      })
      .catch((requestError) => { if (active) setError(requestError instanceof Error ? requestError.message : "Could not open item."); });
    Promise.all([
      api<SeriesSummary[]>("/api/series"),
      api<Array<{ id: number; name: string }>>(`/api/items/${itemId}/series`),
    ]).then(([allSeries, memberships]) => {
      if (!active) return;
      setSeriesOptions(allSeries.map((entry) => ({ id: entry.id, name: entry.title })));
      setSeriesIds(memberships.map((entry) => entry.id));
    }).catch((requestError) => { if (active) setError(requestError instanceof Error ? requestError.message : "Could not load series and sets."); });
    return () => { active = false; };
  }, [itemId, galleryContext]);

  // Refresh assignments and renamed attributes without replacing the mounted reader/player.
  useEffect(() => {
    if (previousAttributeRevision.current === attributeRevision) return;
    previousAttributeRevision.current = attributeRevision;
    const controller = new AbortController();
    api<MediaDetail>(`/api/items/${itemId}`, { signal: controller.signal })
      .then((detail) => { if (!controller.signal.aborted) setItem((current) => current?.id === itemId ? detail : current); })
      .catch((requestError) => { if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : "Could not refresh attributes."); });
    return () => controller.abort();
  }, [attributeRevision, itemId]);

  const changeComicZoom = (delta: number) => {
    setComicZoom((value) => Math.max(25, Math.min(400, value + delta)));
    setFit("custom");
  };

  const changeComicFit = (nextFit: ComicFit) => {
    setComicZoom(100);
    setFit(nextFit);
  };

  const toggleComicFullscreen = () => {
    if (document.fullscreenElement === comicStageRef.current) void document.exitFullscreen().catch(() => undefined);
    else if (comicStageRef.current) void comicStageRef.current.requestFullscreen().catch(() => undefined);
  };

  const previousComicPage = () => {
    if (page > 0) setPage(page - 1);
    else if (continuousReading) openPreviousItem();
  };

  const nextComicPage = () => {
    if (page < pages.length - 1) setPage(page + 1);
    else if (continuousReading) openNextItem();
  };

  useLayoutEffect(() => {
    const container = comicScrollRef.current;
    const destination = comicContinuous ? container?.querySelector<HTMLElement>(`[data-comic-page="${page}"]`) : null;
    container?.scrollTo({ top: destination && container ? destination.offsetTop - container.offsetTop : 0, left: 0, behavior: "instant" });
  }, [itemId, page, comicContinuous]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setComicFullscreen(document.fullscreenElement === comicStageRef.current);
      if (!document.fullscreenElement) lastFullscreenExit.current = performance.now();
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.target instanceof HTMLElement && event.target.closest("[role='combobox'], .context-menu, .select-menu, .shortcut-help-popover"))) return;
      if (document.activeElement instanceof HTMLElement && document.activeElement.closest(".management-drawer, .management-editor-window, .management-dock")) return;
      if (event.key === "Tab" && viewerRef.current) {
        const focusable = Array.from(viewerRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled):not([aria-hidden]), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])"));
        if (!focusable.length) { event.preventDefault(); viewerRef.current.focus(); return; }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        return;
      }
      if (document.activeElement instanceof HTMLElement && document.activeElement.closest(".viewer") && !viewerRef.current?.contains(document.activeElement)) return;
      if (floating && !viewerRef.current?.contains(document.activeElement)) return;
      if (matchesShortcut(event, "viewer.close")) {
        // While the video is in fullscreen, let the browser exit fullscreen first;
        // a second Escape press then closes the viewer.
        if (document.fullscreenElement || performance.now() - lastFullscreenExit.current < 350) return;
        onClose();
        return;
      }
      const targetElement = event.target instanceof HTMLElement ? event.target : null;
      if (targetElement?.closest("input, textarea, select, [contenteditable]")) return;
      const activatingControl = Boolean(targetElement?.closest("button, a"));
      if (navigationItems && (matchesShortcut(event, "series.previous") || matchesShortcut(event, "series.next"))) {
        event.preventDefault();
        const target = matchesShortcut(event, "series.previous") ? previousItem : nextItem;
        if (target) onNavigateItem(target.id);
        return;
      }
      if (item?.media_type === "comic" && item.file_extension !== "pdf") {
        if (matchesShortcut(event, "reader.nextPage")) { event.preventDefault(); nextComicPage(); }
        if (matchesShortcut(event, "reader.previousPage")) { event.preventDefault(); previousComicPage(); }
        if (matchesShortcut(event, "comic.zoomIn") && !activatingControl) { event.preventDefault(); changeComicZoom(25); }
        if (matchesShortcut(event, "comic.zoomOut") && !activatingControl) { event.preventDefault(); changeComicZoom(-25); }
        if (matchesShortcut(event, "comic.fitWidth") && !activatingControl) { event.preventDefault(); changeComicFit("width"); }
        if (matchesShortcut(event, "comic.fullscreen") && !activatingControl) { event.preventDefault(); toggleComicFullscreen(); }
        if (matchesShortcut(event, "comic.resetFit")) {
          event.preventDefault();
          changeComicFit("screen");
        }
      }
      // Video shortcuts (Enter fullscreen, Space play/pause, arrows seek/volume, M mute)
      // are handled inside VideoPlayer while it's mounted.
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, page, pages.length, navigationItems, previousItem, nextItem, onClose, onNavigateItem, manager?.isOpen, floating]);

  const toggleFavorite = async () => {
    if (!item) return;
    const favorite = item.favorite ? 0 : 1;
    setError("");
    try {
      await api(`/api/items/${item.id}/favorite`, { method: "PUT", body: JSON.stringify({ favorite: Boolean(favorite) }) });
      setItem({ ...item, favorite });
      onChanged();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not update favorite."); }
  };

  const updateCategories = async (categoryIds: number[]) => {
    if (!item) return;
    setSaving(true);
    setError("");
    try {
      const result = await api<{ category_ids: number[] }>(`/api/items/${item.id}/categories`, { method: "PUT", body: JSON.stringify({ categoryIds }) });
      setItem({ ...item, category_ids: result.category_ids });
      onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not update categories.");
    } finally {
      setSaving(false);
    }
  };

  const updateTags = async (tagIds: number[]) => {
    if (!item) return;
    setSaving(true);
    setError("");
    try {
      const result = await api<{ tags: Tag[] }>(`/api/items/${item.id}/tags`, {
        method: "PUT",
        body: JSON.stringify({ tagIds }),
      });
      setItem({ ...item, tags: result.tags });
      onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not update tags.");
    } finally {
      setSaving(false);
    }
  };

  const updatePeople = async (role: "cast" | "artist", personIds: number[]) => {
    if (!item) return;
    setSaving(true); setError("");
    try {
      const result = await api<{ people: Person[] }>(`/api/items/${item.id}/people/${role}`, {
        method: "PUT", body: JSON.stringify({ personIds }),
      });
      setItem(role === "cast" ? { ...item, cast: result.people } : { ...item, artists: result.people });
      onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : `Could not update ${role}.`);
    } finally { setSaving(false); }
  };

  const updateSeries = async (ids: number[]) => {
    if (!item) return;
    setSaving(true);
    setError("");
    try {
      const result = await api<Array<{ id: number; name: string }>>(`/api/items/${item.id}/series`, {
        method: "PUT", body: JSON.stringify({ seriesIds: ids }),
      });
      setSeriesIds(result.map((entry) => entry.id));
      onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not update series and sets.");
    } finally { setSaving(false); }
  };

  const createSeries = async (name: string) => {
    const created = await api<SeriesSummary>("/api/series", { method: "POST", body: JSON.stringify({ title: name }) });
    const option = { id: created.id, name: created.title };
    setSeriesOptions((current) => [...current, option].sort((a, b) => a.name.localeCompare(b.name)));
    return option;
  };

  const revealInExplorer = async () => {
    setError("");
    try { await api(`/api/items/${itemId}/reveal`, { method: "POST" }); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not open the containing folder."); }
  };

  return (
    <div className={`viewer-backdrop${floating ? " is-floating" : ""}${hasPlaylist ? " has-playlist" : ""}`} style={floating ? { width: floatSize.width, height: floatSize.height } : undefined} role="presentation" onMouseDown={floating ? undefined : onClose}>
      <section ref={viewerRef} style={floating ? { width: floatSize.width, height: floatSize.height } : undefined} className={`viewer${floating ? " viewer-floating" : ""}${hasPlaylist ? " has-playlist" : ""}${floating && floatDetails ? " show-float-details" : ""}`} role="dialog" aria-modal={!floating} aria-label={item?.title || "Media viewer"} tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
        <header className="viewer-header">
          <div className="viewer-title"><strong>{item?.title || "Opening media…"}</strong><span>{galleryContext && seriesIndex >= 0 ? `Gallery page ${galleryContext.page + 1} · ${seriesIndex + 1} / ${galleryContext.videos.length}` : playlistIndex >= 0 ? `Temporary playlist · ${playlistIndex + 1} / ${playlist.length}` : seriesContext && seriesIndex >= 0 ? `${seriesContext.seriesTitle} · ${seriesIndex + 1} / ${seriesContext.items.length}` : item ? `${item.source_name} · ${formatSize(item.size_bytes)}` : ""}</span></div>
          <div className="viewer-header-actions">
            {floating && <label className="float-size-control" title="Player size"><input type="range" aria-label="Floating player size" min="320" max={Math.max(320, Math.min(1000, window.innerWidth - 36))} step="20" value={floatSize.width} onChange={(event) => { const width = Number(event.target.value); setFloatSize({ width, height: Math.min(window.innerHeight - 36, width * 9 / 16 + (floatDetails ? 189 : 49)) }); }} /></label>}
            {floating && hasPlaylist && <button type="button" aria-label="Show floating playlist and details" aria-pressed={floatDetails} onClick={() => { setFloatDetails((value) => !value); setFloatSize((value) => ({ ...value, height: Math.max(230, Math.min(window.innerHeight - 36, value.height + (floatDetails ? -140 : 140))) })); }}><ListVideo size={17} /></button>}
            {manager && <button type="button" onClick={() => manager.open("tags")} title="Manage attributes without leaving this media" aria-label="Manage attributes"><SlidersHorizontal size={17} /><span className="viewer-manage-label">Attributes</span></button>}
            {item && <button className={item.favorite ? "is-favorite" : ""} type="button" onClick={() => void toggleFavorite()} aria-label={item.favorite ? "Remove from favorites" : "Add to favorites"} title={item.favorite ? "Remove from favorites" : "Add to favorites"}><Heart size={17} fill={item.favorite ? "currentColor" : "none"} /></button>}
            {navigationItems && <><button type="button" onClick={() => previousItem && onNavigateItem(previousItem.id)} disabled={!previousItem} title={previousItem ? `Previous: ${previousItem.title}` : "First item"} aria-label="Previous file"><ChevronLeft size={17} /> Previous</button><button type="button" onClick={() => nextItem && onNavigateItem(nextItem.id)} disabled={!nextItem} title={nextItem ? `Next: ${nextItem.title}` : "Last item"} aria-label="Next file">Next <ChevronRight size={17} /></button></>}
            {item?.media_type === "video" && <button className="viewer-float-toggle" type="button" onClick={onToggleFloating} title={floating ? "Return to full player" : "Keep playing while browsing"} aria-pressed={floating}>{floating ? <Maximize2 size={18} /> : <PictureInPicture2 size={18} />}{floating ? "Full view" : "Float"}</button>}
            <button className="icon-button" type="button" onClick={onClose} aria-label="Close viewer"><X size={21} /></button>
          </div>
        </header>

        <div className="viewer-main">
          {!item && !error && <div className="viewer-loading"><LoaderCircle className="spin" size={30} /> Loading…</div>}
          {item?.media_type === "video" && (
            <div className="video-stage">
              <VideoPlayer key={item.id} itemId={item.id} src={vaultUrl(`/api/items/${item.id}/file`)} compact={floating} autoPlay={readBooleanPreference("vaultly.video.autoplay", true)} onEnded={readBooleanPreference("vaultly.video.autoAdvance", true) ? openNextItem : undefined} onError={setError} />
            </div>
          )}
          {(item?.media_type === "story" || (item?.media_type === "comic" && item.file_extension === "pdf")) && (
            <Suspense fallback={<div className="viewer-loading"><LoaderCircle className="spin" size={19} /> Loading PDF reader…</div>}>
              {item.file_extension === "pdf" ? <PdfReader itemId={item.id} onPreviousItem={continuousReading && previousItem ? openPreviousItem : undefined} onNextItem={continuousReading && nextItem ? openNextItem : undefined} /> : <EbookReader key={item.id} itemId={item.id} extension={item.file_extension} />}
            </Suspense>
          )}
          {item?.media_type === "comic" && item.file_extension !== "pdf" && (
            pages.length > 0 ? (
              <div className={`comic-stage page-tone-${appearance}`} ref={comicStageRef}>
                <div className="comic-toolbar">
                  <ReaderAppearance value={appearance} onChange={setAppearance} />
                  <label><input type="checkbox" checked={comicContinuous} onChange={(event) => { setComicContinuous(event.target.checked); changeComicFit("width"); }} /> Continuous view</label>
                  <ReaderAutoScroll scrollRef={comicScrollRef} enabled={comicContinuous || fit !== "screen"} contentKey={`${itemId}:${comicContinuous}:${page}`} />
                  <button type="button" onClick={previousComicPage} disabled={page === 0 && (!continuousReading || !previousItem)}><ChevronLeft size={18} /> Previous</button>
                  <span>Page {page + 1} / {pages.length}</span>
                  <button type="button" onClick={nextComicPage} disabled={page === pages.length - 1 && (!continuousReading || !nextItem)}>Next <ChevronRight size={18} /></button>
                  <label><ZoomIn size={17} /><Select aria-label="Comic page fit" value={fit} onChange={(event) => { changeComicFit(event.target.value as typeof fit); window.requestAnimationFrame(() => viewerRef.current?.focus({ preventScroll: true })); }}><option value="screen">Fit screen</option><option value="width">Fit width</option><option value="custom">{comicZoom}%</option></Select></label>
                  <button type="button" onClick={() => changeComicZoom(-25)} aria-label="Zoom out"><Minus size={17} /></button>
                  <button type="button" onClick={() => changeComicZoom(25)} aria-label="Zoom in"><Plus size={17} /></button>
                  <button type="button" onClick={toggleComicFullscreen} aria-label={comicFullscreen ? "Exit comic fullscreen" : "Open comic fullscreen"}>{comicFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
                  <ShortcutHelp kind="comic" />
                  <ActionMenu label="Reader options" actions={[{ label: comicContinuous ? "Use single page view" : "Use continuous view", icon: <BookOpen size={16} />, onSelect: () => { setComicContinuous(!comicContinuous); changeComicFit(comicContinuous ? "screen" : "width"); } }, { label: "Reset zoom and fit", icon: <ZoomIn size={16} />, onSelect: () => changeComicFit("screen") }, { label: "Open in desktop reader", icon: <FolderOpen size={16} />, disabled: !item.file_extension, onSelect: () => { void api(`/api/items/${item.id}/open-document`, { method: "POST" }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not open file.")); } }]} />
                </div>
                <div
                  className="comic-page-scroll"
                  ref={comicScrollRef}
                  tabIndex={-1}
                  onPointerDown={() => viewerRef.current?.focus({ preventScroll: true })}
                >
                  {(comicContinuous ? pages.map((_, index) => index) : [page]).map((index) => <img key={index} data-comic-page={index} loading="lazy" className={`comic-page fit-${fit}`} style={fit === "custom" ? { width: `${comicZoom}%` } : undefined} src={vaultUrl(`/api/items/${item.id}/pages/${index}`)} alt={`Page ${index + 1}`} />)}
                </div>
              </div>
            ) : archive ? (
              <div className="archive-state"><BookOpen size={40} /><h2>Open in your comic reader</h2><p>This archive format uses your associated desktop reader.</p><ShortcutHelp kind="comic" /><button className="secondary-button" type="button" onClick={() => { void api(`/api/items/${item.id}/open-document`, { method: "POST" }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not open comic.")); }}>Open in desktop reader</button><a className="secondary-button" href={vaultUrl(`/api/items/${item.id}/file`)} download>Open the archive <Download size={17} /></a></div>
            ) : <div className="viewer-loading"><LoaderCircle className="spin" size={28} /> Loading pages…</div>
          )}
        </div>

        <aside className="viewer-details">
          {error && <p className="form-error" role="alert">{error}</p>}
          {item && <>
            {item.media_type === "video" && <div className="viewer-detail-tabs" role="tablist" aria-label="Video sidebar">
              <button type="button" role="tab" aria-selected={sidebarTab === "playlist"} className={sidebarTab === "playlist" ? "active" : ""} onClick={() => setSidebarTab("playlist")}><ListVideo size={15} /> Up next</button>
              <button type="button" role="tab" aria-selected={sidebarTab === "info"} className={sidebarTab === "info" ? "active" : ""} onClick={() => setSidebarTab("info")}>Info</button>
            </div>}
            {item.media_type === "video" && sidebarTab === "playlist" && <div className="viewer-playlist-panel" role="tabpanel">
              {playlist.length > 0 && <section className="temporary-playlist">
                <div className="temporary-playlist-heading"><span><ListVideo size={16} /> Temporary playlist</span><button type="button" onClick={onClearPlaylist}>Clear</button></div>
                <div>{playlist.map((entry, index) => <div className={entry.id === itemId ? "is-playing" : ""} key={entry.id}><button type="button" onClick={() => onNavigatePlaylistItem(entry.id)}><span>{index + 1}</span><strong>{entry.title}</strong></button><button type="button" onClick={() => onRemoveFromPlaylist(entry.id)} aria-label={`Remove ${entry.title} from playlist`}><Trash2 size={14} /></button></div>)}</div>
              </section>}
              <section className={`similar-playlist${galleryContext ? " gallery-playlist" : ""}`}>
                <div className="similar-playlist-heading"><span>{galleryContext ? `Current page · ${galleryContext.page + 1}` : "Similar videos"}</span><small>{suggestedVideos.length || ""}</small></div>
                {!galleryContext && similarLoading && <div className="viewer-playlist-state"><LoaderCircle className="spin" size={16} /> Finding similar videos…</div>}
                {!similarLoading && suggestedVideos.length === 0 && <p className="viewer-playlist-state">{galleryContext ? "No videos on this gallery page." : "No other videos are available yet."}</p>}
                <div className="similar-playlist-list">{suggestedVideos.map((video) => <button type="button" key={video.id} className={video.id === itemId ? "is-playing" : undefined} aria-current={video.id === itemId ? "true" : undefined} onClick={() => { if (video.id !== itemId) onNavigateItem(video.id); }} title={video.filename}>
                  <span className="similar-video-art"><img src={vaultUrl(`/api/items/${video.id}/thumbnail`)} alt="" loading="lazy" /></span>
                  <span className="similar-video-copy"><strong>{video.title}</strong><small>{video.source_name} · {formatDuration(video.duration_seconds)}</small></span>
                </button>)}</div>
              </section>
            </div>}
            {(item.media_type !== "video" || sidebarTab === "info") && <AttributeMediaContext.Provider value={item.media_type}><div className="viewer-info-panel" role={item.media_type === "video" ? "tabpanel" : undefined}>
              <div className="viewer-detail-row"><span>Type</span><strong>{item.media_type}</strong></div>
              <div className="viewer-detail-row"><span>{item.file_extension ? "File name" : "Folder name"}</span><strong title={item.filename}>{item.filename}</strong></div>
              <div className="viewer-detail-row"><span>{item.media_type === "video" ? "Source" : "Path"}</span><strong title={item.media_type === "video" ? item.source_name : item.relative_path}>{item.media_type === "video" ? item.source_name : item.relative_path}</strong></div>
              {item.media_type === "video" && <p className="detail-hint">Arrow keys seek 5 seconds by default. Shift + Arrow seeks 1 minute. Mouse wheel changes volume by 5%; all shortcuts and seek durations can be changed in Settings.</p>}
              {(item.media_type === "story" || item.media_type === "comic") && <p className="detail-hint">Page, scroll, zoom, and fit shortcuts can be assigned in Settings.</p>}
              {seriesContext && <p className="detail-hint">Alt + ←/→ moves to the previous or next file in this set.</p>}
              <button className="secondary-button" type="button" onClick={() => setShowRename(true)} disabled={saving}><Pencil size={16} /> Rename title</button>
              <button className="secondary-button" type="button" onClick={() => void revealInExplorer()}><FolderOpen size={16} /> Open located folder</button>
              {item.media_type !== "comic" && <a className="secondary-button" href={vaultUrl(`/api/items/${item.id}/file`)} download><Download size={16} /> Download file</a>}
              <MediaCoverEditor key={item.id} item={item} onChanged={(changes) => { setItem((current) => current?.id === item.id ? { ...current, ...changes } : current); onChanged(); }} />
              <h3>Categories</h3>
              {item.source_attributes && (item.source_attributes.tags.length > 0 || item.source_attributes.categories.length > 0) && <div className="attribute-help">Common source attributes:<div className="attribute-badges">{item.source_attributes.tags.map((tag) => <AttributeBadge key={`tag-${tag.id}`} kind="tag" {...tag} />)}{item.source_attributes.categories.map((category) => <AttributeBadge key={`category-${category.id}`} kind="category" {...category} />)}</div>These apply to every file; edit them in Sources.</div>}
              <TagCombobox attributeKind="category" label="Item categories" tags={categories} selectedIds={item.category_ids} onChange={(ids) => void updateCategories(ids)} onCreate={onCategoryCreated} disabled={saving} placeholder="Search or create categories" />
              <h3>Tags</h3>
              <TagCombobox attributeKind="tag" label="Item tags" tags={tags} selectedIds={item.tags.map((tag) => tag.id)} onChange={(ids) => void updateTags(ids)} onCreate={onTagCreated} disabled={saving} placeholder="Search or create tags" />
              <h3>{item.media_type === "video" ? "Cast" : "Artists"}</h3>
              <TagCombobox attributeKind={item.media_type === "video" ? "cast" : "artist"} label={item.media_type === "video" ? "Cast" : "Artists"} tags={people} selectedIds={(item.media_type === "video" ? item.cast : item.artists).map((person) => person.id)} onChange={(ids) => void updatePeople(item.media_type === "video" ? "cast" : "artist", ids)} onCreate={onPersonCreated} disabled={saving} placeholder={item.media_type === "video" ? "Search or add cast" : "Search or add artists"} />
              <h3>Series & sets</h3>
              <TagCombobox attributeKind="series" label="In series & sets" tags={seriesOptions} selectedIds={seriesIds} onChange={(ids) => void updateSeries(ids)} onCreate={createSeries} disabled={saving} placeholder="Search or create a set" />
              {seriesIds.length > 0 && <div className="viewer-series-links">{seriesOptions.filter((entry) => seriesIds.includes(entry.id)).map((entry) =>
                <button key={entry.id} type="button" onClick={() => onOpenSeries(entry.id)}>View {entry.name}</button>)}</div>}
            </div></AttributeMediaContext.Provider>}
          </>}
        </aside>
        {showRename && item && <RenameMediaDialog key={item.id} item={item} onClose={() => setShowRename(false)} onSaved={(renamed) => {
          setItem((current) => current?.id === renamed.id ? { ...current, ...renamed } : current);
          onChanged();
        }} />}
      </section>
    </div>
  );
}
