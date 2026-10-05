import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test, vi } from "vitest";
import { database } from "./database.js";
import { scanSource } from "./scanner.js";
import { buildVaultlyServer } from "./server.js";
import { getVideoPlaybackFile } from "./video-playback.js";

const run = promisify(execFile);
test.each([
  ["ts", "mpegts", "mpeg2video", "mp2"],
  ["mkv", "matroska", "mpeg4", "pcm_s16le"],
  ["avi", "avi", "mpeg4", "libmp3lame"],
])("converts real %s video into seekable H.264/AAC, caches it and preserves the original", async (extension, format, videoCodec, audioCodec) => {
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-playback-"));
  const inputPath = path.join(root, `Sample.${extension}`);
  const app = await buildVaultlyServer();
  app.log.level = "silent";
  const source = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES (?, ?, ?)").run("Playback fixture", root, root).lastInsertRowid);
  let cachedFile: string | null = null;
  try {
    await run(ffmpegInstaller.path, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=10",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "1", "-c:v", videoCodec,
      "-pix_fmt", "yuv420p", "-c:a", audioCodec, "-f", format, inputPath], { windowsHide: true });
    const original = await readFile(inputPath);
    await scanSource(source, root);
    const item = database.prepare("SELECT id, size_bytes, modified_at_ms FROM media_items WHERE source_id = ?").get(source) as { id: number; size_bytes: number; modified_at_ms: number };
    const url = `/api/items/${item.id}/playback`;
    expect((await app.inject(url)).json().state).toBe("idle");
    expect((await app.inject(`${url}/file`)).statusCode).toBe(409);
    const start = await app.inject({ method: "POST", url });
    expect(start.statusCode).toBe(202);
    expect(["queued", "preparing"]).toContain(start.json().state);
    await vi.waitFor(async () => expect((await app.inject(url)).json()).toMatchObject({ state: "ready", percent: 100 }), { timeout: 15000, interval: 100 });
    const ranged = await app.inject({ url: `${url}/file`, headers: { range: "bytes=0-15" } });
    expect(ranged.statusCode).toBe(206);
    expect(ranged.headers["content-type"]).toBe("video/mp4");
    expect(ranged.rawPayload.subarray(4, 8).toString()).toBe("ftyp");
    expect(ranged.rawPayload).toHaveLength(16);
    expect((await app.inject({ method: "POST", url })).json().state).toBe("ready");
    cachedFile = await getVideoPlaybackFile({ id: item.id, inputPath, sizeBytes: item.size_bytes, modifiedAtMs: item.modified_at_ms });
    expect(cachedFile).toBeTruthy();
    const decoded = await run(ffmpegInstaller.path, ["-hide_banner", "-i", cachedFile!, "-f", "null", "-"], { windowsHide: true });
    expect(decoded.stderr).toMatch(/Video: h264/);
    expect(decoded.stderr).toMatch(/Audio: aac/);
    expect(await readFile(inputPath)).toEqual(original);
  } finally {
    await app.close();
    database.prepare("DELETE FROM sources WHERE id = ?").run(source);
    if (cachedFile) await rm(cachedFile, { force: true });
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
