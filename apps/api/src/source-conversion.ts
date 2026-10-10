import { execFile, spawn } from "node:child_process";
import { access, copyFile, realpath, stat, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { database } from "./database.js";
import { video2mp4Script } from "./video2mp4-script.js";
import { withMediaProcess } from "./process-resources.js";

const run = promisify(execFile);
const python = () => process.env.VAULTLY_PYTHON || "python";
export interface ConversionProgress {
  status: "running" | "completed" | "cancelled" | "failed";
  processed: number; total: number; converted: number; skipped: number;
  currentPath: string; errors: string[];
  logs: string[];
  failed: number;
}
const jobs = new Map<number, { root: string; progress: ConversionProgress; controller: AbortController; promise: Promise<void> }>();
export const getConversionProgress = (id: number) => {
  const job = jobs.get(id);
  if (!job) return null;
  const source = database.prepare("SELECT root_path FROM sources WHERE id = ?").get(id) as { root_path: string } | undefined;
  if (source?.root_path !== job.root) { jobs.delete(id); return null; }
  return job.progress;
};
export const isSourceConverting = (id: number) => jobs.get(id)?.progress.status === "running";
export const getConversionActivity = () => [...jobs].filter(([, job]) => job.progress.status === "running")
  .map(([id, job]) => ({ id: `conversion-${id}`, label: "Video conversion", detail: job.progress.currentPath,
    processed: job.progress.processed, total: job.progress.total, target: "sources" as const }));

// Reuse the supplied converter's codec planning, retries and duration verification.
// Python writes only a temporary file; Vaultly commits the file and its existing ID.
export const conversionWorker = video2mp4Script
  .replace('if __name__ == "__main__":', 'if False:')
  .replace('capture_output=True, text=True)', 'capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)')
  .replace('text=True, errors="replace")', 'text=True, encoding="utf-8", errors="replace")')
  .replace('"-i", str(src),', '"-nostdin", "-threads", "2", "-filter_threads", "1", "-i", str(src),')
  .replace('"-movflags", "+faststart"', '"-threads", "2", "-movflags", "+faststart"')
  .replace('errors.append(line)', 'errors.append(line); errors = errors[-30:]') + `
import math
data = json.load(sys.stdin)
src, tmp = Path(data['src']), Path(data['tmp'])
vcopy, acopy = plan(src)
supported = src.suffix.lower() in ('.mp4', '.m4v') and vcopy and acopy
if src.suffix.lower() == '.webm':
    probe = run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', str(src)])
    streams = json.loads(probe.stdout).get('streams', [])
    supported = any(s.get('codec_type') == 'video' for s in streams) and all(
        s.get('codec_name') in (('vp8', 'vp9', 'av1') if s.get('codec_type') == 'video' else ('opus', 'vorbis'))
        for s in streams if s.get('codec_type') in ('video', 'audio'))
if supported:
    sys.exit(3)
total = duration(src)
if total is None or not math.isfinite(total) or total <= 0:
    raise RuntimeError('Could not read source duration')
success, errs = convert(src, tmp, total)
d_out = duration(tmp) if tmp.exists() else None
if not success or d_out is None or not math.isfinite(d_out) or abs(total-d_out) > max(2, total*0.01):
    raise RuntimeError('Conversion or duration verification failed: ' + '; '.join(errs[-3:]))
if plan(tmp) != (True, True):
    raise RuntimeError('Output does not contain browser-compatible video and audio')
`;

export const addConversionLog = (progress: ConversionProgress, line: string) => {
  progress.logs.push(line.slice(0, 800));
  if (progress.logs.length > 100) progress.logs.splice(0, progress.logs.length - 100);
};
function addConversionError(progress: ConversionProgress, message: string) {
  progress.failed++;
  progress.errors.push(message.slice(0, 2400));
  if (progress.errors.length > 100) progress.errors.shift();
  addConversionLog(progress, message);
}

async function worker(src: string, tmp: string, signal: AbortSignal, progress: ConversionProgress) {
  signal.throwIfAborted();
  return new Promise<number>((resolve, reject) => {
    const child = spawn(python(), ["-X", "utf8", "-u", "-c", conversionWorker], { windowsHide: true, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8:replace" } });
    let errors = "";
    let pending = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const lines = (pending + chunk).split(/[\r\n]+/);
      pending = (lines.pop() ?? "").slice(-800);
      for (const line of lines) if (line.trim()) addConversionLog(progress, line.trim());
    });
    child.stderr.on("data", (chunk) => { errors = (errors + chunk.toString()).slice(-2000); });
    const abort = () => {
      if (process.platform === "win32" && child.pid) {
        execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => undefined);
      } else if (child.pid) {
        try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
      }
    };
    signal.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => { signal.removeEventListener("abort", abort); reject(error); });
    child.once("close", (code) => {
      if (pending.trim()) addConversionLog(progress, pending.trim());
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(new Error("Conversion cancelled"));
      else if (code === 0 || code === 3) resolve(code);
      else reject(new Error(errors.trim() || "Converter failed"));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify({ src, tmp }));
  });
}

