import { afterEach, expect, test, vi } from "vitest";

const ipc = vi.hoisted(() => ({ send: vi.fn(), sendSync: vi.fn() }));
vi.mock("electron", () => ({ ipcRenderer: ipc, contextBridge: { exposeInMainWorld: vi.fn() } }));
afterEach(() => vi.unstubAllGlobals());

test("trusted editable-field clicks request desktop focus, including repeated clicks", async () => {
  const addEventListener = vi.fn();
  vi.stubGlobal("window", { addEventListener });
  class Editable {
    constructor(private matches: boolean) {}
    closest() { return this.matches ? this : null; }
  }
  vi.stubGlobal("Element", Editable);
  await import("./preload.js");
  const listener = addEventListener.mock.calls.find(([name]) => name === "pointerdown")![1];
  expect(addEventListener).toHaveBeenCalledWith("pointerdown", expect.any(Function), true);
  const click = { button: 0, isTrusted: true, target: new Editable(true) };
  listener(click);
  listener(click);
  expect(ipc.send).toHaveBeenCalledTimes(2);
  expect(ipc.send).toHaveBeenLastCalledWith("window:focus-input");
  listener({ ...click, isTrusted: false });
  listener({ ...click, button: 2 });
  listener({ ...click, target: new Editable(false) });
  expect(ipc.send).toHaveBeenCalledTimes(2);
});
