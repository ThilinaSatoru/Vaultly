import { fork } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { withMediaProcess } from "./process-resources.js";

/** Wait for worker exit before releasing the slot so native image memory is reclaimed. */
export function readCoverDimensions(filename: string, signal?: AbortSignal): Promise<{ width: number; height: number }> {
  return withMediaProcess(() => {
    signal?.throwIfAborted();
    const url = process.env.VAULTLY_COVER_WORKER_PATH
      ? pathToFileURL(path.resolve(process.env.VAULTLY_COVER_WORKER_PATH))
      : new URL("../cover-dimensions-worker.mjs", import.meta.url);
    const processOptions = {
      execArgv: ["--max-old-space-size=128"], windowsHide: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"] as ("ignore" | "ipc")[],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    };
    const worker = fork(url, [filename], processOptions);
    return new Promise<{ width: number; height: number }>((resolve, reject) => {
      let result: { width: number; height: number } | undefined;
      let failure: Error | undefined;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (error) reject(error);
        else if (result) resolve(result);
        else reject(new Error("Cover worker exited without dimensions."));
      };
      const stop = (error: Error) => { failure = error; worker.kill(); };
      const abort = () => stop(signal?.reason instanceof Error ? signal.reason : new Error("Cover inspection cancelled."));
      const timer = setTimeout(() => stop(new Error("Cover inspection timed out.")), 8000);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      worker.once("message", (message: { ok?: boolean; width?: number; height?: number; error?: string }) => {
        if (signal?.aborted || failure) return;
        if (message.ok && Number.isInteger(message.width) && Number.isInteger(message.height)
          && message.width! > 0 && message.height! > 0 && message.width! * message.height! <= 40_000_000) {
          result = { width: message.width!, height: message.height! };
        } else failure = new Error(message.error || "Invalid cover dimensions.");
        worker.kill();
      });
      worker.once("error", (error) => finish(error));
      worker.once("exit", () => finish(failure));
    });
  }, signal);
}
