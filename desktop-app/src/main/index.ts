import { app, BrowserWindow, shell } from "electron";
import path from "path";
import { getAdbManager } from "./adb/adb-manager";
let mainWindow: BrowserWindow | null = null;
const isDev = !app.isPackaged;
async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: isDev
      ? path.join(__dirname, "..", "..", "resources", "icon.png")
      : path.join(process.resourcesPath, "icon.png"),
    show: false,
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  if (!isDev) {
    await mainWindow.loadURL("http://localhost:3001");
    mainWindow.webContents.openDevTools();
  } else {
    await mainWindow.loadFile(
      path.join(__dirname, "..", "..", "renderer", "index.html"),
    );
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  app.on("before-quit", async () => {
    try {
        const adb = getAdbManager();
        await adb.stopServer();
        console.log("ADB server stopped.");
    } catch(error) {
        console.error('failed to stop ADB server', error)
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });   
}
