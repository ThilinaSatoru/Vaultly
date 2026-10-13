import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const vaultRootDirectory = process.env.VAULTLY_RUNTIME_DIR
  ? path.resolve(process.env.VAULTLY_RUNTIME_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../runtime");
mkdirSync(vaultRootDirectory, { recursive: true });

const profileSchema = z.object({
  id: z.string().regex(/^(default|[0-9a-f-]{36})$/),
  name: z.string().trim().min(1).max(80),
});
const registrySchema = z.object({
  activeId: profileSchema.shape.id,
  profiles: z.array(profileSchema).min(1),
}).superRefine((value, context) => {
  if (!value.profiles.some((profile) => profile.id === value.activeId)
    || new Set(value.profiles.map((profile) => profile.id)).size !== value.profiles.length) {
    context.addIssue({ code: "custom", message: "Invalid vault profile registry." });
  }
});
export type VaultProfile = z.infer<typeof profileSchema>;
const registryPath = path.join(vaultRootDirectory, "vault-profiles.json");
let registry = existsSync(registryPath)
  ? registrySchema.parse(JSON.parse(readFileSync(registryPath, "utf8")))
  : { activeId: "default", profiles: [{ id: "default", name: "Default" }] };

function persist(next: typeof registry) {
  writeFileSync(`${registryPath}.tmp`, JSON.stringify(next, null, 2));
  renameSync(`${registryPath}.tmp`, registryPath);
  registry = next;
}

export function getVaultProfiles() {
  return { activeId: registry.activeId, profiles: registry.profiles.map((profile) => ({ ...profile })) };
}
export function getActiveVaultProfile(): VaultProfile {
  return { ...registry.profiles.find((profile) => profile.id === registry.activeId)! };
}
export function vaultDirectory(id: string) {
  if (!registry.profiles.some((profile) => profile.id === id)) throw new Error("Vault profile not found.");
  // Keep the original library and cache in place for existing installations.
  return id === "default" ? vaultRootDirectory : path.join(vaultRootDirectory, "vaults", id);
}
export function createVaultProfile(name: string) {
  name = profileSchema.shape.name.parse(name);
  if (registry.profiles.some((profile) => profile.name.toLowerCase() === name.toLowerCase())) return null;
  const profile = { id: randomUUID(), name };
  persist({ ...registry, profiles: [...registry.profiles, profile] });
  return profile;
}
export function saveActiveVaultProfile(id: string) {
  vaultDirectory(id);
  persist({ ...registry, activeId: id });
}

/** Delete only application-owned data, including Default's legacy root files. */
export function vaultDeletionTargets(id: string) {
  const directory = vaultDirectory(id);
  const root = realpathSync(vaultRootDirectory);
  const expected = id === "default" ? root : path.join(root, "vaults", id);
  if (existsSync(directory) && path.relative(expected, realpathSync(directory)) !== "") {
    throw new Error("The profile data directory is redirected. It cannot be deleted.");
  }
  // Keep the obsolete report in deletion cleanup so older vaults leave no orphan files.
  const owned = ["vaultly.db", "vaultly.db-wal", "vaultly.db-shm", "vaultly.db-journal", "thumbnails", "profile-images", "audio-tracks", "playback", "people-profile-scan.json"];
  const targets = owned.map((name) => path.resolve(directory, name)).filter((target) => existsSync(target));
  for (const target of targets) {
    if (path.dirname(target) !== path.resolve(directory) || lstatSync(target).isSymbolicLink()
      || path.relative(path.join(expected, path.basename(target)), realpathSync(target)) !== "") {
      throw new Error("A profile data path is redirected. It cannot be deleted.");
    }
  }
  return { directory, root, targets };
}

export function deleteVaultProfile(id: string) {
  if (registry.activeId === id) throw new Error("Switch away from this vault before deleting it.");
  const { directory, root, targets } = vaultDeletionTargets(id);
  const trash = path.join(root, `.deleted-vault-${randomUUID()}`);
  mkdirSync(trash);
  const moved: string[] = [];
  try {
    for (const target of targets) { renameSync(target, path.join(trash, path.basename(target))); moved.push(target); }
    persist({ ...registry, profiles: registry.profiles.filter((profile) => profile.id !== id) });
  } catch (error) {
    for (const target of moved.reverse()) renameSync(path.join(trash, path.basename(target)), target);
    rmdirSync(trash);
    throw error;
  }
  let cleanupWarning: string | undefined;
  try { rmSync(trash, { recursive: true, force: true, maxRetries: 3 }); }
  catch { cleanupWarning = "Profile removed. Some cached files are still locked; restart Vaultly and remove the .deleted-vault cache directory."; }
  if (id !== "default") {
    try { rmdirSync(directory); } catch { /* Preserve any files that are not application data. */ }
  }
  return { ...getVaultProfiles(), cleanupWarning };
}
