import { afterEach, expect, test, vi } from "vitest";

const ipc = vi.hoisted(() => ({ send: vi.fn(), sendSync: vi.fn(), on: vi.fn(), removeListener: vi.fn() }));
const exposed = vi.hoisted(() => ({ exposeInMainWorld: vi.fn() }));
vi.mock("electron", () => ({ ipcRenderer: ipc, contextBridge: exposed }));
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

test("tray playback commands are bounded and their subscription is removed on cleanup", async () => {
  vi.stubGlobal("window", { addEventListener: vi.fn() });
  await import("./preload.js");
  const bridge = exposed.exposeInMainWorld.mock.calls.find(([name]) => name === "vaultlyWindow")![1];
  const handler = vi.fn();
  const dispose = bridge.onMusicCommand(handler);
  const [channel, listener] = ipc.on.mock.calls.at(-1)!;
  expect(channel).toBe("music:command");
  for (const command of ["toggle", "next", "previous", "quit", "open-path", {}, null]) listener({},command);
  expect(handler.mock.calls).toEqual([["toggle"],["next"],["previous"]]);
  dispose();
  expect(ipc.removeListener).toHaveBeenCalledWith("music:command",listener);
  bridge.musicState({ enabled: true, playing: true, title: "Track" });
  expect(ipc.send).toHaveBeenLastCalledWith("window:music-state",{ enabled: true, playing: true, title: "Track" });
  bridge.minimizeToTray();
  expect(ipc.send).toHaveBeenLastCalledWith("window:minimize-to-tray");
});
