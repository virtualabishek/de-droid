import { contextBridge, ipcRenderer } from "electron";

console.log("[Preload] Starting preload script");

contextBridge.exposeInMainWorld("electronAPI", {
  adb: {
    isAvailable: () => {
      console.log("[Preload] Calling adb:isAvailable");
      return ipcRenderer.invoke("adb:isAvailable");
    },
    startAvailable: () => {
      console.log("[Preload] Calling adb:startServer");
      return ipcRenderer.invoke("adb:startServer");
    },
    stopAvailable: () => {
      console.log("[Preload] Calling adb:stopServer");
      return ipcRenderer.invoke("adb:stopServer");
    },
    getDevices: () => {
      console.log("[Preload] Calling adb:getDevices");
      return ipcRenderer.invoke("adb:getDevices");
    },
    getPackages: (deviceId: string, options?: any) => {
      console.log("[Preload] Calling adb:getPackages for device:", deviceId);
      return ipcRenderer.invoke("adb:getPackages", deviceId, options);
    },
    disablePackage: (deviceId: string, packageName: string) => {
      console.log("[Preload] Calling adb:disablePackages:", packageName);
      return ipcRenderer.invoke("adb:disablePackages", deviceId, packageName);
    },
    enablePackage: (deviceId: string, packageName: string) => {
      console.log("[Preload] Calling adb:enablePackages:", packageName);
      return ipcRenderer.invoke("adb:enablePackages", deviceId, packageName);
    },
    uninstallPackage: (
      deviceId: string,
      packageName: string,
      keepData?: boolean
    ) => {
      console.log("[Preload] Calling adb:uninstallPackage:", packageName);
      return ipcRenderer.invoke(
        "adb:unistallPackage",
        deviceId,
        packageName,
        keepData
      );
    },
    reinstallPackage: (deviceId: string, packageName: string) => {
      console.log("[Preload] Calling adb:reinstallPackages:", packageName);
      return ipcRenderer.invoke("adb:reinstallPackages", deviceId, packageName);
    },
    getDeviceInfo: (deviceId: string) => {
      console.log("[Preload] Calling adb:getDeviceInfo:", deviceId);
      return ipcRenderer.invoke("adb:getDeviceInfo", deviceId);
    },
    isRooted: (deviceId: string) => {
      console.log("[Preload] Calling adb:isRooted:", deviceId);
      return ipcRenderer.invoke("adb:isRooted", deviceId);
    },
  },
  //   TODO, Backend API
  app: {
    getVersion: () => ipcRenderer.invoke("app:getVersion"),
    getPlatform: () => process.platform
  }
});

console.log("[Preload] Preload script completed successfully");
