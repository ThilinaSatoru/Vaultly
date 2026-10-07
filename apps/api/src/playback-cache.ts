import { readdir, realpath, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { runtimeDirectory } from "./database.js";

/** Remove only files named by the retired playback converter. */
export async function removeLegacyPlaybackCache(baseDirectory = runtimeDirectory): Promise<void> {
  const expected = path.join(await realpath(baseDirectory), "playback");
  const resolved = await realpath(expected).catch(() => null);
  // A redirected cache directory may contain unrelated user files.
  if (!resolved || path.relative(expected, resolved) !== "") return;
  const entries = await readdir(resolved, { withFileTypes: true });
  await Promise.all(entries.filter((entry) => entry.isFile()
    && /^h264-v1-\d+-\d+-\d+(?:-\d+\.partial)?\.mp4$/.test(entry.name))
    .map((entry) => unlink(path.join(resolved, entry.name)).catch(() => undefined)));
  await rmdir(resolved).catch(() => undefined);
}
