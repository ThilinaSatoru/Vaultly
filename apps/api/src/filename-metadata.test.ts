import { expect, test } from "vitest";
import { FilenameMetadataMatcher } from "./filename-metadata.js";

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
