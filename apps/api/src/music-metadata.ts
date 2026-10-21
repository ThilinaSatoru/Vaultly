import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { runCommand, runBinaryCommand } from "./background-processes.js";
import { withMediaProcess } from "./process-resources.js";

export function parseMusicMetadata(diagnostic: string) {
  const tags: Record<string, string> = {};
  let inMetadata = false;
  for (const line of diagnostic.split(/\r?\n/)) {
    if (/^\s*Stream #|^\s*Duration:/.test(line)) inMetadata = false;
    if (/^\s*Metadata:/.test(line)) { inMetadata = true; continue; }
    const tag = inMetadata && /^\s+([\w -]+?)\s*:\s*(.+)$/.exec(line);
    if (tag) {
      const key = tag[1]!.trim().toLowerCase().replace(/[ -]/g, "_");
      // Container tags take precedence over stream titles/encoder metadata.
      tags[key] ??= tag[2]!.trim().slice(0, 8000);
    }
  }
  const audio = diagnostic.split(/\r?\n/).find((line) => /Stream .*Audio:/.test(line)) ?? "";
  const duration = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(diagnostic);
  return {
    tags,
    duration: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : null,
    bitrate: Number(/(\d+) kb\/s/.exec(audio)?.[1] ?? /bitrate:\s*(\d+) kb\/s/.exec(diagnostic)?.[1]) || null,
    sample_rate: Number(/(\d+) Hz/.exec(audio)?.[1]) || null,
    codec: /Audio:\s*([^\s,(]+)/.exec(audio)?.[1] ?? "",
    channels: /\d+ Hz,\s*([^,]+)/.exec(audio)?.[1]?.trim() ?? "",
    bit_depth: Number(/\((\d+) bit\)/.exec(audio)?.[1] ?? /\b[su](8|16|24|32|64)(?:p|le|be)?\b/.exec(audio)?.[1]) || null,
    hasCover: /Video:.*(?:attached pic|mjpeg|png)/.test(diagnostic),
    hasAudio: Boolean(audio),
  };
}

export async function readMusicMetadata(filename: string, signal: AbortSignal) {
  return withMediaProcess(async () => {
    let diagnostic = "";
    try {
      diagnostic = (await runCommand(ffmpegInstaller.path, ["-hide_banner", "-nostdin", "-threads", "1", "-i", filename],
        { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024, signal })).stderr;
    } catch (error) {
      signal.throwIfAborted();
      if (error && typeof error === "object" && "stderr" in error) diagnostic = String(error.stderr);
      else throw error;
    }
    const metadata = parseMusicMetadata(diagnostic);
    if (!metadata.hasAudio) throw new Error("No readable audio stream in this file.");
    let cover: Buffer | null = null;
    if (metadata.hasCover) {
      try {
        const result = await runBinaryCommand(ffmpegInstaller.path, ["-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "1", "-i", filename,
          "-map", "0:v:0", "-frames:v", "1", "-c:v", "copy", "-f", "image2pipe", "pipe:1"],
        { encoding: "buffer", windowsHide: true, timeout: 20000, maxBuffer: 2 * 1024 * 1024, signal });
        cover = result.stdout;
      } catch { signal.throwIfAborted(); }
    }
    return { ...metadata, cover };
  }, signal);
}
