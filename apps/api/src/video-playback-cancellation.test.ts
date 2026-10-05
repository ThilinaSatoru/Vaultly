import { randomUUID } from "node:crypto";
import { writeFile, rm } from "node:fs/promises";
import { expect, test, vi } from "vitest";
import { cancelVideoPlayback, getVideoPlaybackFile, getVideoPlaybackStatus, prepareVideoPlayback, stopVideoPlaybacks } from "./video-playback.js";

const { processes } = vi.hoisted(() => ({ processes: [] as Array<{ signal: AbortSignal; output: string; close: (code: number) => void }> }));
vi.mock("node:child_process", async () => {
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");
  return { spawn: (_file: string, args: string[], options: { signal: AbortSignal }) => {
    const child = new EventEmitter() as InstanceType<typeof EventEmitter> & { stdout: InstanceType<typeof PassThrough>; stderr: InstanceType<typeof PassThrough> };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const close = (code: number) => { options.signal.removeEventListener("abort", abort); child.emit("close", code); };
    const abort = () => queueMicrotask(() => close(1));
    options.signal.addEventListener("abort", abort, { once: true });
    processes.push({ signal: options.signal, output: args.at(-1)!, close });
    return child;
  } };
});

test("deduplicates conversion, queues one encoder, isolates player cancellations, and retries failures", async () => {
  const stamp = Date.now();
  const first = { id: 910001, inputPath: "first.ts", sizeBytes: 1, modifiedAtMs: stamp };
  const second = { ...first, id: 910002, inputPath: "second.avi" };
  const sessionA = randomUUID(), sessionB = randomUUID();
  let cache: string | null = null;
  try {
    await Promise.all([prepareVideoPlayback(first, false, sessionA), prepareVideoPlayback(first, false, sessionB)]);
    await vi.waitFor(() => expect(processes).toHaveLength(1));
    expect((await prepareVideoPlayback(second)).state).toBe("queued");
    await cancelVideoPlayback(first, sessionA);
    expect(processes[0].signal.aborted).toBe(false);
    await cancelVideoPlayback(first, sessionB);
    expect(processes[0].signal.aborted).toBe(true);
    expect((await getVideoPlaybackStatus(first)).state).toBe("idle");
    await vi.waitFor(() => expect(processes).toHaveLength(2));
    processes[1].close(1);
    await vi.waitFor(async () => expect((await getVideoPlaybackStatus(second)).state).toBe("failed"));
    expect((await prepareVideoPlayback(second)).state).toBe("failed");
    await prepareVideoPlayback(second, true);
    await vi.waitFor(() => expect(processes).toHaveLength(3));
    await writeFile(processes[2].output, "encoded mp4 fixture");
    processes[2].close(0);
    await vi.waitFor(async () => expect((await getVideoPlaybackStatus(second)).state).toBe("ready"));
    cache = await getVideoPlaybackFile(second);
    expect((await prepareVideoPlayback({ ...second, modifiedAtMs: stamp + 1 })).state).toBe("preparing");
    await vi.waitFor(() => expect(processes).toHaveLength(4));
    await stopVideoPlaybacks();
    expect(processes[3].signal.aborted).toBe(true);
    expect((await getVideoPlaybackStatus({ ...second, modifiedAtMs: stamp + 1 })).state).toBe("idle");
    // Cleanup can arrive before an aborted POST, as with React StrictMode.
    const abandonedSession = randomUUID();
    await cancelVideoPlayback(first, abandonedSession);
    expect((await prepareVideoPlayback(first, false, abandonedSession)).state).toBe("idle");
    expect(processes).toHaveLength(4);
  } finally {
    await stopVideoPlaybacks();
    if (cache) await rm(cache, { force: true });
  }
});
