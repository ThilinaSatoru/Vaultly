import { expect, test, vi } from "vitest";
import type { BrowserWindow, IpcMainEvent } from "electron";
import { focusActiveRenderer, focusInputSender } from "./input-focus.js";

function setup() {
  const frame = {};
  const contents = { mainFrame: frame, focus: vi.fn() };
  const window = { isDestroyed: () => false, isFocused: () => true, webContents: contents };
  const event = { sender: contents, senderFrame: frame };
  return { window: window as unknown as BrowserWindow, event: event as unknown as IpcMainEvent, focus: contents.focus };
}

test("each input click restores native renderer focus in the active desktop window", () => {
  const { window, event, focus } = setup();
  focusInputSender(event, window);
  focusInputSender(event, window);
  expect(focus).toHaveBeenCalledTimes(2);
});

test("focus recovery rejects other windows and subframes", () => {
  const { window, event, focus } = setup();
  focusInputSender({ ...event, senderFrame: {} } as IpcMainEvent, window);
  focusInputSender({ ...event, sender: {} } as IpcMainEvent, window);
  expect(focus).not.toHaveBeenCalled();
});

test("focus recovery never activates a background or destroyed window", () => {
  const { window, event, focus } = setup();
  window.isFocused = () => false;
  focusInputSender(event, window);
  focusActiveRenderer(window);
  window.isFocused = () => true;
  window.isDestroyed = () => true;
  focusInputSender(event, window);
  focusActiveRenderer(window);
  focusInputSender(event, null);
  focusActiveRenderer(null);
  expect(focus).not.toHaveBeenCalled();
});
