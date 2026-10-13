import path from "node:path";
import { readdir, realpath, stat } from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readCoverDimensions } from "./cover-dimensions.js";

const imagePattern = /\.(?:jpe?g|png|webp|avif)$/i;
export function coverCandidates(mediaName: string, filenames: string[], isDirectory = false) {
  const fullName = path.basename(mediaName).toLowerCase();
  const stem = isDirectory ? fullName : path.basename(mediaName, path.extname(mediaName)).toLowerCase();
  const suffixes = ["poster", "cover", "front", "front-cover", "front_cover", "fanart", "banner", "thumb", "thumbnail"];
  const generic = ["poster", "cover", "folder", "front", "front-cover", "front_cover", "cover-front", "cover_front", "book", "movie", "series", "albumart", "albumartsmall", "fanart", "banner", "thumb", "thumbnail"];
  const rank = (name: string) => {
    const title = path.basename(name, path.extname(name)).toLowerCase();
    if (title === stem) return 0;
    if ([stem, fullName].some((base) => suffixes.some((suffix) => ["-", ".", "_", " "].some((separator) => title === `${base}${separator}${suffix}`)))) return 1;
    const index = generic.indexOf(title);
    return index < 0 ? Infinity : index + 2;
  };
  const images = filenames.filter((name) => imagePattern.test(name));
  return images.filter((name) => Number.isFinite(rank(name)))
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

export async function findMediaCover(rootPath: string, mediaPath: string, dimensions = new Map<string, { width: number; height: number }>(), isDirectory = false, directories = new Map<string, string[]>(), signal?: AbortSignal) {
  signal?.throwIfAborted();
  const root = await realpath(rootPath);
  let directory = await realpath(isDirectory ? mediaPath : path.dirname(mediaPath));
  while (true) {
    const relativeDirectory = path.relative(root, directory);
    if (relativeDirectory === ".." || relativeDirectory.startsWith(`..${path.sep}`) || path.isAbsolute(relativeDirectory)) break;
    let filenames = directories.get(directory);
    if (!filenames) {
      const entries = await readdir(directory, { withFileTypes: true });
      filenames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
      directories.set(directory, filenames);
    }
    const candidates = new Set([
      ...coverCandidates(path.basename(mediaPath), filenames, isDirectory),
      ...coverCandidates(path.basename(directory), filenames, true),
    ]);
    for (const name of candidates) {
      try {
        signal?.throwIfAborted();
        const filename = await realpath(path.join(directory, name));
        const relative = path.relative(root, filename);
        if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
        const info = await stat(filename);
        if (info.size > 5 * 1024 * 1024) continue;
        const signature = `${relative}:${info.size}:${info.mtimeMs}`;
        const cacheKey = `${filename}:${signature}`;
        let size = dimensions.get(cacheKey);
        if (!size) { size = await readCoverDimensions(filename, signal); dimensions.set(cacheKey, size); }
        return { path: relative, ...size, signature };
      } catch { signal?.throwIfAborted(); /* Try the next recognised cover if an image is damaged. */ }
    }
    if (!relativeDirectory) break;
    directory = path.dirname(directory);
  }
  return null;
}

export const findVideoCover = findMediaCover;
