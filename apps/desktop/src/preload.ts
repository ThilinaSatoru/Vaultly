import { contextBridge, ipcRenderer } from "electron";

// DOM focus alone can leave the native renderer unfocused after a desktop dialog.
// Recover on the user's next click, before they start typing into an editable field.
window.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !event.isTrusted || !(event.target instanceof Element)) return;
  if (event.target.closest("input:not(:disabled), textarea:not(:disabled), [contenteditable='true']")) {
    ipcRenderer.send("window:focus-input");
  }
}, true);

contextBridge.exposeInMainWorld("vaultlyWindow", {
  platform: process.platform,
  taskActivity: (running: boolean) => ipcRenderer.send("window:task-activity", running),
  musicState: (state: { enabled: boolean; playing: boolean; title: string }) => ipcRenderer.send("window:music-state", state),
  minimizeToTray: () => ipcRenderer.send("window:minimize-to-tray"),
  onMusicCommand: (handler: (command: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: unknown) => {
      if (command === "toggle" || command === "next" || command === "previous") handler(command);
    };
    ipcRenderer.on("music:command", listener);
    return () => { ipcRenderer.removeListener("music:command", listener); };
  },
  appearance: (appearance: { color: string; symbolColor: string; title: string }) => ipcRenderer.send("window:appearance", appearance),
});

contextBridge.exposeInMainWorld("vaultlyPreferences", {
  read: () => ipcRenderer.sendSync("preferences:read"),
  write: (key: string, value: string | null) => {
    const error = ipcRenderer.sendSync("preferences:write", key, value);
    if (error) throw new Error(error);
  },
});
