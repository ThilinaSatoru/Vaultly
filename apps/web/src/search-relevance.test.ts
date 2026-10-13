import { expect, test } from "vitest";
import { rankSearchResults } from "./search-relevance";
import { searchAttributes, filterAttributes } from "./attribute-search";

test("exact names precede exact aliases and partial names without mutating the list", () => {
  const entries = [
    { id: 1, name: "Alice extended", patterns: [] },
    { id: 2, name: "A painter", patterns: ["Alice"] },
    { id: 3, name: "Alice", patterns: [] },
  ];
  expect(searchAttributes(entries, "ALICE").map((entry) => entry.id)).toEqual([3, 2, 1]);
  expect(filterAttributes(entries, { query: "alice", scope: "all", usage: "all", sort: "relevance" }, () => 0).map((entry) => entry.id)).toEqual([3, 2, 1]);
  expect(entries.map((entry) => entry.id)).toEqual([1, 2, 3]);
});

test("exact title ranking preserves ties, handles accents and leaves empty queries alone", () => {
  const entries = [{ title: "Zoe Smith extended" }, { title: "Zoë-Smith" }, { title: "ZOE SMITH" }];
  expect(rankSearchResults(entries, "zoe smith", (entry) => [entry.title])).toEqual([entries[1], entries[2], entries[0]]);
  expect(rankSearchResults(entries, "", (entry) => [entry.title])).toBe(entries);
});

test("explicit attribute sorts remain available", () => {
  const entries = [{ id: 1, name: "Alice extended" }, { id: 2, name: "Alice" }];
  expect(filterAttributes(entries, { query: "alice", scope: "all", usage: "all", sort: "name-desc" }, () => 0).map((entry) => entry.id)).toEqual([1, 2]);
});
