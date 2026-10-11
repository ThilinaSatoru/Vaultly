import path from "node:path";
import { readdir, realpath, readFile, stat } from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const imagePattern = /\.(?:jpe?g|png|webp|avif)$/i;
export function coverCandidates(videoName: string, filenames: string[]) {
  const stem = path.basename(videoName, path.extname(videoName)).toLowerCase();
  const rank = (name: string) => {
    const title = path.basename(name, path.extname(name)).toLowerCase();
    if (title === stem) return 0;
    if ([`${stem}-poster`, `${stem}.poster`, `${stem}-cover`, `${stem}.cover`].includes(title)) return 1;
    if (title === "poster") return 2;
    if (title === "cover") return 3;
    if (title === "folder") return 4;
    return 10;
  };
  const images = filenames.filter((name) => imagePattern.test(name));
  return images.filter((name) => rank(name) < 10)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

async function decodeVideoCover(bytes: Buffer) {
  if (bytes.length > 5 * 1024 * 1024) throw new Error("Use a cover smaller than 5 MB.");
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  const webp = bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  const avif = bytes.toString("ascii", 4, 8) === "ftyp" && /avif|avis/.test(bytes.toString("ascii", 8, 32));
  if (!png && !jpeg && !webp && !avif) throw new Error("Invalid cover format.");
  const image = await loadImage(bytes);
  if (!image.width || !image.height || image.width * image.height > 40_000_000) throw new Error("Cover dimensions are too large.");
  return image;
}

export async function normalizeVideoCover(bytes: Buffer) {
  const image = await decodeVideoCover(bytes);
  const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  canvas.getContext("2d").drawImage(image, 0, 0, width, height);
  return { data: canvas.toBuffer("image/png"), width, height };
}

export async function findVideoCover(rootPath: string, videoPath: string, dimensions = new Map<string, { width: number; height: number }>()) {
  const root = await realpath(rootPath);
  const directory = path.dirname(videoPath);
  const entries = await readdir(directory, { withFileTypes: true });
  const candidates = coverCandidates(path.basename(videoPath), entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  for (const name of candidates) {
    try {
      const filename = await realpath(path.join(directory, name));
      const relative = path.relative(root, filename);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
      const info = await stat(filename);
      if (info.size > 5 * 1024 * 1024) continue;
      const signature = `${info.size}:${info.mtimeMs}`;
      const cacheKey = `${filename}:${signature}`;
      let size = dimensions.get(cacheKey);
      if (!size) { const image = await decodeVideoCover(await readFile(filename)); size = { width: image.width, height: image.height }; dimensions.set(cacheKey, size); }
      return { path: relative, ...size, signature };
    } catch { /* Try the next recognised cover if an image is damaged. */ }
  }
  return null;
}
