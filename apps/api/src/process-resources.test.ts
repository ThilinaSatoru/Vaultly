import os from "node:os";
import { expect, test, vi } from "vitest";
import { getSystemResources, withMediaProcess, withSourceScan } from "./process-resources.js";

test("shares a two-process cap across tasks and releases slots after failures", async () => {
  const memory = vi.spyOn(os, "freemem").mockReturnValue(os.totalmem());
  const releases: Array<() => void> = [];
  const run = () => withMediaProcess(() => new Promise<void>((resolve) => releases.push(resolve)));
  const first = run(), second = run(), third = run();
  try {
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    expect(getSystemResources()).toMatchObject({ activeProcesses: 2, waitingProcesses: 1 });
    releases[0]();
    await vi.waitFor(() => expect(releases).toHaveLength(3));
    releases[1](); releases[2]();
    await Promise.all([first, second, third]);
    await expect(withMediaProcess(async () => { throw new Error("Failed process"); })).rejects.toThrow("Failed process");
    expect(getSystemResources().activeProcesses).toBe(0);
  } finally { for (const release of releases) release(); memory.mockRestore(); }
});

test("low memory queues work and cancellation removes it without starting a process", async () => {
  const memory = vi.spyOn(os, "freemem").mockReturnValue(0);
  const controller = new AbortController();
  const task = vi.fn(async () => undefined);
  const queued = withMediaProcess(task, controller.signal);
  try {
    expect(getSystemResources().lowMemory).toBe(true);
    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(task).not.toHaveBeenCalled();
    expect(getSystemResources()).toMatchObject({ activeProcesses: 0, waitingProcesses: 0 });
  } finally { memory.mockRestore(); }
});

test("source scans serialize and queued scans can be cancelled", async () => {
  const memory = vi.spyOn(os, "freemem").mockReturnValue(os.totalmem());
  let finish!: () => void;
  const first = withSourceScan(() => new Promise<void>((resolve) => { finish = resolve; }));
  const controller = new AbortController();
  const task = vi.fn(async () => undefined);
  const queued = withSourceScan(task, controller.signal);
  try {
    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(task).not.toHaveBeenCalled();
  } finally { finish(); await first; memory.mockRestore(); }
});

test("a running scan reduces media work to one process and releases the limit afterward", async () => {
  const memory = vi.spyOn(os, "freemem").mockReturnValue(os.totalmem());
  let finishScan!: () => void;
  const scan = withSourceScan(() => new Promise<void>((resolve) => { finishScan = resolve; }));
  const releases: Array<() => void> = [];
  const run = () => withMediaProcess(() => new Promise<void>((resolve) => releases.push(resolve)));
  const first = run(), second = run();
  try {
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    expect(getSystemResources()).toMatchObject({ processLimit: 1, activeProcesses: 1 });
    releases[0]();
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[1]();
    await Promise.all([first, second]);
  } finally { releases.forEach((release) => release()); finishScan(); await scan; memory.mockRestore(); }
  expect(getSystemResources().processLimit).toBe(2);
});
