import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { execFile, fork } from "node:child_process";
import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { runtimeDirectory } from "./database.js";
import { withMediaProcess } from "./process-resources.js";

const execFileAsync = promisify(execFile);
const thumbnailDirectory = path.join(runtimeDirectory, "thumbnails");
const inFlight = new Map<string, Promise<string>>();
export interface VideoMetadata { durationSeconds: number | null; width: number | null; height: number | null }
const metadataInFlight = new Map<string, Promise<VideoMetadata>>();
const failedPdfUntil = new Map<string, number>();
const waiting: Array<() => void> = [];
const probeWaiting: Array<() => void> = [];
let running = 0;
let probesRunning = 0;

export function getThumbnailActivity() {
  return { thumbnails: inFlight.size, running, metadata: metadataInFlight.size };
}

export async function clearThumbnailCache(itemIds: number[]): Promise<void> {
  if (!itemIds.length) return;
  const ids = new Set(itemIds);
  const files = await readdir(thumbnailDirectory).catch(() => [] as string[]);
  await Promise.all(files.map(async (filename) => {
    const match = /^(?:video-mid-v2-|pdf-)?(\d+)-/.exec(filename);
    if (match && ids.has(Number(match[1]))) await unlink(path.join(thumbnailDirectory, filename)).catch(() => undefined);
  }));
  for (const cacheKey of failedPdfUntil.keys()) {
    const match = /^pdf-(\d+)-/.exec(cacheKey);
    if (match && ids.has(Number(match[1]))) failedPdfUntil.delete(cacheKey);
  }
}

async function exists(filePath: string): Promise<boolean> {
  try { return (await stat(filePath)).size > 0; }
  catch { return false; }
}

function waitForTask<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return task;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    task.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function waitForSlot(queue: Array<() => void>, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const ready = () => { signal?.removeEventListener("abort", abort); resolve(); };
    const abort = () => {
      const index = queue.indexOf(ready);
      if (index !== -1) queue.splice(index, 1);
      reject(signal?.reason);
    };
    queue.push(ready);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

async function withWorker<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (running >= 2) await waitForSlot(waiting, signal);
  running += 1;
  try { signal?.throwIfAborted(); return await task(); }
  finally {
    running -= 1;
    waiting.shift()?.();
  }
}

async function withProbe<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (probesRunning >= 2) await waitForSlot(probeWaiting, signal);
  probesRunning += 1;
  try { signal?.throwIfAborted(); return await task(); }
  finally {
    probesRunning -= 1;
    probeWaiting.shift()?.();
  }
}

async function captureFrame(inputPath: string, outputPath: string, seekSeconds: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  await withMediaProcess(() => execFileAsync(ffmpegInstaller.path, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "2", "-filter_threads", "1", "-ss", seekSeconds,
    "-i", inputPath, "-frames:v", "1", "-vf", "scale=480:-2",
    "-q:v", "5", "-threads", "2", "-y", outputPath,
  ], { windowsHide: true, timeout: 20_000, maxBuffer: 1024 * 1024, signal }), signal);
  if (!(await exists(outputPath))) throw new Error("FFmpeg did not produce a frame.");
}

export function parseVideoMetadata(diagnostic: string): VideoMetadata {
  const duration = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(diagnostic);
  const seconds = duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : null;
  const streams = diagnostic.split(/\r?\n/).filter((line) => /Stream .*Video:/.test(line) && !line.includes("attached pic"));
  const stream = streams.find((line) => line.includes("(default)")) ?? streams[0] ?? "";
  const dimensions = /(?:^|[,\s])([1-9]\d{1,5})x([1-9]\d{1,5})(?=[,\s]|$)/.exec(stream);
  return {
    durationSeconds: seconds !== null && Number.isFinite(seconds) && seconds > 0 ? seconds : null,
    width: dimensions ? Number(dimensions[1]) : null,
    height: dimensions ? Number(dimensions[2]) : null,
  };
}

export function getVideoMetadata(inputPath: string, signal?: AbortSignal): Promise<VideoMetadata> {
  const pending = metadataInFlight.get(inputPath);
  if (pending) return waitForTask(pending, signal);
  const task = withProbe(async () => {
    let diagnostic = "";
    try {
      const result = await withMediaProcess(() => execFileAsync(ffmpegInstaller.path, ["-hide_banner", "-nostdin", "-threads", "2", "-i", inputPath], {
        windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024, signal,
      }), signal);
      diagnostic = result.stderr;
    } catch (error) {
      signal?.throwIfAborted();
      diagnostic = typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr) : "";
    }
    return parseVideoMetadata(diagnostic);
  }, signal).finally(() => metadataInFlight.delete(inputPath));
  metadataInFlight.set(inputPath, task);
  return task;
}

export async function getVideoDuration(inputPath: string, signal?: AbortSignal): Promise<number | null> {
  return (await getVideoMetadata(inputPath, signal)).durationSeconds;
}

