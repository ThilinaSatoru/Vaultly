import { vaultStorage } from "./vault-session";

export type Theme = "midnight" | "forest" | "dusk" | "rose" | "ocean" | "amber" | "neon" | `custom:${string}`;
export type PaletteMode = "light" | "dark";
export const themeColors = {
  bg: "Background", sidebar: "Navigation", panel: "Containers", "panel-2": "Raised containers", field: "Input backgrounds",
  text: "Text", muted: "Secondary text", border: "Borders", acid: "Accent", "secondary-accent": "Secondary accent", danger: "Danger",
} as const;
export type ThemeColors = Record<keyof typeof themeColors, string>;
export interface CustomTheme { id: string; name: string; palette: PaletteMode; colors: ThemeColors; palettes?: Partial<Record<PaletteMode, ThemeColors>>; gradient: number; glow: number }
export const darkColors: ThemeColors = { bg: "#111111", sidebar: "#181818", panel: "#212121", "panel-2": "#303030", field: "#161616", text: "#f1f1f1", muted: "#b0b0b0", border: "#444444", acid: "#9fc7ff", "secondary-accent": "#c6adf0", danger: "#ff7b8e" };
export const lightColors: ThemeColors = { bg: "#f7f7f8", sidebar: "#f0f0f0", panel: "#ffffff", "panel-2": "#e9e9eb", field: "#f5f5f5", text: "#202020", muted: "#606060", border: "#cccccf", acid: "#335f9c", "secondary-accent": "#7955a1", danger: "#b32642" };
export const neonTheme: CustomTheme = { id: "neon", name: "Neon cyan", palette: "dark", colors: { ...darkColors, acid: "#45f4df", "secondary-accent": "#ca8cff", danger: "#ff6489" }, gradient: 0, glow: 35 };

