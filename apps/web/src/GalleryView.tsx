import { BookOpen, ChevronDown, Clapperboard, FolderPlus, Image, LoaderCircle, Play, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, formatCount, formatSize, type Category, type ItemPage, type MediaItem, type MediaType } from "./media";

interface GalleryViewProps {
  type?: MediaType;
  search: string;
  categories: Category[];
  onOpen: (id: number) => void;
  onAddSource: () => void;
  refreshKey: number;
}

const galleryNames: Record<MediaType, string> = {
  comic: "Comics",
  video: "Videos",
  story: "Stories",
};

function MediaCard({ item, onOpen }: { item: MediaItem; onOpen: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const [thumbnailAttempt, setThumbnailAttempt] = useState(0);
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
    <button
      className="media-card"
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
        <span className="media-type-badge">{item.media_type}</span>
        {item.media_type === "video" && <span className="play-overlay"><Play size={19} fill="currentColor" /></span>}
      </div>
      <div className="media-card-body">
        <h3 title={item.title}>{item.title}</h3>
        <p title={item.relative_path}>{item.source_name} · {item.relative_path}</p>
        <div className="media-card-meta"><span>{formatSize(item.size_bytes)}</span><span>{item.media_type === "comic" ? `${item.file_count} ${item.file_count === 1 ? "file" : "pages"}` : item.category_names || "Uncategorized"}</span></div>
      </div>
    </button>
  );
}

export function GalleryView({ type, search, categories, onOpen, onAddSource, refreshKey }: GalleryViewProps) {
  const [categoryId, setCategoryId] = useState("");
  const [sort, setSort] = useState<"title" | "recent" | "size">("title");
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<ItemPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { setPage(0); }, [type, search, categoryId, sort]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), sort });
    if (type) params.set("type", type);
    if (search.trim()) params.set("q", search.trim());
    if (categoryId) params.set("category", categoryId);
    setLoading(true);
    api<ItemPage>(`/api/items?${params.toString()}`, { signal: controller.signal })
      .then((data) => { setResult(data); setError(""); })
      .catch((requestError) => {
        if (controller.signal.aborted) return;
        setError(requestError instanceof Error ? requestError.message : "Could not load media.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [type, search, categoryId, sort, page, refreshKey]);

  const title = type ? galleryNames[type] : "All media";

  return (
    <section className="gallery-view">
      <div className="page-heading gallery-heading">
        <div><p className="eyebrow">Your library</p><h1>{title}</h1><p>{search ? `Results for “${search}”` : "Browse files indexed from your local folders."}</p></div>
        <span className="result-count">{loading && !result ? "Loading…" : `${formatCount(result?.total ?? 0)} items`}</span>
      </div>

      <div className="gallery-toolbar">
        <label className="select-wrap">
          <span>Category</span>
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">All categories</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
          <ChevronDown size={16} />
        </label>
        <label className="select-wrap">
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="title">Title A–Z</option>
            <option value="recent">Recently modified</option>
            <option value="size">Largest first</option>
          </select>
          <ChevronDown size={16} />
        </label>
      </div>

      {error && <p className="page-error" role="alert">{error}</p>}
      {loading ? (
        <div className="loading-state"><LoaderCircle className="spin" size={28} /><span>Loading media…</span></div>
      ) : result && result.items.length > 0 ? (
        <>
          <div className="media-grid">{result.items.map((item) => <MediaCard key={item.id} item={item} onOpen={() => onOpen(item.id)} />)}</div>
          <div className="pagination">
            <button className="secondary-button" type="button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0}>Previous</button>
            <span>Page {page + 1} of {Math.max(1, Math.ceil(result.total / result.pageSize))}</span>
            <button className="secondary-button" type="button" onClick={() => setPage((value) => value + 1)} disabled={(page + 1) * result.pageSize >= result.total}>Next</button>
          </div>
        </>
      ) : (
        <div className="gallery-empty">
          {search ? <Search size={34} /> : <FolderPlus size={34} />}
          <h2>{search || categoryId ? "No matching media" : `No ${type ? title.toLowerCase() : "media"} indexed yet`}</h2>
          <p>{search || categoryId ? "Try another search or category." : "Add a source folder, or scan an existing source again."}</p>
          {!search && !categoryId && <button className="primary-button" type="button" onClick={onAddSource}>Add source</button>}
        </div>
      )}
    </section>
  );
}
