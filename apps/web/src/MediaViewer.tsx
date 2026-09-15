import { BookOpen, ChevronLeft, ChevronRight, Download, Heart, LoaderCircle, Minus, Pencil, Plus, X, ZoomIn } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { TagCombobox } from "./TagCombobox";
import { VideoPlayer } from "./VideoPlayer";
import { api, formatSize, type Category, type MediaDetail, type Person, type SeriesSummary, type SeriesViewerContext, type Tag } from "./media";
import { matchesShortcut, readBooleanPreference, readNumberPreference } from "./preferences";

const PdfReader = lazy(async () => ({ default: (await import("./PdfReader")).PdfReader }));
type ComicFit = "screen" | "width" | "custom";

const storedComicFit = (): ComicFit => {
  const value = window.localStorage.getItem("vaultly.comic.fit");
  return value === "width" || value === "custom" ? value : "screen";
};

const storedComicZoom = () => {
  const value = Number(window.localStorage.getItem("vaultly.comic.zoom"));
  return Number.isFinite(value) ? Math.max(25, Math.min(400, value)) : 100;
};

interface MediaViewerProps {
  itemId: number;
  seriesContext: SeriesViewerContext | null;
  onNavigateItem: (id: number) => void;
  categories: Category[];
  tags: Tag[];
  people: Person[];
  onCategoryCreated: (name: string) => Promise<Category>;
  onTagCreated: (name: string) => Promise<Tag>;
  onPersonCreated: (name: string) => Promise<Person>;
  onOpenSeries: (id: number) => void;
  onClose: () => void;
  onChanged: () => void;
}

