interface DesktopPreferences {
  read(): Record<string, string>;
  write(key: string, value: string | null): void;
}
let desktopStorage: Storage | undefined;
function preferenceStorage(): Storage {
  const bridge = (window as Window & { vaultlyPreferences?: DesktopPreferences }).vaultlyPreferences;
  if (!bridge) return window.localStorage;
  if (!desktopStorage) {
    const values = bridge.read();
    // Migrate preferences still available at the current browser origin.
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (key?.startsWith("vaultly.") && !(key in values)) {
        const value = window.localStorage.getItem(key)!;
        bridge.write(key, value);
        values[key] = value;
      }
    }
    desktopStorage = {
      get length() { return Object.keys(values).length; },
      key: (index) => Object.keys(values)[index] ?? null,
      getItem: (key) => values[key] ?? null,
      setItem: (key, value) => { bridge.write(key, value); values[key] = value; },
      removeItem: (key) => { bridge.write(key, null); delete values[key]; },
      clear: () => { for (const key of Object.keys(values)) { bridge.write(key, null); delete values[key]; } },
    };
  }
  return desktopStorage;
}
export interface VaultProfile { id: string; name: string }
export interface VaultProfiles { activeId: string; profiles: VaultProfile[] }

let activeProfile: VaultProfile | undefined;
let preferenceRevision = 0;
export const getActiveProfile = () => activeProfile;
export const getPreferenceRevision = () => preferenceRevision;
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
  getItem: (key: string) => preferenceStorage().getItem(storedKey(key)),
  setItem: (key: string, value: string) => preferenceStorage().setItem(storedKey(key), value),
  removeItem: (key: string) => preferenceStorage().removeItem(storedKey(key)),
};
function preferenceKey(key: string) {
  return key.startsWith("vaultly.") && !key.startsWith("vaultly.profile.");
}
export function exportVaultPreferences() {
  const prefix = activeProfile && activeProfile.id !== "default" ? `vaultly.profile.${activeProfile.id}.` : "";
  const result: Record<string, string> = {};
  for (let index = 0; index < preferenceStorage().length; index++) {
    const key = preferenceStorage().key(index);
    if (!key || (prefix && !key.startsWith(prefix))) continue;
    const unscoped = prefix ? key.slice(prefix.length) : key;
    if (preferenceKey(unscoped)) result[unscoped] = preferenceStorage().getItem(key) ?? "";
  }
  return result;
}
export function restoreVaultPreferences(preferences?: Record<string, unknown>) {
  preferenceRevision++;
  for (const key of Object.keys(exportVaultPreferences())) vaultStorage.removeItem(key);
  for (const [key, value] of Object.entries(preferences ?? {})) {
    if (preferenceKey(key) && typeof value === "string") vaultStorage.setItem(key, value);
  }
}

export function removeVaultPreferences(profileId: string) {
  if (profileId === activeProfile?.id) preferenceRevision++;
  const prefix = profileId === "default" ? "" : `vaultly.profile.${profileId}.`;
  const keys: string[] = [];
  for (let index = 0; index < preferenceStorage().length; index++) {
    const key = preferenceStorage().key(index);
    if (key && (prefix ? key.startsWith(prefix) : preferenceKey(key))) keys.push(key);
  }
  for (const key of keys) preferenceStorage().removeItem(key);
}
