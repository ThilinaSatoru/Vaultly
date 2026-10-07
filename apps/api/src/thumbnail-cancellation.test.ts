import { expect, test, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { getEventListeners } from "node:events";
import { getPdfThumbnail, getVideoThumbnail, getThumbnailActivity } from "./thumbnails.js";

const { workers, probes } = vi.hoisted(() => ({
  workers: [] as Array<{ outputPath: string; terminate: ReturnType<typeof vi.fn>; emit: (event: string, ...args: unknown[]) => boolean }>,
  probes: [] as Array<{ args: string[]; signal: AbortSignal }>,
}));

vi.mock("node:worker_threads", async () => {
  const { EventEmitter } = await import("node:events");
  return { Worker: class extends EventEmitter {
    outputPath: string;
    terminate = vi.fn(async () => { this.emit("exit", 1); return 1; });
    constructor(_url: URL, options: { workerData: { outputPath: string } }) {
      super();
      this.outputPath = options.workerData.outputPath;
      workers.push(this);
    }
  } };
});

vi.mock("node:child_process", () => ({
  execFile: (_file: string, args: string[], options: { signal: AbortSignal }, callback: (error: Error) => void) => {
    probes.push({ args, signal: options.signal });
    const abort = () => callback(Object.assign(new Error("Cancelled"), { name: "AbortError" }));
    options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) abort();
  },
}));

test("PDF cancellation terminates active workers, removes queued jobs, and allows an immediate retry", async () => {
  const controllers = Array.from({ length: 3 }, () => new AbortController());
  const stamp = Date.now();
  const first = getPdfThumbnail(900001, "first.pdf", 1, stamp, controllers[0].signal).catch((error: unknown) => error);
  const second = getPdfThumbnail(900002, "second.pdf", 1, stamp, controllers[1].signal).catch((error: unknown) => error);
  await vi.waitFor(() => expect(workers).toHaveLength(2));
  const queued = getPdfThumbnail(900003, "third.pdf", 1, stamp, controllers[2].signal).catch((error: unknown) => error);
  await vi.waitFor(() => expect(getEventListeners(controllers[2].signal, "abort")).toHaveLength(1));
  expect(getThumbnailActivity()).toMatchObject({ thumbnails: 3, running: 2 });
  controllers[2].abort();
  expect(await queued).toMatchObject({ name: "AbortError" });
  controllers[0].abort();
  controllers[1].abort();
  for (const result of await Promise.all([first, second])) expect(result).toMatchObject({ name: "AbortError" });
  expect(workers).toHaveLength(2);
  expect(getThumbnailActivity()).toMatchObject({ thumbnails: 0, running: 0 });
  for (const worker of workers) expect(worker.terminate).toHaveBeenCalledOnce();

  const retry = getPdfThumbnail(900001, "first.pdf", 1, stamp);
  await vi.waitFor(() => expect(workers).toHaveLength(3));
  const worker = workers[2];
  await writeFile(worker.outputPath, "thumbnail");
  worker.emit("message", { ok: true });
  const cached = await retry;
  expect(cached).toMatch(/\.jpg$/);
  await expect(getPdfThumbnail(900001, "first.pdf", 1, stamp)).resolves.toBe(cached);
  expect(workers).toHaveLength(3);
});

test("video cancellation aborts the duration probe and does not launch fallback frame captures", async () => {
  const controller = new AbortController();
  const thumbnail = getVideoThumbnail(900004, "video.mp4", 1, Date.now(), controller.signal).catch((error: unknown) => error);
  await vi.waitFor(() => expect(probes).toHaveLength(1));
  expect(probes[0].signal).toBe(controller.signal);
  expect(getThumbnailActivity()).toMatchObject({ thumbnails: 1, metadata: 1 });
  controller.abort();
  expect(await thumbnail).toMatchObject({ name: "AbortError" });
  expect(probes).toHaveLength(1);
  expect(getThumbnailActivity()).toMatchObject({ thumbnails: 0, metadata: 0 });
});
