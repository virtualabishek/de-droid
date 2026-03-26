
import { contextBridge, ipcRenderer } from "electron";
import type { DownloadProgress, ElectronAPI } from "../shared/electron-api";

const electronAPI: ElectronAPI = {
  // ============ ADB API ============
  adb: {
    getDevices: () => ipcRenderer.invoke("adb:get-devices"),
    getPackages: (deviceId: string, userId?: number, systemOnly?: boolean) =>
      ipcRenderer.invoke("adb:get-packages", deviceId, userId, systemOnly),
    getEnrichedPackages: (
      deviceId: string,
      userId?: number,
      systemOnly?: boolean,
    ) =>
      ipcRenderer.invoke(
        "adb:get-enriched-packages",
        deviceId,
        userId,
        systemOnly,
      ),
    uninstallPackage: (
      deviceId: string,
      packageName: string,
      userId?: number,
      androidSdk?: number,
    ) =>
      ipcRenderer.invoke(
        "adb:uninstall",
        deviceId,
        packageName,
        userId,
        androidSdk,
      ),
    restorePackage: (
      deviceId: string,
      packageName: string,
      userId?: number,
      androidSdk?: number,
    ) =>
      ipcRenderer.invoke(
        "adb:restore",
        deviceId,
        packageName,
        userId,
        androidSdk,
      ),
    disablePackage: (deviceId: string, packageName: string, userId?: number) =>
      ipcRenderer.invoke("adb:disable", deviceId, packageName, userId),
    enablePackage: (deviceId: string, packageName: string, userId?: number) =>
      ipcRenderer.invoke("adb:enable", deviceId, packageName, userId),
    bulkUninstall: (
      deviceId: string,
      packages: string[],
      userId?: number,
      androidSdk?: number,
    ) =>
      ipcRenderer.invoke(
        "adb:bulk-uninstall",
        deviceId,
        packages,
        userId,
        androidSdk,
      ),
    health: () => ipcRenderer.invoke("adb:health"),
    runConnectionDiagnostics: () =>
      ipcRenderer.invoke("adb:run-connection-diagnostics"),
    checkSafety: (packageNames: string[]) =>
      ipcRenderer.invoke("adb:check-safety", packageNames),
    wireless: {
      enableTcpip: (deviceId: string, port?: number) =>
        ipcRenderer.invoke("adb:wireless:enable-tcpip", deviceId, port),
      connect: (ipAddress: string, port?: number) =>
        ipcRenderer.invoke("adb:wireless:connect", ipAddress, port),
      disconnect: (ipAddress: string, port?: number) =>
        ipcRenderer.invoke("adb:wireless:disconnect", ipAddress, port),
      pair: (ipAddress: string, port: number, pairingCode: string) =>
        ipcRenderer.invoke("adb:wireless:pair", ipAddress, port, pairingCode),
    },
    getPackagePermissions: (
      deviceId: string,
      packageName: string,
      userId?: number,
    ) =>
      ipcRenderer.invoke(
        "adb:get-package-permissions",
        deviceId,
        packageName,
        userId,
      ),
    togglePermission: (
      deviceId: string,
      packageName: string,
      permission: string,
      action: "grant" | "revoke",
      userId?: number,
    ) =>
      ipcRenderer.invoke(
        "adb:toggle-permission",
        deviceId,
        packageName,
        permission,
        action,
        userId,
      ),
    getPackageDetails: (deviceId: string, packageName: string) =>
      ipcRenderer.invoke("adb:get-package-details", deviceId, packageName),
    getDeviceHealthSnapshot: (deviceId: string) =>
      ipcRenderer.invoke("adb:get-device-health-snapshot", deviceId),
  },

  // ============ DEBLOAT DATA API (LOCAL JSON for now later we would have the real API) ============
  debloat: {
    getPackages: () => ipcRenderer.invoke("debloat:get-packages"),
    getPackageInfo: (packageId: string) =>
      ipcRenderer.invoke("debloat:get-package-info", packageId),
    getAlternatives: () => ipcRenderer.invoke("debloat:get-alternatives"),
    getAlternativeById: (altId: string) =>
      ipcRenderer.invoke("debloat:get-alternative", altId),
    getAlternativesForPackage: (packageId: string) =>
      ipcRenderer.invoke("debloat:get-alternatives-for-package", packageId),
    getCategories: () => ipcRenderer.invoke("debloat:get-categories"),
    getPackagesByCategory: (category: string) =>
      ipcRenderer.invoke("debloat:get-packages-by-category", category),
    getRemovalTypes: () => ipcRenderer.invoke("debloat:get-removal-types"),
    getLists: () => ipcRenderer.invoke("debloat:get-lists"),
  },

  // ============ ALTERNATIVES API (LOCAL JSON) ============
  alternatives: {
    getAll: () => ipcRenderer.invoke("alternatives:get-all"),
    search: (query: string) => ipcRenderer.invoke("alternatives:search", query),
  },

  // ============ F-DROID API (DOWNLOAD & INSTALL) ============
  fdroid: {
    install: (deviceId: string, packageId: string) =>
      ipcRenderer.invoke("fdroid:install", deviceId, packageId),
    getDownloadInfo: (alternativeId: string) =>
      ipcRenderer.invoke("fdroid:get-download-info", alternativeId),
    openExternal: (url: string) =>
      ipcRenderer.invoke("fdroid:open-external", url),
    onProgress: (callback: (progress: DownloadProgress) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: DownloadProgress) => {
        callback(progress);
      };
      ipcRenderer.on("fdroid:progress", handler);
      return () => {
        ipcRenderer.removeListener("fdroid:progress", handler);
      };
    },
  },

  // ============ BACKUP API (LOCAL SQLITE + ADB) ============
  backup: {
    create: (
      deviceId: string,
      deviceModel: string,
      deviceBrand: string,
      androidSdk: number,
      userId?: number,
      systemOnly?: boolean,
    ) =>
      ipcRenderer.invoke(
        "backup:create",
        deviceId,
        deviceModel,
        deviceBrand,
        androidSdk,
        userId,
        systemOnly,
      ),
    compare: (
      deviceId: string,
      backupId: string,
      userId?: number,
      systemOnly?: boolean,
    ) =>
      ipcRenderer.invoke(
        "backup:compare",
        deviceId,
        backupId,
        userId,
        systemOnly,
      ),
  },

  // ============ HISTORY API (LOCAL SQLITE) ============
  history: {
    getAll: (limit?: number) => ipcRenderer.invoke("history:get-all", limit),
    getStats: () => ipcRenderer.invoke("history:get-stats"),
    getDevice: (deviceId: string, limit?: number) =>
      ipcRenderer.invoke("history:get-device", deviceId, limit),
    getUndoable: (deviceId: string) =>
      ipcRenderer.invoke("history:get-undoable", deviceId),
    create: (action: {
      deviceId: string;
      deviceModel?: string;
      deviceBrand?: string;
      packageName: string;
      action: "UNINSTALL" | "DISABLE" | "RESTORE" | "ENABLE";
      androidUser: number;
      success: boolean;
      errorMessage?: string;
    }) => ipcRenderer.invoke("history:create", action),
    markUndone: (actionId: string) =>
      ipcRenderer.invoke("history:mark-undone", actionId),
  },

  // ============ TELEMETRY API (LOCAL SQLITE, OPT-IN) ============
  telemetry: {
    getSummary: (days?: number) =>
      ipcRenderer.invoke("telemetry:get-summary", days),
    getRetrainingSignals: (days?: number) =>
      ipcRenderer.invoke("telemetry:get-retraining-signals", days),
  },

  // ============ SAVED BACKUPS API (LOCAL SQLITE) ============
  savedBackups: {
    getAll: () => ipcRenderer.invoke("backups:get-all"),
    get: (id: string) => ipcRenderer.invoke("backups:get", id),
    getDevice: (deviceId: string) =>
      ipcRenderer.invoke("backups:get-device", deviceId),
    create: (backup: {
      deviceId: string;
      deviceModel?: string;
      deviceBrand?: string;
      name: string;
      packages: Array<{ name: string; state: string }>;
    }) => ipcRenderer.invoke("backups:create", backup),
    updateName: (id: string, name: string) =>
      ipcRenderer.invoke("backups:update-name", id, name),
    delete: (id: string) => ipcRenderer.invoke("backups:delete", id),
  },

  // ============ SETTINGS API (LOCAL SQLITE) ============
  settings: {
    getAll: () => ipcRenderer.invoke("settings:get-all"),
    get: (key: string) => ipcRenderer.invoke("settings:get", key),
    set: (key: string, value: string) =>
      ipcRenderer.invoke("settings:set", key, value),
    reset: () => ipcRenderer.invoke("settings:reset"),
  },

  // ============ AUTH API (LOCAL SQLITE) ============
  auth: {
    register: (email: string, password: string, name?: string) =>
      ipcRenderer.invoke("auth:register", email, password, name),
    login: (email: string, password: string) =>
      ipcRenderer.invoke("auth:login", email, password),
    getUser: (userId: string) => ipcRenderer.invoke("auth:get-user", userId),
    updateProfile: (userId: string, data: { name?: string }) =>
      ipcRenderer.invoke("auth:update-profile", userId, data),
    // User devices
    getDevices: (userId: string) =>
      ipcRenderer.invoke("auth:get-devices", userId),
    saveDevice: (
      userId: string,
      deviceId: string,
      deviceModel?: string,
      deviceBrand?: string,
      nickname?: string,
    ) =>
      ipcRenderer.invoke(
        "auth:save-device",
        userId,
        deviceId,
        deviceModel,
        deviceBrand,
        nickname,
      ),
    removeDevice: (userId: string, deviceId: string) =>
      ipcRenderer.invoke("auth:remove-device", userId, deviceId),
    updateDeviceNickname: (
      userId: string,
      deviceId: string,
      nickname: string,
    ) =>
      ipcRenderer.invoke(
        "auth:update-device-nickname",
        userId,
        deviceId,
        nickname,
      ),
    // User settings
    getSetting: (userId: string, key: string) =>
      ipcRenderer.invoke("auth:get-setting", userId, key),
    getAllSettings: (userId: string) =>
      ipcRenderer.invoke("auth:get-all-settings", userId),
    setSetting: (userId: string, key: string, value: string) =>
      ipcRenderer.invoke("auth:set-setting", userId, key, value),
  },

  // ============ APP API ============
  app: {
    health: () => ipcRenderer.invoke("app:health"),
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
