import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { clearThumbnailCache, getPdfThumbnail } from "./thumbnails.js";

test("isolated PDF renderer produces a thumbnail and survives a malformed PDF", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vaultly-pdf-process-"));
  const stamp = Date.now();
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  try {
    const valid = path.join(root, "valid.pdf"), invalid = path.join(root, "invalid.pdf");
    await writeFile(valid, pdf);
    await writeFile(invalid, "malformed PDF");
    await expect(getPdfThumbnail(950002, invalid, 13, stamp)).rejects.toThrow();
    const output = await getPdfThumbnail(950001, valid, Buffer.byteLength(pdf), stamp);
    expect((await readFile(output)).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  } finally { await clearThumbnailCache([950001, 950002]); await rm(root, { recursive: true, force: true }); }
}, 20_000);