export function MediaViewer({ itemId, seriesContext, onNavigateItem, categories, tags, people, onCategoryCreated, onTagCreated, onPersonCreated, onOpenSeries, onClose, onChanged }: MediaViewerProps) {
  const viewerRef = useRef<HTMLElement>(null);
  const comicScrollRef = useRef<HTMLDivElement>(null);
  const [item, setItem] = useState<MediaDetail | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [archive, setArchive] = useState(false);
  const [page, setPage] = useState(0);
  const [fit, setFit] = useState<ComicFit>(storedComicFit);
  const [comicZoom, setComicZoom] = useState(storedComicZoom);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [seriesOptions, setSeriesOptions] = useState<Array<{ id: number; name: string }>>([]);
  const [seriesIds, setSeriesIds] = useState<number[]>([]);
  const lastFullscreenExit = useRef(-Infinity);
  const seriesIndex = seriesContext?.items.findIndex((entry) => entry.id === itemId) ?? -1;
  const previousItem = seriesIndex > 0 ? seriesContext?.items[seriesIndex - 1] : undefined;
  const nextItem = seriesContext && seriesIndex >= 0 ? seriesContext.items[seriesIndex + 1] : undefined;
  const openPreviousItem = () => { if (previousItem) onNavigateItem(previousItem.id); };
  const openNextItem = () => { if (nextItem) onNavigateItem(nextItem.id); };
  const continuousReading = readBooleanPreference("vaultly.reader.continuous", true);

  useEffect(() => { window.localStorage.setItem("vaultly.comic.fit", fit); }, [fit]);
  useEffect(() => { window.localStorage.setItem("vaultly.comic.zoom", String(comicZoom)); }, [comicZoom]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusViewer = () => viewerRef.current?.focus({ preventScroll: true });
    const frame = window.requestAnimationFrame(focusViewer);
    const keepFocusInside = (event: FocusEvent) => {
      if (viewerRef.current && event.target instanceof Node && !viewerRef.current.contains(event.target)) focusViewer();
    };
    document.addEventListener("focusin", keepFocusInside);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("focusin", keepFocusInside);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (viewerRef.current && !viewerRef.current.contains(document.activeElement)) viewerRef.current.focus({ preventScroll: true });
  }, [itemId]);

  useEffect(() => {
    let active = true;
    setItem(null);
    setPages([]);
    setArchive(false);
    setPage(0);
    setError("");
    setSeriesOptions([]);
    setSeriesIds([]);
    api<MediaDetail>(`/api/items/${itemId}`)
      .then(async (detail) => {
        if (!active) return;
        setItem(detail);
        if (detail.media_type === "comic") {
          const pageResult = await api<{ pages: string[]; archive: boolean }>(`/api/items/${itemId}/pages`);
          if (active) { setPages(pageResult.pages); setArchive(pageResult.archive); }
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
  }, [itemId]);

  const changeComicZoom = (delta: number) => {
    setComicZoom((value) => Math.max(25, Math.min(400, value + delta)));
    setFit("custom");
  };

  const previousComicPage = () => {
    if (page > 0) setPage(page - 1);
    else if (continuousReading) openPreviousItem();
  };

  const nextComicPage = () => {
    if (page < pages.length - 1) setPage(page + 1);
    else if (continuousReading) openNextItem();
  };

  useEffect(() => {
    comicScrollRef.current?.scrollTo({ top: 0, left: 0 });
  }, [itemId, page]);

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) lastFullscreenExit.current = performance.now();
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Tab" && viewerRef.current) {
        const focusable = Array.from(viewerRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])"));
        if (!focusable.length) { event.preventDefault(); viewerRef.current.focus(); return; }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        return;
      }
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
      if (seriesContext && (matchesShortcut(event, "series.previous") || matchesShortcut(event, "series.next"))) {
        event.preventDefault();
        const target = matchesShortcut(event, "series.previous") ? previousItem : nextItem;
        if (target) onNavigateItem(target.id);
        return;
      }
      if (item?.media_type === "comic") {
        if (matchesShortcut(event, "reader.nextPage")) { event.preventDefault(); nextComicPage(); }
        if (matchesShortcut(event, "reader.previousPage")) { event.preventDefault(); previousComicPage(); }
        if (matchesShortcut(event, "reader.scrollUp")) { event.preventDefault(); comicScrollRef.current?.scrollBy({ top: -readNumberPreference("vaultly.reader.scrollStep", 160, 40, 800), behavior: "smooth" }); }
        if (matchesShortcut(event, "reader.scrollDown")) { event.preventDefault(); comicScrollRef.current?.scrollBy({ top: readNumberPreference("vaultly.reader.scrollStep", 160, 40, 800), behavior: "smooth" }); }
        if (matchesShortcut(event, "reader.zoomIn") && !activatingControl) { event.preventDefault(); changeComicZoom(25); }
        if (matchesShortcut(event, "reader.resetFit")) {
          event.preventDefault();
          setComicZoom(100);
          setFit("screen");
        }
      }
      // Video shortcuts (Enter fullscreen, Space play/pause, arrows seek/volume, M mute)
      // are handled inside VideoPlayer while it's mounted.
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, page, pages.length, seriesContext, previousItem, nextItem, onClose, onNavigateItem]);

  const rename = async () => {
    if (!item) return;
    const title = window.prompt("Item title", item.title)?.trim();
    if (!title || title === item.title) return;
    setSaving(true);
    setError("");
    try {
      await api(`/api/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ title }) });
      setItem({ ...item, title });
      onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not rename item.");
    } finally {
      setSaving(false);
    }
  };

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
      await api(`/api/items/${item.id}/categories`, { method: "PUT", body: JSON.stringify({ categoryIds }) });
      setItem({ ...item, category_ids: categoryIds });
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

  return (
    <div className="viewer-backdrop" role="presentation" onMouseDown={onClose}>
      <section ref={viewerRef} className="viewer" role="dialog" aria-modal="true" aria-label={item?.title || "Media viewer"} tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
        <header className="viewer-header">
          <div className="viewer-title"><strong>{item?.title || "Opening media…"}</strong><span>{seriesContext && seriesIndex >= 0 ? `${seriesContext.seriesTitle} · ${seriesIndex + 1} / ${seriesContext.items.length}` : item ? `${item.source_name} · ${formatSize(item.size_bytes)}` : ""}</span></div>
          <div className="viewer-header-actions">
            {item && <button className={item.favorite ? "is-favorite" : ""} type="button" onClick={() => void toggleFavorite()} aria-label={item.favorite ? "Remove from favorites" : "Add to favorites"} title={item.favorite ? "Remove from favorites" : "Add to favorites"}><Heart size={17} fill={item.favorite ? "currentColor" : "none"} /></button>}
            {seriesContext && <><button type="button" onClick={() => previousItem && onNavigateItem(previousItem.id)} disabled={!previousItem} title={previousItem ? `Previous: ${previousItem.title}` : "First item"} aria-label="Previous file in set"><ChevronLeft size={17} /> Previous</button><button type="button" onClick={() => nextItem && onNavigateItem(nextItem.id)} disabled={!nextItem} title={nextItem ? `Next: ${nextItem.title}` : "Last item"} aria-label="Next file in set">Next <ChevronRight size={17} /></button></>}
            <button className="icon-button" type="button" onClick={onClose} aria-label="Close viewer"><X size={21} /></button>
          </div>
        </header>

        <div className="viewer-main">
          {!item && !error && <div className="viewer-loading"><LoaderCircle className="spin" size={30} /> Loading…</div>}
          {item?.media_type === "video" && (
            <div className="video-stage">
              <VideoPlayer key={item.id} src={`/api/items/${item.id}/file`} autoPlay={readBooleanPreference("vaultly.video.autoplay", true)} onEnded={readBooleanPreference("vaultly.video.autoAdvance", true) ? openNextItem : undefined} onError={setError} />
            </div>
          )}
          {item?.media_type === "story" && (
            <Suspense fallback={<div className="viewer-loading"><LoaderCircle className="spin" size={19} /> Loading PDF reader…</div>}>
              <PdfReader itemId={item.id} onPreviousItem={continuousReading && previousItem ? openPreviousItem : undefined} onNextItem={continuousReading && nextItem ? openNextItem : undefined} />
            </Suspense>
          )}
          {item?.media_type === "comic" && (
            pages.length > 0 ? (
              <div className="comic-stage">
                <div className="comic-toolbar">
                  <button type="button" onClick={previousComicPage} disabled={page === 0 && (!continuousReading || !previousItem)}><ChevronLeft size={18} /> Previous</button>
                  <span>Page {page + 1} / {pages.length}</span>
                  <button type="button" onClick={nextComicPage} disabled={page === pages.length - 1 && (!continuousReading || !nextItem)}>Next <ChevronRight size={18} /></button>
                  <label><ZoomIn size={17} /><select value={fit} onChange={(event) => { setFit(event.target.value as typeof fit); window.requestAnimationFrame(() => viewerRef.current?.focus({ preventScroll: true })); }}><option value="screen">Fit screen</option><option value="width">Fit width</option><option value="custom">{comicZoom}%</option></select></label>
                  <button type="button" onClick={() => changeComicZoom(-25)} aria-label="Zoom out"><Minus size={17} /></button>
                  <button type="button" onClick={() => changeComicZoom(25)} aria-label="Zoom in"><Plus size={17} /></button>
                </div>
                <div
                  className="comic-page-scroll"
                  ref={comicScrollRef}
                  tabIndex={-1}
                  onPointerDown={() => viewerRef.current?.focus({ preventScroll: true })}
                >
                  <img className={`comic-page fit-${fit}`} style={fit === "custom" ? { width: `${comicZoom}%` } : undefined} src={`/api/items/${item.id}/pages/${page}`} alt={`Page ${page + 1}`} />
                </div>
              </div>
            ) : archive ? (
              <div className="archive-state"><BookOpen size={40} /><h2>Archive reader is coming next</h2><p>This CBZ/ZIP comic is indexed, but pages cannot be shown in the browser yet.</p><a className="secondary-button" href={`/api/items/${item.id}/file`} download>Open the archive <Download size={17} /></a></div>
            ) : <div className="viewer-loading"><LoaderCircle className="spin" size={28} /> Loading pages…</div>
          )}
        </div>

        <aside className="viewer-details">
          {error && <p className="form-error" role="alert">{error}</p>}
          {item && <>
            <div className="viewer-detail-row"><span>Type</span><strong>{item.media_type}</strong></div>
            <div className="viewer-detail-row"><span>{item.file_extension ? "File name" : "Folder name"}</span><strong title={item.filename}>{item.filename}</strong></div>
            <div className="viewer-detail-row"><span>Path</span><strong title={item.relative_path}>{item.relative_path}</strong></div>
            {item.media_type === "video" && <p className="detail-hint">Mouse wheel changes volume by 5%. Playback shortcuts can be assigned in Settings.</p>}
            {(item.media_type === "story" || item.media_type === "comic") && <p className="detail-hint">Page, scroll, zoom, and fit shortcuts can be assigned in Settings.</p>}
            {seriesContext && <p className="detail-hint">Alt + ←/→ moves to the previous or next file in this set.</p>}
            <button className="secondary-button" type="button" onClick={rename} disabled={saving}><Pencil size={16} /> Edit title</button>
            {item.media_type !== "comic" && <a className="secondary-button" href={`/api/items/${item.id}/file`} download><Download size={16} /> Download file</a>}
            <h3>Categories</h3>
            <TagCombobox label="Item categories" tags={categories} selectedIds={item.category_ids} onChange={(ids) => void updateCategories(ids)} onCreate={onCategoryCreated} disabled={saving} placeholder="Search or create categories" />
            <h3>Tags</h3>
            <TagCombobox label="Item tags" tags={tags} selectedIds={item.tags.map((tag) => tag.id)} onChange={(ids) => void updateTags(ids)} onCreate={onTagCreated} disabled={saving} placeholder="Search or create tags" />
            <h3>Cast</h3>
            <TagCombobox label="Cast" tags={people} selectedIds={item.cast.map((person) => person.id)} onChange={(ids) => void updatePeople("cast", ids)} onCreate={onPersonCreated} disabled={saving} placeholder="Search or add people" />
            <h3>Artists</h3>
            <TagCombobox label="Artists" tags={people} selectedIds={item.artists.map((person) => person.id)} onChange={(ids) => void updatePeople("artist", ids)} onCreate={onPersonCreated} disabled={saving} placeholder="Search or add artists" />
            <h3>Series & sets</h3>
            <TagCombobox label="In series & sets" tags={seriesOptions} selectedIds={seriesIds} onChange={(ids) => void updateSeries(ids)} onCreate={createSeries} disabled={saving} placeholder="Search or create a set" />
            {seriesIds.length > 0 && <div className="viewer-series-links">{seriesOptions.filter((entry) => seriesIds.includes(entry.id)).map((entry) =>
              <button key={entry.id} type="button" onClick={() => onOpenSeries(entry.id)}>View {entry.name}</button>)}</div>}
          </>}
        </aside>
      </section>
    </div>
  );
}