export async function checkConversionRuntime() {
  await run(python(), ["-c", "import shutil; assert shutil.which('ffmpeg') and shutil.which('ffprobe'), 'ffmpeg and ffprobe must be on PATH'"], { windowsHide: true, timeout: 10_000 });
}

export function startSourceConversion(id: number, root: string): ConversionProgress {
  if (isSourceConverting(id)) return getConversionProgress(id)!;
  const items = database.prepare("SELECT id, relative_path FROM media_items WHERE source_id = ? AND media_type = 'video' AND indexed = 1 AND available = 1 ORDER BY id")
    .all(id) as Array<{ id: number; relative_path: string }>;
  const progress: ConversionProgress = { status: "running", processed: 0, total: items.length, converted: 0, skipped: 0, failed: 0, currentPath: "", errors: [], logs: [] };
  const controller = new AbortController();
  const promise = (async () => {
    try {
      const resolvedRoot = await realpath(root);
      for (const item of items) {
        controller.signal.throwIfAborted();
        progress.currentPath = item.relative_path;
        addConversionLog(progress, `Checking ${item.relative_path}`);
        let tmp: string | undefined;
        try {
          const src = await realpath(path.resolve(root, item.relative_path));
          const relative = path.relative(resolvedRoot, src);
          if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Video is outside the source folder");
          const before = await stat(src);
          const parsed = path.parse(src);
          const dst = path.join(parsed.dir, `${parsed.name}${parsed.ext.toLowerCase() === ".mp4" ? ".browser" : ""}.mp4`);
          try { await access(dst); progress.skipped++; addConversionLog(progress, "Skipped: output already exists"); continue; }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
          tmp = path.join(parsed.dir, `.vaultly-${randomUUID()}.converting.tmp`);
          addConversionLog(progress, "Waiting for process slot / available resources");
          const result = await withMediaProcess(() => worker(src, tmp!, controller.signal, progress), controller.signal);
          if (result === 3) { progress.skipped++; addConversionLog(progress, "Skipped: already browser compatible"); continue; }
          controller.signal.throwIfAborted();
          const after = await stat(src);
          if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("Source changed during conversion; original kept");
          const output = await stat(tmp);
          if (!output.size) throw new Error("Empty conversion output; original kept");
          // Exclusive publication prevents overwriting a file created during conversion.
          await copyFile(tmp, dst, constants.COPYFILE_EXCL);
          try {
            controller.signal.throwIfAborted();
            const latest = await stat(src);
            if (before.size !== latest.size || before.mtimeMs !== latest.mtimeMs) throw new Error("Source changed during conversion; original kept");
            const updated = database.prepare(`UPDATE media_items SET filename = ?, file_extension = '.mp4', relative_path = ?,
              size_bytes = ?, modified_at_ms = ?, video_metadata_signature = NULL, updated_at = CURRENT_TIMESTAMP
              WHERE id = ? AND source_id = ? AND relative_path = ?`)
              .run(path.basename(dst), path.relative(resolvedRoot, dst), output.size, (await stat(dst)).mtimeMs, item.id, id, item.relative_path);
            if (!updated.changes) throw new Error("Library item changed during conversion");
          } catch (error) { await unlink(dst); throw error; }
          progress.converted++;
          await unlink(src);
          addConversionLog(progress, `Converted ${item.relative_path}`);
        } catch (error) {
          if (controller.signal.aborted) throw error;
          addConversionError(progress, `${item.relative_path}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          if (tmp) await unlink(tmp).catch(() => undefined);
          progress.processed++;
        }
      }
      progress.status = progress.failed ? "failed" : "completed";
    } catch (error) {
      progress.status = controller.signal.aborted ? "cancelled" : "failed";
      if (!controller.signal.aborted) addConversionError(progress, error instanceof Error ? error.message : String(error));
    }
    progress.currentPath = "";
    addConversionLog(progress, `Conversion ${progress.status}: ${progress.converted} converted, ${progress.skipped} skipped, ${progress.failed} errors`);
  })();
  jobs.set(id, { root, progress, controller, promise });
  return progress;
}

export async function cancelSourceConversion(id: number) {
  const job = jobs.get(id);
  if (job?.progress.status === "running") { job.controller.abort(); await job.promise; }
  return getConversionProgress(id);
}
