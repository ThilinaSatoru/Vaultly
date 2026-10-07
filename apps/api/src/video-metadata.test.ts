import { expect, test } from "vitest";
import { getVideoMetadata, parseVideoMetadata } from "./thumbnails.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

test("reads duration and resolution from FFmpeg video diagnostics", () => {
  expect(parseVideoMetadata(`Duration: 01:02:03.50, start: 0.000000, bitrate: 600 kb/s
    Stream #0:0: Video: h264 (High), yuv420p, 1920x1080 [SAR 1:1 DAR 16:9], 30 fps (default)`))
    .toEqual({ durationSeconds: 3723.5, width: 1920, height: 1080 });
});

test("skips attached artwork and prefers the default video stream", () => {
  expect(parseVideoMetadata(`Stream #0:0: Video: mjpeg, yuv420p, 3000x3000 (attached pic)
    Stream #0:1: Video: h264, yuv420p, 320x240, 30 fps
    Stream #0:2: Video: h264, yuv420p, 1080x1920, 30 fps (default)`))
    .toEqual({ durationSeconds: null, width: 1080, height: 1920 });
});

test("unreadable files and audio-only files have no video dimensions", () => {
  expect(parseVideoMetadata("Invalid data found when processing input")).toEqual({ durationSeconds: null, width: null, height: null });
  expect(parseVideoMetadata("Stream #0:0: Audio: aac, 48000 Hz").width).toBeNull();
});

test("the bundled FFmpeg reads resolution from an actual video file", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "vaultly-resolution-"));
  try {
    const file = path.join(directory, "480p.mp4");
    await promisify(execFile)(ffmpegInstaller.path, ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "lavfi", "-i", "color=c=black:s=720x480:r=1", "-t", "1", "-c:v", "mpeg4", "-y", file], { windowsHide: true });
    expect(await getVideoMetadata(file)).toEqual({ durationSeconds: 1, width: 720, height: 480 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
