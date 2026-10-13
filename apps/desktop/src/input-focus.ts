import type { BrowserWindow, IpcMainEvent } from "electron";

export function focusActiveRenderer(window: BrowserWindow | null) {
  if (window && !window.isDestroyed() && window.isFocused()) window.webContents.focus();
}

export function focusInputSender(event: IpcMainEvent, window: BrowserWindow | null) {
  if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame) return;
  focusActiveRenderer(window);
}
