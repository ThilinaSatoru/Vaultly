import type { ShortcutAction } from "./preferences";

export type PlayerKind = "video" | "pdf" | "comic" | "ebook";
export interface ShortcutGroup { title: string; actions: Array<{ action: ShortcutAction; label: string }> }

export const shortcutGroups: ShortcutGroup[] = [
  { title: "Viewer and collections", actions: [
    { action: "viewer.close", label: "Close viewer" },
    { action: "series.previous", label: "Previous collection item" },
    { action: "series.next", label: "Next collection item" },
  ] },
  { title: "Video player", actions: [
    { action: "video.playPause", label: "Play / pause" }, { action: "video.fullscreen", label: "Toggle fullscreen" },
    { action: "video.seekBack", label: "Seek backward" }, { action: "video.seekForward", label: "Seek forward" },
    { action: "video.seekBackLarge", label: "Large seek backward" }, { action: "video.seekForwardLarge", label: "Large seek forward" },
    { action: "video.volumeUp", label: "Volume up 5%" }, { action: "video.volumeDown", label: "Volume down 5%" }, { action: "video.mute", label: "Mute" },
  ] },
  { title: "PDF reader", actions: [
    { action: "reader.previousPage", label: "Previous page" }, { action: "reader.nextPage", label: "Next page" },
    { action: "reader.scrollUp", label: "Scroll up" }, { action: "reader.scrollDown", label: "Scroll down" },
    { action: "reader.autoScroll", label: "Play / pause auto-scroll" },
    { action: "reader.zoomIn", label: "Zoom in" }, { action: "reader.resetFit", label: "Reset to fit" },
  ] },
  { title: "Comic reader", actions: [
    { action: "comic.zoomIn", label: "Zoom in" }, { action: "comic.zoomOut", label: "Zoom out" },
    { action: "comic.fitWidth", label: "Fit to width" }, { action: "comic.resetFit", label: "Reset to fit screen" },
    { action: "comic.fullscreen", label: "Toggle fullscreen" },
  ] },
];

export const playerNames: Record<PlayerKind, string> = { video: "Video player", pdf: "PDF reader", comic: "Comic & picture reader", ebook: "E-book reader" };

export function playerShortcutGroups(kind: PlayerKind): ShortcutGroup[] {
  const [viewer, video, reader, comic] = shortcutGroups;
  if (kind === "video") return [video, viewer];
  if (kind === "pdf") return [reader, viewer];
  const actions = reader.actions.filter(({ action }) => kind === "ebook"
    ? ["reader.scrollUp", "reader.scrollDown", "reader.autoScroll"].includes(action)
    : !["reader.zoomIn", "reader.resetFit"].includes(action));
  return kind === "comic" ? [{ title: "Pages & scrolling", actions }, comic, viewer]
    : [{ title: "Reading & scrolling", actions }, viewer];
}

export function keyLabel(key: string): string {
  const labels: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Space: "Space", Escape: "Esc", PageUp: "Page Up", PageDown: "Page Down", Numpad0: "Num 0", Meta: "Meta" };
  return labels[key] ?? key.replace(/^Key|^Digit/, "").replace(/^Numpad/, "Num ");
}
