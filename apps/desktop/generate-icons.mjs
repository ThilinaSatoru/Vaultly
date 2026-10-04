import { createCanvas, loadImage } from "@napi-rs/canvas";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Keep desktop branding in sync with the existing vector favicon.
export async function generateIcons() {
  const artwork = await readFile(new URL("../web/public/favicon.svg", import.meta.url), "utf8");
  const outputDirectory = new URL("build/", import.meta.url);
  await mkdir(outputDirectory, { recursive: true });
  const render = async (size) => {
    const svg = artwork.replace("<svg", `<svg width="${size}" height="${size}"`);
    const canvas = createCanvas(size, size);
    canvas.getContext("2d").drawImage(await loadImage(Buffer.from(svg)), 0, 0, size, size);
    return canvas.encode("png");
  };
  await writeFile(new URL("icon.png", outputDirectory), await render(1024));

  // ICO stores a directory of PNG frames so Windows has a sharp icon at every common display size.
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const frames = await Promise.all(sizes.map(render));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  for (let index = 0; index < sizes.length; index++) {
    const entry = 6 + index * 16;
    const dimension = sizes[index] === 256 ? 0 : sizes[index];
    header[entry] = dimension;
    header[entry + 1] = dimension;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(frames[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += frames[index].length;
  }
  await writeFile(new URL("icon.ico", outputDirectory), Buffer.concat([header, ...frames]));
  return fileURLToPath(outputDirectory);
}
