import { ipcMain } from "electron";
import { getAdbManager } from "../adb/adb-manager";
import { isAdbAvailable } from "../adb/adb-path";

export function registerAdbHandlers(): void {
  const adb = getAdbManager();
  ipcMain.handle("adb: isAvailable", () => {
    return isAdbAvailable();
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
    async (_, deviceId: string, options?: any) => {
      return adb.getPackages(deviceId, options);
    }
  );
  ipcMain.handle(
    "adb:disablePackages",
    async (_, deviceId: string, packageName: string) => {
      return adb.disablePackage(deviceId, packageName);
    }
  );
  ipcMain.handle(
    "adb:enablePackages",
    async (_, deviceId: string, packageName: string) => {
      return adb.enablePackage(deviceId, packageName);
    }
  );
  ipcMain.handle(
    "adb:unistallPackage",
    async (_, deviceId: string, packageName: string, keepData?: boolean) => {
      return adb.uninstallPackage(deviceId, packageName, keepData);
    }
  );
  ipcMain.handle(
    "adb:reinstallPackages",
    async (_, deviceId: string, packageName: string) => {
      return adb.reinstallPackage(deviceId, packageName);
    }
  );
  ipcMain.handle("adb:getDeviceInfo", async (_, deviceId: string) => {
    return adb.getDeviceInfo(deviceId);
  });
  ipcMain.handle(
    "adb:isRooted",
    async (_, deviceId: string) => {
      return adb.isRooted(deviceId);
    }
  );
}
