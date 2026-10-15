import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readLastPlayed, rememberLastPlayed } from "./last-played";
import { exportVaultPreferences, restoreVaultPreferences, setActiveProfile, vaultStorage } from "./vault-session";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    }, history: { state: null, replaceState: vi.fn() }, dispatchEvent: vi.fn(),
  });
  setActiveProfile({ id: "default", name: "Default" });
});
afterEach(() => vi.unstubAllGlobals());

test("remembering playback is opt-in and keeps a separate last episode for each series", () => {
  const first = { itemId: 11, title: "Episode 1", seriesId: 1, seriesTitle: "First series" };
  rememberLastPlayed(first);
  expect(readLastPlayed()).toBeNull();
  vaultStorage.setItem("vaultly.video.rememberLastPlayed", "true");
  expect(readLastPlayed()).toBeNull();
  rememberLastPlayed(first);
  const second = { itemId: 24, title: "Episode 4", seriesId: 2, seriesTitle: "Second series" };
  rememberLastPlayed(second);
  expect(readLastPlayed()).toEqual(second);
  expect(readLastPlayed(1)).toEqual(first);
  expect(readLastPlayed(2)).toEqual(second);
  vaultStorage.setItem("vaultly.video.rememberLastPlayed", "false");
  rememberLastPlayed({ itemId: 99, title: "Not remembered" });
  expect(readLastPlayed()).toBeNull();
  vaultStorage.setItem("vaultly.video.rememberLastPlayed", "true");
  expect(readLastPlayed()).toEqual(second);
});

test("last played and UI state survive backup restore and stay isolated across profiles", () => {
  vaultStorage.setItem("vaultly.video.rememberLastPlayed", "true");
  const played = { itemId: 8, title: "Saved episode" };
  rememberLastPlayed(played);
  vaultStorage.setItem("vaultly.ui.sources.expanded", "[4,7]");
  vaultStorage.setItem("vaultly.video.sidebarVisible", "false");
  const backup = exportVaultPreferences();
  setActiveProfile({ id: "other", name: "Other" });
  expect(readLastPlayed()).toBeNull();
  expect(vaultStorage.getItem("vaultly.video.sidebarVisible")).toBeNull();
  restoreVaultPreferences(backup);
  expect(readLastPlayed()).toEqual(played);
  expect(vaultStorage.getItem("vaultly.ui.sources.expanded")).toBe("[4,7]");
  setActiveProfile({ id: "default", name: "Default" });
  expect(readLastPlayed()).toEqual(played);
});

test("invalid saved playback cannot create an invalid Continue watching action", () => {
  vaultStorage.setItem("vaultly.video.rememberLastPlayed", "true");
  for (const value of ["invalid", "null", '{"itemId":-1,"title":"bad"}', '{"itemId":1,"title":"bad","seriesId":"oops"}']) {
    vaultStorage.setItem("vaultly.video.lastPlayed", value);
    expect(readLastPlayed()).toBeNull();
  }
});
