import { startVaultlyServer } from "./server.js";

const apiPort = Number.parseInt(process.env.VAULTLY_API_PORT ?? "4400", 10);
await startVaultlyServer({ port: apiPort });
