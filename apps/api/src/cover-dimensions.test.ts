import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { expect, test } from "vitest";
import { readCoverDimensions } from "./cover-dimensions.js";
import { getSystemResources } from "./process-resources.js";

test("cover dimensions are decoded in a worker that exits before releasing its slot", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaultly-cover-worker-"));
  try {
    const filename = path.join(root, "cover.png");
    await writeFile(filename, createCanvas(800, 1200).toBuffer("image/png"));
    expect(await readCoverDimensions(filename)).toEqual({ width: 800, height: 1200 });
    expect(getSystemResources().activeProcesses).toBe(0);
    await writeFile(filename, "broken");
    await expect(readCoverDimensions(filename)).rejects.toThrow("Invalid cover format");
    expect(getSystemResources().activeProcesses).toBe(0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("cancelled cover inspection releases its process slot", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(readCoverDimensions("unused.png", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(getSystemResources()).toMatchObject({ activeProcesses: 0, waitingProcesses: 0 });
  const running = new AbortController();
  const inspection = readCoverDimensions("unused.png", running.signal);
  running.abort();
  await expect(inspection).rejects.toMatchObject({ name: "AbortError" });
  expect(getSystemResources()).toMatchObject({ activeProcesses: 0, waitingProcesses: 0 });
});
