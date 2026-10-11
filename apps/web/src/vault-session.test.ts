import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { exportVaultPreferences, restoreVaultPreferences, removeVaultPreferences, setActiveProfile, vaultFetch, vaultStorage, vaultUrl } from "./vault-session";

let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal("window", {
    localStorage: {
      get length() { return values.size; },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
    history: { state: null, replaceState: vi.fn() },
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

test("legacy preferences stay in Default and each new profile starts with default settings", () => {
  values.set("vaultly.video.volume", "0.7");
  values.set("unrelated", "keep");
  setActiveProfile({ id: "default", name: "Default" });
  expect(vaultStorage.getItem("vaultly.video.volume")).toBe("0.7");
  setActiveProfile({ id: "new-vault", name: "New" });
  expect(vaultStorage.getItem("vaultly.video.volume")).toBeNull();
  vaultStorage.setItem("vaultly.video.volume", "0.2");
  expect(exportVaultPreferences()).toEqual({ "vaultly.video.volume": "0.2" });
  restoreVaultPreferences({ "vaultly.pdf.fit": "width", "vaultly.profile.other.vaultly.pdf.fit": "bad", unrelated: "bad" });
  expect(exportVaultPreferences()).toEqual({ "vaultly.pdf.fit": "width" });
  setActiveProfile({ id: "default", name: "Default" });
  expect(exportVaultPreferences()).toEqual({ "vaultly.video.volume": "0.7" });
  restoreVaultPreferences({ "vaultly.video.volume": "0.9" });
  setActiveProfile({ id: "new-vault", name: "New" });
  expect(exportVaultPreferences()).toEqual({ "vaultly.pdf.fit": "width" });
  expect(values.get("unrelated")).toBe("keep");
});

test("media and fetch URLs are pinned to the vault without changing external URLs", async () => {
  setActiveProfile({ id: "default", name: "Default" });
  expect(vaultUrl("/api/items/1/file")).toBe("/api/items/1/file?vaultProfile=default");
  expect(vaultUrl("/api/people/1/image?v=abc")).toBe("/api/people/1/image?v=abc&vaultProfile=default");
  expect(vaultUrl("https://example.com/image.png")).toBe("https://example.com/image.png");
  const fetch = vi.fn().mockResolvedValue(new Response("ok"));
  vi.stubGlobal("fetch", fetch);
  await vaultFetch("/api/backup/archive", { method: "POST" });
  expect(fetch).toHaveBeenCalledWith("/api/backup/archive?vaultProfile=default", { method: "POST" });
});


test("deleting vault preferences removes its progress and settings without clearing other profiles", () => {
  values.set("vaultly.video.position.7", "45"); values.set("vaultly.video.volume", "0.7");
  values.set("vaultly.profile.other.vaultly.video.position.7", "20"); values.set("unrelated", "keep");
  removeVaultPreferences("default");
  expect([...values.keys()]).toEqual(["vaultly.profile.other.vaultly.video.position.7", "unrelated"]);
  removeVaultPreferences("other"); expect([...values.keys()]).toEqual(["unrelated"]);
});
