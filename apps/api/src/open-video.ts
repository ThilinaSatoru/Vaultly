import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function openVideoInDefaultPlayer(filePath: string): Promise<void> {
  // Pass the validated path as data, never interpolate filenames into shell code.
  await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "Invoke-Item -LiteralPath $env:VAULTLY_OPEN_VIDEO -ErrorAction Stop"], {
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 64 * 1024,
    env: { ...process.env, VAULTLY_OPEN_VIDEO: filePath },
  });
}
