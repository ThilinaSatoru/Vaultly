import { expect, test } from "vitest";
import { BookArchive, epubChapters } from "./book-archive.js";

export function zipFixture(files: Record<string, string>) {
  const locals: Buffer[] = [], entries: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const filename = Buffer.from(name), data = Buffer.from(text);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42);
    locals.push(local, filename, data); entries.push(entry, filename); offset += local.length + filename.length + data.length;
  }
  const directory = Buffer.concat(entries), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
test("EPUB chapters follow the spine, resolve relative paths and omit non-linear entries", () => {
  const archive = new BookArchive(zipFixture({
    "META-INF/container.xml": '<container><rootfiles><rootfile full-path="OPS/book.opf" /></rootfiles></container>',
    "OPS/book.opf": '<package><manifest><item id="two" href="text/two.xhtml" media-type="application/xhtml+xml"/><item id="one" href="text/one.xhtml" media-type="application/xhtml+xml"/><item id="extra" href="text/extra.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="extra" linear="no"/><itemref idref="two"/></spine></package>',
    "OPS/text/one.xhtml": "<p>First</p>", "OPS/text/two.xhtml": "<p>Second</p>", "OPS/text/extra.xhtml": "<p>Extra</p>",
  }));
  expect(epubChapters(archive)).toEqual([{ html: "<p>First</p>", base: "OPS/text" }, { html: "<p>Second</p>", base: "OPS/text" }]);
  expect(() => archive.read("OPS/text/one.xhtml", 3)).toThrow(/too large/);
  expect(() => archive.read("../escape")).toThrow(/unavailable/);
});
test("invalid ZIP data and unsupported compression fail without extracting files", () => {
  expect(() => new BookArchive(Buffer.alloc(40))).toThrow(/Invalid ZIP/);
  const data = zipFixture({ "page.jpg": "image" });
  data.writeUInt16LE(99, 30 + Buffer.byteLength("page.jpg") + 5 + 10);
  expect(() => new BookArchive(data).read("page.jpg")).toThrow(/compression/);
});
