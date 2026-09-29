import { app, BrowserWindow, dialog, shell } from "electron";
import { writeFileSync } from "node:fs";
import path from "node:path";

const currentDirectory = __dirname;
const developmentUrl = process.env.VAULTLY_DEV_SERVER_URL;
let mainWindow: BrowserWindow | null = null;
let closeServer: (() => Promise<void>) | null = null;
let serverAddress: string | null = null;

async function createWindow() {
  if (!serverAddress) {
    process.env.VAULTLY_RUNTIME_DIR = app.getPath("userData");
    process.env.VAULTLY_PDF_WORKER_PATH = path.join(currentDirectory, "pdf-thumbnail-worker.mjs");

    const { startVaultlyServer } = await import("../../api/src/server.js");
    const staticRoot = developmentUrl
      ? undefined
      : app.isPackaged ? path.join(process.resourcesPath, "web") : path.resolve(currentDirectory, "../../web/dist");
    const { app: server, address } = await startVaultlyServer({
      port: developmentUrl ? Number.parseInt(process.env.VAULTLY_API_PORT ?? "4400", 10) : 0,
      staticRoot,
      pickDirectory: async () => {
        const dialogOptions = {
        title: "Choose a media library folder",
          properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">,
        };
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, dialogOptions)
          : await dialog.showOpenDialog(dialogOptions);
        return result.canceled ? null : result.filePaths[0] ?? null;
      },
      revealPath: async (itemPath) => shell.showItemInFolder(itemPath),
    });
    serverAddress = address;
    closeServer = () => server.close();
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#111315",
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowedOrigin = new URL(developmentUrl ?? serverAddress!).origin;
    if (new URL(url).origin !== allowedOrigin) {
      event.preventDefault();
      if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    }
  });

  await mainWindow.loadURL(developmentUrl ?? serverAddress);
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

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  if (closeServer) void closeServer();
});
