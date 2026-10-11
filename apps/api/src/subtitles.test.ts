import { expect, test } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { readSubtitle, videoSubtitles } from "./subtitles.js";
import { getEmbeddedSubtitle, getVideoTracks } from "./video-tracks.js";

const ass = `[Script Info]
ScriptType: v4.00+
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,Hello from ASS
`;
async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-subtitle-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("sidecars match their video across formats without picking another movie's tracks", async () => {
  await fixture(async (root) => {
    const names = ["Film.m2ts", "Other.mp4", "Film.en.ass", "Film.ja.srt", "Film.fr.sbv", "Other.en.vtt", "notes.txt", "junk.jpg"];
    await Promise.all(names.map((name) => writeFile(path.join(root, name), "fixture")));
    expect(await videoSubtitles(path.join(root, "Film.m2ts"))).toEqual(["Film.en.ass", "Film.fr.sbv", "Film.ja.srt"]);
  });
});

test("external ASS, UTF-16 SRT and SBV become readable WebVTT", async () => {
  await fixture(async (root) => {
    const assFile = path.join(root, "Film.en.ass"), srtFile = path.join(root, "Film.fr.srt"), sbvFile = path.join(root, "Film.en.sbv");
    await writeFile(assFile, ass);
    await writeFile(srtFile, Buffer.from("\uFEFF1\n00:00:00,000 --> 00:00:01,000\nBonjour\n", "utf16le"));
    await writeFile(sbvFile, "0:00:00.000,0:00:01.000\nHello SBV\n");
    expect(await readSubtitle(assFile)).toMatch(/WEBVTT[\s\S]*Hello from ASS/);
    expect(await readSubtitle(srtFile)).toContain("00:00:00.000 --> 00:00:01.000\nBonjour");
    expect(await readSubtitle(sbvFile)).toContain("00:00:00.000 --> 00:00:01.000\nHello SBV");
  });
});

test("embedded ASS is discovered with its language and converted for native playback", async () => {
  await fixture(async (root) => {
    const subtitle = path.join(root, "Film.ass"), video = path.join(root, "Film.mkv");
    await writeFile(subtitle, ass);
    await promisify(execFile)(ffmpegInstaller.path, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=s=64x36:r=1", "-i", subtitle,
      "-map", "0:v", "-map", "1:s", "-t", "1", "-c:v", "libx264", "-threads", "1", "-c:s", "copy", "-metadata:s:s:0", "language=eng", "-y", video], { windowsHide: true, timeout: 10_000 });
    const tracks = await getVideoTracks(video);
    expect(tracks.subtitles).toMatchObject([{ codec: "ass", language: "eng" }]);
    expect(await getEmbeddedSubtitle(video, tracks.subtitles[0]!)).toContain("Hello from ASS");
  });
});
