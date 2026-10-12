import { vaultStorage } from "./vault-session";

export type Theme = "midnight" | "forest" | "dusk";
export function readTheme(): Theme {
  const value = vaultStorage.getItem("vaultly.theme");
  return value === "forest" || value === "dusk" ? value : "midnight";
}
export function applyTheme(theme = readTheme()) {
  document.documentElement.dataset.theme = theme;
}
export function saveTheme(theme: Theme) {
  vaultStorage.setItem("vaultly.theme", theme);
  applyTheme(theme);
}
