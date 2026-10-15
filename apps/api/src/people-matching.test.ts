import { expect, test } from "vitest";
import { PeopleMatcher } from "./people-matching.js";

test("people require ordered full names, with token boundaries and no partial first/last aliases", () => {
  const jane = { id: 1, name: "Jane Doe", patterns: ["Jane", "Doe", "J. Doe", "Star Jane"] };
  const matcher = new PeopleMatcher([jane, { id: 2, name: "Jane Smith" }, { id: 3, name: "John Doe" }]);
  expect(matcher.match("Jane_Doe - episode.mp4", "mp4")).toEqual([jane]);
  expect(matcher.match("J Doe.mp4", "mp4")).toEqual([jane]);
  expect(matcher.match("JaneDoe - episode.mp4", "mp4")).toEqual([jane]);
  for (const filename of ["Jane", "Doe", "Doe Jane", "Jane something Doe", "Janelle Doe", "Jane Does", "Jane Smith", "JaneDoeExtra"]) {
    expect(matcher.match(`${filename}.mp4`, "mp4").map((person) => person.id)).not.toContain(1);
  }
  expect(matcher.match("Jane Doe and John Doe.mp4", "mp4").map((person) => person.id)).toEqual([1, 3]);
});
test("ambiguous aliases and shorter names embedded in another person's full name are rejected", () => {
  const matcher = new PeopleMatcher([
    { id: 1, name: "Jane", patterns: ["Shared Star"] },
    { id: 2, name: "Jane Doe", patterns: ["Shared Star"] },
    { id: 3, name: "Mary Jane Doe" },
  ]);
  expect(matcher.match("Mary Jane Doe.mp4", "mp4").map((person) => person.id)).toEqual([3]);
  expect(matcher.match("Shared Star.mp4", "mp4")).toEqual([]);
  expect(matcher.matchValue("Shared Star")).toEqual([]);
  expect(matcher.matchValue("Jane Doe").map((person) => person.id)).toEqual([2]);
  expect(matcher.matchValue("Doe Jane")).toEqual([]);
});
test("people normalize accents and punctuation and never inspect an extension", () => {
  const matcher = new PeopleMatcher([{ id: 1, name: "José Álvarez" }, { id: 2, name: "Video", patterns: ["mp4"] }]);
  expect(matcher.match("Jose-Alvarez.mp4", "mp4").map((person) => person.id)).toEqual([1]);
  expect(matcher.match("Unrelated.mp4", "mp4")).toEqual([]);
});

test("joined full names remain ambiguous when two people have the same joined spelling", () => {
  const matcher = new PeopleMatcher([{ id: 1, name: "Jane Doe" }, { id: 2, name: "Jan E Doe" }]);
  expect(matcher.match("JaneDoe.mp4", "mp4")).toEqual([]);
  expect(matcher.match("Jane Doe.mp4", "mp4").map((person) => person.id)).toEqual([1]);
});

test("possessive filename matches both spaced names and joined saved handles", () => {
  const filename = "Karmen Karma's Hotel Tape With A BBC.mp4";
  for (const name of ["Karmen Karma", "KarmenKarma"]) {
    const person = { id: 1, name };
    expect(new PeopleMatcher([person]).match(filename, "mp4")).toEqual([person]);
  }
});
