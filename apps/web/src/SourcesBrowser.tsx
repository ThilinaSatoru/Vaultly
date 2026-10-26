import { ClearableInput } from "./ClearableField";
import { Select } from "./Select";
import { rankSearchResults } from "./search-relevance";
import { Fragment, type ReactNode, useMemo } from "react";
import { useUiState } from "./ui-state";
import { vaultStorage } from "./vault-session";
import { Folder, HardDrive, Search } from "lucide-react";

const sourceLabels: Record<string, string> = { movies: "Movies", tv: "TV series", anime: "Anime", manga: "Manga", ebooks: "E-books", pictures: "Pictures", music: "Music" };
interface SourceSummary {
  media_type?: string;
  id: number; name: string; root_path: string; comic_count: number; video_count: number; story_count: number;
  item_count: number; status: string; path_available: boolean;
  enabled?: number; music_count?: number;
}
type MediaFilter = "all" | "comic" | "video" | "story" | "mixed" | "music";
export function sourceMediaGroup(source: SourceSummary) {
  if (source.media_type && sourceLabels[source.media_type]) return sourceLabels[source.media_type];
  const types = [source.comic_count, source.video_count, source.story_count].filter((count) => count > 0).length;
  return types > 1 ? "Mixed media" : source.video_count > 0 ? "Videos" : source.comic_count > 0 ? "Comics" : source.story_count > 0 ? "Stories" : "No indexed media";
}
export function matchesSource(source: SourceSummary, media: MediaFilter, status: string, query: string) {
  const text = query.trim().toLocaleLowerCase();
  const matchesText = !text || `${source.name} ${source.root_path}`.toLocaleLowerCase().includes(text);
  const matchesStatus = status === "all" || (status === "disabled" ? source.enabled === 0 : source.enabled !== 0 && (status === "unavailable" ? !source.path_available : source.path_available && source.status === status));
  const matchesMedia = media === "all" || (media === "mixed" ? sourceMediaGroup(source) === "Mixed media" : (source[`${media}_count`] ?? 0) > 0);
  return matchesText && matchesStatus && matchesMedia;
}

export interface SourceTreeNode<T> { key: string; label: string; children: SourceTreeNode<T>[]; sources: T[] }
export function buildSourceTree<T extends SourceSummary>(sources: T[]): SourceTreeNode<T>[] {
  const roots: SourceTreeNode<T>[] = [];
  for (const source of sources) {
    const normalized = source.root_path.replace(/\\/g, "/");
    const windows = /^[a-z]:/i.test(normalized) || normalized.startsWith("//");
    const parts = normalized.split("/").filter(Boolean);
    const root = normalized.startsWith("//") ? `//${parts.splice(0, 2).join("/")}` : /^[a-z]:/i.test(normalized) ? parts.shift()!.toUpperCase() + "/" : normalized.startsWith("/") ? "/" : "Relative paths";
    let siblings = roots;
    let key = "";
    let leaf: SourceTreeNode<T> | undefined;
    for (const label of [root, ...parts]) {
      key += `/${windows ? label.toLowerCase() : label}`;
      let node = siblings.find((entry) => entry.key === key);
      if (!node) { node = { key, label, children: [], sources: [] }; siblings.push(node); }
      leaf = node;
      siblings = node.children;
    }
    leaf!.sources.push(source);
  }
  const sort = (nodes: SourceTreeNode<T>[]) => {
    nodes.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    for (const node of nodes) { node.sources.sort((a, b) => a.name.localeCompare(b.name)); sort(node.children); }
  };
  sort(roots);
  return roots;
}

/** Merge chains of folders that only lead to one child folder ("C:/ › Users › Me") into a single row. */
export function compactSourceTree<T>(nodes: SourceTreeNode<T>[]): SourceTreeNode<T>[] {
  return nodes.map((node) => {
    let { key, label, children, sources } = node;
    while (sources.length === 0 && children.length === 1) {
      label = `${label} › ${children[0].label}`;
      ({ key, children, sources } = children[0]);
    }
    return { key, label, sources, children: compactSourceTree(children) };
  });
}

const flattenBranches = <T,>(nodes: SourceTreeNode<T>[]): SourceTreeNode<T>[] => nodes.flatMap((node) => [node, ...flattenBranches(node.children)]);
const branchSources = <T,>(node: SourceTreeNode<T>): T[] => [...node.sources, ...node.children.flatMap(branchSources)];
/** A branch is disconnected when every source beneath it has an unavailable folder. */
export const isBranchDisconnected = <T extends SourceSummary>(node: SourceTreeNode<T>) => { const all = branchSources(node); return all.length > 0 && all.every((source) => !source.path_available); };

/** Reset the persisted source filters (used when the management drawer is closed). */
export function clearSourceFilters() {
  for (const [key, value] of [["query", ""], ["media", "all"], ["status", "all"], ["category", "all"]] as const) vaultStorage.setItem(`vaultly.ui.sources.${key}`, JSON.stringify(value));
}

