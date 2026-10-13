export interface SearchableAttribute { id: number; name: string; patterns?: string[] }
export type AttributeSearchScope = "all" | "name" | "patterns";
export type AttributeUsage = "all" | "used" | "unused" | "patterns";
export type AttributeSort = "name" | "name-desc" | "usage" | "patterns";
const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function normalize(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

export function matchesAttribute(entry: SearchableAttribute, query: string, scope: AttributeSearchScope = "all") {
  const tokens = normalize(query).split(" ").filter(Boolean);
  return matchesTokens(entry, tokens, scope);
}

function matchesTokens(entry: SearchableAttribute, tokens: string[], scope: AttributeSearchScope) {
  if (!tokens.length) return true;
  const fields = scope === "name" ? [entry.name] : scope === "patterns" ? entry.patterns ?? [] : [entry.name, ...(entry.patterns ?? [])];
  const searchable = fields.map(normalize).join(" ");
  return tokens.every((token) => searchable.includes(token));
}

export function searchAttributes<T extends SearchableAttribute>(entries: T[], query: string, scope: AttributeSearchScope = "all"): T[] {
  const tokens = normalize(query).split(" ").filter(Boolean);
  return entries.filter((entry) => matchesTokens(entry, tokens, scope));
}

export function filterAttributes<T extends SearchableAttribute>(entries: T[], options: {
  query: string; scope: AttributeSearchScope; usage: AttributeUsage; sort: AttributeSort;
}, count: (entry: T) => number): T[] {
  const tokens = normalize(options.query).split(" ").filter(Boolean);
  const byName = (a: T, b: T) => nameCollator.compare(a.name, b.name) || a.id - b.id;
  return entries.filter((entry) => matchesTokens(entry, tokens, options.scope)
    && (options.usage === "all" || (options.usage === "used" ? count(entry) > 0
      : options.usage === "unused" ? count(entry) === 0 : Boolean(entry.patterns?.length))))
    .sort((a, b) => options.sort === "usage" ? count(b) - count(a) || byName(a, b)
      : options.sort === "patterns" ? (b.patterns?.length ?? 0) - (a.patterns?.length ?? 0) || byName(a, b)
      : options.sort === "name-desc" ? -byName(a, b) : byName(a, b));
}