function renderPdfInWorker(inputPath: string, outputPath: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const workerUrl = process.env.VAULTLY_PDF_WORKER_PATH
    ? pathToFileURL(path.resolve(process.env.VAULTLY_PDF_WORKER_PATH))
    : new URL("../pdf-thumbnail-worker.mjs", import.meta.url);
  // Native canvas/PDF failures must not terminate the desktop's main process.
  const processOptions = {
    execArgv: ["--max-old-space-size=256"], windowsHide: true,
    stdio: ["ignore", "ignore", "ignore", "ipc"] as ("ignore" | "ipc")[],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  };
  const worker = fork(workerUrl, [inputPath, outputPath], processOptions);
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.kill();
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => {
      finish(new Error("PDF thumbnail rendering timed out."));
    }, 8_000);
    const abort = () => finish(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    worker.once("message", (message: { ok: boolean; error?: string }) => {
      finish(message.ok ? undefined : new Error(message.error || "PDF thumbnail rendering failed."));
    });
    worker.once("error", (error) => finish(error));
    worker.once("exit", (code) => {
      if (signal?.aborted) finish(signal.reason);
      else finish(new Error(`PDF thumbnail worker exited before producing a thumbnail (code ${code}).`));
    });
  });
}

export function getVideoThumbnail(
  id: number,
  inputPath: string,
  sizeBytes: number,
  modifiedAtMs: number,
  signal?: AbortSignal,
): Promise<string> {
  // Versioned so previously cached opening-frame thumbnails are replaced.
  const cacheKey = `video-mid-v2-${id}-${sizeBytes}-${Math.round(modifiedAtMs)}`;
  const targetPath = path.join(thumbnailDirectory, `${cacheKey}.jpg`);
  const pending = inFlight.get(cacheKey);
  if (pending) return waitForTask(pending, signal);

  const task = (async () => {
    signal?.throwIfAborted();
    if (await exists(targetPath)) return targetPath;
    return withWorker(async () => {
      if (await exists(targetPath)) return targetPath;
      await mkdir(thumbnailDirectory, { recursive: true });
      const temporaryPath = path.join(thumbnailDirectory, `${cacheKey}-${process.pid}-${Date.now()}.tmp.jpg`);
      try {
        const duration = await getVideoDuration(inputPath, signal);
        const middle = duration ? Math.max(0.1, duration * 0.5).toFixed(3) : "10";
        try { await captureFrame(inputPath, temporaryPath, middle, signal); }
        catch {
          signal?.throwIfAborted();
          try { await captureFrame(inputPath, temporaryPath, "5", signal); }
          catch { signal?.throwIfAborted(); await captureFrame(inputPath, temporaryPath, "1", signal); }
        }
        signal?.throwIfAborted();
        await rename(temporaryPath, targetPath);
        return targetPath;
      } finally {
        await unlink(temporaryPath).catch(() => undefined);
      }
    }, signal);
  })().finally(() => inFlight.delete(cacheKey));

  inFlight.set(cacheKey, task);
  return task;
}

export function getPdfThumbnail(
  id: number,
  inputPath: string,
  sizeBytes: number,
  modifiedAtMs: number,
  signal?: AbortSignal,
): Promise<string> {
  const cacheKey = `pdf-${id}-${sizeBytes}-${Math.round(modifiedAtMs)}`;
  const targetPath = path.join(thumbnailDirectory, `${cacheKey}.jpg`);
  const pending = inFlight.get(cacheKey);
  if (pending) return waitForTask(pending, signal);
  const retryAfter = failedPdfUntil.get(cacheKey);
  if (retryAfter && retryAfter > Date.now()) {
    return Promise.reject(new Error("PDF thumbnail rendering is temporarily unavailable."));
  }
  failedPdfUntil.delete(cacheKey);

  const task = (async () => {
    signal?.throwIfAborted();
    if (await exists(targetPath)) return targetPath;
    return withWorker(async () => {
      if (await exists(targetPath)) return targetPath;
      await mkdir(thumbnailDirectory, { recursive: true });
      const temporaryPath = path.join(thumbnailDirectory, `${cacheKey}-${process.pid}-${Date.now()}.tmp.jpg`);
      try {
        await withMediaProcess(() => renderPdfInWorker(inputPath, temporaryPath, signal), signal);
        signal?.throwIfAborted();
        await rename(temporaryPath, targetPath);
        return targetPath;
      } finally {
        await unlink(temporaryPath).catch(() => undefined);
      }
    }, signal);
  })().catch((error: unknown) => {
    if (!signal?.aborted) failedPdfUntil.set(cacheKey, Date.now() + 5 * 60_000);
    throw error;
  }).finally(() => inFlight.delete(cacheKey));

  inFlight.set(cacheKey, task);
  return task;
}
