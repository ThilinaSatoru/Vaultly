import { normalizeMetadataFilename, normalizeMetadataPhrase } from "./filename-metadata.js";

interface Person { id: number; name: string; patterns?: string[] }
interface Node<T> { children: Map<string, Node<T>>; people?: Map<number, T> }

/** People require ordered complete names or unambiguous explicit aliases. */
export class PeopleMatcher<T extends Person> {
  private readonly root: Node<T> = { children: new Map() };
  private readonly names = new Map<string, Map<number, T>>();
  private readonly aliases = new Map<string, Map<number, T>>();
  constructor(entries: T[]) { for (const entry of entries) this.add(entry); }
  add(entry: T) {
    const name = normalizeMetadataPhrase(entry.name);
    const words = name.split(" ");
    for (const [values, index] of [[[name], this.names], [entry.patterns ?? [], this.aliases]] as const) {
      for (const raw of values) {
        const phrase = normalizeMetadataPhrase(raw);
        if (!phrase || phrase.length < 2) continue;
        // First/last-name aliases of a multiword person are not identifying names.
        if (index === this.aliases && words.length > 1 && !phrase.includes(" ") && words.includes(phrase)) continue;
        const people = index.get(phrase) ?? new Map<number, T>();
        people.set(entry.id, entry); index.set(phrase, people);
        let node = this.root;
        for (const word of phrase.split(" ")) {
          let child = node.children.get(word);
          if (!child) { child = { children: new Map() }; node.children.set(word, child); }
          node = child;
        }
        // Names take priority over aliases; colliding names/aliases stay ambiguous.
        node.people = this.names.get(phrase) ?? this.aliases.get(phrase);
      }
    }
  }
  matchValue(value: string): T[] {
    const phrase = normalizeMetadataPhrase(value);
    const people = this.names.get(phrase) ?? this.aliases.get(phrase);
    return people?.size === 1 ? [...people.values()] : [];
  }
  match(filename: string, extension: string): T[] { return this.matchNormalized(normalizeMetadataFilename(filename, extension)); }
  matchNormalized(value: string): T[] {
    const words = value.split(" ");
    const hits: Array<{ start: number; end: number; people: Map<number, T> }> = [];
    for (let start = 0; start < words.length; start++) {
      let node = this.root;
      for (let end = start; end < words.length; end++) {
        const child = node.children.get(words[end]);
        if (!child) break;
        node = child;
        if (node.people) hits.push({ start, end, people: node.people });
      }
    }
    const found = new Map<number, T>();
    for (const hit of hits) {
      if (hit.people.size !== 1 || hits.some((other) => other !== hit && other.start <= hit.start && other.end >= hit.end && other.end - other.start > hit.end - hit.start)) continue;
      for (const person of hit.people.values()) found.set(person.id, person);
    }
    return [...found.values()];
  }
}
