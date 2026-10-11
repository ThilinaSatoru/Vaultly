import type { DatabaseSync } from "node:sqlite";

export function searchTerms(query: string): string[] {
  return (query.match(/"[^"]+"|\S+/gu) ?? []).map((term) => term.replace(/^"|"$/g, ""));
}

export function parsedSearchTerms(query: string): Array<{ text: string; quoted: boolean }> {
  return (query.match(/"[^"]+"|\S+/gu) ?? []).map((value) => ({ text: value.replace(/^"|"$/g, ""), quoted: value.startsWith('"') && value.endsWith('"') }));
}

// Optimal string alignment distance also handles adjacent transpositions.
export function editDistance(a: string, b: string): number {
  const left = [...a]; const right = [...b];
  const rows = Array.from({ length: left.length + 1 }, (_, i) => [i, ...Array(right.length).fill(0)]);
  for (let j = 0; j <= right.length; j++) rows[0][j] = j;
  for (let i = 1; i <= left.length; i++) for (let j = 1; j <= right.length; j++) {
    rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + Number(left[i - 1] !== right[j - 1]));
    if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
  }
  return rows[left.length][right.length];
}

export function expandSearchTerms(db: DatabaseSync, query: string, fuzzy: boolean): string[][] {
  return parsedSearchTerms(query).map(({ text: term, quoted }) => {
    if (quoted) return [term];
    if (!fuzzy || !/^[\p{L}\p{N}]{4,40}$/u.test(term)) return [term];
    const normalized = term.toLowerCase();
    const distance = [...normalized].length >= 8 ? 2 : 1;
    const words = db.prepare("SELECT term, doc FROM media_word_vocabulary WHERE length(term) BETWEEN ? AND ?")
      .all([...normalized].length - distance, [...normalized].length + distance) as Array<{ term: string; doc: number }>;
    const matches = words.map((word) => ({ ...word, distance: editDistance(normalized, word.term) }))
      .filter((word) => word.distance > 0 && word.distance <= distance)
      .sort((a, b) => a.distance - b.distance || b.doc - a.doc || a.term.localeCompare(b.term)).slice(0, 8);
    return [term, ...matches.map((word) => word.term)];
  });
}

export function rankedMatch(groups: string[][]): string {
  // Quote all input so FTS operators and punctuation are always literal.
  return groups.flat().filter((term) => /[\p{L}\p{N}]/u.test(term)).map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
}
