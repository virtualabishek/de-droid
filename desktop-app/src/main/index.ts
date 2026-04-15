import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import * as dotenv from "dotenv";
import { initDatabase, closeDatabase } from "./database";
import {
  AdbIpcRegistrar,
  AuthIpcRegistrar,
  HistoryIpcRegistrar,
} from "./ipc";

dotenv.config();
let mainWindow: BrowserWindow | null = null;

function getAppIconPath(): string {
  if (process.env.NODE_ENV === "development") {
    return path.join(__dirname, "../../resources/dedroid-transparent-logo.png");
  }

  return path.join(process.resourcesPath, "dedroid-transparent-logo.png");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    frame: true,
    backgroundColor: "#1a1a2e",
    icon: getAppIconPath(),
  });

  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:3001");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });

  mainWindow.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
}

// Initialize database and register IPC handlers
async function setupApp() {
  console.log("[APP] Initializing database...");
  initDatabase();

  console.log("[APP] Registering IPC handlers...");
  AdbIpcRegistrar.getInstance().registerHandlers();
  AuthIpcRegistrar.getInstance().registerHandlers();
  HistoryIpcRegistrar.getInstance().registerHandlers();

  ipcMain.removeHandler("app:health");
  ipcMain.handle("app:health", async () => {
    return {
      status: "healthy",
      version: app.getVersion(),
      mode: "local",
    };
  });

  console.log("[APP] Setup complete");
}

app.whenReady().then(() => {
  setupApp();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  console.log("[APP] Closing database...");
  AdbIpcRegistrar.getInstance().unregisterHandlers();
  AuthIpcRegistrar.getInstance().unregisterHandlers();
  HistoryIpcRegistrar.getInstance().unregisterHandlers();
  ipcMain.removeHandler("app:health");
  closeDatabase();
});
