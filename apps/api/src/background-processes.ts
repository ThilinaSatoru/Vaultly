import { execFile, type ChildProcess, type ExecFileOptions } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const children = new Set<ChildProcess>();
let shutdown = new AbortController();
export const backgroundSignal = (signal?: AbortSignal) => signal ?? shutdown.signal;
export function resetProcessShutdown() { if (shutdown.signal.aborted) shutdown = new AbortController(); }
export function trackProcess<T extends ChildProcess>(child: T): T {
  children.add(child);
  const remove = () => children.delete(child);
  child.once("close", remove);
  child.once("error", remove);
  return child;
}
export function runCommand(command: string, args: string[], options: ExecFileOptions = {}) {
  const task = execute(command, args, { ...options, encoding: "utf8", signal: backgroundSignal(options.signal) });
  if (task.child) trackProcess(task.child);
  return task;
}
export function runBinaryCommand(command: string, args: string[], options: ExecFileOptions = {}) {
  const task = execute(command, args, { ...options, encoding: "buffer", signal: backgroundSignal(options.signal) });
  if (task.child) trackProcess(task.child);
  return task;
}
export async function terminateProcess(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    await execute("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 5000 }).catch(() => { child.kill(); });
  } else { child.kill("SIGKILL"); }
}
export async function stopBackgroundProcesses() {
  shutdown.abort(new Error("Vaultly is closing."));
  // Only processes launched by this server are tracked; never kill by executable name.
  for (const child of [...children]) {
    const closed = new Promise<void>((resolve) => { child.once("close", resolve); child.once("error", () => resolve()); });
    await terminateProcess(child);
    if (children.has(child)) await Promise.race([closed, new Promise<void>((resolve) => { const timer = setTimeout(resolve, 5000); timer.unref(); })]);
  }
  const remaining = [...children].filter((child) => child.exitCode === null && child.signalCode === null).map((child) => child.pid);
  if (remaining.length) throw new Error(`Background processes did not exit: ${remaining.join(", ")}`);
}
