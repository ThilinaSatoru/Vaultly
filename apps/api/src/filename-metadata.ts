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

class MatchingPhrase {
  readonly words: string[];
  readonly signature: string;
  readonly joinedLength: number;

  constructor(readonly phrase: string) {
    this.words = phrase.split(" ");
    this.signature = [...this.words].sort().join(" ");
    this.joinedLength = this.words.join("").length;
  }

  matches(words: string[]): boolean {
    if (words.length === this.words.length && [...words].sort().join(" ") === this.signature) return true;
    if (words.length !== 1 || words[0].length !== this.joinedLength) return false;
    // Consume each word once, without generating every possible permutation.
    const counts = new Map<string, number>();
    for (const word of this.words) counts.set(word, (counts.get(word) ?? 0) + 1);
    const unique = [...counts.keys()];
    const remaining = unique.map((word) => counts.get(word)!);
    const failed = new Set<string>();
    const consume = (offset: number): boolean => {
      if (offset === words[0].length) return remaining.every((count) => count === 0);
      const key = `${offset}:${remaining.join(",")}`;
      if (failed.has(key)) return false;
      for (let i = 0; i < unique.length; i++) {
        if (!remaining[i] || !words[0].startsWith(unique[i], offset)) continue;
        remaining[i]--;
        const matched = consume(offset + unique[i].length);
        remaining[i]++;
        if (matched) return true;
      }
      failed.add(key);
      return false;
    };
    return consume(0);
  }
}

/** Explicit metadata values match a whole name or alias, rather than a phrase inside a filename. */
export class AttributeNameMatcher<T extends NamedEntry> {
  private readonly names = new Map<string, Map<number, T>>();
  private readonly patterns = new Map<string, Map<number, T>>();
  private readonly flexibleNames = new FilenameMetadataMatcher<T>([]);
  private readonly flexiblePatterns = new FilenameMetadataMatcher<T>([]);

  constructor(entries: T[]) { for (const entry of entries) this.add(entry); }

  add(entry: T) {
    this.flexibleNames.add(entry, [entry.name]);
    this.flexiblePatterns.add(entry, entry.patterns ?? []);
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
    const exact = this.names.get(key) ?? this.patterns.get(key);
    if (exact) return [...exact.values()];
    const names = this.flexibleNames.matchNormalized(key, true);
    return names.length ? names : this.flexiblePatterns.matchNormalized(key, true);
  }
}

/** Match complete words or phrases, not arbitrary substrings or file extensions. */
export class FilenameMetadataMatcher<T extends NamedEntry> {
  private readonly byFirstWord = new Map<string, Array<{ entry: T; phrase: MatchingPhrase }>>();
  private readonly byJoinedWord = new Map<string, Array<{ entry: T; phrase: MatchingPhrase }>>();

  constructor(entries: T[]) {
    for (const entry of entries) this.add(entry);
  }

  add(entry: T, values = [entry.name, ...(entry.patterns ?? [])]) {
    for (const value of new Set(values.map(normalizeMetadataPhrase))) {
      if (!value) continue;
      const phrase = new MatchingPhrase(value);
      const candidate = { entry, phrase };
      for (const word of new Set(phrase.words)) {
        const candidates = this.byFirstWord.get(word) ?? [];
        candidates.push(candidate);
        this.byFirstWord.set(word, candidates);
      }
      if (phrase.words.length > 1) {
        for (const first of new Set(phrase.words.map((word) => word[0]))) {
          const key = `${phrase.joinedLength}:${first}`;
          const candidates = this.byJoinedWord.get(key) ?? [];
          candidates.push(candidate);
          this.byJoinedWord.set(key, candidates);
        }
      }
    }
  }

  match(filename: string, extension: string): T[] {
    return this.matchNormalized(normalizeMetadataFilename(filename, extension));
  }

  matchNormalized(normalized: string, wholeValue = false): T[] {
    if (!normalized) return [];
    const words = normalized.split(" ");
    const matches: T[] = [];
    const matchedIds = new Set<number>();
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const candidates = [...(this.byFirstWord.get(word) ?? []), ...(this.byJoinedWord.get(`${word.length}:${word[0]}`) ?? [])];
      for (const candidate of candidates) {
        if (!wholeValue && candidate.phrase.phrase.length < 2) continue;
        const window = wholeValue ? words : words.slice(i, i + candidate.phrase.words.length);
        if (!matchedIds.has(candidate.entry.id) && (candidate.phrase.matches(window)
          || (!wholeValue && candidate.phrase.matches([word])))) {
          matchedIds.add(candidate.entry.id);
          matches.push(candidate.entry);
        }
      }
    }
    return matches;
  }
}
