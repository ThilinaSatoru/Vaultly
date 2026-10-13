import { Select } from "./Select";
import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { filterAttributes, type AttributeSearchScope, type AttributeSort, type AttributeUsage, type SearchableAttribute } from "./attribute-search";

export function useAttributeList<T extends SearchableAttribute>(entries: T[], count: (entry: T) => number) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<AttributeSearchScope>("all");
  const [usage, setUsage] = useState<AttributeUsage>("all");
  const [sort, setSort] = useState<AttributeSort>("name");
  const [requestedPage, setPage] = useState(1);
  const filtered = useMemo(() => filterAttributes(entries, { query, scope, usage, sort }, count), [entries, query, scope, usage, sort, count]);
  const pageSize = 100;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(requestedPage, pages);
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const pagination = pages > 1 ? <nav className="pagination" aria-label="Attribute pages">
    <button type="button" className="secondary-button" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
    <span role="status">Page {page} of {pages} · {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}</span>
    <button type="button" className="secondary-button" disabled={page === pages} onClick={() => setPage(page + 1)}>Next</button>
  </nav> : null;
  const tools = <div className="attribute-manager-tools">
    <label className="attribute-manager-search"><span>Search attributes</span><div><Search size={17} /><input type="search" aria-label="Search attributes" value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} placeholder="Search names or matching patterns" />{query && <button className="icon-button" type="button" aria-label="Clear attribute search" onClick={() => { setPage(1); setQuery(""); }}><X size={16} /></button>}</div></label>
    <label><span>Search in</span><Select value={scope} onChange={(event) => { setPage(1); setScope(event.target.value as AttributeSearchScope); }}><option value="all">Names & patterns</option><option value="name">Names only</option><option value="patterns">Patterns only</option></Select></label>
    <label><span>Show</span><Select value={usage} onChange={(event) => { setPage(1); setUsage(event.target.value as AttributeUsage); }}><option value="all">All attributes</option><option value="used">Used attributes</option><option value="unused">Unused attributes</option><option value="patterns">With patterns</option></Select></label>
    <label><span>Sort by</span><Select value={sort} onChange={(event) => { setPage(1); setSort(event.target.value as AttributeSort); }}><option value="name">Name A–Z</option><option value="name-desc">Name Z–A</option><option value="usage">Most used</option><option value="patterns">Most patterns</option></Select></label>
    <p className="attribute-manager-count" role="status">{filtered.length} of {entries.length} attributes</p>
  </div>;
  return { filtered, visible, tools, pagination };
}

export function AttributePatternSummary({ patterns = [] }: { patterns?: string[] }) {
  if (!patterns.length) return <span className="attribute-pattern-summary">No alternative patterns</span>;
  return <span className="attribute-pattern-summary" title={patterns.join(" · ")}>Patterns: {patterns.slice(0, 3).join(" · ")}{patterns.length > 3 ? ` · +${patterns.length - 3} more` : ""}</span>;
}
