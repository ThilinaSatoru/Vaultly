import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("vaultlyPreferences", {
  read: () => ipcRenderer.sendSync("preferences:read"),
  write: (key: string, value: string | null) => {
    const error = ipcRenderer.sendSync("preferences:write", key, value);
    if (error) throw new Error(error);
  },
});
