
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
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
  },

  // ============ DEBLOAT DATA API (LOCAL JSON) ============
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
    verifyEmail: (email: string, otp: string) =>
      ipcRenderer.invoke("auth:verify-email", email, otp),
    resendOtp: (email: string) => ipcRenderer.invoke("auth:resend-otp", email),
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
});

// ============ TYPESCRIPT DECLARATIONS ============

export interface Device {
  adb_id: string;
  model: string;
  brand: string;
  android_sdk: number;
  android_version?: string;
  users: Array<{ id: number; index: number }>;
}

export interface Permission {
  name: string;
  granted: boolean;
  category: string;
  description: string;
  isDangerous: boolean;
  type: "runtime" | "install";
}

export interface PermissionResult {
  packageName: string;
  permissions: Permission[];
  dangerousCount: number;
  grantedDangerousCount: number;
  totalCount: number;
}

export interface PackageInfo {
  name: string;
  state: "enabled" | "disabled" | "uninstalled";
}

export interface EnrichedPackage extends PackageInfo {
  description: string;
  removal: string;
  category: string;
  list: string;
  dependencies: string[];
  neededBy: string[];
  labels: string[];
  alternatives: string[];
  isKnown: boolean;
}

export interface PackageActionResult {
  package_name: string;
  action: string;
  success: boolean;
  message: string;
}

export interface BulkActionResult {
  results: PackageActionResult[];
  total: number;
  success_count: number;
  failure_count: number;
}

export interface ActionHistoryRecord {
  id: string;
  device_id: string;
  device_model: string | null;
  device_brand: string | null;
  package_name: string;
  action: "UNINSTALL" | "DISABLE" | "RESTORE" | "ENABLE";
  android_user: number;
  success: boolean;
  error_message: string | null;
  created_at: string;
  is_undone: boolean;
}

export interface HistoryStats {
  total_actions: number;
  successful_actions: number;
  failed_actions: number;
  uninstall_count: number;
  restore_count: number;
  disable_count: number;
  enable_count: number;
  devices_count: number;
  packages_count: number;
}

export interface SavedBackup {
  id: string;
  device_id: string;
  device_model: string | null;
  device_brand: string | null;
  name: string;
  packages: Array<{ name: string; state: string }>;
  total_packages: number;
  created_at: string;
}

export interface DebloatPackage {
  id: string;
  list: string;
  description: string;
  removal: "RECOMMENDED" | "ADVANCED" | "EXPERT" | "UNSAFE";
  category: "BLOATWARE" | "OPTIONAL" | "ESSENTIAL";
  dependencies: string[];
  neededBy: string[];
  labels: string[];
  alternatives: string[];
}

export interface AlternativeApp {
  id: string;
  name: string;
  description: string;
  packageId: string;
  source: string;
  sourceUrl: string;
  githubUrl: string;
  icon: string;
}

export interface Category {
  id: string;
  name: string;
  description: string;
  color: string;
}

export interface RemovalType {
  id: string;
  name: string;
  description: string;
  color: string;
}

export interface DebloatList {
  id: string;
  name: string;
  description: string;
}

export interface FdroidInstallResult {
  success: boolean;
  packageId: string;
  install_message: string;
}

export interface FdroidDownloadInfo {
  fdroidUrl: string | null;
  githubUrl: string | null;
  packageId: string | null;
}

export interface DownloadProgress {
  packageId: string;
  stage: "fetching" | "downloading" | "installing" | "success" | "error";
  progress: number; // 0-100
  downloadedMB?: number;
  totalMB?: number;
  speed?: string; // e.g., "1.5 MB/s"
  message: string;
}

export interface HealthResponse {
  status: string;
  adb_available: boolean;
  mode: string;
}

export interface WirelessResponse {
  success: boolean;
  message: string;
  port?: number;
  ip_address?: string;
}

