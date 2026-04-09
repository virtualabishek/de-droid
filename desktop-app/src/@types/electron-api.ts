export interface AuthResult {
  success: boolean;
  message: string;
  user?: PublicUser;
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

export interface Device {
  adb_id: string;
  model: string;
  brand: string;
  android_sdk: number;
  android_version?: string;
  users: Array<{ id: number; index: number }>;
}

export interface PackageInfo {
  name: string;
  state: "enabled" | "disabled" | "uninstalled";
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

export interface EnrichedPackage extends PackageInfo {
  description: string;
  removal: string;
  category: string;
  packageType?: "system" | "user";
  list: string;
  sizeBytes?: number;
  dependencies: string[];
  neededBy: string[];
  labels: string[];
  alternatives: string[];
  modelLabel?: string;
  modelConfidence?: number;
  modelVersion?: string;
  modelTopFactors?: string[];
  oemOverrideApplied?: boolean;
  oemOverrideReason?: string;
  isKnown: boolean;
}

export interface PackageSafetyInfo {
  package_name: string;
  safety: "green" | "yellow" | "orange" | "red";
  safety_description: string;
  can_uninstall: boolean;
  description: string;
  category: string;
  removal_type: string;
  model_label: string | null;
  model_confidence: number | null;
  model_version: string | null;
  model_gate_applied: boolean;
  dependencies: string[];
  alternatives: string[];
  graph_risk_score?: number | null;
  graph_risk_reasons?: string[] | null;
  model_top_factors?: string[] | null;
}

export interface PackageActionResult {
  package_name: string;
  action: string;
  success: boolean;
  message: string;
}

export interface PackageSizesResult {
  sizes: Record<string, number>;
  unavailable: string[];
  total: number;
}

export type BackgroundRestrictionMode = "restrict" | "relax";

export interface BackgroundRestrictionStatus {
  packageName: string;
  userId: number;
  packageUid: number | null;
  standbyBucket: string | null;
  runInBackgroundMode: string | null;
  runAnyInBackgroundMode: string | null;
  wakeLockMode: string | null;
  networkRestricted: boolean | null;
  controlsActive: string[];
  warnings: string[];
}

export interface BackgroundOptimizationResult {
  success: boolean;
  packageName: string;
  mode: BackgroundRestrictionMode;
  userId: number;
  message: string;
  appliedSteps: string[];
  failedSteps: string[];
  warnings: string[];
  status: BackgroundRestrictionStatus;
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
  modelLabel?: "RECOMMENDED" | "ADVANCED" | "EXPERT" | "UNSAFE";
  modelConfidence?: number;
  modelVersion?: string;
  modelTopFactors?: string[];
  oemOverrideApplied?: boolean;
  oemOverrideReason?: string;
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
  progress: number;
  downloadedMB?: number;
  totalMB?: number;
  speed?: string;
  message: string;
}

export interface HealthResponse {
  status: string;
  adb_available: boolean;
  mode: string;
}

export interface ConnectionDiagnostics {
  timestamp: string;
  status: "healthy" | "warning" | "error";
  adb_available: boolean;
  adb_version: string | null;
  connected_devices: number;
  unauthorized_devices: number;
  offline_devices: number;
  raw_devices_output: string;
  checks: Array<{
    name: string;
    ok: boolean;
    message: string;
  }>;
  suggestions: string[];
}

export interface WirelessResponse {
  success: boolean;
  message: string;
  port?: number;
  ip_address?: string;
}

export interface DeviceHealthSnapshot {
  collectedAt: string;
  battery: {
    levelPercent?: number;
    status: string;
    charging: boolean;
    temperatureC?: number;
    voltageMv?: number;
  };
  memory: {
    totalMb?: number;
    usedMb?: number;
    freeMb?: number;
  };
  storage: {
    mountPoint: string;
    totalGb?: number;
    usedGb?: number;
    freeGb?: number;
    usedPercent?: number;
  };
  performance: {
    cpuLoadPercent?: number;
    topApps: Array<{
      name: string;
      cpuPercent: number;
    }>;
    thermalStatus: string;
    thermalWarning: boolean;
  };
  errors: string[];
}

export interface TelemetrySummary {
  enabled: boolean;
  total_events: number;
  success_rate: number;
  rollback_rate: number | null;
  avg_model_confidence: number | null;
  by_action: Record<string, number>;
}

export interface RetrainingSignals {
  enabled: boolean;
  low_confidence_rate: number | null;
  unsafe_false_safe_proxy: number | null;
  sample_size: number;
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
    runConnectionDiagnostics: () => Promise<ConnectionDiagnostics>;
    checkSafety: (
      packageNames: string[],
    ) => Promise<{ packages: PackageSafetyInfo[]; total: number }>;
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
      userId?: number,
    ) => Promise<PermissionResult>;
    togglePermission: (
      deviceId: string,
      packageName: string,
      permission: string,
      action: "grant" | "revoke",
      userId?: number,
    ) => Promise<{ success: boolean; error?: string; message?: string }>;
    getPackageDetails: (deviceId: string, packageName: string) => Promise<any>;
    getPackageSizes: (
      deviceId: string,
      packageNames: string[],
    ) => Promise<PackageSizesResult>;
    getDeviceHealthSnapshot: (deviceId: string) => Promise<DeviceHealthSnapshot>;
    getBackgroundRestrictionStatus: (
      deviceId: string,
      packageName: string,
      userId?: number,
    ) => Promise<BackgroundRestrictionStatus>;
    optimizeBackgroundRestriction: (
      deviceId: string,
      packageName: string,
      mode?: BackgroundRestrictionMode,
      userId?: number,
    ) => Promise<BackgroundOptimizationResult>;
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
      packageId: string,
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
    clear: (deviceId?: string) => Promise<{ success: boolean; deleted: number }>;
    deleteSelected: (
      ids: string[],
    ) => Promise<{ success: boolean; deleted: number }>;
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
  telemetry: {
    getSummary: (days?: number) => Promise<TelemetrySummary>;
    getRetrainingSignals: (days?: number) => Promise<RetrainingSignals>;
  };
  savedBackups: {
    getAll: () => Promise<SavedBackup[]>;
    clear: (deviceId?: string) => Promise<{ success: boolean; deleted: number }>;
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
