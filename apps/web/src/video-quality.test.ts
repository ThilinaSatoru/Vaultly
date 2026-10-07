import { expect, test } from "vitest";
import { formatVideoQuality } from "./media";

test.each([[1920, 1080, "1080p"], [720, 480, "480p"], [1080, 1920, "1080p"], [3840, 2160, "2160p"], [1920, 800, "800p"]])("labels %s × %s from the shorter dimension", (width, height, label) => {
  expect(formatVideoQuality(Number(width), Number(height))).toBe(label);
});

test("unknown or invalid resolution has no label", () => {
  for (const dimensions of [[null, null], [1920, null], [0, 480], [-1, 480], [NaN, 480]]) {
    expect(formatVideoQuality(...dimensions as [number | null, number | null])).toBeNull();
  }
});