export interface ElectronAPI {
  adb: {
    getDevices: () => Promise<Device[]>;
    getPackages: (
      deviceId: string,
      userId?: number,
      systemOnly?: boolean,
    ) => Promise<{ packages: PackageInfo[]; total: number }>;
    getEnrichedPackages: (
      deviceId: string,
      userId?: number,
      systemOnly?: boolean,
    ) => Promise<{ packages: EnrichedPackage[]; total: number }>;
    uninstallPackage: (
      deviceId: string,
      packageName: string,
      userId?: number,
      androidSdk?: number,
    ) => Promise<PackageActionResult>;
    restorePackage: (
      deviceId: string,
      packageName: string,
      userId?: number,
      androidSdk?: number,
    ) => Promise<PackageActionResult>;
    disablePackage: (
      deviceId: string,
      packageName: string,
      userId?: number,
    ) => Promise<PackageActionResult>;
    enablePackage: (
      deviceId: string,
      packageName: string,
      userId?: number,
    ) => Promise<PackageActionResult>;
    bulkUninstall: (
      deviceId: string,
      packages: string[],
      userId?: number,
      androidSdk?: number,
    ) => Promise<BulkActionResult>;
    health: () => Promise<HealthResponse>;
    checkSafety: (
      packageNames: string[],
    ) => Promise<{ packages: any[]; total: number }>;
    wireless: {
      enableTcpip: (
        deviceId: string,
        port?: number,
      ) => Promise<WirelessResponse>;
      connect: (ipAddress: string, port?: number) => Promise<WirelessResponse>;
      disconnect: (
        ipAddress: string,
        port?: number,
      ) => Promise<WirelessResponse>;
      pair: (
        ipAddress: string,
        port: number,
        pairingCode: string,
      ) => Promise<WirelessResponse>;
    };
    getPackagePermissions: (
      deviceId: string,
      packageName: string,
    ) => Promise<PermissionResult>;
    togglePermission: (
      deviceId: string,
      packageName: string,
      permission: string,
      action: "grant" | "revoke",
      userId?: number,
    ) => Promise<{ success: boolean; error?: string }>;
    getPackageDetails: (deviceId: string, packageName: string) => Promise<any>;
  };
  debloat: {
    getPackages: () => Promise<DebloatPackage[]>;
    getPackageInfo: (packageId: string) => Promise<DebloatPackage | null>;
    getAlternatives: () => Promise<AlternativeApp[]>;
    getAlternativeById: (altId: string) => Promise<AlternativeApp | null>;
    getAlternativesForPackage: (packageId: string) => Promise<AlternativeApp[]>;
    getCategories: () => Promise<Category[]>;
    getPackagesByCategory: (category: string) => Promise<DebloatPackage[]>;
    getRemovalTypes: () => Promise<RemovalType[]>;
    getLists: () => Promise<DebloatList[]>;
  };
  alternatives: {
    getAll: () => Promise<AlternativeApp[]>;
    search: (query: string) => Promise<AlternativeApp[]>;
  };
  fdroid: {
    install: (
      deviceId: string,
      packageId: string
    ) => Promise<FdroidInstallResult>;
    getDownloadInfo: (alternativeId: string) => Promise<FdroidDownloadInfo>;
    openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
    onProgress: (callback: (progress: DownloadProgress) => void) => () => void;
  };
  backup: {
    create: (
      deviceId: string,
      deviceModel: string,
      deviceBrand: string,
      androidSdk: number,
      userId?: number,
      systemOnly?: boolean,
    ) => Promise<SavedBackup>;
    compare: (
      deviceId: string,
      backupId: string,
      userId?: number,
      systemOnly?: boolean,
    ) => Promise<any>;
  };
  history: {
    getAll: (limit?: number) => Promise<ActionHistoryRecord[]>;
    getStats: () => Promise<HistoryStats>;
    getDevice: (
      deviceId: string,
      limit?: number,
    ) => Promise<ActionHistoryRecord[]>;
    getUndoable: (deviceId: string) => Promise<ActionHistoryRecord[]>;
    create: (action: {
      deviceId: string;
      deviceModel?: string;
      deviceBrand?: string;
      packageName: string;
      action: "UNINSTALL" | "DISABLE" | "RESTORE" | "ENABLE";
      androidUser: number;
      success: boolean;
      errorMessage?: string;
    }) => Promise<ActionHistoryRecord>;
    markUndone: (actionId: string) => Promise<boolean>;
  };
  savedBackups: {
    getAll: () => Promise<SavedBackup[]>;
    get: (id: string) => Promise<SavedBackup | null>;
    getDevice: (deviceId: string) => Promise<SavedBackup[]>;
    create: (backup: {
      deviceId: string;
      deviceModel?: string;
      deviceBrand?: string;
      name: string;
      packages: Array<{ name: string; state: string }>;
    }) => Promise<SavedBackup>;
    updateName: (id: string, name: string) => Promise<SavedBackup | null>;
    delete: (id: string) => Promise<boolean>;
  };
  settings: {
    getAll: () => Promise<Record<string, string>>;
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<{ success: boolean }>;
    reset: () => Promise<{ success: boolean }>;
  };
  auth: {
    register: (
      email: string,
      password: string,
      name?: string,
    ) => Promise<AuthResult>;
    verifyEmail: (email: string, otp: string) => Promise<AuthResult>;
    resendOtp: (email: string) => Promise<AuthResult>;
    login: (email: string, password: string) => Promise<AuthResult>;
    getUser: (userId: string) => Promise<PublicUser | null>;
    updateProfile: (
      userId: string,
      data: { name?: string },
    ) => Promise<AuthResult>;
    getDevices: (userId: string) => Promise<UserDevice[]>;
    saveDevice: (
      userId: string,
      deviceId: string,
      deviceModel?: string,
      deviceBrand?: string,
      nickname?: string,
    ) => Promise<UserDevice | null>;
    removeDevice: (userId: string, deviceId: string) => Promise<boolean>;
    updateDeviceNickname: (
      userId: string,
      deviceId: string,
      nickname: string,
    ) => Promise<boolean>;
    getSetting: (userId: string, key: string) => Promise<string | null>;
    getAllSettings: (userId: string) => Promise<Record<string, string>>;
    setSetting: (
      userId: string,
      key: string,
      value: string,
    ) => Promise<boolean>;
  };
  app: {
    health: () => Promise<{ status: string; version: string; mode: string }>;
  };
}

export interface AuthResult {
  success: boolean;
  message: string;
  user?: PublicUser;
  requiresVerification?: boolean;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  isVerified: boolean;
}

export interface UserDevice {
  id: string;
  user_id: string;
  device_id: string;
  device_model: string | null;
  device_brand: string | null;
  nickname: string | null;
  last_connected_at: string | null;
  created_at: string;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
