import { expect, test, vi } from "vitest";
import { createExitGuard } from "./exit-confirmation.js";

test("idle exit proceeds without a prompt", async () => {
  const confirm = vi.fn();
  const exit = vi.fn();
  const guard = createExitGuard(async () => false, confirm);
  await guard.request(exit);
  expect(confirm).not.toHaveBeenCalled();
  expect(exit).toHaveBeenCalledOnce();
  expect(guard.approved).toBe(true);
});

test("cancel keeps tasks running and later exit can be confirmed", async () => {
  const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const exit = vi.fn();
  const guard = createExitGuard(async () => true, confirm);
  await guard.request(exit);
  expect(exit).not.toHaveBeenCalled();
  expect(guard.approved).toBe(false);
  await guard.request(exit);
  expect(exit).toHaveBeenCalledOnce();
  expect(guard.approved).toBe(true);
});

test("repeated close and quit events share one confirmation", async () => {
  let resolve!: (value: boolean) => void;
  const confirm = vi.fn(() => new Promise<boolean>((done) => { resolve = done; }));
  const guard = createExitGuard(async () => true, confirm);
  const exit = vi.fn();
  const pending = guard.request(exit);
  await Promise.resolve();
  await guard.request(exit);
  expect(confirm).toHaveBeenCalledOnce();
  resolve(true);
  await pending;
  expect(exit).toHaveBeenCalledOnce();
});
