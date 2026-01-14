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

  if (isDev) {
    const ports = [5173, 5174];
    let loaded = false;

    for (const port of ports) {
      try {
        await mainWindow.loadURL(`http://localhost:${port}`);
        console.log(`Loaded renderer from port ${port}`);
        loaded = true;
        break;
      } catch (error) {
        console.log(`Port ${port} not available, trying next...`);
      }
    }

    if (!loaded) {
      console.error("Failed to load renderer from any port");
    }

    mainWindow.webContents.openDevTools();
  } else {
    await mainWindow.loadFile(
      path.join(__dirname, "..", "..", "dist", "renderer", "index.html")
    );
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.on("ready", createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on("before-quit", async () => {
  try {
    const adb = getAdbManager();
    await adb.stopServer();
    console.log("ADB server stopped.");
  } catch (error) {
    console.error("Failed to stop ADB server", error);
  }
});

