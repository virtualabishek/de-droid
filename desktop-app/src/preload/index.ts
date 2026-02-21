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
  auth: {
    register: (email: string, password: string, name?: string) =>
      ipcRenderer.invoke("auth:register", email, password, name),
    verifyEmail: (email: string, otp: string) =>
      ipcRenderer.invoke("auth:verifyEmail", email, otp),
    resendOtp: (email: string) => ipcRenderer.invoke("auth:resendOtp", email),
    login: (email: string, password: string) =>
      ipcRenderer.invoke("auth:login", email, password),
    getUser: (userId: string) => ipcRenderer.invoke("auth:getUser", userId),
    updateProfile: (userId: string, data: { name?: string }) =>
      ipcRenderer.invoke("auth:updateProfile", userId, data),
    getDevices: (userId: string) => ipcRenderer.invoke("auth:getDevices", userId),
    saveDevice: (
      userId: string,
      deviceId: string,
      deviceModel?: string,
      deviceBrand?: string,
      nickname?: string
    ) =>
      ipcRenderer.invoke(
        "auth:saveDevice",
        userId,
        deviceId,
        deviceModel,
        deviceBrand,
        nickname
      ),
    removeDevice: (userId: string, deviceId: string) =>
      ipcRenderer.invoke("auth:removeDevice", userId, deviceId),
    updateDeviceNickname: (userId: string, deviceId: string, nickname: string) =>
      ipcRenderer.invoke("auth:updateDeviceNickname", userId, deviceId, nickname),
    getSetting: (userId: string, key: string) =>
      ipcRenderer.invoke("auth:getSetting", userId, key),
    getAllSettings: (userId: string) =>
      ipcRenderer.invoke("auth:getAllSettings", userId),
    setSetting: (userId: string, key: string, value: string) =>
      ipcRenderer.invoke("auth:setSetting", userId, key, value),
  },
  //   TODO, Backend API
  app: {
    getVersion: () => ipcRenderer.invoke("app:getVersion"),
    getPlatform: () => process.platform
  }
});

console.log("[Preload] Preload script completed successfully");
