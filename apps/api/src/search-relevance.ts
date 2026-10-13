import { normalizeMetadataPhrase } from "./filename-metadata.js";
import { parsedSearchTerms } from "./advanced-search.js";

export function mediaSearchRelevance(query: string, title: string, filename: string, relativePath: string): number {
  const text = normalizeMetadataPhrase(parsedSearchTerms(query).map((term) => term.text).join(" "));
  if (!text) return 0;
  const name = normalizeMetadataPhrase(title);
  const fields = [filename, filename.replace(/\.[^.\\/]+$/, ""), relativePath].map(normalizeMetadataPhrase);
  if (name === text) return 0;
  if (fields.includes(text)) return 1;
  if ([name, ...fields].some((field) => field.includes(text))) return 2;
  const literal = [name, ...fields].join(" ");
  return text.split(" ").every((token) => literal.includes(token)) ? 3 : 4;
}
