import { createCanvas } from "@napi-rs/canvas";
import { writeFile } from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const { inputPath, outputPath } = workerData;

async function renderThumbnail() {
  const loadingTask = getDocument({ url: inputPath, useSystemFonts: true });
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
