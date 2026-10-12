import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { applyTheme, readPaletteMode, savePaletteMode, saveTheme } from "./theme";
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
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
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
