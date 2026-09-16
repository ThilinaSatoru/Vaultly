import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { execFile } from "node:child_process";
import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";
import { runtimeDirectory } from "./database.js";

const execFileAsync = promisify(execFile);
const thumbnailDirectory = path.join(runtimeDirectory, "thumbnails");
const inFlight = new Map<string, Promise<string>>();
const durationInFlight = new Map<string, Promise<number | null>>();
const failedPdfUntil = new Map<string, number>();
const waiting: Array<() => void> = [];
const probeWaiting: Array<() => void> = [];
let running = 0;
let probesRunning = 0;

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

async function withWorker<T>(task: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  try { return await task(); }
  finally {
    running -= 1;
    waiting.shift()?.();
  }
}

async function withProbe<T>(task: () => Promise<T>): Promise<T> {
  if (probesRunning >= 2) await new Promise<void>((resolve) => probeWaiting.push(resolve));
  probesRunning += 1;
  try { return await task(); }
  finally {
    probesRunning -= 1;
    probeWaiting.shift()?.();
  }
}

async function captureFrame(inputPath: string, outputPath: string, seekSeconds: string) {
  await execFileAsync(ffmpegInstaller.path, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-ss", seekSeconds,
    "-i", inputPath, "-frames:v", "1", "-vf", "scale=480:-2",
    "-q:v", "5", "-y", outputPath,
  ], { windowsHide: true, timeout: 20_000, maxBuffer: 1024 * 1024 });
  if (!(await exists(outputPath))) throw new Error("FFmpeg did not produce a frame.");
}

export function getVideoDuration(inputPath: string): Promise<number | null> {
  const pending = durationInFlight.get(inputPath);
  if (pending) return pending;
  const task = withProbe(async () => {
    let diagnostic = "";
    try {
      const result = await execFileAsync(ffmpegInstaller.path, ["-hide_banner", "-i", inputPath], {
        windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024,
      });
      diagnostic = result.stderr;
    } catch (error) {
      diagnostic = typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr) : "";
    }
    const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(diagnostic);
    if (!match) return null;
    const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }).finally(() => durationInFlight.delete(inputPath));
  durationInFlight.set(inputPath, task);
  return task;
}

function renderPdfInWorker(inputPath: string, outputPath: string): Promise<void> {
  const worker = new Worker(new URL("../pdf-thumbnail-worker.mjs", import.meta.url), {
    workerData: { inputPath, outputPath },
    execArgv: [],
  });
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => {
      void worker.terminate();
      finish(new Error("PDF thumbnail rendering timed out."));
    }, 8_000);
    worker.once("message", (message: { ok: boolean; error?: string }) => {
      finish(message.ok ? undefined : new Error(message.error || "PDF thumbnail rendering failed."));
    });
    worker.once("error", (error) => finish(error));
    worker.once("exit", (code) => {
      if (code !== 0) finish(new Error(`PDF thumbnail worker exited with code ${code}.`));
    });
  });
}

export function getVideoThumbnail(
  id: number,
  inputPath: string,
  sizeBytes: number,
  modifiedAtMs: number,
): Promise<string> {
  // Versioned so previously cached opening-frame thumbnails are replaced.
  const cacheKey = `video-mid-v2-${id}-${sizeBytes}-${Math.round(modifiedAtMs)}`;
  const targetPath = path.join(thumbnailDirectory, `${cacheKey}.jpg`);
  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const task = (async () => {
    if (await exists(targetPath)) return targetPath;
    return withWorker(async () => {
      if (await exists(targetPath)) return targetPath;
      await mkdir(thumbnailDirectory, { recursive: true });
      const temporaryPath = path.join(thumbnailDirectory, `${cacheKey}-${process.pid}-${Date.now()}.tmp.jpg`);
      try {
        const duration = await getVideoDuration(inputPath);
        const middle = duration ? Math.max(0.1, duration * 0.5).toFixed(3) : "10";
        try { await captureFrame(inputPath, temporaryPath, middle); }
        catch {
          try { await captureFrame(inputPath, temporaryPath, "5"); }
          catch { await captureFrame(inputPath, temporaryPath, "1"); }
        }
        await rename(temporaryPath, targetPath);
        return targetPath;
      } finally {
        await unlink(temporaryPath).catch(() => undefined);
      }
    });
  })().finally(() => inFlight.delete(cacheKey));

  inFlight.set(cacheKey, task);
  return task;
}

export function getPdfThumbnail(
  id: number,
  inputPath: string,
  sizeBytes: number,
  modifiedAtMs: number,
): Promise<string> {
  const cacheKey = `pdf-${id}-${sizeBytes}-${Math.round(modifiedAtMs)}`;
  const targetPath = path.join(thumbnailDirectory, `${cacheKey}.jpg`);
  const pending = inFlight.get(cacheKey);
  if (pending) return pending;
  const retryAfter = failedPdfUntil.get(cacheKey);
  if (retryAfter && retryAfter > Date.now()) {
    return Promise.reject(new Error("PDF thumbnail rendering is temporarily unavailable."));
  }
  failedPdfUntil.delete(cacheKey);

  const task = (async () => {
    if (await exists(targetPath)) return targetPath;
    return withWorker(async () => {
      if (await exists(targetPath)) return targetPath;
      await mkdir(thumbnailDirectory, { recursive: true });
      const temporaryPath = path.join(thumbnailDirectory, `${cacheKey}-${process.pid}-${Date.now()}.tmp.jpg`);
      try {
        await renderPdfInWorker(inputPath, temporaryPath);
        await rename(temporaryPath, targetPath);
        return targetPath;
      } finally {
        await unlink(temporaryPath).catch(() => undefined);
      }
    });
  })().catch((error: unknown) => {
    failedPdfUntil.set(cacheKey, Date.now() + 5 * 60_000);
    throw error;
  }).finally(() => inFlight.delete(cacheKey));

  inFlight.set(cacheKey, task);
  return task;
}
