import { createCanvas, loadImage } from "@napi-rs/canvas";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { runtimeDirectory } from "./database.js";

export const profileImageDirectory = path.join(runtimeDirectory, "profile-images");
export const maxProfileImageBytes = 10 * 1024 * 1024;
export function profileImagePath(filename: string) {
  if (!/^[0-9a-f-]{36}\.png$/.test(filename)) throw new Error("Invalid profile image filename.");
  return path.join(profileImageDirectory, filename);
}
export async function normalizeProfileImage(data: Buffer) {
  if (!data.length || data.length > maxProfileImageBytes) throw new Error("Choose an image smaller than 10 MB.");
  const raster = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || (data[0] === 255 && data[1] === 216 && data[2] === 255)
    || ["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString())
    || (data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP");
  if (!raster) throw new Error("Choose a PNG, JPEG, GIF, or WebP image.");
  let image;
  try { image = await loadImage(data); } catch { throw new Error("That image could not be read."); }
  if (!image.width || !image.height || image.width * image.height > 40_000_000) throw new Error("That image is too large.");
  const scale = Math.min(1, 512 / Math.max(image.width, image.height));
  const canvas = createCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toBuffer("image/png");
}
export async function storeProfileImage(data: Buffer) {
  await mkdir(profileImageDirectory, { recursive: true });
  const filename = `${randomUUID()}.png`;
  await writeFile(profileImagePath(filename), data, { flag: "wx" });
  return filename;
}
export async function removeProfileImage(filename: string | null | undefined) {
  if (filename) await unlink(profileImagePath(filename)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}
export const readProfileImage = (filename: string) => readFile(profileImagePath(filename));
export type ProfileImageFetch = (url: string, options: RequestInit) => Promise<Response>;

export async function downloadProfileImage(url: string, referrer?: string, fetchImage: ProfileImageFetch = fetch, cancellation?: AbortSignal) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Use an HTTP or HTTPS image URL.");
  const sourcePage = referrer ? new URL(referrer) : new URL("/", parsed);
  if (!["http:", "https:"].includes(sourcePage.protocol)) throw new Error("Use an HTTP or HTTPS source page URL.");
  sourcePage.hash = "";
  sourcePage.username = "";
  sourcePage.password = "";
  const signal = cancellation ? AbortSignal.any([AbortSignal.timeout(30_000), cancellation]) : AbortSignal.timeout(30_000);
  let response: Response;
  try {
    response = await fetchImage(parsed.href, {
      signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.7",
        Referer: sourcePage.href,
      },
      referrer: sourcePage.href,
      referrerPolicy: "unsafe-url",
      credentials: "omit",
    });
  } catch (error) {
    const cause = error instanceof Error ? (error.cause as { code?: string } | undefined)?.code : undefined;
    if (signal.aborted || cause === "UND_ERR_CONNECT_TIMEOUT" || cause === "ETIMEDOUT") {
      throw new Error(`Connection to ${parsed.hostname} timed out. Check your connection or proxy, or download the image in your browser and upload it.`);
    }
    throw new Error(`Could not connect to ${parsed.hostname}${cause ? ` (${cause})` : ""}. Check your connection or proxy, or upload the image from your computer.`);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`The image host returned HTTP ${response.status}. Try adding the source page URL, or download the image in your browser and upload it.`);
  }
  if (!response.body) throw new Error("The image host returned an empty response.");
  if (Number(response.headers.get("content-length")) > maxProfileImageBytes) {
    await response.body.cancel();
    throw new Error("Choose an image smaller than 10 MB.");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxProfileImageBytes) throw new Error("Choose an image smaller than 10 MB.");
      chunks.push(Buffer.from(chunk));
    }
  } catch (error) {
    if (signal.aborted) throw new Error("The image download timed out. Download it in your browser and upload it.");
    if (size > maxProfileImageBytes) throw error;
    throw new Error("The image download was interrupted. Try again or upload the image from your computer.");
  }
  return Buffer.concat(chunks);
}
