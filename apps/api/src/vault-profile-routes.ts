import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { activateVaultDatabase, initializeVaultDatabase } from "./database.js";
import { getBackgroundActivity } from "./background-activity.js";
import { createVaultProfile, deleteVaultProfile, getActiveVaultProfile, getVaultProfiles, vaultDeletionTargets } from "./vault-profiles.js";

// Install on the root instance before registering routes, so all library routes
// participate. Switching is synchronous and cannot overlap a library handler.
export function installVaultProfileRoutes(app: FastifyInstance) {
  const requests = new Set<FastifyRequest>();
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    const origin = request.headers.origin;
    if (request.method !== "GET" && request.url.startsWith("/api/vault-profiles") && origin
      && !["http://127.0.0.1:5173", "http://localhost:5173", `http://${request.headers.host}`].includes(origin)) {
      return reply.code(403).send({ message: "Manage profiles from Vaultly." });
    }
    const profileId = request.headers["x-vaultly-profile"]
      ?? new URL(request.url, "http://localhost").searchParams.get("vaultProfile");
    if (profileId && profileId !== getActiveVaultProfile().id) {
      return reply.code(409).send({ message: "The active vault changed. Reload Vaultly to continue.", code: "VAULT_CHANGED" });
    }
    requests.add(request);
  });
  app.addHook("onSend", async (request, reply, payload) => {
    requests.delete(request);
    if (request.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    return payload;
  });

  app.get("/api/vault-profiles", async () => getVaultProfiles());
  app.post("/api/vault-profiles", async (request, reply) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(request.body);
    const profile = createVaultProfile(name);
    if (!profile) return reply.code(409).send({ message: "A profile with that name already exists." });
    initializeVaultDatabase(profile.id);
    return reply.code(201).send(profile);
  });
  app.delete("/api/vault-profiles/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const profiles = getVaultProfiles().profiles;
    if (!profiles.some((profile) => profile.id === id)) return reply.code(404).send({ message: "Vault profile not found." });
    if (requests.size > 1 || getBackgroundActivity().length) {
      return reply.code(409).send({ message: "Finish or cancel background work and close the viewer before deleting a profile. Then try again." });
    }
    vaultDeletionTargets(id);
    const wasActive = getActiveVaultProfile().id === id;
    let createdFallback: string | undefined;
    if (wasActive) {
      let fallback = profiles.find((profile) => profile.id !== id);
      if (!fallback) {
        const name = profiles[0]?.name.toLowerCase() === "new vault" ? "New vault (2)" : "New vault";
        fallback = createVaultProfile(name)!;
        initializeVaultDatabase(fallback.id); createdFallback = fallback.id;
      }
      activateVaultDatabase(fallback.id);
    }
    try { return deleteVaultProfile(id); }
    catch (error) {
      if (wasActive) activateVaultDatabase(id);
      if (createdFallback) deleteVaultProfile(createdFallback);
      if (["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")) {
        return reply.code(409).send({ message: "Profile files are still in use. Close the viewer and try deleting again." });
      }
      throw error;
    }
  });
  app.post("/api/vault-profiles/:id/activate", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    if (!getVaultProfiles().profiles.some((profile) => profile.id === id)) {
      return reply.code(404).send({ message: "Vault profile not found." });
    }
    if (id !== getActiveVaultProfile().id) {
      if (requests.size > 1 || getBackgroundActivity().length) {
        return reply.code(409).send({ message: "Finish or cancel background work and close the viewer before switching profiles. Then try again." });
      }
      activateVaultDatabase(id);
    }
    return getVaultProfiles();
  });
}