function validateColors(input: ThemeColors): ThemeColors {
  return Object.fromEntries(Object.keys(themeColors).map((key) => {
    const color = input?.[key as keyof ThemeColors];
    if (typeof color !== "string" || !/^#[a-f\d]{6}$/i.test(color)) throw new Error(`Use a six-digit hex color for ${key}.`);
    return [key, color.toLowerCase()];
  })) as ThemeColors;
}

export function colorsForPalette(theme: CustomTheme, palette: PaletteMode): ThemeColors {
  if (palette === theme.palette) return theme.colors;
  if (theme.palettes?.[palette]) return theme.palettes[palette];
  const colors = { ...(palette === "dark" ? darkColors : lightColors) };
  // Preserve the accent hues while adapting their brightness for the companion palette.
  for (const key of ["acid", "secondary-accent", "danger"] as const) {
    let color = theme.colors[key];
    for (let attempt = 0; contrastRatio(color, colors.panel) < 4.5 && attempt < 30; attempt++) {
      color = "#" + [1, 3, 5].map((index) => {
        const channel = parseInt(color.slice(index, index + 2), 16);
        return Math.round(palette === "dark" ? channel + (255 - channel) * .12 : channel * .88).toString(16).padStart(2, "0");
      }).join("");
    }
    colors[key] = color;
  }
  return colors;
}

export function validateCustomTheme(value: unknown): CustomTheme {
  if (!value || typeof value !== "object") throw new Error("Enter a theme object.");
  const input = value as CustomTheme;
  if (typeof input.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.id) || typeof input.name !== "string" || !input.name.trim() || input.name.length > 80 || !["light", "dark"].includes(input.palette)) throw new Error("Give the theme a valid name and base palette.");
  const colors = validateColors(input.colors);
  const palettes = input.palettes ? Object.fromEntries((["light", "dark"] as const).flatMap((palette) => input.palettes?.[palette] ? [[palette, validateColors(input.palettes[palette])]] : [])) : undefined;
  if (![input.gradient, input.glow].every((number) => Number.isFinite(number) && number >= 0 && number <= 100)) throw new Error("Gradient and glow must be between 0 and 100.");
  return { id: input.id, name: input.name.trim(), palette: input.palette, colors, ...(palettes ? { palettes } : {}), gradient: input.gradient, glow: input.glow };
}
export function readCustomThemes(): CustomTheme[] {
  try {
    const values = JSON.parse(vaultStorage.getItem("vaultly.customThemes") ?? "[]");
    return Array.isArray(values) ? values.slice(0, 100).flatMap((value) => { try { return [validateCustomTheme(value)]; } catch { return []; } }) : [];
  } catch { return []; }
}
const tokenKeys = [...Object.keys(themeColors), "acid-dark", "accent-fill", "on-accent", "accent-soft", "surface-gradient", "soft-shadow", "neon-shadow", "neon-text"];
function resetTokens() { for (const key of tokenKeys) document.documentElement.style?.removeProperty(`--${key}`); delete document.documentElement.dataset.glow; }
export function previewCustomTheme(theme: CustomTheme, palette = theme.palette) {
  const root = document.documentElement;
  const colors = colorsForPalette(theme, palette);
  root.dataset.palette = palette;
  root.dataset.glow = theme.glow ? "on" : "off";
  for (const [key, value] of Object.entries(colors)) root.style.setProperty(`--${key}`, value);
  root.style.setProperty("--acid-dark", colors.acid);
  root.style.setProperty("--accent-fill", colors.acid);
  root.style.setProperty("--on-accent", contrastRatio(colors.acid, "#111111") > contrastRatio(colors.acid, "#ffffff") ? "#111111" : "#ffffff");
  root.style.setProperty("--accent-soft", colors["panel-2"]);
  root.style.setProperty("--surface-gradient", `linear-gradient(145deg, ${colors.panel}, color-mix(in srgb, ${colors["panel-2"]} ${theme.gradient}%, ${colors.panel}))`);
  root.style.setProperty("--soft-shadow", `0 10px 28px #00000035`);
  root.style.setProperty("--neon-shadow", `0 0 ${theme.glow / 3}px color-mix(in srgb, ${theme.colors.acid} ${theme.glow}%, transparent)`);
  root.style.setProperty("--neon-text", `0 0 ${theme.glow / 5}px color-mix(in srgb, ${theme.colors.acid} ${theme.glow}%, transparent)`);
}
export function storeCustomTheme(value: CustomTheme) {
  const theme = validateCustomTheme(value), themes = readCustomThemes();
  const next = [...themes.filter((entry) => entry.id !== theme.id), theme];
  if (next.length > 100) throw new Error("You can save up to 100 themes.");
  vaultStorage.setItem("vaultly.customThemes", JSON.stringify(next));
  vaultStorage.setItem("vaultly.palette", theme.palette);
  saveTheme(`custom:${theme.id}`); return theme;
}
export function deleteCustomTheme(id: string) {
  vaultStorage.setItem("vaultly.customThemes", JSON.stringify(readCustomThemes().filter((theme) => theme.id !== id)));
  if (vaultStorage.getItem("vaultly.theme") === `custom:${id}`) saveTheme("midnight");
}
export function contrastRatio(first: string, second: string) {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((index) => { const v = parseInt(hex.slice(index, index + 2), 16) / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
    return .2126 * r + .7152 * g + .0722 * b;
  };
  const a = luminance(first), b = luminance(second); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

export function readPaletteMode(): PaletteMode {
  return vaultStorage.getItem("vaultly.palette") === "dark" ? "dark" : "light";
}

export function readTheme(): Theme {
  const value = vaultStorage.getItem("vaultly.theme");
  return value === "forest" || value === "dusk" || value === "rose" || value === "ocean" || value === "amber" || value === "neon" || (value?.startsWith("custom:") && readCustomThemes().some((theme) => `custom:${theme.id}` === value)) ? value as Theme : "midnight";
}
export function applyTheme(theme = readTheme(), palette = readPaletteMode()) {
  resetTokens();
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.palette = palette;
  const custom = theme === "neon" ? neonTheme : readCustomThemes().find((entry) => `custom:${entry.id}` === theme);
  if (custom && document.documentElement.style) previewCustomTheme(custom, palette);
}
export function saveTheme(theme: Theme) {
  vaultStorage.setItem("vaultly.theme", theme);
  const custom = theme === "neon" ? neonTheme : readCustomThemes().find((entry) => `custom:${entry.id}` === theme);
  if (custom) vaultStorage.setItem("vaultly.palette", custom.palette);
  applyTheme(theme);
}

export function savePaletteMode(palette: PaletteMode) {
  vaultStorage.setItem("vaultly.palette", palette);
  applyTheme(readTheme(), palette);
}
