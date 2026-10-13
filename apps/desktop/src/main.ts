import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { fork } from "node:child_process";
import { terminateProcess } from "../../api/src/background-processes.js";
import type { DesktopRequest, DesktopResponse } from "./server-ipc.js";
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const currentDirectory = __dirname;
const developmentUrl = process.env.VAULTLY_DEV_SERVER_URL;
let mainWindow: BrowserWindow | null = null;
let closeServer: (() => Promise<void>) | null = null;
let serverAddress: string | null = null;
let shuttingDown = false;
let shutdownComplete = false;
let preferences: Record<string, string> | undefined;
function readPreferences() {
  if (!preferences) {
    const file = path.join(app.getPath("userData"), "preferences.json");
    const stored = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    preferences = Object.fromEntries(Object.entries(stored).filter(([key, value]) => key.startsWith("vaultly.") && typeof value === "string")) as Record<string, string>;
  }
  return preferences;
}
function trustedPreferencesSender(event: Electron.IpcMainEvent) {
  return event.sender === mainWindow?.webContents && event.senderFrame === event.sender.mainFrame;
}
ipcMain.on("preferences:read", (event) => {
  event.returnValue = trustedPreferencesSender(event) ? readPreferences() : {};
});
ipcMain.on("preferences:write", (event, key, value) => {
  if (!trustedPreferencesSender(event) || typeof key !== "string" || !key.startsWith("vaultly.") || (value !== null && typeof value !== "string")) {
    event.returnValue = "Invalid preference request.";
    return;
  }
  try {
    const next = { ...readPreferences() };
    if (value === null) delete next[key]; else next[key] = value;
    const file = path.join(app.getPath("userData"), "preferences.json");
    writeFileSync(`${file}.tmp`, JSON.stringify(next), "utf8");
    renameSync(`${file}.tmp`, file);
    preferences = next;
    event.returnValue = null;
  } catch (error) { event.returnValue = String(error); }
});
function recordCrash(details: string) {
  const snapshot = `RSS=${Math.round(process.memoryUsage().rss / 1024 ** 2)}MB free=${Math.round(os.freemem() / 1024 ** 2)}MB`;
  try { appendFileSync(path.join(app.getPath("userData"), "crash-error.log"), `${new Date().toISOString()} ${snapshot}\n${details}\n`, "utf8"); }
  catch { console.error(details); }
}
ipcMain.on("window:appearance", (event, appearance) => {
  if (!trustedPreferencesSender(event) || !appearance || typeof appearance.title !== "string" || appearance.title.length > 200) return;
  if (!/^#[0-9a-f]{6}$/i.test(appearance.color) || !/^#[0-9a-f]{6}$/i.test(appearance.symbolColor)) return;
  mainWindow?.setTitle(appearance.title);
  if (process.platform !== "darwin") mainWindow?.setTitleBarOverlay({ color: appearance.color, symbolColor: appearance.symbolColor, height: 38 });
});
process.on("uncaughtExceptionMonitor", (error) => recordCrash(error.stack ?? error.message));
app.on("child-process-gone", (_event, details) => recordCrash(`Child process: ${JSON.stringify(details)}`));

async function createWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#111315",
    title: "Vaultly · A world within your vault",
    titleBarStyle: "hidden",
    ...(process.platform !== "darwin" && { titleBarOverlay: { color: "#111315", symbolColor: "#e6edf3", height: 38 } }),
    icon: path.join(currentDirectory, process.platform === "win32" ? "icon.ico" : "icon.png"),
    show: false,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(currentDirectory, "preload.cjs") },
  });
  mainWindow.setMenu(null);

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.on("render-process-gone", (_event, details) => recordCrash(`Renderer: ${JSON.stringify(details)}`));
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!developmentUrl && !serverAddress) { event.preventDefault(); return; }
    const allowedOrigin = new URL(developmentUrl ?? serverAddress!).origin;
    if (new URL(url).origin !== allowedOrigin) {
      event.preventDefault();
      if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    }
  });

  // Paint before database initialization. The API runs outside Electron's UI process.
  await mainWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><title>Vaultly · Opening the vault</title><style>body{margin:0;display:grid;place-items:center;height:100vh;background:#111315;color:#e6edf3;font:16px system-ui}body::before{content:'Vaultly · Opening the vault';position:fixed;inset:0 145px auto ${process.platform === "darwin" ? "80px" : "16px"};height:38px;display:flex;align-items:center;font-size:12px;-webkit-app-region:drag}.loading{text-align:center}.spinner{width:32px;height:32px;margin:0 auto 20px;border:3px solid #343b44;border-top-color:#a9c8ec;border-radius:50%;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div class="loading" role="status"><div class="spinner"></div><h1>Vaultly</h1><p>Opening your library…</p></div></body></html>`));
  if (!serverAddress) {
    const processOptions = {
      windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", VAULTLY_RUNTIME_DIR: app.getPath("userData"),
        VAULTLY_API_PORT: developmentUrl ? process.env.VAULTLY_API_PORT ?? "4400" : "0",
        VAULTLY_STATIC_ROOT: developmentUrl ? "" : app.isPackaged ? path.join(process.resourcesPath, "web") : path.resolve(currentDirectory, "../../web/dist"),
        VAULTLY_PDF_WORKER_PATH: path.join(currentDirectory, "pdf-thumbnail-worker.mjs"), VAULTLY_COVER_WORKER_PATH: path.join(currentDirectory, "cover-dimensions-worker.mjs") },
    };
    const child = fork(path.join(currentDirectory, "api-process.cjs"), [], { ...processOptions, stdio: ["ignore", "ignore", "pipe", "ipc"] });
    let diagnostic = "";
    child.stderr?.on("data", (chunk) => { diagnostic = (diagnostic + chunk.toString()).slice(-4000); });
    const exited = new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.once("error", () => resolve()); });
    closeServer = async () => {
      if (child.connected) child.send({ type: "stop" });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([exited, new Promise<void>((resolve) => { timer = setTimeout(() => { void terminateProcess(child).then(resolve); }, 15000); })]);
        await exited;
      } finally { if (timer) clearTimeout(timer); }
    };
    child.on("message", async (message: DesktopRequest | { type: "ready"; address: string }) => {
      if (message.type !== "desktop") return;
      const response: DesktopResponse = { type: "desktop-result", id: message.id };
      try {
        if (shuttingDown) throw new Error("Vaultly is closing.");
        if (message.action === "pick-directory") {
          const options = { title: "Choose a media library folder", properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory"> };
          const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
          response.value = result.canceled ? null : result.filePaths[0] ?? null;
        } else if (message.action === "reveal-path" && message.path) shell.showItemInFolder(message.path);
        else if (message.action === "open-video" && message.path) { const error = await shell.openPath(message.path); if (error) throw new Error(error); }
      } catch (error) { response.error = String(error); }
      if (child.connected) child.send(response);
    });
    serverAddress = await new Promise<string>((resolve, reject) => {
      child.on("message", (message: { type?: string; address?: string }) => { if (message.type === "ready" && message.address) resolve(message.address); });
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(diagnostic || `Library server exited (${code}).`)));
    });
    child.once("exit", (code) => {
      if (!shuttingDown) { recordCrash(`Library server exited (${code}): ${diagnostic}`); dialog.showErrorBox("Vaultly's library server stopped", diagnostic || "Restart Vaultly to reopen your library."); app.quit(); }
    });
  }
  if (!shuttingDown && mainWindow) await mainWindow.loadURL(developmentUrl ?? serverAddress);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(createWindow).catch((error) => {
    const details = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(details);
    try {
      writeFileSync(path.join(app.getPath("userData"), "startup-error.log"), `${details}\n`, "utf8");
    } catch {
      // The error dialog remains available if the application-data directory is not writable.
    }
    dialog.showErrorBox("Vaultly could not start", details);
    app.quit();
  });
}

app.on("ready", () => {
  if (process.platform === "win32") app.setAppUserModelId("com.vaultly.app");
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", (event) => {
  if (closeServer && !shutdownComplete) {
    event.preventDefault();
    if (shuttingDown) return;
    shuttingDown = true;
    void closeServer().catch((error) => recordCrash(String(error))).finally(() => { shutdownComplete = true; app.quit(); });
  }
});
