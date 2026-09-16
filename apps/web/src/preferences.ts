export type ShortcutAction =
  | "viewer.close" | "series.previous" | "series.next"
  | "video.playPause" | "video.fullscreen" | "video.seekBack" | "video.seekForward"
  | "video.seekBackLarge" | "video.seekForwardLarge" | "video.volumeUp" | "video.volumeDown" | "video.mute"
  | "reader.previousPage" | "reader.nextPage" | "reader.scrollUp" | "reader.scrollDown"
  | "reader.zoomIn" | "reader.resetFit"
  | "comic.zoomIn" | "comic.zoomOut" | "comic.fitWidth" | "comic.resetFit" | "comic.fullscreen";

export const defaultBindings: Record<ShortcutAction, string[]> = {
  "viewer.close": ["Escape"],
  "series.previous": ["Alt+ArrowLeft"],
  "series.next": ["Alt+ArrowRight"],
  "video.playPause": ["Space", "KeyK"],
  "video.fullscreen": ["Enter", "KeyF"],
  "video.seekBack": ["ArrowLeft"],
  "video.seekForward": ["ArrowRight"],
  "video.seekBackLarge": ["Shift+ArrowLeft"],
  "video.seekForwardLarge": ["Shift+ArrowRight"],
  "video.volumeUp": ["ArrowUp"],
  "video.volumeDown": ["ArrowDown"],
  "video.mute": ["KeyM"],
  "reader.previousPage": ["ArrowLeft", "PageUp"],
  "reader.nextPage": ["ArrowRight", "PageDown"],
  "reader.scrollUp": ["ArrowUp"],
  "reader.scrollDown": ["ArrowDown"],
  "reader.zoomIn": ["Enter"],
  "reader.resetFit": ["Numpad0"],
  "comic.zoomIn": ["Shift+ArrowUp"],
  "comic.zoomOut": ["Shift+ArrowDown"],
  "comic.fitWidth": ["Enter"],
  "comic.resetFit": ["Numpad0"],
  "comic.fullscreen": ["KeyF"],
};

const bindingKey = "vaultly.keybindings";

export function eventBinding(event: KeyboardEvent): string {
  return [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Meta", event.code]
    .filter(Boolean).join("+");
}

export function readBindings(): Record<ShortcutAction, string[]> {
  try {
    const stored = JSON.parse(window.localStorage.getItem(bindingKey) ?? "{}") as Partial<Record<ShortcutAction, string[]>>;
    return Object.fromEntries(Object.entries(defaultBindings).map(([action, defaults]) => [action, Array.isArray(stored[action as ShortcutAction]) ? stored[action as ShortcutAction] : defaults])) as Record<ShortcutAction, string[]>;
  } catch { return { ...defaultBindings }; }
}

export function writeBindings(bindings: Record<ShortcutAction, string[]>) {
  window.localStorage.setItem(bindingKey, JSON.stringify(bindings));
  window.dispatchEvent(new Event("vaultly-preferences-changed"));
}

export function matchesShortcut(event: KeyboardEvent, action: ShortcutAction): boolean {
  return readBindings()[action].includes(eventBinding(event));
}

export function readBooleanPreference(key: string, fallback: boolean): boolean {
  const value = window.localStorage.getItem(key);
  return value === null ? fallback : value === "true";
}

export function readNumberPreference(key: string, fallback: number, min: number, max: number): number {
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

export function writePreference(key: string, value: string | number | boolean) {
  window.localStorage.setItem(key, String(value));
  window.dispatchEvent(new Event("vaultly-preferences-changed"));
}

export function formatBinding(binding: string) {
  return binding.replace("Key", "").replace("Digit", "").replace("Arrow", "Arrow ");
}
