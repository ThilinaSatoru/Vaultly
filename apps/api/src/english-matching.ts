import winkNLP, { type ItsFunction } from "wink-nlp";
import model from "wink-eng-lite-web-model";

// Bundled statistical English model. Only POS/lemmatization is needed; no
// generative model, network service, vectors, or runtime downloads are used.
const nlp = winkNLP(model, ["pos"]);
export const englishMatchingVersion = 2;

// Deliberately bounded equivalence groups, rather than loosely related topics.
// Keep these separate from user-defined attribute aliases. Increment the index
// version whenever normalization or this dictionary changes.
export const englishSynonymGroups: readonly (readonly string[])[] = [
  ["movie", "film"], ["photo", "photograph", "picture"], ["image", "illustration"],
  ["story", "tale", "narrative"], ["drawing", "sketch"],
  ["holiday", "vacation"], ["trip", "journey"], ["car", "automobile", "auto"],
  ["bike", "bicycle"], ["plane", "airplane", "aeroplane"], ["boat", "vessel"],
  ["dog", "canine"], ["cat", "feline"], ["rabbit", "bunny"],
  ["child", "kid"], ["baby", "infant"], ["woman", "lady"],
  ["house", "home"], ["forest", "woodland"], ["sea", "ocean"],
  ["road", "street"], ["city", "town"], ["shop", "store"],
  ["job", "occupation"], ["gift", "present"], ["start", "begin"],
  ["finish", "complete"], ["buy", "purchase"], ["speak", "talk"],
  ["laugh", "chuckle"], ["cry", "weep"], ["fight", "battle"],
  ["quick", "fast", "rapid"], ["slow", "sluggish"], ["big", "large", "huge"],
  ["small", "little", "tiny"], ["happy", "joyful", "glad"], ["sad", "unhappy", "sorrowful"],
  ["beautiful", "pretty", "lovely"], ["scary", "frightening", "terrifying"],
  ["funny", "humorous", "comical"], ["quiet", "silent"], ["angry", "furious"],
  ["smart", "clever", "intelligent"], ["rich", "wealthy"], ["poor", "impoverished"],
];
const synonyms = new Map<string, string>();
for (const group of englishSynonymGroups) for (const word of group) synonyms.set(word, group[0]);
const cache = new Map<string, string>();

export function englishText(value: string): string {
  const normalized = value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  const existing = cache.get(normalized);
  if (existing !== undefined) return existing;
  // The library's lemma declaration uses an addon argument rather than the
  // generic signature expected by its public token-output overload.
  const tokens = nlp.readDoc(normalized).tokens().out(nlp.its.lemma as unknown as ItsFunction<string>);
  const result = tokens.map((word) => synonyms.get(word) ?? word).join(" ");
  if (cache.size >= 4096) cache.delete(cache.keys().next().value!);
  cache.set(normalized, result);
  return result;
}

export function englishMatch(value: string, columns: Array<"title" | "filename"> = ["title", "filename"]): string {
  const words = englishText(value).split(" ").filter(Boolean);
  return words.length ? `{${columns.join(" ")}} : (${words.map((word) => `"${word}"`).join(" AND ")})` : "";
}
