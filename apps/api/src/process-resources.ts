import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";

let previous = os.cpus();
let sampledAt = 0;
let cpuPercent = 0;
let active = 0;
let scansActive = 0;
let waiting = 0;
const limit = 2;
export function getSystemResources() {
  const now = Date.now();
  if (now - sampledAt >= 500) {
    const current = os.cpus();
    let idle = 0, total = 0;
    current.forEach((cpu, index) => {
      const old = previous[index]?.times;
      if (!old) return;
      idle += cpu.times.idle - old.idle;
      total += Object.values(cpu.times).reduce((sum, value) => sum + value, 0) - Object.values(old).reduce((sum, value) => sum + value, 0);
    });
    if (total > 0) cpuPercent = Math.round((1 - idle / total) * 100);
    previous = current; sampledAt = now;
  }
  const freeBytes = os.freemem(), totalBytes = os.totalmem();
  return { cpuPercent, freeBytes, totalBytes, appBytes: process.memoryUsage().rss,
    activeProcesses: active, waitingProcesses: waiting, processLimit: limit,
    lowMemory: freeBytes < Math.min(512 * 1024 * 1024, totalBytes * 0.1) };
}

async function withSlot<T>(scan: boolean, task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const started = Date.now();
  waiting++;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const resources = getSystemResources();
      if ((scan ? scansActive < 1 : active < limit) && !resources.lowMemory
        && (resources.cpuPercent < 95 || Date.now() - started >= 5000)) break;
      await delay(250, undefined, { signal });
    }
    if (scan) scansActive++; else active++;
  } finally { waiting--; }
  try { return await task(); }
  finally { if (scan) scansActive--; else active--; }
}
export const withMediaProcess = <T>(task: () => Promise<T>, signal?: AbortSignal) => withSlot(false, task, signal);
export const withSourceScan = <T>(task: () => Promise<T>, signal?: AbortSignal) => withSlot(true, task, signal);
