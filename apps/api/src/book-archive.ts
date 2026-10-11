import { readFile, stat } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import path from "node:path";

interface Entry { name: string; method: number; size: number; compressed: number; offset: number }
export class BookArchive {
  readonly entries = new Map<string, Entry>();
  constructor(private bytes: Buffer) {
    let end = bytes.length - 22;
    for (; end >= Math.max(0, bytes.length - 65557); end--) if (bytes.readUInt32LE(end) === 0x06054b50) break;
    if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50) throw new Error("Invalid ZIP book archive.");
    if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw new Error("Split archives are unsupported.");
    const count = bytes.readUInt16LE(end + 10);
    if (count > 10000) throw new Error("Book archive has too many entries.");
    let offset = bytes.readUInt32LE(end + 16);
    for (let index = 0; index < count; index++) {
      if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error("Invalid book archive directory.");
      if (bytes.readUInt16LE(offset + 8) & 1) throw new Error("Encrypted books must be opened in an external reader.");
      const length = bytes.readUInt16LE(offset + 28);
      const next = offset + 46 + length + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
      if (next > bytes.length) throw new Error("Invalid book archive entry.");
      const name = bytes.subarray(offset + 46, offset + 46 + length).toString("utf8").replace(/\\/g, "/");
      this.entries.set(name, { name, method: bytes.readUInt16LE(offset + 10), size: bytes.readUInt32LE(offset + 24), compressed: bytes.readUInt32LE(offset + 20), offset: bytes.readUInt32LE(offset + 42) });
      offset = next;
    }
  }
  read(name: string, limit = 16 * 1024 * 1024): Buffer {
    const entry = this.entries.get(name);
    if (!entry || entry.size > limit) throw new Error("Book entry is unavailable or too large.");
    const offset = entry.offset;
    if (offset + 30 > this.bytes.length || this.bytes.readUInt32LE(offset) !== 0x04034b50) throw new Error("Invalid book entry.");
    const start = offset + 30 + this.bytes.readUInt16LE(offset + 26) + this.bytes.readUInt16LE(offset + 28);
    if (start + entry.compressed > this.bytes.length) throw new Error("Truncated book entry.");
    const compressed = this.bytes.subarray(start, start + entry.compressed);
    const data = entry.method === 0 ? compressed : entry.method === 8 ? inflateRawSync(compressed, { maxOutputLength: limit }) : undefined;
    if (!data || data.length !== entry.size) throw new Error("Unsupported or corrupt book compression.");
    return data;
  }
}

let cache: { filename: string; signature: string; archive: BookArchive } | undefined;
let pending: { filename: string; signature: string; promise: Promise<BookArchive> } | undefined;
export async function openBookArchive(filename: string) {
  const info = await stat(filename);
  const signature = `${info.size}:${info.mtimeMs}`;
  if (cache?.filename === filename && cache.signature === signature) return cache.archive;
  if (info.size > 256 * 1024 * 1024) throw new Error("Books over 256 MB must be opened in an external reader.");
  if (pending?.filename === filename && pending.signature === signature) return pending.promise;
  const job = { filename, signature, promise: readFile(filename).then((bytes) => new BookArchive(bytes)) };
  pending = job;
  try {
    const archive = await job.promise;
    cache = { filename, signature, archive };
    return archive;
  } finally { if (pending === job) pending = undefined; }
}
export function xmlAttribute(tag: string, key: string) {
  return tag.match(new RegExp(`\\b${key}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1]?.replace(/&amp;/g, "&") ?? "";
}
export function epubChapters(archive: BookArchive) {
  const container = archive.read("META-INF/container.xml", 1024 * 1024).toString("utf8");
  const opfPath = xmlAttribute(container.match(/<(?:[\w-]+:)?rootfile\b[^>]*>/i)?.[0] ?? "", "full-path");
  const opf = archive.read(opfPath, 4 * 1024 * 1024).toString("utf8");
  const manifest = new Map<string, string>();
  for (const match of opf.matchAll(/<(?:[\w-]+:)?item\b[^>]*>/gi)) {
    const tag = match[0];
    if (!["application/xhtml+xml", "text/html"].includes(xmlAttribute(tag, "media-type"))) continue;
    manifest.set(xmlAttribute(tag, "id"), path.posix.normalize(path.posix.join(path.posix.dirname(opfPath), decodeURIComponent(xmlAttribute(tag, "href")))));
  }
  const chapters: Array<{ html: string; base: string }> = [];
  let total = 0;
  for (const match of opf.matchAll(/<(?:[\w-]+:)?itemref\b[^>]*>/gi)) {
    if (xmlAttribute(match[0], "linear") === "no") continue;
    const filename = manifest.get(xmlAttribute(match[0], "idref"));
    if (!filename) continue;
    const data = archive.read(filename, 8 * 1024 * 1024);
    total += data.length;
    if (total > 32 * 1024 * 1024) throw new Error("Book text is too large for the built-in reader.");
    chapters.push({ html: data.toString("utf8"), base: path.posix.dirname(filename) });
  }
  if (!chapters.length) throw new Error("This EPUB has no readable chapters.");
  return chapters;
}
