import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { execFile } from "node:child_process";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { runtimeDirectory } from "./database.js";
import { withMediaProcess } from "./process-resources.js";

const execute = promisify(execFile);
export interface VideoTrack { index: number; language: string; title: string; codec: string; default: boolean }
export function parseVideoTracks(diagnostic: string) {
  const audio: VideoTrack[] = [], subtitles: VideoTrack[] = [];
  let current: VideoTrack | undefined;
  for (const line of diagnostic.split(/\r?\n/)) {
    if (/^\s*Stream #/.test(line)) {
      current = undefined;
      const match = /Stream #0:(\d+)(?:\[[^\]]+\])?(?:\(([^)]+)\))?: (Audio|Subtitle): ([\w]+)/.exec(line);
      if (!match) continue;
      const [, index, language, kind, codec] = match;
      if (kind === "Subtitle" && !["subrip", "ass", "ssa", "mov_text", "webvtt", "text", "microdvd", "mpl2", "jacosub", "sami", "realtext", "subviewer", "subviewer1", "vplayer", "pjs", "ttml"].includes(codec!)) continue;
      current = { index: Number(index), language: language ?? "und", title: "", codec: codec!, default: line.includes("(default)") };
      (kind === "Audio" ? audio : subtitles).push(current);
    } else if (current) {
      const title = /^\s+title\s*:\s*(.+)/i.exec(line);
      if (title) current.title = title[1]!.trim();
    }
  }
  return { audio, subtitles };
}
const probing = new Map<string, Promise<ReturnType<typeof parseVideoTracks>>>();
export async function getVideoTracks(filename: string) {
  const info = await stat(filename);
  const key = `${filename}:${info.size}:${info.mtimeMs}`;
  const pending = probing.get(key);
  if (pending) return pending;
  const task = withMediaProcess(async () => {
    let diagnostic = "";
    try {
      diagnostic = (await execute(ffmpegInstaller.path, ["-hide_banner", "-nostdin", "-i", filename], { windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 })).stderr;
    } catch (error) {
      if (error && typeof error === "object" && "stderr" in error) diagnostic = String(error.stderr);
    }
    return parseVideoTracks(diagnostic);
  });
  probing.set(key, task);
  // Keep a small metadata cache; signatures invalidate edited files.
  if (probing.size > 100) probing.delete(probing.keys().next().value!);
  task.catch(() => probing.delete(key));
  return task;
}

const extracting = new Map<string, Promise<string>>();
export async function getAudioTrack(id: number, filename: string, track: VideoTrack) {
  const info = await stat(filename);
  const directory = path.join(runtimeDirectory, "audio-tracks");
  const target = path.join(directory, `${id}-${info.size}-${Math.round(info.mtimeMs)}-${track.index}.m4a`);
  if ((await stat(target).catch(() => null))?.size) return target;
  const pending = extracting.get(target);
  if (pending) return pending;
  const task = withMediaProcess(async () => {
    await mkdir(directory, { recursive: true });
    const temporary = `${target}.${process.pid}.tmp.m4a`;
    try {
      await execute(ffmpegInstaller.path, ["-hide_banner", "-nostdin", "-loglevel", "error", "-threads", "2", "-i", filename,
        "-map", `0:${track.index}`, "-vn", "-sn", "-c:a", track.codec === "aac" ? "copy" : "aac", "-b:a", "192k",
        "-threads", "2", "-movflags", "+faststart", "-y", temporary], { windowsHide: true, timeout: 300_000, maxBuffer: 1024 * 1024 });
      if (!(await stat(temporary)).size) throw new Error("Empty audio track.");
      await rename(temporary, target);
      return target;
    } finally { await unlink(temporary).catch(() => undefined); }
  }).finally(() => extracting.delete(target));
  extracting.set(target, task);
  return task;
}

export function getEmbeddedSubtitle(filename: string, track: VideoTrack) {
  return withMediaProcess(async () => (await execute(ffmpegInstaller.path, ["-hide_banner", "-nostdin", "-loglevel", "error", "-threads", "2",
    "-i", filename, "-map", `0:${track.index}`, "-f", "webvtt", "pipe:1"], { windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })).stdout);
}
