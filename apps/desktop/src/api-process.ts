import { startVaultlyServer } from "../../api/src/server.js";
import type { DesktopRequest, DesktopResponse } from "./server-ipc.js";

let nextId = 0;
const requests = new Map<number, { resolve: (value: string | null) => void; reject: (error: Error) => void }>();
function desktop(action: DesktopRequest["action"], path?: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    requests.set(id, { resolve, reject });
    process.send?.({ type: "desktop", id, action, path } satisfies DesktopRequest);
  });
}
let close: (() => Promise<void>) | undefined;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  for (const request of requests.values()) request.reject(new Error("Vaultly is closing."));
  requests.clear();
  try { await close?.(); process.exit(0); }
  catch (error) { console.error(error); process.exit(1); }
}
process.on("message", (message: DesktopResponse | { type: "stop" }) => {
  if (message.type === "stop") { void stop(); return; }
  if (message.type !== "desktop-result") return;
  const request = requests.get(message.id);
  requests.delete(message.id);
  if (message.error) request?.reject(new Error(message.error)); else request?.resolve(message.value ?? null);
});
process.on("disconnect", () => void stop());
process.on("SIGTERM", () => void stop());
void startVaultlyServer({
  port: Number(process.env.VAULTLY_API_PORT ?? "0"),
  staticRoot: process.env.VAULTLY_STATIC_ROOT || undefined,
  pickDirectory: () => desktop("pick-directory"),
  revealPath: async (path) => { await desktop("reveal-path", path); },
  openVideo: async (path) => { await desktop("open-video", path); },
}).then(({ app, address }) => {
  close = () => app.close();
  if (stopping || !process.connected) { stopping = false; void stop(); return; }
  process.send?.({ type: "ready", address });
}).catch((error) => { console.error(error); process.exit(1); });
