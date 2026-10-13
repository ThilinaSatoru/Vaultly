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
  appearance: (appearance: { color: string; symbolColor: string; title: string }) => ipcRenderer.send("window:appearance", appearance),
});

contextBridge.exposeInMainWorld("vaultlyPreferences", {
  read: () => ipcRenderer.sendSync("preferences:read"),
  write: (key: string, value: string | null) => {
    const error = ipcRenderer.sendSync("preferences:write", key, value);
    if (error) throw new Error(error);
  },
});
