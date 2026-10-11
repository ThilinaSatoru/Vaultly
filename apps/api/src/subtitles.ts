import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { withMediaProcess } from "./process-resources.js";

const execute = promisify(execFile);
const subtitleExtensions = /\.(?:srt|vtt|ass|ssa|sub|sbv|smi|sami|lrc|mpl|stl)$/i;

export async function videoSubtitles(videoPath: string) {
  const directory = path.dirname(videoPath);
  const stem = path.basename(videoPath, path.extname(videoPath)).toLowerCase();
  const entries = await readdir(directory, { withFileTypes: true });
  const videos = entries.filter((entry) => entry.isFile() && /\.(?:mp4|m4v|mkv|webm|avi|mov|wmv|flv|mpeg|mpg|ts|mts|m2ts|vob|ogv|3gp|3g2|asf|mxf)$/i.test(entry.name));
  return entries.filter((entry) => {
    if (!entry.isFile() || !subtitleExtensions.test(entry.name)) return false;
    const subtitleStem = path.basename(entry.name, path.extname(entry.name)).toLowerCase();
    return subtitleStem === stem || (subtitleStem.startsWith(stem) && /^[ ._-]/.test(subtitleStem.slice(stem.length))) || videos.length === 1;
  }).map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
}
export function subtitleVtt(text: string) {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (normalized.startsWith("WEBVTT")) return normalized;
  return `WEBVTT\n\n${normalized.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")}`;
}
export async function readSubtitle(filename: string) {
  if ((await stat(filename)).size > 4 * 1024 * 1024) throw new Error("Subtitle is too large.");
  if (!/\.(?:srt|vtt|sbv)$/i.test(filename)) {
    // Convert text subtitle formats into the browser's native timed-text format.
    return withMediaProcess(async () => (await execute(ffmpegInstaller.path,
      ["-hide_banner", "-nostdin", "-loglevel", "error", "-i", filename, "-map", "0:s:0", "-f", "webvtt", "pipe:1"],
      { windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })).stdout);
  }
  const data = await readFile(filename);
  const text = (data[0] === 0xfe && data[1] === 0xff ? data.subarray(2).swap16().toString("utf16le")
    : data.toString(data[0] === 0xff && data[1] === 0xfe ? "utf16le" : "utf8")).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (/\.sbv$/i.test(filename)) return subtitleVtt(text.replace(/^(\d+):(\d{2}):(\d{2}\.\d{3}),(\d+):(\d{2}):(\d{2}\.\d{3})$/gm,
    (_match, h1: string, m1: string, s1: string, h2: string, m2: string, s2: string) => `${h1.padStart(2, "0")}:${m1}:${s1} --> ${h2.padStart(2, "0")}:${m2}:${s2}`));
  return subtitleVtt(text);
}
