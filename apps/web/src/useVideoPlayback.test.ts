import { afterEach, beforeEach, expect, test, vi } from "vitest";

const hooks = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0, effect: undefined as (() => void) | undefined, deps: undefined as unknown[] | undefined, jobs: [] as Array<() => void> }));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [hooks.states[index], (value: unknown) => { hooks.states[index] = typeof value === "function" ? value(hooks.states[index]) : value; }];
  },
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    if (hooks.deps && deps.every((value, index) => Object.is(value, hooks.deps![index]))) return;
    hooks.jobs.push(() => { hooks.effect?.(); hooks.deps = deps; hooks.effect = effect(); });
  },
}));
vi.mock("./media", () => ({ api: vi.fn() }));
import { api } from "./media";
import { needsCompatiblePlayback, useVideoPlayback } from "./useVideoPlayback";
const request = vi.mocked(api);
function render(extension = "mp4") {
  hooks.cursor = 0;
  const result = useVideoPlayback("/api/items/1/file", 1, extension);
  hooks.jobs.splice(0).forEach((job) => job());
  return result;
}
beforeEach(() => {
  hooks.states = []; hooks.cursor = 0; hooks.deps = undefined; hooks.effect = undefined; hooks.jobs = [];
  request.mockReset(); vi.useFakeTimers();
});
afterEach(() => { hooks.effect?.(); vi.useRealTimers(); });

test("native playback stays direct and failures switch to cached compatibility playback", async () => {
  request.mockResolvedValue({ state: "ready", percent: 100 });
  const native = render();
  expect(native.src).toBe("/api/items/1/file");
  expect(request).not.toHaveBeenCalled();
  native.fallback();
  expect(render().preparing).toBe(true);
  await Promise.resolve();
  expect(render().src).toBe("/api/items/1/playback/file");
  expect(request).toHaveBeenCalledTimes(1);
});

test("transport streams prepare automatically, poll progress, and expose retry after conversion failure", async () => {
  for (const extension of ["TS", "mts", "m2ts", "mkv", "avi", "wmv", "vob", "mpeg"]) expect(needsCompatiblePlayback(extension)).toBe(true);
  expect(needsCompatiblePlayback("WEBM")).toBe(false);
  request.mockResolvedValueOnce({ state: "preparing", percent: 10 })
    .mockResolvedValueOnce({ state: "failed", percent: 0, message: "Damaged video" })
    .mockResolvedValue({ state: "ready", percent: 100 });
  render("ts");
  await Promise.resolve();
  expect(render("ts")).toMatchObject({ preparing: true, percent: 10, src: undefined });
  await vi.advanceTimersByTimeAsync(1000);
  const failed = render("ts");
  expect(failed.error).toBe("Damaged video");
  failed.retry();
  render("ts");
  await Promise.resolve();
  expect(render("ts").src).toBe("/api/items/1/playback/file");
  expect(JSON.parse(request.mock.calls[2][1]!.body as string)).toMatchObject({ retry: true });
});

test("closing during preparation aborts polling and releases only this player's session", async () => {
  request.mockResolvedValue({ state: "queued", percent: 0 });
  render("ts");
  await Promise.resolve();
  const start = request.mock.calls[0][1]!;
  hooks.effect?.(); hooks.effect = undefined;
  expect((start.signal as AbortSignal).aborted).toBe(true);
  expect(request.mock.calls[1][1]).toMatchObject({ method: "DELETE", body: JSON.stringify({ session: JSON.parse(start.body as string).session }) });
  await vi.advanceTimersByTimeAsync(5000);
  expect(request).toHaveBeenCalledTimes(2);
});
