import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
    || !value.profiles.some((profile) => profile.id === "default")
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
