import { expect, test } from "vitest";
import { defaultPeopleCreditFilter, filterPeopleCredits } from "./people-filter";

test("the current library selects cast or artists, otherwise all people", () => {
  expect(defaultPeopleCreditFilter("video")).toBe("cast");
  expect(defaultPeopleCreditFilter("comic")).toBe("artist");
  expect(defaultPeopleCreditFilter("story")).toBe("artist");
  expect(defaultPeopleCreditFilter()).toBe("all");
});

test("people with both kinds of credits appear in both filters, unused people remain in all", () => {
  const people = [
    { id: 1, name: "Cast", cast_count: 1 },
    { id: 2, name: "Artist", artist_count: 1 },
    { id: 3, name: "Both", cast_count: 2, artist_count: 3 },
    { id: 4, name: "Unused" },
    { id: 5, name: "Set only", set_count: 1 },
  ];
  expect(filterPeopleCredits(people, "cast").map((person) => person.id)).toEqual([1, 3]);
  expect(filterPeopleCredits(people, "artist").map((person) => person.id)).toEqual([2, 3]);
  expect(filterPeopleCredits(people, "all")).toEqual(people);
});
