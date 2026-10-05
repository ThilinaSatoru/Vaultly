import { withAttributePatterns } from "./attribute-routes.js";
import { database } from "./database.js";
import { normalizeMetadataPhrase } from "./filename-metadata.js";
import { substringFilter } from "./search-index.js";

/** Read definitions once per query; aliases apply to the media assigned to them. */
export function gallerySearchFilters(query: string) {
  const definitions = (["tags", "categories", "people"] as const).map((kind) => ({
    kind,
    entries: withAttributePatterns(kind, database.prepare(`SELECT id, name FROM ${kind}`).all() as Array<{ id: number; name: string }>)
      .map((entry) => ({ id: entry.id, phrases: [entry.name, ...entry.patterns].map(normalizeMetadataPhrase) })),
  }));
  return query.split(/\s+/).filter(Boolean).map((token) => {
    const text = substringFilter(token, ["title", "relative_path"]);
    const normalized = normalizeMetadataPhrase(token);
    const candidates: string[] = [];
    const values: string[] = [];
    for (const { kind, entries } of definitions) {
      const ids = normalized ? entries.filter((entry) => entry.phrases.some((phrase) => phrase.includes(normalized))).map((entry) => entry.id) : [];
      if (!ids.length) continue;
      const table = kind === "people" ? "item_people" : `effective_item_${kind}`;
      const column = kind === "people" ? "person_id" : kind === "tags" ? "tag_id" : "category_id";
      candidates.push(`SELECT item_id FROM ${table} WHERE ${column} IN (SELECT value FROM json_each(?))`);
      values.push(JSON.stringify(ids));
    }
    if (!candidates.length) return text;
    // Union candidate IDs before filtering/sorting the gallery, keeping the
    // existing trigram path fast and avoiding a correlated check per media row.
    return {
      sql: `m.id IN (SELECT search_match.id FROM media_items search_match WHERE ${text.sql.replaceAll("m.", "search_match.")} UNION ${candidates.join(" UNION ")})`,
      values: [...text.values, ...values],
      indexed: true,
    };
  });
}
