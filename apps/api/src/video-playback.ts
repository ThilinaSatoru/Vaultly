import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { spawn } from "node:child_process";
import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { runtimeDirectory } from "./database.js";

export interface PlaybackInput {
  id: number;
  inputPath: string;
  sizeBytes: number;
  modifiedAtMs: number;
}
export interface PlaybackStatus {
  state: "idle" | "queued" | "preparing" | "ready" | "failed";
  percent: number;
  message?: string;
}
interface Job {
  input: PlaybackInput;
  status: PlaybackStatus;
  controller: AbortController;
  sessions: Set<string>;
  task?: Promise<void>;
}
const cacheDirectory = path.join(runtimeDirectory, "playback");
const jobs = new Map<string, Job>();
const cancelledSessions = new Set<string>();
let running = 0;
let stopping = false;
const keyFor = (input: PlaybackInput) => `h264-v1-${input.id}-${input.sizeBytes}-${Math.round(input.modifiedAtMs)}`;
const fileFor = (input: PlaybackInput) => path.join(cacheDirectory, `${keyFor(input)}.mp4`);

async function exists(filePath: string) {
  try { return (await stat(filePath)).size > 0; } catch { return false; }
}

export async function getVideoPlaybackStatus(input: PlaybackInput): Promise<PlaybackStatus> {
  if (await exists(fileFor(input))) return { state: "ready", percent: 100 };
  const job = jobs.get(keyFor(input));
  return job ? { ...job.status } : { state: "idle", percent: 0 };
}

function encode(job: Job, temporaryPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegInstaller.path, [
      "-hide_banner", "-nostdin", "-y", "-i", job.input.inputPath,
      "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn",
      "-vf", "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-threads", "2",
      "-c:a", "aac", "-b:a", "160k", "-ac", "2", "-movflags", "+faststart",
      "-progress", "pipe:1", "-nostats", temporaryPath,
    ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], signal: job.controller.signal });
    let diagnostic = "";
    let duration = 0;
    let pending = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      diagnostic = (diagnostic + chunk).slice(-8192);
      const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(diagnostic);
      if (match) duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    });
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      const lines = (pending + chunk).split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const time = /^out_time_(?:us|ms)=(\d+)/.exec(line);
        if (time && duration > 0) job.status.percent = Math.min(99, Math.round(Number(time[1]) / 1_000_000 / duration * 100));
      }
    });
    let error: Error | undefined;
    child.once("error", (reason) => { error = reason; });
    child.once("close", (code) => {
      if (job.controller.signal.aborted) reject(job.controller.signal.reason);
      else if (error) reject(error);
      else if (code !== 0) reject(new Error(`Video conversion failed (${code}): ${diagnostic.slice(-2000)}`));
      else resolve();
    });
  });
}

function runQueue() {
  if (stopping || running >= 1) return;
  const queued = [...jobs.entries()].find(([, job]) => job.status.state === "queued");
  if (!queued) return;
  const [key, job] = queued;
  running++;
  job.status.state = "preparing";
  const temporaryPath = path.join(cacheDirectory, `${key}-${process.pid}.partial.mp4`);
  job.task = (async () => {
    try {
      await mkdir(cacheDirectory, { recursive: true });
      job.controller.signal.throwIfAborted();
      await encode(job, temporaryPath);
      job.controller.signal.throwIfAborted();
      if (!(await exists(temporaryPath))) throw new Error("No playable video was produced.");
      await rename(temporaryPath, fileFor(job.input));
      // Keep only the current completed copy of a rescanned item.
      const prefix = `h264-v1-${job.input.id}-`;
      await Promise.all((await readdir(cacheDirectory)).filter((name) => name.startsWith(prefix)
        && name.endsWith(".mp4") && !name.endsWith(".partial.mp4") && name !== `${key}.mp4`)
        .map((name) => unlink(path.join(cacheDirectory, name)).catch(() => undefined)));
      if (jobs.get(key) === job) jobs.delete(key);
    } catch {
      job.status = { state: "failed", percent: 0,
        message: "This video could not be prepared for playback. Retry or download the original file." };
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
      running--;
      runQueue();
    }
  })();
}

export async function prepareVideoPlayback(input: PlaybackInput, retry = false, session?: string): Promise<PlaybackStatus> {
  const current = await getVideoPlaybackStatus(input);
  if (session && cancelledSessions.has(session)) return { state: "idle", percent: 0 };
  if (current.state === "ready") return current;
  const pending = jobs.get(keyFor(input));
  if (pending && pending.status.state !== "failed") {
    if (session) pending.sessions.add(session);
    return { ...pending.status };
  }
  if (current.state === "failed" && !retry) return current;
  if (stopping) return { state: "failed", percent: 0, message: "Playback preparation is shutting down." };
  // A changed source file invalidates any conversion still running for this item.
  for (const [key, job] of jobs) if (job.input.id === input.id && key !== keyFor(input)) {
    job.controller.abort();
    jobs.delete(key);
  }
  const job: Job = { input, status: { state: "queued", percent: 0 }, controller: new AbortController(), sessions: new Set(session ? [session] : []) };
  jobs.set(keyFor(input), job);
  runQueue();
  return { ...job.status };
}

export async function getVideoPlaybackFile(input: PlaybackInput): Promise<string | null> {
  return await exists(fileFor(input)) ? fileFor(input) : null;
}

export async function cancelVideoPlayback(input: PlaybackInput, session?: string): Promise<void> {
  if (session) {
    cancelledSessions.add(session);
    if (cancelledSessions.size > 1024) cancelledSessions.delete(cancelledSessions.values().next().value!);
  }
  const key = keyFor(input);
  const job = jobs.get(key);
  if (!job) return;
  if (session) {
    job.sessions.delete(session);
    if (job.sessions.size > 0) return;
  }
  job.controller.abort();
  jobs.delete(key);
  await job.task;
}

export async function stopVideoPlaybacks(): Promise<void> {
  stopping = true;
  const active = [...jobs.values()];
  jobs.clear();
  for (const job of active) job.controller.abort();
  await Promise.all(active.map((job) => job.task));
  stopping = false;
}
