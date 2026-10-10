import { Fragment, type ReactNode, useMemo, useState } from "react";
import { Search } from "lucide-react";

interface SourceSummary {
  id: number; name: string; root_path: string; comic_count: number; video_count: number; story_count: number;
  item_count: number; status: string; path_available: boolean;
}
type MediaFilter = "all" | "comic" | "video" | "story" | "mixed";
const groups = ["Mixed media", "Videos", "Comics", "Stories", "No indexed media"];
export function sourceMediaGroup(source: SourceSummary) {
  const types = [source.comic_count, source.video_count, source.story_count].filter((count) => count > 0).length;
  return types > 1 ? "Mixed media" : source.video_count > 0 ? "Videos" : source.comic_count > 0 ? "Comics" : source.story_count > 0 ? "Stories" : "No indexed media";
}
export function matchesSource(source: SourceSummary, media: MediaFilter, status: string, query: string) {
  const text = query.trim().toLocaleLowerCase();
  const matchesText = !text || `${source.name} ${source.root_path}`.toLocaleLowerCase().includes(text);
  const matchesStatus = status === "all" || (status === "unavailable" ? !source.path_available : source.path_available && source.status === status);
  const matchesMedia = media === "all" || (media === "mixed" ? sourceMediaGroup(source) === "Mixed media" : source[`${media}_count`] > 0);
  return matchesText && matchesStatus && matchesMedia;
}

export function SourcesBrowser<T extends SourceSummary>({ sources, renderSource }: {
  sources: T[]; renderSource: (source: T, expanded: boolean, toggle: () => void) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [media, setMedia] = useState<MediaFilter>("all");
  const [status, setStatus] = useState("all");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const visible = useMemo(() => sources.filter((source) => matchesSource(source, media, status, query)), [sources, media, status, query]);
  const filters: Array<{ value: MediaFilter; label: string }> = [{ value: "all", label: "All" }, { value: "comic", label: "Comics" }, { value: "video", label: "Videos" }, { value: "story", label: "Stories" }, { value: "mixed", label: "Mixed" }];
  const toggle = (id: number) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return <section className="sources-browser" aria-label="Browse sources">
    <div className="source-filter-tools">
      <label className="source-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find folder or path…" aria-label="Search sources" /></label>
      <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter sources by status">
        <option value="all">All statuses</option><option value="ready">Ready</option><option value="scanning">Scanning</option><option value="unavailable">Unavailable</option><option value="error">Errors</option><option value="idle">Not scanned</option>
      </select>
    </div>
    <div className="source-media-filters" role="group" aria-label="Filter sources by media type">
      {filters.map((filter) => <button key={filter.value} type="button" aria-pressed={media === filter.value} onClick={() => setMedia(filter.value)}>
        {filter.label}<span>{sources.filter((source) => matchesSource(source, filter.value, status, query)).length}</span>
      </button>)}
    </div>
    <div className="source-list-tools"><span>{visible.length} / {sources.length} sources</span><div>
      <button type="button" onClick={() => setExpanded((current) => new Set([...current, ...visible.map((source) => source.id)]))}>Expand all</button>
      <button type="button" onClick={() => setExpanded((current) => new Set([...current].filter((id) => !visible.some((source) => source.id === id))))}>Collapse all</button>
    </div></div>
    {groups.map((group) => {
      const entries = visible.filter((source) => sourceMediaGroup(source) === group);
      return entries.length > 0 && <details className="source-group" key={group} open>
        <summary>{group}<span>{entries.length}</span></summary>
        <div className="source-grid">{entries.map((source) => <Fragment key={source.id}>{renderSource(source, expanded.has(source.id), () => toggle(source.id))}</Fragment>)}</div>
      </details>;
    })}
    {visible.length === 0 && <div className="source-filter-empty"><p>No sources match these filters.</p><button className="secondary-button" onClick={() => { setMedia("all"); setStatus("all"); setQuery(""); }}>Clear filters</button></div>}
  </section>;
}
