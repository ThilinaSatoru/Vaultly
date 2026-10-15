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
    if (!readBooleanPreference("vaultly.video.rememberLastPlayed", false)) return null;
    const value = JSON.parse(vaultStorage.getItem(key(seriesId)) ?? "null");
    return value && Number.isSafeInteger(value.itemId) && value.itemId > 0 && typeof value.title === "string"
      && (value.seriesId === undefined || (Number.isSafeInteger(value.seriesId) && value.seriesId > 0))
      && (value.seriesTitle === undefined || typeof value.seriesTitle === "string") ? value : null;
  } catch { return null; }
}

export function rememberLastPlayed(value: LastPlayed) {
  if (!readBooleanPreference("vaultly.video.rememberLastPlayed", false)) return;
  vaultStorage.setItem(key(), JSON.stringify(value));
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
