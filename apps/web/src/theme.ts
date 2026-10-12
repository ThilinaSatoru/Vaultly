import { vaultStorage } from "./vault-session";

export type Theme = "midnight" | "forest" | "dusk" | "rose" | "ocean" | "amber";
export type PaletteMode = "light" | "dark";

export function readPaletteMode(): PaletteMode {
  return vaultStorage.getItem("vaultly.palette") === "dark" ? "dark" : "light";
}

export function readTheme(): Theme {
  const value = vaultStorage.getItem("vaultly.theme");
  return value === "forest" || value === "dusk" || value === "rose" || value === "ocean" || value === "amber" ? value : "midnight";
}
export function applyTheme(theme = readTheme(), palette = readPaletteMode()) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.palette = palette;
}
export function saveTheme(theme: Theme) {
  vaultStorage.setItem("vaultly.theme", theme);
  applyTheme(theme);
}

export function savePaletteMode(palette: PaletteMode) {
  vaultStorage.setItem("vaultly.palette", palette);
  applyTheme(readTheme(), palette);
}
