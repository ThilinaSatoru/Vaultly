export function normalizeSearchText(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

// Keep the original order inside each tier, including when there is no query.
export function rankSearchResults<T>(entries: T[], query: string, fields: (entry: T) => string[]): T[] {
  const text = normalizeSearchText(query);
  if (!text) return entries;
  return entries.map((entry, index) => {
    const values = fields(entry).map(normalizeSearchText);
    const rank = values[0] === text ? 0 : values.slice(1).includes(text) ? 1
      : values[0]?.includes(text) ? 2 : 3;
    return { entry, index, rank };
  }).sort((a, b) => a.rank - b.rank || a.index - b.index).map(({ entry }) => entry);
}
