export interface VaultProfile { id: string; name: string }
export interface VaultProfiles { activeId: string; profiles: VaultProfile[] }

let activeProfile: VaultProfile | undefined;
export const getActiveProfile = () => activeProfile;
export function setActiveProfile(profile: VaultProfile) {
  activeProfile = profile;
  if (window.history.state?.vaultProfile !== profile.id) {
    window.history.replaceState({ vaultProfile: profile.id }, "");
  }
}

// Include the profile in URLs used by images, PDF workers and native video
// requests as well as fetches. This also gives each vault a distinct cache key.
export function vaultUrl(url: string) {
  if (!activeProfile || !url.startsWith("/api/")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}vaultProfile=${encodeURIComponent(activeProfile.id)}`;
}
export function vaultFetch(url: string, options?: RequestInit) {
  return fetch(vaultUrl(url), options);
}

function storedKey(key: string) {
  return !activeProfile || activeProfile.id === "default" ? key : `vaultly.profile.${activeProfile.id}.${key}`;
}
export const vaultStorage = {
  getItem: (key: string) => window.localStorage.getItem(storedKey(key)),
  setItem: (key: string, value: string) => window.localStorage.setItem(storedKey(key), value),
  removeItem: (key: string) => window.localStorage.removeItem(storedKey(key)),
};
function preferenceKey(key: string) {
  return key.startsWith("vaultly.") && !key.startsWith("vaultly.profile.");
}
export function exportVaultPreferences() {
  const prefix = activeProfile && activeProfile.id !== "default" ? `vaultly.profile.${activeProfile.id}.` : "";
  const result: Record<string, string> = {};
  for (let index = 0; index < window.localStorage.length; index++) {
    const key = window.localStorage.key(index);
    if (!key || (prefix && !key.startsWith(prefix))) continue;
    const unscoped = prefix ? key.slice(prefix.length) : key;
    if (preferenceKey(unscoped)) result[unscoped] = window.localStorage.getItem(key) ?? "";
  }
  return result;
}
export function restoreVaultPreferences(preferences?: Record<string, unknown>) {
  for (const key of Object.keys(exportVaultPreferences())) vaultStorage.removeItem(key);
  for (const [key, value] of Object.entries(preferences ?? {})) {
    if (preferenceKey(key) && typeof value === "string") vaultStorage.setItem(key, value);
  }
}

export function removeVaultPreferences(profileId: string) {
  const prefix = profileId === "default" ? "" : `vaultly.profile.${profileId}.`;
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index++) {
    const key = window.localStorage.key(index);
    if (key && (prefix ? key.startsWith(prefix) : preferenceKey(key))) keys.push(key);
  }
  for (const key of keys) window.localStorage.removeItem(key);
}
