import { createCanvas } from "@napi-rs/canvas";
import { readFile, writeFile } from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const { inputPath, outputPath } = workerData;

async function renderThumbnail() {
  // Passing a Windows path makes PDF.js convert it to a file:// URL and fetch it.
  // Node's fetch does not support that protocol, so load the bytes ourselves.
  const file = await readFile(inputPath);
  const loadingTask = getDocument({ data: new Uint8Array(file), useSystemFonts: true });
  try {
    const document = await loadingTask.promise;
    const page = await document.getPage(1);
    const natural = page.getViewport({ scale: 1 });
    const scale = Math.min(420 / natural.width, 600 / natural.height);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({
      canvas,
      canvasContext: canvas.getContext("2d"),
      viewport,
    }).promise;
    await writeFile(outputPath, await canvas.encode("jpeg", 78));
  } finally {
    await loadingTask.destroy();
  }
}

renderThumbnail()
  .then(() => parentPort?.postMessage({ ok: true }))
  .catch((error) => parentPort?.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }));
