import { readBooleanPreference } from "./preferences";
import { vaultStorage } from "./vault-session";

/** Track original-video time, including alternate audio and floating playback. */
export function trackVideoPosition(video: HTMLVideoElement, itemId: number) {
  const key = `vaultly.video.position.${itemId}`;
  const enabled = () => readBooleanPreference("vaultly.video.rememberPosition", false);
  let position = 0, duration = 0, ready = false, lastSaved = -Infinity;
  const save = () => {
    if (!enabled() || !ready || !Number.isFinite(position)) return;
    try {
      if (position <= 0 || (Number.isFinite(duration) && duration > 0 && position >= duration - 2)) vaultStorage.removeItem(key);
      else vaultStorage.setItem(key, String(position));
      lastSaved = performance.now();
    } catch { /* Storage limits must not interrupt playback. */ }
  };
  const observe = () => { position = video.currentTime; duration = video.duration; };
  const loaded = () => {
    ready = true; observe();
    if (!enabled()) return;
    const stored = Number(vaultStorage.getItem(key));
    if (Number.isFinite(stored) && stored > 0 && Number.isFinite(duration) && stored < duration - 2) {
      video.currentTime = stored; position = stored;
    }
  };
  const time = () => { observe(); if (performance.now() - lastSaved >= 5000) save(); };
  const stopped = () => { observe(); save(); };
  const ended = () => { position = 0; save(); };
  const preferences = () => { if (enabled()) stopped(); };
  video.addEventListener("loadedmetadata", loaded);
  video.addEventListener("timeupdate", time);
  video.addEventListener("pause", stopped);
  video.addEventListener("seeked", stopped);
  video.addEventListener("ended", ended);
  window.addEventListener("pagehide", stopped);
  window.addEventListener("vaultly-preferences-changed", preferences);
  if (video.readyState >= 1) loaded();
  return () => {
    // React may already have changed src: keep the last observed time of this item.
    save();
    video.removeEventListener("loadedmetadata", loaded);
    video.removeEventListener("timeupdate", time);
    video.removeEventListener("pause", stopped);
    video.removeEventListener("seeked", stopped);
    video.removeEventListener("ended", ended);
    window.removeEventListener("pagehide", stopped);
    window.removeEventListener("vaultly-preferences-changed", preferences);
  };
}
