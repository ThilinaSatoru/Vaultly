import { fork } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { resetProcessShutdown, stopBackgroundProcesses, trackProcess } from "./background-processes.js";

test("shutdown terminates owned subprocesses and their Windows descendants", async () => {
  resetProcessShutdown();
  const directory = await mkdtemp(path.join(tmpdir(), "vaultly-process-test-"));
  const filename = path.join(directory, "worker.cjs");
  await writeFile(filename, `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'}); process.send({pid:child.pid}); setInterval(()=>{},1000);`);
  const child = trackProcess(fork(filename, [], { stdio: ["ignore", "ignore", "ignore", "ipc"] }));
  let descendant = 0;
  try {
    descendant = await new Promise<number>((resolve, reject) => { child.once("message", (message) => resolve((message as { pid: number }).pid)); child.once("error", reject); });
    const parent = child.pid!;
    await stopBackgroundProcesses();
    expect(() => process.kill(parent, 0)).toThrow();
    if (process.platform === "win32") expect(() => process.kill(descendant, 0)).toThrow();
  } finally {
    child.kill(); if (descendant) { try { process.kill(descendant); } catch { /* Already stopped. */ } }
    resetProcessShutdown(); await rm(directory, { recursive: true, force: true });
  }
});
