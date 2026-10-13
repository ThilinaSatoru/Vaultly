import { readFile, stat } from "node:fs/promises";
import { loadImage } from "@napi-rs/canvas";

async function inspect() {
  const filename = process.argv[2];
  if ((await stat(filename)).size > 5 * 1024 * 1024) throw new Error("Use a cover smaller than 5 MB.");
  const bytes = await readFile(filename);
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  const webp = bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  const avif = bytes.toString("ascii", 4, 8) === "ftyp" && /avif|avis/.test(bytes.toString("ascii", 8, 32));
  if (!png && !jpeg && !webp && !avif) throw new Error("Invalid cover format.");
  const image = await loadImage(bytes);
  if (!image.width || !image.height || image.width * image.height > 40_000_000) throw new Error("Cover dimensions are too large.");
  return { width: image.width, height: image.height };
}

const report = (message) => process.send?.(message, () => process.disconnect());
inspect().then((size) => report({ ok: true, ...size }))
  .catch((error) => report({ ok: false, error: error instanceof Error ? error.message : String(error) }));
