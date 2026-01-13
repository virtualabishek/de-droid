import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  adb: {
    isAvailable: () => ipcRenderer.invoke("adb:isAvailable"),
    startAvailable: () => ipcRenderer.invoke("adb:startServer"),
    stopAvailable: () => ipcRenderer.invoke("adb:stopServer"),
    getDevices: () => ipcRenderer.invoke("adb:getDevices"),
    getPackages: (deviceId: string, options?: any) =>
      ipcRenderer.invoke("adb:getPackages", deviceId, options),
    disablePackage: (deviceId: string, packageName: string) =>
      ipcRenderer.invoke("adb:disablePackages", deviceId, packageName),
    enablePackage: (deviceId: string, packageName: string) =>
      ipcRenderer.invoke("adb:enablePackages", deviceId, packageName),
    uninstallPackage: (
      deviceId: string,
      packageName: string,
      keepData?: boolean
    ) =>
      ipcRenderer.invoke(
        "adb:unistallPackage",
        deviceId,
        packageName,
        keepData
      ),
    reinstallPackage: (deviceId: string, packageName: string) =>
      ipcRenderer.invoke("adb:reinstallPackages", deviceId, packageName),
    getDeviceInfo: (deviceId: string) =>
      ipcRenderer.invoke("adb:getDeviceInfo", deviceId),
    isRooted: (deviceId: string) =>
      ipcRenderer.invoke("adb:isRooted", deviceId),
  },
  //   TODO, Backend API
  app: {
    getVersion: () => ipcRenderer.invoke("app:getVersion"),
    getPlatform: () => process.platform
  }
});
