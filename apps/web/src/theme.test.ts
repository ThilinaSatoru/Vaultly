import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { applyTheme, readPaletteMode, savePaletteMode, saveTheme, colorsForPalette, contrastRatio, darkColors, lightColors, deleteCustomTheme, readCustomThemes, readTheme, storeCustomTheme, validateCustomTheme } from "./theme";
import { exportVaultPreferences, setActiveProfile } from "./vault-session";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      get length() { return values.size; },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
    history: { state: null, replaceState: vi.fn() },
  });
  vi.stubGlobal("document", { documentElement: { dataset: {}, style: { setProperty: vi.fn(), removeProperty: vi.fn() } } });
  setActiveProfile({ id: "default", name: "Default" });
});

afterEach(() => { vi.unstubAllGlobals(); });

test("changing accents preserves the palette and applying saved preferences restores it", () => {
  expect(readPaletteMode()).toBe("light");
  savePaletteMode("dark");
  saveTheme("dusk");
  expect(document.documentElement.dataset).toEqual({ theme: "dusk", palette: "dark" });
  document.documentElement.dataset.palette = "light";
  applyTheme();
  expect(document.documentElement.dataset.palette).toBe("dark");
  savePaletteMode("light");
  expect(document.documentElement.dataset).toEqual({ theme: "dusk", palette: "light" });
});

test("palette preferences stay with their vault and are included in backups", () => {
  savePaletteMode("dark");
  setActiveProfile({ id: "other", name: "Other" });
  applyTheme();
  expect(document.documentElement.dataset.palette).toBe("light");
  saveTheme("forest");
  setActiveProfile({ id: "default", name: "Default" });
  applyTheme();
  expect(document.documentElement.dataset).toEqual({ theme: "midnight", palette: "dark" });
  expect(exportVaultPreferences()).toEqual({ "vaultly.palette": "dark" });
});

test.each(["rose", "ocean", "amber"] as const)("restores the %s accent", (theme) => {
  saveTheme(theme);
  document.documentElement.dataset.theme = "midnight";
  applyTheme();
  expect(document.documentElement.dataset.theme).toBe(theme);
});

test("desktop preferences survive a new session with an empty browser origin", async () => {
  const disk: Record<string, string> = {};
  const bridge = { read: () => ({ ...disk }), write: (key: string, value: string | null) => {
    if (value === null) delete disk[key]; else disk[key] = value;
  } };
  Object.assign(window, { vaultlyPreferences: bridge });
  vi.resetModules();
  let session = await import("./vault-session");
  session.setActiveProfile({ id: "other", name: "Other" });
  session.vaultStorage.setItem("vaultly.theme", "rose");
  session.vaultStorage.setItem("vaultly.video.volume", "0.35");
  vi.resetModules();
  session = await import("./vault-session");
  session.setActiveProfile({ id: "other", name: "Other" });
  expect(session.vaultStorage.getItem("vaultly.theme")).toBe("rose");
  expect(session.vaultStorage.getItem("vaultly.video.volume")).toBe("0.35");
  expect(session.exportVaultPreferences()).toEqual({ "vaultly.theme": "rose", "vaultly.video.volume": "0.35" });
  session.setActiveProfile({ id: "default", name: "Default" });
  expect(session.vaultStorage.getItem("vaultly.theme")).toBeNull();
});


test("custom themes validate color tokens, persist with the vault and revert safely after deletion", () => {
  const custom = { id: "my-neon", name: "My neon", palette: "dark" as const, colors: { ...darkColors, acid: "#00ffcc" }, gradient: 15, glow: 50 };
  storeCustomTheme(custom);
  expect(readTheme()).toBe("custom:my-neon");
  expect(readPaletteMode()).toBe("dark");
  expect(document.documentElement.dataset.glow).toBe("on");
  expect(document.documentElement.style.setProperty).toHaveBeenCalledWith("--acid", "#00ffcc");
  expect(exportVaultPreferences()["vaultly.customThemes"]).toContain("My neon");
  setActiveProfile({ id: "other", name: "Other" });
  expect(readCustomThemes()).toEqual([]);
  setActiveProfile({ id: "default", name: "Default" });
  expect(readCustomThemes()).toHaveLength(1);
  deleteCustomTheme(custom.id);
  expect(readTheme()).toBe("midnight");
  expect(document.documentElement.dataset.glow).toBeUndefined();
  expect(document.documentElement.style.removeProperty).toHaveBeenCalledWith("--acid");
});
test("invalid theme imports cannot inject CSS and dark text has readable contrast", () => {
  const value = { id: "safe", name: "Safe", palette: "dark", colors: darkColors, glow: 0, gradient: 12 };
  expect(() => validateCustomTheme({ ...value, colors: { ...darkColors, bg: "url(https://example.com)" } })).toThrow();
  expect(() => validateCustomTheme({ ...value, glow: Infinity })).toThrow();
  expect(contrastRatio(darkColors.text, darkColors.panel)).toBeGreaterThan(7);
  expect(contrastRatio(darkColors.muted, darkColors.panel)).toBeGreaterThan(4.5);
  saveTheme("neon"); expect(readPaletteMode()).toBe("dark");
  savePaletteMode("light"); expect(readTheme()).toBe("neon");
  expect(document.documentElement.dataset.palette).toBe("light");
});

test("custom themes keep their identity and exact saved colors across light and dark mode changes", () => {
  const custom = { id: "paired", name: "Paired", palette: "dark" as const, colors: { ...darkColors, bg: "#151515", acid: "#00eedd" }, palettes: { light: { ...lightColors, bg: "#faf8f3" } }, gradient: 10, glow: 30 };
  storeCustomTheme(custom); savePaletteMode("light");
  expect(readTheme()).toBe("custom:paired");
  expect(document.documentElement.dataset.palette).toBe("light");
  expect(document.documentElement.style.setProperty).toHaveBeenCalledWith("--bg", "#faf8f3");
  applyTheme(); expect(document.documentElement.dataset.palette).toBe("light");
  savePaletteMode("dark");
  expect(readTheme()).toBe("custom:paired");
  expect(document.documentElement.style.setProperty).toHaveBeenCalledWith("--bg", "#151515");
  expect(readCustomThemes()[0]!.palettes!.light!.bg).toBe("#faf8f3");
  const generated = colorsForPalette({ ...custom, palettes: undefined }, "light");
  expect(contrastRatio(generated.text, generated.panel)).toBeGreaterThan(7);
  expect(contrastRatio(generated.acid, generated.panel)).toBeGreaterThanOrEqual(4.5);
});
