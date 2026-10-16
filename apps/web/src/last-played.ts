import { useEffect, useState } from "react";
import { readBooleanPreference } from "./preferences";
import { vaultStorage } from "./vault-session";

export interface LastPlayed {
  itemId: number;
  title: string;
  seriesId?: number;
  seriesTitle?: string;
}
const key = (seriesId?: number) => `vaultly.video.lastPlayed${seriesId === undefined ? "" : `.${seriesId}`}`;

export function readLastPlayed(seriesId?: number): LastPlayed | null {
  try {
    if (!readBooleanPreference("vaultly.video.rememberLastPlayed", true)) return null;
    const value = JSON.parse(vaultStorage.getItem(key(seriesId)) ?? "null");
    return value && Number.isSafeInteger(value.itemId) && value.itemId > 0 && typeof value.title === "string"
      && (value.seriesId === undefined || (Number.isSafeInteger(value.seriesId) && value.seriesId > 0))
      && (value.seriesTitle === undefined || typeof value.seriesTitle === "string")
      && (seriesId === undefined || value.seriesId === seriesId) ? value : null;
  } catch { return null; }
}

export function rememberLastPlayed(value: LastPlayed, collections: Array<{ id: number; name: string }> = []) {
  if (!readBooleanPreference("vaultly.video.rememberLastPlayed", true)) return;
  vaultStorage.setItem(key(), JSON.stringify(value));
  for (const collection of collections) {
    vaultStorage.setItem(key(collection.id), JSON.stringify({ itemId: value.itemId, title: value.title, seriesId: collection.id, seriesTitle: collection.name }));
  }
  if (value.seriesId !== undefined) vaultStorage.setItem(key(value.seriesId), JSON.stringify(value));
  window.dispatchEvent(new Event("vaultly-preferences-changed"));
}

export function useLastPlayed(seriesId?: number) {
  const [, refresh] = useState(0);
  useEffect(() => {
    const changed = () => refresh((value) => value + 1);
    window.addEventListener("vaultly-preferences-changed", changed);
    return () => window.removeEventListener("vaultly-preferences-changed", changed);
  }, []);
  return readLastPlayed(seriesId);
}