export function SourcesBrowser<T extends SourceSummary>({ sources, renderSource }: {
  sources: T[]; renderSource: (source: T, expanded: boolean, toggle: () => void) => ReactNode;
}) {
  const [query, setQuery] = useUiState("vaultly.ui.sources.query", "");
  const [media, setMedia] = useUiState<MediaFilter>("vaultly.ui.sources.media", "all");
  const [status, setStatus] = useUiState("vaultly.ui.sources.status", "all");
  const [category, setCategory] = useUiState("vaultly.ui.sources.category", "all");
  // Explicit open/closed choices per folder; folders never chosen follow their connection state.
  const [branches, setBranches] = useUiState<Record<string, boolean>>("vaultly.ui.sources.branches", {});
  const [expanded, setExpanded] = useUiState<number[]>("vaultly.ui.sources.expanded", []);
  const visible = useMemo(() => rankSearchResults(sources.filter((source) => matchesSource(source, media, status, query) && (category === "all" || sourceMediaGroup(source) === category)), query, (source) => [source.name, source.root_path]), [sources, media, status, query, category]);
  const tree = useMemo(() => compactSourceTree(buildSourceTree(visible)), [visible]);
  const branchOpen = (node: SourceTreeNode<T>) => branches[node.key] ?? !isBranchDisconnected(node);
  const setAllBranches = (open: boolean | ((node: SourceTreeNode<T>) => boolean)) => setBranches(Object.fromEntries(flattenBranches(tree).map((node) => [node.key, typeof open === "boolean" ? open : open(node)])));
  const categories = [...new Set(sources.map(sourceMediaGroup))].sort();
  const renderBranch = (node: SourceTreeNode<T>, depth: number): ReactNode => <li key={node.key}>
    <details className="source-tree-branch" open={branchOpen(node)} onToggle={(event) => { const open = event.currentTarget.open; if (open !== branchOpen(node)) setBranches((current) => ({ ...current, [node.key]: open })); }}>
      <summary>{depth === 0 ? <HardDrive size={16} /> : <Folder size={15} />}<span title={node.label}>{node.label}</span>
        {isBranchDisconnected(node) && <em className="source-branch-flag">Disconnected</em>}<small className="source-branch-count">{branchSources(node).length}</small></summary>
      {node.sources.map((source) => <Fragment key={source.id}>{renderSource(source, expanded.includes(source.id), () => toggle(source.id))}</Fragment>)}
      {node.children.length > 0 && <ul>{node.children.map((child) => renderBranch(child, depth + 1))}</ul>}
    </details>
  </li>;
  const filters: Array<{ value: MediaFilter; label: string }> = [{ value: "all", label: "All" }, { value: "comic", label: "Comics" }, { value: "video", label: "Videos" }, { value: "story", label: "Stories" }, { value: "music", label: "Music" }, { value: "mixed", label: "Mixed" }];
  const toggle = (id: number) => setExpanded((current) => {
    return current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
  });
  return <section className="sources-browser" aria-label="Browse sources">
    <div className="source-filter-tools">
      <label className="source-search"><Search size={16} /><ClearableInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find folder or path…" aria-label="Search sources" /></label>
      <Select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter sources by status">
        <option value="all">All statuses</option><option value="ready">Ready</option><option value="scanning">Scanning</option><option value="disabled">Disabled</option><option value="unavailable">Unavailable</option><option value="error">Errors</option><option value="idle">Not scanned</option>
      </Select>
      <Select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter sources by source type"><option value="all">All source types</option>{categories.map((name) => <option key={name} value={name}>{name}</option>)}</Select>
    </div>
    <div className="source-media-filters" role="group" aria-label="Filter sources by media type">
      {filters.map((filter) => <button key={filter.value} type="button" aria-pressed={media === filter.value} onClick={() => setMedia(filter.value)}>
        {filter.label}<span>{sources.filter((source) => matchesSource(source, filter.value, status, query) && (category === "all" || sourceMediaGroup(source) === category)).length}</span>
      </button>)}
    </div>
    <div className="source-list-tools"><span>{visible.length} / {sources.length} sources</span><div>
      <button type="button" onClick={() => setAllBranches(true)}>Expand all</button>
      <button type="button" onClick={() => { setAllBranches(false); setExpanded([]); }}>Collapse all</button>
      <button type="button" onClick={() => setAllBranches((node) => !isBranchDisconnected(node) && branchOpen(node))} disabled={!flattenBranches(tree).some(isBranchDisconnected)}>Collapse disconnected</button>
      <button type="button" onClick={() => setExpanded([])} disabled={expanded.length === 0}>Collapse cards</button>
    </div></div>
    {query.trim() ? <div className="source-search-results">{visible.map((source) => <Fragment key={source.id}>{renderSource(source, expanded.includes(source.id), () => toggle(source.id))}</Fragment>)}</div> : <ul className="source-tree">{tree.map((node) => renderBranch(node, 0))}</ul>}
    {visible.length === 0 && <div className="source-filter-empty"><p>No sources match these filters.</p><button className="secondary-button" onClick={() => { setMedia("all"); setCategory("all"); setStatus("all"); setQuery(""); }}>Clear filters</button></div>}
  </section>;
}
