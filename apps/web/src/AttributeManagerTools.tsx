import { Search, X } from "lucide-react";
import { useState } from "react";
import { filterAttributes, type AttributeSearchScope, type AttributeSort, type AttributeUsage, type SearchableAttribute } from "./attribute-search";

export function useAttributeList<T extends SearchableAttribute>(entries: T[], count: (entry: T) => number) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<AttributeSearchScope>("all");
  const [usage, setUsage] = useState<AttributeUsage>("all");
  const [sort, setSort] = useState<AttributeSort>("name");
  const filtered = filterAttributes(entries, { query, scope, usage, sort }, count);
  const tools = <div className="attribute-manager-tools">
    <label className="attribute-manager-search"><span>Search attributes</span><div><Search size={17} /><input type="search" aria-label="Search attributes" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search names or matching patterns" />{query && <button className="icon-button" type="button" aria-label="Clear attribute search" onClick={() => setQuery("")}><X size={16} /></button>}</div></label>
    <label><span>Search in</span><select value={scope} onChange={(event) => setScope(event.target.value as AttributeSearchScope)}><option value="all">Names & patterns</option><option value="name">Names only</option><option value="patterns">Patterns only</option></select></label>
    <label><span>Show</span><select value={usage} onChange={(event) => setUsage(event.target.value as AttributeUsage)}><option value="all">All attributes</option><option value="used">Used attributes</option><option value="unused">Unused attributes</option><option value="patterns">With patterns</option></select></label>
    <label><span>Sort by</span><select value={sort} onChange={(event) => setSort(event.target.value as AttributeSort)}><option value="name">Name A–Z</option><option value="name-desc">Name Z–A</option><option value="usage">Most used</option><option value="patterns">Most patterns</option></select></label>
    <p className="attribute-manager-count" role="status">{filtered.length} of {entries.length} attributes</p>
  </div>;
  return { filtered, tools };
}

export function AttributePatternSummary({ patterns = [] }: { patterns?: string[] }) {
  if (!patterns.length) return <span className="attribute-pattern-summary">No alternative patterns</span>;
  return <span className="attribute-pattern-summary" title={patterns.join(" · ")}>Patterns: {patterns.slice(0, 3).join(" · ")}{patterns.length > 3 ? ` · +${patterns.length - 3} more` : ""}</span>;
}
