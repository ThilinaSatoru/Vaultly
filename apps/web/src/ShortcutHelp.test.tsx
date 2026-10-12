import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ShortcutHelp, ShortcutList } from "./ShortcutHelp";
import { setActiveProfile, vaultStorage } from "./vault-session";

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) },
    history: { state: null, replaceState: vi.fn() },
  });
  setActiveProfile({ id: "default", name: "Default" });
});
afterEach(() => vi.unstubAllGlobals());

test("the read-only guide shows saved keys, unassigned actions, and current seek durations", () => {
  vaultStorage.setItem("vaultly.keybindings", JSON.stringify({ "video.playPause": ["Ctrl+KeyP"], "video.mute": [] }));
  vaultStorage.setItem("vaultly.video.seekAmount", "15");
  vaultStorage.setItem("vaultly.video.seekLargeAmount", "2");
  const html = renderToStaticMarkup(<ShortcutList kind="video" />);
  expect(html).toContain('aria-label="Ctrl+P"');
  expect(html).not.toContain('aria-label="Space"');
  expect(html).toContain("Not assigned");
  expect(html).toContain("15 seconds");
  expect(html).toContain("2 minutes");
  expect(html).not.toMatch(/<(input|select|button)\b/);
});

test("each reader guide limits shortcuts to controls supported by that reader", () => {
  const ebook = renderToStaticMarkup(<ShortcutList kind="ebook" />);
  expect(ebook).toContain("Scroll up");
  expect(ebook).toContain("Play / pause auto-scroll");
  expect(ebook).not.toContain("Previous page");
  expect(ebook).not.toContain("Zoom in");
  const comic = renderToStaticMarkup(<ShortcutList kind="comic" />);
  expect(comic).toContain("Previous page");
  expect(comic).toContain("Zoom out");
  const pdf = renderToStaticMarkup(<ShortcutList kind="pdf" />);
  expect(pdf).toContain("Previous page");
  expect(pdf).not.toContain("Toggle fullscreen");
});

test("the help button is labeled for its player and starts closed", () => {
  const html = renderToStaticMarkup(<ShortcutHelp kind="video" />);
  expect(html).toContain('aria-label="Video player keyboard shortcuts"');
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain('role="dialog"');
});
