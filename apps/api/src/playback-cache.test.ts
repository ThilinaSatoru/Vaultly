import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { removeLegacyPlaybackCache } from "./playback-cache.js";

test("retired conversion cache cleanup removes generated copies and leaves unrelated media and thumbnails", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-cache-cleanup-"));
  try {
    const cache = path.join(root, "playback");
    await mkdir(cache);
    await mkdir(path.join(root, "thumbnails"));
    await Promise.all([
      writeFile(path.join(cache, "h264-v1-1-100-1000.mp4"), "completed copy"),
      writeFile(path.join(cache, "h264-v1-1-100-1000-123.partial.mp4"), "partial copy"),
      writeFile(path.join(cache, "Original.mp4"), "user file"),
      writeFile(path.join(root, "thumbnails", "video-1.jpg"), "thumbnail"),
    ]);
    await removeLegacyPlaybackCache(root);
    expect(await readdir(cache)).toEqual(["Original.mp4"]);
    expect(await readFile(path.join(root, "thumbnails", "video-1.jpg"), "utf8")).toBe("thumbnail");
    await removeLegacyPlaybackCache(root);
    expect(await readFile(path.join(cache, "Original.mp4"), "utf8")).toBe("user file");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("cleanup skips a redirected cache directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-cache-link-"));
  const target = await mkdtemp(path.join(tmpdir(), "vaultly-cache-target-"));
  try {
    await writeFile(path.join(target, "h264-v1-1-100-1000.mp4"), "unrelated file");
    await symlink(target, path.join(root, "playback"), process.platform === "win32" ? "junction" : "dir");
    await removeLegacyPlaybackCache(root);
    expect(await readFile(path.join(target, "h264-v1-1-100-1000.mp4"), "utf8")).toBe("unrelated file");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});
