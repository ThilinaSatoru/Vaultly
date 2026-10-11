import { englishMatch } from "./english-matching.js";
import { parsedSearchTerms } from "./advanced-search.js";
import { substringFilter } from "./search-index.js";

export function englishSearchFilters(query: string, columns: Array<"title" | "filename"> = ["title", "filename"]) {
  return parsedSearchTerms(query).map(({ text, quoted }) => {
    const literal = substringFilter(text, columns);
    const match = quoted ? "" : englishMatch(text, columns);
    if (!match) return literal;
    return {
      sql: `(${literal.sql} OR m.id IN (SELECT rowid FROM media_english WHERE media_english MATCH ?))`,
      values: [...literal.values, match], indexed: true,
    };
  });
}
