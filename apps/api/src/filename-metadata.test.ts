import { expect, test } from "vitest";
import { AttributeNameMatcher, FilenameMetadataMatcher } from "./filename-metadata.js";

test("matches complete metadata names in filenames without using the extension", () => {
  const matcher = new FilenameMetadataMatcher([
    { id: 1, name: "Sci-Fi" },
    { id: 2, name: "Jane Doe" },
    { id: 3, name: "Planet" },
    { id: 4, name: "PDF" },
    { id: 5, name: "A" },
  ]);
  expect(matcher.match("Blue.Planet_[Sci-Fi] (Jane Doe).pdf", "pdf").map((entry) => entry.id))
    .toEqual([3, 1, 2]);
  expect(matcher.match("Planetary-Jane.pdf", "pdf")).toEqual([]);
});

test("normalizes accents and keeps image-folder names intact", () => {
  const matcher = new FilenameMetadataMatcher([{ id: 7, name: "José Álvarez" }, { id: 8, name: "Volume 2" }]);
  expect(matcher.match("Jose Alvarez - Volume 2", "").map((entry) => entry.id)).toEqual([7, 8]);
  expect(matcher.match("Issue 01.cbz", "cbz")).toEqual([]);
});

test("matches optional synonyms to the canonical entry once, using complete phrases", () => {
  const entry = { id: 1, name: "Science fiction", patterns: ["Sci-Fi", "SF", "science.fiction", "Sci fi"] };
  const matcher = new FilenameMetadataMatcher([entry, { id: 2, name: "Jane Doe", patterns: ["J. Doe"] }]);
  expect(matcher.match("SF - Sci_Fi - Science Fiction - J Doe.pdf", "pdf")).toEqual([entry, { id: 2, name: "Jane Doe", patterns: ["J. Doe"] }]);
  expect(matcher.match("Scifi.pdf", "pdf")).toEqual([entry]);
  expect(matcher.match("SFish - Scifish - Jane.pdf", "pdf")).toEqual([]);
  expect(matcher.match("unrelated.sf", "sf")).toEqual([]);
});

test("multiword names and aliases match any order, separated or joined, with whole-word boundaries", () => {
  const name = { id: 1, name: "Jane Mary Doe" };
  const alias = { id: 2, name: "Canonical", patterns: ["red blue green"] };
  const matcher = new FilenameMetadataMatcher([name, alias]);
  for (const filename of ["Doe Jane Mary", "Mary-Doe_Jane", "JaneMaryDoe", "DoeMaryJane", "MaryJaneDoe"]) {
    expect(matcher.match(`Book ${filename}.pdf`, "pdf")).toEqual([name]);
  }
  for (const filename of ["green red blue", "blue.green.red", "GreenBlueRed", "redgreenblue"]) {
    expect(matcher.match(`${filename}.pdf`, "pdf")).toEqual([alias]);
  }
  expect(matcher.match("JaneMaryDoesh - Jane something Mary Doe - red blue - bluegreenredder.pdf", "pdf")).toEqual([]);
  expect(matcher.match("JaneMaryDoe - Doe Jane Mary - MaryDoeJane.pdf", "pdf")).toEqual([name]);
  expect(matcher.match("unrelated.JaneMaryDoe", "JaneMaryDoe")).toEqual([]);
});

test("joined matching handles repeated words and ambiguous word prefixes without losing word counts", () => {
  const repeated = { id: 1, name: "go go home" };
  const prefixes = { id: 2, name: "a ab bc" };
  const matcher = new FilenameMetadataMatcher([repeated, prefixes]);
  expect(matcher.match("home go go.pdf", "pdf")).toEqual([repeated]);
  expect(matcher.match("gohomego.pdf", "pdf")).toEqual([repeated]);
  expect(matcher.match("go home home - gogohomesh.pdf", "pdf")).toEqual([]);
  expect(matcher.match("ababc.pdf", "pdf")).toEqual([prefixes]);
});

test("explicit metadata accepts reordered and joined names and aliases while requiring the entire value", () => {
  const name = { id: 1, name: "José Álvarez" };
  const alias = { id: 2, name: "Canonical", patterns: ["red blue green"] };
  const matcher = new AttributeNameMatcher([name, alias]);
  expect(matcher.match("Alvarez Jose")).toEqual([name]);
  expect(matcher.match("ÁlvarezJosé")).toEqual([name]);
  expect(matcher.match("green blue red")).toEqual([alias]);
  expect(matcher.match("bluegreenred")).toEqual([alias]);
  expect(matcher.match("extra Alvarez Jose")).toEqual([]);
  expect(matcher.match("bluegreenreddish")).toEqual([]);
  matcher.add({ id: 3, name: "Mary Jane Doe" });
  expect(matcher.match("DoeJaneMary").map((entry) => entry.id)).toEqual([3]);
});

test("explicit metadata matches complete names and aliases, preserving qualifiers and preferring names", () => {
  const male = { id: 1, name: "Muscle (male)", patterns: ["male muscles"] };
  const female = { id: 2, name: "Muscle (female)", patterns: ["female muscles", "male muscles"] };
  const canonical = { id: 3, name: "male muscles" };
  const matcher = new AttributeNameMatcher([male, female, canonical, { id: 4, name: "Muscle" }, { id: 5, name: "José", patterns: ["J"] }]);
  expect(matcher.match("MUSCLE (MALE)")).toEqual([male]);
  expect(matcher.match("female muscles")).toEqual([female]);
  expect(matcher.match("male muscles")).toEqual([canonical]);
  expect(matcher.match("muscle (other)")).toEqual([]);
  expect(matcher.match("j").map((entry) => entry.id)).toEqual([5]);
  expect(matcher.match("Jose").map((entry) => entry.id)).toEqual([5]);
  matcher.add({ id: 6, name: "Zoë" });
  expect(matcher.match("ZOË").map((entry) => entry.id)).toEqual([6]);
});
