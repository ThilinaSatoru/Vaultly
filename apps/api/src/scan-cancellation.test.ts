import { afterEach, expect, test, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { setImmediate as yieldToScan } from "node:timers/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { database } from "./database.js";
import { cancelAllSourceScans, cancelSourceScan, collectItems, getScanProgress, scanSource } from "./scanner.js";
import { buildVaultlyServer } from "./server.js";
import { clearThumbnailCache, getPdfThumbnail, getVideoThumbnail, getVideoMetadata } from "./thumbnails.js";

vi.mock("./thumbnails.js", () => ({
  clearThumbnailCache: vi.fn().mockResolvedValue(undefined),
  getPdfThumbnail: vi.fn().mockResolvedValue("thumbnail.jpg"),
  getVideoThumbnail: vi.fn().mockResolvedValue("thumbnail.jpg"),
  getVideoDuration: vi.fn().mockResolvedValue(null),
  getVideoMetadata: vi.fn().mockResolvedValue({ durationSeconds: 12, width: 1920, height: 1080 }),
  getThumbnailActivity: vi.fn().mockReturnValue({ thumbnails: 0, running: 0, metadata: 0 }),
}));

const fixtures: Array<{ id: number; root: string }> = [];
async function source() {
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-cancel-"));
  const id = Number(database.prepare("INSERT INTO sources(name, root_path, normalized_path) VALUES (?, ?, ?)")
    .run("Cancel fixture", root, root).lastInsertRowid);
  const fixture = { id, root };
  fixtures.push(fixture);
  return fixture;
}

afterEach(async () => {
  await cancelAllSourceScans();
  for (const { id, root } of fixtures.splice(0)) {
    database.prepare("DELETE FROM sources WHERE id = ?").run(id);
    database.prepare("DELETE FROM series WHERE auto_key LIKE ?").run(`${id}|%`);
    await rm(root, { recursive: true, force: true });
  }
  vi.mocked(getPdfThumbnail).mockReset().mockResolvedValue("thumbnail.jpg");
  vi.mocked(getVideoThumbnail).mockReset().mockResolvedValue("thumbnail.jpg");
  vi.mocked(clearThumbnailCache).mockClear();
  vi.mocked(getVideoMetadata).mockReset().mockResolvedValue({ durationSeconds: 12, width: 1920, height: 1080 });
});

test("scans index video quality without thumbnails, cache unchanged files and refresh changed files", async () => {
  const { id, root } = await source();
  const file = path.join(root, "quality.mp4");
  await writeFile(file, "video");
  vi.mocked(getVideoMetadata).mockClear();
  await scanSource(id, root);
  expect(database.prepare("SELECT video_width, video_height, duration_seconds FROM media_items WHERE source_id = ?").get(id))
    .toMatchObject({ video_width: 1920, video_height: 1080, duration_seconds: 12 });
  await scanSource(id, root);
  expect(getVideoMetadata).toHaveBeenCalledOnce();
  vi.mocked(getVideoMetadata).mockResolvedValue({ width: 720, height: 480, durationSeconds: 6 });
  await writeFile(file, "changed video");
  await scanSource(id, root);
  expect(getVideoMetadata).toHaveBeenCalledTimes(2);
  const app = await buildVaultlyServer();
  try {
    const response = (await app.inject(`/api/items?type=video&source=${id}`)).json();
    expect(response.items.find((item: { source_id: number }) => item.source_id === id))
      .toMatchObject({ video_width: 720, video_height: 480 });
  } finally { await app.close(); }
});

test("cancelling a video quality read leaves it eligible for retry", async () => {
  const { id, root } = await source();
  await writeFile(path.join(root, "cancel.mp4"), "video");
  vi.mocked(getVideoMetadata).mockImplementationOnce((_file, signal) => new Promise((_resolve, reject) => {
    signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
  }));
  const scan = scanSource(id, root);
  await vi.waitFor(() => expect(getScanProgress(id)?.phase).toBe("metadata"));
  cancelSourceScan(id);
  await scan;
  expect(database.prepare("SELECT video_metadata_signature FROM media_items WHERE source_id = ?").get(id))
    .toMatchObject({ video_metadata_signature: null });
  await scanSource(id, root);
  expect(database.prepare("SELECT video_height FROM media_items WHERE source_id = ?").get(id)).toMatchObject({ video_height: 1080 });
});

test("progress reports real discovery counts and thumbnail completion through the lightweight API", async () => {
  const { id, root } = await source();
  await mkdir(path.join(root, "Comic"));
  await Promise.all([
    ...Array.from({ length: 4 }, (_, index) => writeFile(path.join(root, "Comic", `${index}.jpg`), "page")),
    ...["Book.pdf", "Another.pdf", "Video.mp4", "Archive.cbz", "Ignored.txt"].map((name) => writeFile(path.join(root, name), "fixture")),
  ]);
  const pending: Array<{ resolve: (path: string) => void; reject: (error: Error) => void }> = [];
  const thumbnail = () => new Promise<string>((resolve, reject) => { pending.push({ resolve, reject }); });
  vi.mocked(getPdfThumbnail).mockImplementation(thumbnail);
  vi.mocked(getVideoThumbnail).mockImplementation(thumbnail);
  const app = await buildVaultlyServer();
  app.log.level = "silent";
  try {
    const scan = scanSource(id, root, { generateThumbnails: true });
    const initial = getScanProgress(id)!;
    expect(initial).toMatchObject({ phase: "discovering", directoriesScanned: 0, itemsProcessed: 0 });
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    const progress = (await app.inject("/api/sources/scan/progress")).json().find((source: { id: number }) => source.id === id).scan_progress;
    expect(progress).toMatchObject({ phase: "thumbnails", directoriesFound: 2, directoriesScanned: 2, filesChecked: 9,
      comicPages: 4, comicsFound: 2, pdfsFound: 2, videosFound: 1, itemsProcessed: 5, itemsTotal: 5,
      thumbnailsProcessed: 0, thumbnailsTotal: 3, thumbnailErrors: 0 });
    expect(progress.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(initial.phase).toBe("discovering");
    expect((await app.inject("/api/activity")).json()).toContainEqual({ id: `source-${id}`, label: "Cancel fixture", detail: "Preparing thumbnails", processed: 0, total: 3, target: "sources" });
    pending[0].resolve("first.jpg");
    pending[1].resolve("second.jpg");
    await vi.waitFor(() => expect(pending).toHaveLength(3));
    expect(getScanProgress(id)).toMatchObject({ thumbnailsProcessed: 2, thumbnailsTotal: 3 });
    expect((await app.inject("/api/activity")).json().find((task: { id: string }) => task.id === `source-${id}`)).toMatchObject({ processed: 2, total: 3 });
    pending[2].reject(new Error("Unreadable preview"));
    await scan;
    expect(getScanProgress(id)).toBeNull();
    expect((await app.inject("/api/activity")).json().some((task: { id: string }) => task.id === `source-${id}`)).toBe(false);
    expect((await app.inject("/api/sources/scan/progress")).json().find((source: { id: number }) => source.id === id))
      .toMatchObject({ status: "ready", scan_progress: null });
    expect(clearThumbnailCache).not.toHaveBeenCalled();
    vi.mocked(getPdfThumbnail).mockResolvedValue("cached.jpg");
    vi.mocked(getVideoThumbnail).mockResolvedValue("cached.jpg");
    await app.inject({ method: "POST", url: `/api/sources/${id}/scan` });
    await scanSource(id, root);
    expect(clearThumbnailCache).not.toHaveBeenCalled();
  } finally { for (const task of pending) task.resolve("done.jpg"); await app.close(); }
});

test("categorization yields for cancellation without marking unprocessed old items missing", async () => {
  const { id, root } = await source();
  await writeFile(path.join(root, "Old.pdf"), "original document with a unique size");
  await scanSource(id, root);
  const oldItem = database.prepare("SELECT id FROM media_items WHERE source_id = ?").get(id) as { id: number };
  await rm(path.join(root, "Old.pdf"));
  for (let batch = 0; batch < 8; batch++) {
    await Promise.all(Array.from({ length: 80 }, (_, index) => writeFile(path.join(root, `New-${batch}-${index}.pdf`), "new")));
  }
  const scan = scanSource(id, root);
  while (getScanProgress(id)?.phase !== "indexing" || getScanProgress(id)!.itemsProcessed === 0) {
    if (!getScanProgress(id)) throw new Error("Scan finished without yielding during categorization.");
    await yieldToScan();
  }
  const progress = getScanProgress(id)!;
  expect(progress.itemsProcessed).toBeGreaterThan(0);
  expect(progress.itemsProcessed).toBeLessThan(640);
  // Library requests can own a separate transaction between scanner batches.
  database.exec("BEGIN IMMEDIATE");
  database.exec("ROLLBACK");
  expect(await cancelSourceScan(id)).toBe(true);
  await scan;
  expect(database.prepare("SELECT indexed, available FROM media_items WHERE id = ?").get(oldItem.id)).toEqual({ indexed: 1, available: 1 });
  await scanSource(id, root);
  expect(database.prepare("SELECT indexed, available FROM media_items WHERE id = ?").get(oldItem.id)).toEqual({ indexed: 0, available: 0 });
  expect(database.prepare("SELECT COUNT(*) AS count FROM media_items WHERE source_id = ? AND available = 1").get(id)).toEqual({ count: 640 });
}, 15_000);

test("cancelling traversal preserves existing items, metadata and the last scan time, then allows a manual retry", async () => {
  const { id, root } = await source();
  await writeFile(path.join(root, "Original.pdf"), "original");
  await scanSource(id, root);
  database.prepare("UPDATE media_items SET favorite = 1, title = 'Custom title' WHERE source_id = ?").run(id);
  const before = database.prepare("SELECT * FROM media_items WHERE source_id = ?").all(id);
  const scanTime = database.prepare("SELECT last_scanned_at FROM sources WHERE id = ?").get(id);
  await rm(path.join(root, "Original.pdf"));
  await writeFile(path.join(root, "New.pdf"), "new file");

  const scan = scanSource(id, root);
  expect(scanSource(id, root)).toBe(scan);
  expect(await cancelSourceScan(id)).toBe(true);
  await scan;
  expect(database.prepare("SELECT * FROM media_items WHERE source_id = ?").all(id)).toEqual(before);
  expect(database.prepare("SELECT status, last_error FROM sources WHERE id = ?").get(id)).toEqual({ status: "ready", last_error: null });
  expect(database.prepare("SELECT last_scanned_at FROM sources WHERE id = ?").get(id)).toEqual(scanTime);
  expect(await cancelSourceScan(id)).toBe(false);

  await scanSource(id, root);
  expect(database.prepare("SELECT filename FROM media_items WHERE source_id = ? AND available = 1").all(id))
    .toEqual([{ filename: "New.pdf" }]);
});

test("cancel all stops every active source and leaves unscanned sources idle", async () => {
  const first = await source(), second = await source();
  const scans = [scanSource(first.id, first.root), scanSource(second.id, second.root)];
  expect(await cancelAllSourceScans()).toBe(2);
  await Promise.all(scans);
  for (const { id } of [first, second]) {
    expect(database.prepare("SELECT status, last_error, last_scanned_at FROM sources WHERE id = ?").get(id))
      .toEqual({ status: "idle", last_error: null, last_scanned_at: null });
  }
  expect(await cancelAllSourceScans()).toBe(0);
  const controller = new AbortController();
  controller.abort();
  await expect(collectItems(first.root, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
});

test("API cancellation aborts thumbnail work without queuing the rest of the source", async () => {
  const { id, root } = await source();
  await Promise.all(Array.from({ length: 6 }, (_, index) => writeFile(path.join(root, `${index}.pdf`), "pdf")));
  vi.mocked(getPdfThumbnail).mockImplementation((_id, _path, _size, _modified, signal) =>
    new Promise((_resolve, reject) => {
      signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
    }));
  const app = await buildVaultlyServer();
  app.log.level = "silent";
  try {
    expect((await app.inject({ method: "POST", url: `/api/sources/${id}/scan` })).statusCode).toBe(202);
    await vi.waitFor(() => expect(getPdfThumbnail).toHaveBeenCalledTimes(2));
    const response = await app.inject({ method: "POST", url: `/api/sources/${id}/scan/cancel` });
    expect(response.json()).toEqual({ cancelled: true });
    expect(getPdfThumbnail).toHaveBeenCalledTimes(2);
    expect(database.prepare("SELECT COUNT(*) AS count FROM media_items WHERE source_id = ?").get(id)).toEqual({ count: 6 });
    expect(database.prepare("SELECT status, last_error, last_scanned_at FROM sources WHERE id = ?").get(id))
      .toEqual({ status: "idle", last_error: null, last_scanned_at: null });
    expect((await app.inject({ method: "POST", url: `/api/sources/${id}/scan/cancel` })).json()).toEqual({ cancelled: false });
    expect((await app.inject({ method: "POST", url: "/api/sources/scan/cancel" })).json()).toEqual({ count: 0 });
    expect((await app.inject({ method: "POST", url: "/api/sources/999999999/scan/cancel" })).statusCode).toBe(404);
  } finally { await app.close(); }
});
