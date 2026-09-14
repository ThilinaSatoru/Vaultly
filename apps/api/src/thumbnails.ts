import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { execFile } from "node:child_process";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";
import { runtimeDirectory } from "./database.js";

const execFileAsync = promisify(execFile);
const thumbnailDirectory = path.join(runtimeDirectory, "thumbnails");
const inFlight = new Map<string, Promise<string>>();
const failedPdfUntil = new Map<string, number>();
const waiting: Array<() => void> = [];
let running = 0;

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

async function captureFrame(inputPath: string, outputPath: string, seekSeconds: string) {
  await execFileAsync(ffmpegInstaller.path, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-ss", seekSeconds,
    "-i", inputPath, "-frames:v", "1", "-vf", "scale=480:-2",
    "-q:v", "5", "-y", outputPath,
  ], { windowsHide: true, timeout: 20_000, maxBuffer: 1024 * 1024 });
  if (!(await exists(outputPath))) throw new Error("FFmpeg did not produce a frame.");
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
  const cacheKey = `${id}-${sizeBytes}-${Math.round(modifiedAtMs)}`;
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
        try { await captureFrame(inputPath, temporaryPath, "1"); }
        catch { await captureFrame(inputPath, temporaryPath, "0"); }
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
