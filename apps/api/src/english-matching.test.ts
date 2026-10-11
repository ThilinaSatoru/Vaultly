import { expect, test } from "vitest";
import { englishText } from "./english-matching.js";
import { EnglishFilenameMetadataMatcher } from "./filename-metadata.js";

test("embedded model matches word forms, irregular inflections, British spellings, and synonyms", () => {
  for (const [left, right] of [
    ["runs", "running"], ["ran", "run"], ["children", "child"], ["women", "woman"],
    ["stories", "story"], ["vacations", "holiday"], ["films", "movie"],
    ["colour", "color"], ["cars", "automobiles"], ["photographs", "photo"],
  ]) expect(englishText(left), `${left} / ${right}`).toBe(englishText(right));
  expect(englishText("planetary")).not.toBe(englishText("planet"));
  expect(englishText("unhappy")).not.toBe(englishText("happy"));
  expect(englishText("not happy")).not.toBe(englishText("happy"));
});

test("English attribute matching preserves complete words, qualifiers and explicit aliases", () => {
  const entries = [{ id: 1, name: "Holiday" }, { id: 2, name: "Child" }, { id: 3, name: "Muscle (male)" },
    { id: 4, name: "Science fiction", patterns: ["Sci-Fi"] }];
  const matcher = new EnglishFilenameMetadataMatcher(entries);
  expect(matcher.match("Children on vacations - Sci-Fi.pdf", "pdf").map((entry) => entry.id)).toEqual([4, 2, 1]);
  expect(matcher.match("male muscles.pdf", "pdf").map((entry) => entry.id)).toEqual([3]);
  expect(matcher.match("female muscles - childish - holidya.pdf", "pdf")).toEqual([]);
  expect(matcher.match("unrelated.holiday", "holiday")).toEqual([]);
  expect(matcher.match("Vacation - Holiday.pdf", "pdf").map((entry) => entry.id)).toEqual([1]);
});

test("ambiguous normalized attributes are not inferred; exact names take precedence", () => {
  const entries = [{ id: 1, name: "Holiday" }, { id: 2, name: "Vacation" }];
  const matcher = new EnglishFilenameMetadataMatcher(entries);
  expect(matcher.match("Vacations.pdf", "pdf")).toEqual([]);
  expect(matcher.match("Holiday.pdf", "pdf")).toEqual([entries[0]]);
});
