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

/** Explicit metadata values match a whole name or alias, rather than a phrase inside a filename. */
export class AttributeNameMatcher<T extends NamedEntry> {
  private readonly names = new Map<string, Map<number, T>>();
  private readonly patterns = new Map<string, Map<number, T>>();

  constructor(entries: T[]) { for (const entry of entries) this.add(entry); }

  add(entry: T) {
    for (const [target, values] of [[this.names, [entry.name]], [this.patterns, entry.patterns ?? []]] as const) {
      for (const value of values) {
        const key = normalizeMetadataPhrase(value);
        if (!key) continue;
        const matches = target.get(key) ?? new Map<number, T>();
        matches.set(entry.id, entry);
        target.set(key, matches);
      }
    }
  }

  match(value: string): T[] {
    const key = normalizeMetadataPhrase(value);
    return [...(this.names.get(key) ?? this.patterns.get(key) ?? new Map<number, T>()).values()];
  }
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
