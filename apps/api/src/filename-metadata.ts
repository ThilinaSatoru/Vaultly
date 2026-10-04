interface NamedEntry { id: number; name: string; patterns?: string[] }

export function normalizeMetadataPhrase(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "")
    .toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

export function normalizeMetadataFilename(filename: string, extension: string): string {
  const suffix = extension ? `.${extension}` : "";
  const baseName = suffix && filename.toLocaleLowerCase().endsWith(suffix.toLocaleLowerCase())
    ? filename.slice(0, -suffix.length) : filename;
  return normalizeMetadataPhrase(baseName);
}

/** Match complete words or phrases, not arbitrary substrings or file extensions. */
export class FilenameMetadataMatcher<T extends NamedEntry> {
  private readonly byFirstWord = new Map<string, Array<{ entry: T; phrase: string }>>();

  constructor(entries: T[]) {
    for (const entry of entries) {
      for (const phrase of new Set([entry.name, ...(entry.patterns ?? [])].map(normalizeMetadataPhrase))) {
        if (phrase.length < 2) continue;
        const firstWord = phrase.split(" ", 1)[0];
        const candidates = this.byFirstWord.get(firstWord) ?? [];
        candidates.push({ entry, phrase });
        this.byFirstWord.set(firstWord, candidates);
      }
    }
  }

  match(filename: string, extension: string): T[] {
    return this.matchNormalized(normalizeMetadataFilename(filename, extension));
  }

  matchNormalized(normalized: string): T[] {
    if (!normalized) return [];
    const padded = ` ${normalized} `;
    const matches: T[] = [];
    const matchedIds = new Set<number>();
    for (const word of new Set(normalized.split(" "))) {
      for (const candidate of this.byFirstWord.get(word) ?? []) {
        if (!matchedIds.has(candidate.entry.id) && padded.includes(` ${candidate.phrase} `)) {
          matchedIds.add(candidate.entry.id);
          matches.push(candidate.entry);
        }
      }
    }
    return matches;
  }
}
