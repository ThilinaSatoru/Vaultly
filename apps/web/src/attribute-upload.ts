export interface AttributeImportReport { created: number; updated: number; indexed: number; skipped?: number }
interface Envelope { scraped_at?: string; total?: number }
interface JsonFile { stream(): ReadableStream<Uint8Array> }
const encoder = new TextEncoder();
const requestLimit = 20 * 1024 * 1024;

/** Parse one record at a time; retain only the small envelope and current record. */
export async function* attributeRecords(file: JsonFile, metadata: Envelope): AsyncGenerator<unknown> {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let root = "", envelope = "", depth = 0, quoted = false, escaped = false;
  let inRecords = false, foundRecords = false, ended = false, record = "";
  let recordDepth = 0, recordQuoted = false, recordEscaped = false, allowEnd = true;
  let first = true;
  let lastYield = performance.now();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      const text = decoder.decode(value, { stream: !done });
      for (const char of text) {
        if (first) { first = false; if (char === "\uFEFF") continue; }
        if (!root) {
          if (/\s/.test(char)) continue;
          if (char !== "[" && char !== "{") throw new Error("Use a records object or a plain array of records.");
          root = char;
          if (char === "[") { inRecords = true; foundRecords = true; }
          else { envelope = "{"; depth = 1; }
          continue;
        }
        if (ended) {
          if (!/\s/.test(char)) throw new Error("Unexpected content after the JSON document.");
          continue;
        }
        if (inRecords) {
          if (!recordQuoted && recordDepth === 0 && (char === "," || char === "]")) {
            if (record.trim()) {
              yield JSON.parse(record);
              record = "";
            } else if (char === "," || !allowEnd) throw new Error("Missing record or trailing comma.");
            if (char === "]") { inRecords = false; if (root === "[") ended = true; }
            allowEnd = false;
            continue;
          }
          if (!record && /\s/.test(char)) continue;
          record += char;
          // A single record cannot be divided between API requests.
          if (record.length > requestLimit) throw new Error("An individual record exceeds the 20 MB request limit.");
          if (recordQuoted) {
            if (recordEscaped) recordEscaped = false;
            else if (char === "\\") recordEscaped = true;
            else if (char === '"') recordQuoted = false;
          } else if (char === '"') recordQuoted = true;
          else if (char === "{" || char === "[") recordDepth++;
          else if (char === "}" || char === "]") recordDepth--;
          if (recordDepth < 0) throw new Error("Invalid JSON record.");
          continue;
        }
        if (!quoted && depth === 1 && char === "[") {
          const key = envelope.match(/("(?:[^"\\]|\\.)*")\s*:\s*$/)?.[1];
          if (!key || JSON.parse(key) !== "records" || foundRecords) throw new Error("Use exactly one records array.");
          envelope += "[]";
          inRecords = true; foundRecords = true; allowEnd = true;
          continue;
        }
        envelope += char;
        if (envelope.length > 64 * 1024) throw new Error("The JSON metadata is too large.");
        if (quoted) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === '"') quoted = false;
        } else if (char === '"') quoted = true;
        else if (char === "{" || char === "[") depth++;
        else if (char === "}" || char === "]") { depth--; if (depth === 0) ended = true; }
      }
      if (done) break;
      if (performance.now() - lastYield >= 25) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        lastYield = performance.now();
      }
    }
    if (!ended || inRecords || !foundRecords) throw new Error("Invalid JSON: incomplete document or missing records array.");
    if (root === "{") {
      const parsed = JSON.parse(envelope) as Record<string, unknown>;

      if (parsed.scraped_at != null && (typeof parsed.scraped_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(parsed.scraped_at) || !Number.isFinite(Date.parse(parsed.scraped_at)))) throw new Error("scraped_at must be an ISO timestamp.");
      if (parsed.total != null && (typeof parsed.total !== "number" || !Number.isInteger(parsed.total) || parsed.total < 0)) throw new Error("total must be a nonnegative integer.");
      if (parsed.scraped_at != null) metadata.scraped_at = parsed.scraped_at as string;
      if (parsed.total != null) metadata.total = parsed.total as number;
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
}

export async function uploadAttributeFile(
  file: JsonFile,
  send: (body: string) => Promise<AttributeImportReport>,
  onProgress: (processed: number, total: number, report: AttributeImportReport) => void,
  limits = { bytes: requestLimit, records: 10000 },
) {
  const metadata: Envelope = {};
  let total = 0;
  let largestRecord = 0;
  // Check syntax/envelope and record sizes before committing the first chunk.
  for await (const value of attributeRecords(file, metadata)) {
    largestRecord = Math.max(largestRecord, encoder.encode(JSON.stringify(value)).length);
    total++;
  }
  if (!total) throw new Error("Choose a JSON file containing at least one record.");
  const prefix = JSON.stringify({ ...metadata, records: [] }).slice(0, -2);
  const overhead = encoder.encode(prefix + "]}").length;
  if (largestRecord + overhead > limits.bytes) throw new Error("An individual record is too large to upload in a chunk.");
  let records: string[] = [], bytes = overhead, processed = 0;
  const report: AttributeImportReport = { created: 0, updated: 0, indexed: 0 };
  onProgress(0, total, report);
  const flush = async () => {
    if (!records.length) return;
    const next = await send(prefix + records.join(",") + "]}");
    processed += records.length;
    report.created += next.created; report.updated += next.updated; report.indexed += next.indexed;
    if (next.skipped) report.skipped = (report.skipped ?? 0) + next.skipped;
    records = []; bytes = overhead;
    onProgress(processed, total, { ...report });
  };
  try {
    for await (const value of attributeRecords(file, {})) {
      const record = JSON.stringify(value);
      const size = encoder.encode(record).length;
      if (records.length && (records.length >= limits.records || bytes + size + 1 > limits.bytes)) await flush();
      records.push(record); bytes += size + (records.length > 1 ? 1 : 0);
    }
    await flush();
    return report;
  } catch (error) {
    throw new Error(`${processed.toLocaleString()} of ${total.toLocaleString()} records saved. ${error instanceof Error ? error.message : "Upload failed."} Earlier chunks remain saved; uploading again safely matches existing names.`);
  }
}
