import { expect, test, vi } from "vitest";
const { launches } = vi.hoisted(() => ({ launches: [] as Array<{ command: string; args: string[]; options: { env: Record<string, string>; windowsHide: boolean } }> }));
vi.mock("node:child_process", () => ({
  execFile: (command: string, args: string[], options: { env: Record<string, string>; windowsHide: boolean }, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    launches.push({ command, args, options });
    callback(null, "", "");
  },
}));
import { openVideoInDefaultPlayer } from "./open-video.js";

test("Windows receives the original path as literal data and hides only the launcher", async () => {
  const filename = "D:\\Videos\\[Live] Movie & 'episode' $name.ts";
  await openVideoInDefaultPlayer(filename);
  expect(launches).toHaveLength(1);
  expect(launches[0].command).toBe("powershell.exe");
  expect(launches[0].args.join(" ")).not.toContain(filename);
  expect(launches[0].args.at(-1)).toBe("Invoke-Item -LiteralPath $env:VAULTLY_OPEN_VIDEO -ErrorAction Stop");
  expect(launches[0].options.env.VAULTLY_OPEN_VIDEO).toBe(filename);
  expect(launches[0].options.windowsHide).toBe(true);
});
