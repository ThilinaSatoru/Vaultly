import { describe, expect, it } from "vitest";
import { filterAttributes, matchesAttribute } from "./attribute-search";

const entries = [
  { id: 1, name: "Zelda", patterns: ["Zoë-Smith", "Painter"], count: 8 },
  { id: 2, name: "Alice", patterns: [], count: 0 },
  { id: 3, name: "Bob", patterns: ["Robert"], count: 2 },
];

describe("attribute search", () => {
  it("finds aliases ignoring case, accents, and punctuation, including in pickers", () => {
    expect(matchesAttribute(entries[0], "ZOE smith")).toBe(true);
    expect(matchesAttribute(entries[0], "zelda painter")).toBe(true);
    expect(matchesAttribute(entries[0], "smith robert")).toBe(false);
    expect(matchesAttribute(entries[0], "smith", "name")).toBe(false);
    expect(matchesAttribute(entries[0], "zelda", "patterns")).toBe(false);
    expect(matchesAttribute(entries[0], "painter", "patterns")).toBe(true);
  });

  it("combines pattern searching, usage filters, and sorting without changing the source list", () => {
    const list = (overrides = {}) => filterAttributes(entries, { query: "", scope: "all", usage: "all", sort: "name", ...overrides }, (entry) => entry.count).map((entry) => entry.id);
    expect(list()).toEqual([2, 3, 1]);
    expect(list({ usage: "used", sort: "usage" })).toEqual([1, 3]);
    expect(list({ usage: "unused" })).toEqual([2]);
    expect(list({ usage: "patterns", sort: "patterns" })).toEqual([1, 3]);
    expect(list({ query: "Robert", scope: "patterns" })).toEqual([3]);
    expect(list({ query: "missing" })).toEqual([]);
    expect(entries.map((entry) => entry.id)).toEqual([1, 2, 3]);
  });
});
