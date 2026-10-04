import { build } from "esbuild";
import { copyFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateIcons } from "./generate-icons.mjs";

const outputDirectory = path.resolve("dist");
if (path.dirname(outputDirectory) !== path.resolve(fileURLToPath(new URL(".", import.meta.url)))) {
  throw new Error("Run the desktop build from apps/desktop.");
}
await generateIcons();
await rm(outputDirectory, { recursive: true, force: true });

const shared = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  logLevel: "info",
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ["src/main.ts"],
    outfile: "dist/main.cjs",
    format: "cjs",
    define: { "import.meta.url": "undefined" },
    external: ["electron", "@ffmpeg-installer/ffmpeg", "@napi-rs/canvas"],
  }),
  build({
    ...shared,
    entryPoints: ["../api/pdf-thumbnail-worker.mjs"],
    outfile: "dist/pdf-thumbnail-worker.mjs",
    external: ["@napi-rs/canvas"],
  }),
]);

// PDF.js resolves this companion module beside the bundled thumbnail worker
// when it creates its Node fake worker.
await copyFile(
  "../api/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  "dist/pdf.worker.mjs",
);

await Promise.all(["icon.png", "icon.ico"].map((filename) => copyFile(`build/${filename}`, `dist/${filename}`)));
