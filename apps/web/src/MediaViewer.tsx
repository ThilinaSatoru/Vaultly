import { BookOpen, ChevronLeft, ChevronRight, Download, LoaderCircle, Minus, Pencil, Plus, X, ZoomIn } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { TagCombobox } from "./TagCombobox";
import { api, formatSize, type Category, type MediaDetail, type SeriesSummary, type Tag } from "./media";

const PdfReader = lazy(async () => ({ default: (await import("./PdfReader")).PdfReader }));

interface MediaViewerProps {
  itemId: number;
  categories: Category[];
  tags: Tag[];
  onCategoryCreated: (name: string) => Promise<Category>;
  onTagCreated: (name: string) => Promise<Tag>;
  onOpenSeries: (id: number) => void;
  onClose: () => void;
  onChanged: () => void;
}

export function MediaViewer({ itemId, categories, tags, onCategoryCreated, onTagCreated, onOpenSeries, onClose, onChanged }: MediaViewerProps) {
  const [item, setItem] = useState<MediaDetail | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [archive, setArchive] = useState(false);
  const [page, setPage] = useState(0);
  const [fit, setFit] = useState<"screen" | "width" | "custom">("screen");
  const [comicZoom, setComicZoom] = useState(100);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [seriesOptions, setSeriesOptions] = useState<Array<{ id: number; name: string }>>([]);
  const [seriesIds, setSeriesIds] = useState<number[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let active = true;
    setItem(null);
    setPages([]);
    setPage(0);
    setFit("screen");
    setComicZoom(100);
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); return; }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (item?.media_type === "comic") {
        if (event.key === "ArrowRight") setPage((value) => Math.min(pages.length - 1, value + 1));
        if (event.key === "ArrowLeft") setPage((value) => Math.max(0, value - 1));
      }
      if (item?.media_type === "video" && videoRef.current) {
        const video = videoRef.current;
        if (event.code === "Space" || event.key.toLowerCase() === "k") {
          event.preventDefault();
          if (video.paused) void video.play(); else video.pause();
        }
        if (event.key === "ArrowRight") { event.preventDefault(); video.currentTime += event.shiftKey ? 30 : 5; }
        if (event.key === "ArrowLeft") { event.preventDefault(); video.currentTime -= event.shiftKey ? 30 : 5; }
        if (event.key.toLowerCase() === "m") video.muted = !video.muted;
        if (event.key.toLowerCase() === "f") void video.requestFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, pages.length, onClose]);

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
      <section className="viewer" role="dialog" aria-modal="true" aria-label={item?.title || "Media viewer"} onMouseDown={(event) => event.stopPropagation()}>
        <header className="viewer-header">
          <div><strong>{item?.title || "Opening media…"}</strong><span>{item ? `${item.source_name} · ${formatSize(item.size_bytes)}` : ""}</span></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close viewer"><X size={21} /></button>
        </header>

        <div className="viewer-main">
          {!item && !error && <div className="viewer-loading"><LoaderCircle className="spin" size={30} /> Loading…</div>}
          {item?.media_type === "video" && (
            <div className="video-stage">
              <div className="video-frame">
                <video ref={videoRef} src={`/api/items/${item.id}/file`} controls autoPlay playsInline onError={() => setError("Your browser could not play this video format. Try the download link or a browser-supported file such as MP4/WebM.")} />
              </div>
            </div>
          )}
          {item?.media_type === "story" && (
            <Suspense fallback={<div className="viewer-loading"><LoaderCircle className="spin" size={19} /> Loading PDF reader…</div>}>
              <PdfReader itemId={item.id} />
            </Suspense>
          )}
          {item?.media_type === "comic" && (
            pages.length > 0 ? (
              <div className="comic-stage">
                <div className="comic-toolbar">
                  <button type="button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0}><ChevronLeft size={18} /> Previous</button>
                  <span>Page {page + 1} / {pages.length}</span>
                  <button type="button" onClick={() => setPage((value) => Math.min(pages.length - 1, value + 1))} disabled={page === pages.length - 1}>Next <ChevronRight size={18} /></button>
                  <label><ZoomIn size={17} /><select value={fit} onChange={(event) => setFit(event.target.value as typeof fit)}><option value="screen">Fit screen</option><option value="width">Fit width</option><option value="custom">{comicZoom}%</option></select></label>
                  <button type="button" onClick={() => changeComicZoom(-25)} aria-label="Zoom out"><Minus size={17} /></button>
                  <button type="button" onClick={() => changeComicZoom(25)} aria-label="Zoom in"><Plus size={17} /></button>
                </div>
                <div className="comic-page-scroll"><img className={`comic-page fit-${fit}`} style={fit === "custom" ? { width: `${comicZoom}%` } : undefined} src={`/api/items/${item.id}/pages/${page}`} alt={`Page ${page + 1}`} /></div>
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
            {item.media_type === "video" && <p className="detail-hint">Space/K pause · ←/→ seek 5s · Shift + ←/→ seek 30s · M mute · F fullscreen</p>}
            <button className="secondary-button" type="button" onClick={rename} disabled={saving}><Pencil size={16} /> Edit title</button>
            {item.media_type !== "comic" && <a className="secondary-button" href={`/api/items/${item.id}/file`} download><Download size={16} /> Download file</a>}
            <h3>Categories</h3>
            <TagCombobox label="Item categories" tags={categories} selectedIds={item.category_ids} onChange={(ids) => void updateCategories(ids)} onCreate={onCategoryCreated} disabled={saving} placeholder="Search or create categories" />
            <h3>Tags</h3>
            <TagCombobox label="Item tags" tags={tags} selectedIds={item.tags.map((tag) => tag.id)} onChange={(ids) => void updateTags(ids)} onCreate={onTagCreated} disabled={saving} placeholder="Search or create tags" />
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
