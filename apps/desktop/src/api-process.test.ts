import { expect, test } from "vitest";
import { build } from "esbuild";
import { fork } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

test.each(["node", "electron"])("isolated API starts under %s, delegates the folder picker over IPC and exits without leftover work", async (runtime: string) => {
  // Keep the temporary bundle below the package so native dependencies resolve normally.
  const directory = await mkdtemp(path.join(process.cwd(), ".api-process-test-"));
  const bundle = path.join(directory, "api.cjs");
  await build({ entryPoints: [fileURLToPath(new URL("./api-process.ts", import.meta.url))], outfile: bundle, platform: "node", format: "cjs", bundle: true, define: { "import.meta.url": "undefined" }, external: ["@ffmpeg-installer/ffmpeg", "@napi-rs/canvas"], logLevel: "silent" });
  const child = fork(bundle, [], { execPath: runtime === "electron" ? createRequire(import.meta.url)("electron") as string : process.execPath, execArgv: [], stdio: ["ignore", "ignore", "pipe", "ipc"], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", VAULTLY_RUNTIME_DIR: path.join(directory, "runtime"), VAULTLY_API_PORT: "0", VAULTLY_STATIC_ROOT: "" } });
  let diagnostic = ""; child.stderr?.on("data", (chunk) => { diagnostic += chunk.toString(); });
  const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
  try {
    const address = await new Promise<string>((resolve, reject) => {
      child.on("message", (message: { type: string; id: number; address: string }) => {
        if (message.type === "ready") resolve(message.address);
        if (message.type === "desktop") child.send({ type: "desktop-result", id: message.id, value: directory });
      });
      child.once("error", reject); child.once("exit", () => reject(new Error(diagnostic)));
    });
    expect(await (await fetch(`${address}/api/health`)).json()).toEqual({ ok: true });
    expect(await (await fetch(`${address}/api/system/pick-directory`, { method: "POST" })).json()).toEqual({ path: directory });
    const pid = child.pid!;
    child.send({ type: "stop" });
    expect(await exited, diagnostic).toBe(0);
    expect(() => process.kill(pid, 0)).toThrow();
  } finally { child.kill(); await exited; await rm(directory, { recursive: true, force: true }); }
}, 20000);
