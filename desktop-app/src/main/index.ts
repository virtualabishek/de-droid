import { app, BrowserWindow, shell, ipcMain } from "electron";
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
      path.join(__dirname, "..", "..", "dist", "renderer", "index.html"),
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

// Register IPC handlers for ADB operations
function registerIpcHandlers() {
  const adb = getAdbManager();

  ipcMain.handle("adb:isAvailable", async () => {
    try {
      const result = await adb.startServer();
      return result.success;
    } catch {
      return false;
    }
  });

  ipcMain.handle("adb:startServer", async () => {
    return adb.startServer();
  });

  ipcMain.handle("adb:stopServer", async () => {
    return adb.stopServer();
  });

  ipcMain.handle("adb:getDevices", async () => {
    return adb.getDevices();
  });

  ipcMain.handle(
    "adb:getPackages",
    async (_event, deviceId: string, options?: any) => {
      return adb.getPackages(deviceId, options);
    },
  );

  ipcMain.handle(
    "adb:disablePackages",
    async (_event, deviceId: string, packageName: string) => {
      return adb.disablePackage(deviceId, packageName);
    },
  );

  ipcMain.handle(
    "adb:enablePackages",
    async (_event, deviceId: string, packageName: string) => {
      return adb.enablePackage(deviceId, packageName);
    },
  );

  ipcMain.handle(
    "adb:unistallPackage",
    async (
      _event,
      deviceId: string,
      packageName: string,
      keepData?: boolean,
    ) => {
      return adb.uninstallPackage(deviceId, packageName, keepData);
    },
  );

  ipcMain.handle(
    "adb:reinstallPackages",
    async (_event, deviceId: string, packageName: string) => {
      return adb.reinstallPackage(deviceId, packageName);
    },
  );

  ipcMain.handle("adb:getDeviceInfo", async (_event, deviceId: string) => {
    return adb.getDeviceInfo(deviceId);
  });

  ipcMain.handle("adb:isRooted", async (_event, deviceId: string) => {
    return adb.isRooted(deviceId);
  });

  console.log("[Main] IPC handlers registered");
}

// Register handlers before app is ready
registerIpcHandlers();

app.on("before-quit", async () => {
  try {
    const adb = getAdbManager();
    await adb.stopServer();
    console.log("ADB server stopped.");
  } catch (error) {
    console.error("Failed to stop ADB server", error);
  }
});
