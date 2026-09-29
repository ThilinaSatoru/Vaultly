import { build } from "esbuild";
import { copyFile, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });

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
