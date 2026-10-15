import { createCanvas, loadImage } from "@napi-rs/canvas";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { runtimeDirectory, onVaultChanged } from "./database.js";

export let profileImageDirectory = path.join(runtimeDirectory, "profile-images");
onVaultChanged(() => { profileImageDirectory = path.join(runtimeDirectory, "profile-images"); });
export const maxProfileImageBytes = 10 * 1024 * 1024;
export async function downloadProfileImage(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Image download failed (HTTP ${response.status}).`);
  if (!response.body) throw new Error("Image download returned no data.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxProfileImageBytes) throw new Error("Choose an image smaller than 10 MB.");
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel(); reader.releaseLock(); }
}
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
