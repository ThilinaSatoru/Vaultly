import { expect, test, vi } from "vitest";
import { attributeRecords, uploadAttributeFile } from "./attribute-upload";

function fragmented(text: string, size = 7) {
  const bytes = new TextEncoder().encode(text);
  return { stream: () => {
    let offset = 0;
    return new ReadableStream<Uint8Array>({ pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      controller.enqueue(bytes.slice(offset, offset += size));
    } });
  } };
}
const send = () => vi.fn(async (body: string) => ({ created: JSON.parse(body).records.length, updated: 0, indexed: 2 }));

test("stream parsing handles BOM, split UTF-8, escaped delimiters and nested values", async () => {
  const records = [{ name: '雪😀 \\"],', patterns: ["a,b", "[x]"], nested: { values: [true, null] } }, { name: "Second" }];
  const metadata = {};
  const text = '\uFEFF' + JSON.stringify({ records, scraped_at: "2026-10-13T06:08:45.385Z", total: 999 });
  const actual = [];
  for await (const value of attributeRecords(fragmented(text, 1), metadata)) actual.push(value);
  expect(actual).toEqual(records);
  expect(metadata).toEqual({ scraped_at: "2026-10-13T06:08:45.385Z", total: 999 });
});

test("uploads sequential record chunks, preserves trailing metadata and aggregates results", async () => {
  const sending = send();
  const progress = vi.fn();
  const records = Array.from({ length: 5 }, (_, id) => ({ name: `Person ${id}` }));
  const report = await uploadAttributeFile(fragmented(JSON.stringify({ records, scraped_at: "2026-10-13T06:08:45Z", total: 5 })), sending, progress, { bytes: 1024, records: 2 });
  expect(sending.mock.calls.map(([body]) => JSON.parse(body).records.length)).toEqual([2, 2, 1]);
  for (const [body] of sending.mock.calls) expect(JSON.parse(body)).toMatchObject({ scraped_at: "2026-10-13T06:08:45Z", total: 5 });
  expect(report).toEqual({ created: 5, updated: 0, indexed: 6 });
  expect(progress.mock.calls.map(([processed]) => processed)).toEqual([0, 2, 4, 5]);
});

test("uses UTF-8 request bytes rather than string length to split chunks", async () => {
  const sending = send();
  const records = Array.from({ length: 4 }, () => ({ name: "雪".repeat(12) }));
  await uploadAttributeFile(fragmented(JSON.stringify(records)), sending, vi.fn(), { bytes: 120, records: 100 });
  expect(sending).toHaveBeenCalledTimes(2);
  expect(sending.mock.calls.flatMap(([body]) => JSON.parse(body).records)).toEqual(records);
  for (const [body] of sending.mock.calls) expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(120);
});

test("a file above 20 MB is streamed without rejecting its total size", async () => {
  const file = new Blob([" ".repeat(21 * 1024 * 1024), '[{"name":"Large dump"}]']);
  const sending = send();
  expect(file.size).toBeGreaterThan(20 * 1024 * 1024);
  await expect(uploadAttributeFile(file, sending, vi.fn())).resolves.toMatchObject({ created: 1 });
  expect(sending).toHaveBeenCalledOnce();
}, 20000);

test("more than 50k records are sent in bounded batches", async () => {
  const records = Array.from({ length: 50001 }, (_, id) => ({ name: `Person ${id}` }));
  const sending = send();
  await expect(uploadAttributeFile(new Blob([JSON.stringify(records)]), sending, vi.fn())).resolves.toMatchObject({ created: 50001 });
  expect(sending).toHaveBeenCalledTimes(6);
  expect(sending.mock.calls.every(([body]) => JSON.parse(body).records.length <= 10000)).toBe(true);
});

test.each([
  '[{"name":"Valid"},]', '[{"name":"Valid"} {"name":"Missing comma"}]',
  '[{"name":"Valid"}',
  '{"records":[],"records":[]}', '{"records":[],"total":-1}',
  '[{"name":"Valid"}] trailing',
])("rejects malformed JSON or metadata before sending any chunks: %s", async (text) => {
  const sending = send();
  await expect(uploadAttributeFile(fragmented(text), sending, vi.fn(), { bytes: 1024, records: 1 })).rejects.toThrow();
  expect(sending).not.toHaveBeenCalled();
});

test("rejects one oversized record before any chunks commit", async () => {
  const sending = send();
  await expect(uploadAttributeFile(fragmented(JSON.stringify([{ name: "Small" }, { name: "雪".repeat(50) }])), sending, vi.fn(), { bytes: 100, records: 1 })).rejects.toThrow("individual record");
  expect(sending).not.toHaveBeenCalled();
});

test("failed chunks stop upload and report already committed records", async () => {
  const sending = send().mockResolvedValueOnce({ created: 2, updated: 0, indexed: 1 }).mockRejectedValueOnce(new Error("Invalid name"));
  const records = Array.from({ length: 5 }, (_, id) => ({ name: `Person ${id}` }));
  const progress = vi.fn();
  await expect(uploadAttributeFile(fragmented(JSON.stringify(records)), sending, progress, { bytes: 1024, records: 2 })).rejects.toThrow("2 of 5 records saved. Invalid name");
  expect(sending).toHaveBeenCalledTimes(2);
  expect(progress).toHaveBeenLastCalledWith(2, 5, { created: 2, updated: 0, indexed: 1 });
});

test("accepts null envelope metadata and extra fields", async () => {
  const sending = send();
  await uploadAttributeFile(fragmented(JSON.stringify({ records: [null, { name: "Person", patterns: null }], total: null, scraped_at: null, extra: true })), sending, vi.fn());
  expect(JSON.parse(sending.mock.calls[0][0])).toEqual({ records: [null, { name: "Person", patterns: null }] });
});
