import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { database } from "./database.js";
import { buildVaultlyServer } from "./server.js";
import { cancelSourceConversion, checkConversionRuntime, conversionWorker, getConversionProgress, startSourceConversion } from "./source-conversion.js";

const run = promisify(execFile);

test("subprocess diagnostics tolerate invalid Windows bytes and remux retries precede full encoding", async () => {
  const functions = conversionWorker.split("\nimport math\n")[0];
  const checks = `
r = run([sys.executable, '-c', 'import sys; sys.stdout.buffer.write(bytes([0x9d]))'])
assert r.returncode == 0 and r.stdout == '\\ufffd', repr(r.stdout)
attempts = []
plan = lambda src: (True, True)
def fake_ffmpeg(cmd, total):
    attempts.append(cmd)
    return len(attempts) == 3, ['copy failed']
run_ffmpeg = fake_ffmpeg
assert convert(Path('source.mkv'), Path('output.tmp'), 1)[0]
assert [cmd[cmd.index('-c:v')+1] for cmd in attempts] == ['copy', 'copy', 'libx264']
assert [cmd[cmd.index('-c:a')+1] for cmd in attempts] == ['copy', 'aac', 'aac']
assert all(cmd[cmd.index('-threads')+1] == '2' for cmd in attempts)
`;
  await expect(run(process.env.VAULTLY_PYTHON || "python", ["-X", "utf8=0", "-c", functions + checks], {
    windowsHide: true, env: { ...process.env, PYTHONUTF8: "0", PYTHONIOENCODING: "utf-8:replace" },
  })).resolves.toMatchObject({ stderr: "" });
});

test("cancelling a separate conversion job leaves originals and index unchanged", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-conversion-cancel-"));
  const id = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES ('Cancel conversion', ?, ?)").run(root, root).lastInsertRowid);
  try {
    await writeFile(path.join(root, "original.avi"), "original bytes");
    database.prepare(`INSERT INTO media_items(source_id, media_type, title, filename, file_extension, relative_path, size_bytes, modified_at_ms, file_count)
      VALUES (?, 'video', 'Original', 'original.avi', '.avi', 'original.avi', 14, 1, 1)`).run(id);
    startSourceConversion(id, root);
    const progress = await cancelSourceConversion(id);
    expect(progress?.status).toBe("cancelled");
    expect(progress?.converted).toBe(0);
    expect(await readFile(path.join(root, "original.avi"), "utf8")).toBe("original bytes");
    expect(database.prepare("SELECT relative_path FROM media_items WHERE source_id = ?").get(id)).toEqual({ relative_path: "original.avi" });
  } finally { database.prepare("DELETE FROM sources WHERE id = ?").run(id); await rm(root, { recursive: true, force: true }); }
});

test("conversion requires a completed scan and rejects unrelated origins", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-conversion-routes-"));
  const id = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES ('Conversion routes', ?, ?)").run(root, root).lastInsertRowid);
  const app = await buildVaultlyServer();
  app.log.level = "silent";
  try {
    expect((await app.inject({ method: "POST", url: `/api/sources/${id}/conversion` })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `/api/sources/${id}/conversion`, headers: { origin: "https://unrelated.example" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `/api/sources/${id}/conversion` })).json()).toBeNull();
  } finally { await app.close(); database.prepare("DELETE FROM sources WHERE id = ?").run(id); await rm(root, { recursive: true, force: true }); }
});

test("real converter preserves IDs and favorites, skips supported/colliding files and keeps failed originals", async () => {
  await checkConversionRuntime();
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-conversion-测试-”"));
  const id = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path, status, last_scanned_at) VALUES ('Conversion fixture', ?, ?, 'ready', CURRENT_TIMESTAMP)").run(root, root).lastInsertRowid);
  const insert = database.prepare(`INSERT INTO media_items(source_id, media_type, title, filename, file_extension, relative_path, size_bytes, modified_at_ms, file_count, favorite)
    VALUES (?, 'video', 'Custom title', ?, ?, ?, 1, 1, 1, 1)`);
  try {
    await run("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=32x32:r=10", "-t", "0.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(root, "convert.mkv")], { windowsHide: true });
    await run("ffmpeg", ["-v", "error", "-i", path.join(root, "convert.mkv"), "-c", "copy", path.join(root, "supported.mp4")], { windowsHide: true });
    const mediaId = Number(insert.run(id, "convert.mkv", ".mkv", "convert.mkv").lastInsertRowid);
    insert.run(id, "supported.mp4", ".mp4", "supported.mp4");
    await run("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=32x32:r=10", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "0.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "pcm_s16le", path.join(root, "audio.mkv")], { windowsHide: true });
    insert.run(id, "audio.mkv", ".mkv", "audio.mkv");
    await run("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=32x32:r=10", "-t", "0.5", "-c:v", "mpeg4", path.join(root, "encode.avi")], { windowsHide: true });
    insert.run(id, "encode.avi", ".avi", "encode.avi");
    await writeFile(path.join(root, "collision.avi"), "keep collision original");
    await writeFile(path.join(root, "collision.mp4"), "keep existing output");
    insert.run(id, "collision.avi", ".avi", "collision.avi");
    await writeFile(path.join(root, "broken.avi"), "keep broken original");
    insert.run(id, "broken.avi", ".avi", "broken.avi");
    const progress = startSourceConversion(id, root);
    const deadline = Date.now() + 30_000;
    while (getConversionProgress(id)?.status === "running" && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(progress.status).toBe("failed");
    expect(progress.converted).toBe(3);
    expect(progress.skipped).toBe(2);
    expect(progress.errors).toHaveLength(1);
    expect(progress.errors.join("\n")).not.toContain("UnicodeDecodeError");
    expect(progress.logs.join("\n")).toContain("video copy, audio copy");
    expect(progress.logs.join("\n")).toContain("video copy, audio re-encode");
    expect(progress.logs.join("\n")).toContain("video RE-ENCODE (slow)");
    const item = database.prepare("SELECT title, filename, favorite FROM media_items WHERE id = ?").get(mediaId);
    expect(item).toEqual({ title: "Custom title", filename: "convert.mp4", favorite: 1 });
    await expect(readFile(path.join(root, "convert.mkv"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readFile(path.join(root, "convert.mp4"))).length).toBeGreaterThan(0);
    expect(await readFile(path.join(root, "broken.avi"), "utf8")).toBe("keep broken original");
    expect(await readFile(path.join(root, "collision.mp4"), "utf8")).toBe("keep existing output");
  } finally { database.prepare("DELETE FROM sources WHERE id = ?").run(id); await rm(root, { recursive: true, force: true }); }
}, 40_000);
