interface NamedEntry { id: number; name: string }

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "")
    .toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

/** Match complete words or phrases, not arbitrary substrings or file extensions. */
export class FilenameMetadataMatcher<T extends NamedEntry> {
  private readonly byFirstWord = new Map<string, Array<{ entry: T; phrase: string }>>();

  constructor(entries: T[]) {
    for (const entry of entries) {
      const phrase = normalize(entry.name);
      if (phrase.length < 2) continue;
      const firstWord = phrase.split(" ", 1)[0];
      const candidates = this.byFirstWord.get(firstWord) ?? [];
      candidates.push({ entry, phrase });
      this.byFirstWord.set(firstWord, candidates);
    }
  }

  match(filename: string, extension: string): T[] {
    const suffix = extension ? `.${extension}` : "";
    const baseName = suffix && filename.toLocaleLowerCase().endsWith(suffix.toLocaleLowerCase())
      ? filename.slice(0, -suffix.length) : filename;
    const normalized = normalize(baseName);
    if (!normalized) return [];
    const padded = ` ${normalized} `;
    const matches: T[] = [];
    for (const word of new Set(normalized.split(" "))) {
      for (const candidate of this.byFirstWord.get(word) ?? []) {
        if (padded.includes(` ${candidate.phrase} `)) matches.push(candidate.entry);
      }
    }
    return matches;
  }
}
