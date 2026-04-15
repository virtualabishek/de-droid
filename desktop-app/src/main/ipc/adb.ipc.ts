/**
 * ADB IPC Handlers - Fully Local Implementation
 * All operations use local ADB and SQLite storage
 */
import { ipcMain, shell } from "electron";
import * as LocalAdb from "../adb";
import * as Permissions from "../adb/permissions";
import * as historyService from "../services/historyService";
import * as backupService from "../services/backupService";
import * as packageDataService from "../services/packageDataService";
import * as fdroidService from "../services/fdroidService";
import * as telemetryService from "../services/telemetryService";
import * as modelFeedbackService from "../services/modelFeedbackService";

// Cache for device information to use in logging
const deviceInfoCache: Map<string, { model: string; brand: string }> =
  new Map();
let adbHandlersRegistered = false;

const DEFAULT_MODEL_API_URL = "http://127.0.0.1:8000";
const VALID_REMOVAL_TYPES = new Set([
  "RECOMMENDED",
  "ADVANCED",
  "EXPERT",
  "UNSAFE",
]);
type RemovalType = "RECOMMENDED" | "ADVANCED" | "EXPERT" | "UNSAFE";

const ADB_IPC_CHANNELS = [
  "adb:get-devices",
  "adb:get-packages",
  "adb:get-enriched-packages",
  "adb:check-safety",
  "adb:uninstall",
  "adb:restore",
  "adb:disable",
  "adb:enable",
  "adb:bulk-uninstall",
  "adb:health",
  "adb:run-connection-diagnostics",
  "adb:wireless:enable-tcpip",
  "adb:wireless:connect",
  "adb:wireless:disconnect",
  "adb:wireless:pair",
  "adb:get-package-permissions",
  "adb:toggle-permission",
  "adb:get-package-details",
  "adb:get-package-sizes",
  "adb:get-device-health-snapshot",
  "adb:get-background-restriction-status",
  "adb:optimize-background-restriction",
  "debloat:get-packages",
  "debloat:get-package-info",
  "debloat:get-alternatives",
  "debloat:get-alternative",
  "debloat:get-alternatives-for-package",
  "debloat:get-categories",
  "debloat:get-packages-by-category",
  "debloat:get-removal-types",
  "debloat:get-lists",
  "backup:create",
  "backup:compare",
  "alternatives:get-all",
  "alternatives:search",
  "fdroid:install",
  "fdroid:get-download-info",
  "fdroid:open-external",
] as const;

function clearAdbHandlers(): void {
  for (const channel of ADB_IPC_CHANNELS) {
    ipcMain.removeHandler(channel);
  }
}

function resolveModelApiBaseUrl(): string {
  const raw = process.env.DEDROID_MODEL_API_URL?.trim();
  if (!raw) return DEFAULT_MODEL_API_URL;
  return raw.replace(/\/+$/, "");
}

function normalizeRemovalType(value: unknown): RemovalType | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (!VALID_REMOVAL_TYPES.has(normalized)) return null;
  return normalized as RemovalType;
}

function isCoreNamespacePackage(packageName: string): boolean {
  return (
    packageName.startsWith("com.android.") ||
    packageName.startsWith("android.") ||
    packageName.startsWith("com.miui.") ||
    packageName.startsWith("com.xiaomi.") ||
    packageName.startsWith("com.samsung.") ||
    packageName.startsWith("com.sec.") ||
    packageName.startsWith("com.huawei.") ||
    packageName.startsWith("com.oppo.") ||
    packageName.startsWith("com.vivo.") ||
    packageName.startsWith("com.oneplus.")
  );
}

/**
 * Get device info from cache or return default values
 */
function getDeviceInfo(deviceId: string): { model: string; brand: string } {
  return (
    deviceInfoCache.get(deviceId) || { model: "Unknown", brand: "Unknown" }
  );
}

function recordTelemetryForAction(input: {
  deviceId: string;
  packageName: string;
  action: "UNINSTALL" | "DISABLE" | "RESTORE" | "ENABLE";
  success: boolean;
  errorMessage?: string;
  androidSdk?: number;
}) {
  const localInfo = packageDataService.getPackageInfo(input.packageName);
  const deviceInfo = getDeviceInfo(input.deviceId);

  telemetryService.recordActionOutcome({
    deviceId: input.deviceId,
    deviceBrand: deviceInfo.brand,
    deviceModel: deviceInfo.model,
    androidSdk: input.androidSdk,
    packageName: input.packageName,
    action: input.action,
    success: input.success,
    errorMessage: input.errorMessage,
    modelLabel: localInfo?.modelLabel,
    modelConfidence: localInfo?.modelConfidence,
    modelGateApplied:
      localInfo?.modelLabel === "UNSAFE" &&
      typeof localInfo?.modelConfidence === "number" &&
      localInfo.modelConfidence >= 0.8,
    removalType: localInfo?.removal,
    category: localInfo?.category,
  });

  modelFeedbackService.uploadActionFeedback({
    packageName: input.packageName,
    action: input.action,
    success: input.success,
    modelLabel: localInfo?.modelLabel,
    modelConfidence: localInfo?.modelConfidence,
    deviceBrand: deviceInfo.brand,
  });
}

function extractMatch(text: string, pattern: RegExp): string | undefined {
  const match = text.match(pattern);
  return match?.[1]?.trim();
}

function extractNumber(text: string, pattern: RegExp): number | undefined {
  const value = extractMatch(text, pattern);
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parsePackageDetailsFromDumpsys(dumpsysOutput: string) {
  const versionName = extractMatch(dumpsysOutput, /^\s*versionName=([^\n\r]+)/m);
  const versionCode = extractNumber(
    dumpsysOutput,
    /^\s*versionCode=(\d+)/m,
  );
  const minSdk = extractNumber(dumpsysOutput, /\bminSdk=(\d+)\b/m);
  const targetSdk = extractNumber(dumpsysOutput, /\btargetSdk=(\d+)\b/m);
  const firstInstallTime = extractMatch(
    dumpsysOutput,
    /^\s*firstInstallTime=([^\n\r]+)/m,
  );
  const lastUpdateTime = extractMatch(
    dumpsysOutput,
    /^\s*lastUpdateTime=([^\n\r]+)/m,
  );
  const dataDir = extractMatch(dumpsysOutput, /^\s*dataDir=([^\n\r]+)/m);
  const codePath = extractMatch(dumpsysOutput, /^\s*codePath=([^\n\r]+)/m);
  const resourcePath = extractMatch(
    dumpsysOutput,
    /^\s*resourcePath=([^\n\r]+)/m,
  );
  const apkPath = codePath || resourcePath;

  const installDate = firstInstallTime ? new Date(firstInstallTime) : null;
  const updateDate = lastUpdateTime ? new Date(lastUpdateTime) : null;
  const installTime =
    installDate && !Number.isNaN(installDate.getTime())
      ? installDate.toISOString()
      : firstInstallTime;
  const updateTime =
    updateDate && !Number.isNaN(updateDate.getTime())
      ? updateDate.toISOString()
      : lastUpdateTime;

  const isSystem =
    !!apkPath &&
    (apkPath.startsWith("/system/") ||
      apkPath.startsWith("/product/") ||
      apkPath.startsWith("/vendor/"));
  const isUpdatedSystemApp =
    !!apkPath && apkPath.includes("/data/app/") && /\bSYSTEM\b/.test(dumpsysOutput);

  const normalizedApkPath = (apkPath || "").toLowerCase();
  const isSystemPath =
    normalizedApkPath.startsWith("/system/") ||
    normalizedApkPath.startsWith("/product/") ||
    normalizedApkPath.startsWith("/vendor/") ||
    normalizedApkPath.startsWith("/system_ext/") ||
    normalizedApkPath.startsWith("/odm/");

  return {
    version_name: versionName,
    version_code: versionCode,
    target_sdk: targetSdk,
    min_sdk: minSdk,
    install_time: installTime,
    update_time: updateTime,
    data_dir: dataDir,
    apk_path: apkPath,
    is_system_path: isSystemPath,
    is_system: isSystem,
    is_updated_system_app: isUpdatedSystemApp,
  };
}

function isSpecialPermission(permissionName: string): boolean {
  const specialPrefixes = [
    "android.permission.SYSTEM_ALERT_WINDOW",
    "android.permission.WRITE_SETTINGS",
    "android.permission.PACKAGE_USAGE_STATS",
    "android.permission.REQUEST_INSTALL_PACKAGES",
    "android.permission.MANAGE_EXTERNAL_STORAGE",
    "android.permission.BIND_ACCESSIBILITY_SERVICE",
    "android.permission.BIND_NOTIFICATION_LISTENER_SERVICE",
    "android.permission.SCHEDULE_EXACT_ALARM",
  ];

  return specialPrefixes.some((name) => permissionName.startsWith(name));
}

function mapPermissionsForDetails(permissionResult: Permissions.PermissionResult) {
  const mapped = permissionResult.permissions.map((permission) => ({
    name: permission.name,
    granted: permission.granted,
    category: permission.category,
    description: permission.description,
    is_dangerous: permission.isDangerous,
    type: permission.type,
  }));

  const dangerousPermissions = mapped.filter((permission) => permission.is_dangerous);
  const specialPermissions = mapped.filter(
    (permission) => !permission.is_dangerous && isSpecialPermission(permission.name),
  );
  const normalPermissions = mapped.filter(
    (permission) =>
      !permission.is_dangerous && !isSpecialPermission(permission.name),
  );

  return {
    dangerous_permissions: dangerousPermissions,
    special_permissions: specialPermissions,
    normal_permissions: normalPermissions,
    total_count: mapped.length,
    dangerous_count: dangerousPermissions.length,
    granted_dangerous: dangerousPermissions.filter((permission) => permission.granted)
      .length,
  };
}

export function registerAdbHandlers() {
  if (adbHandlersRegistered) {
    return;
  }

  clearAdbHandlers();

  // ============ DEVICE HANDLERS (LOCAL ADB) ============

  // Get connected devices
  ipcMain.handle("adb:get-devices", async () => {
    try {
      console.log("[ADB LOCAL] Getting devices");
      const devices = await LocalAdb.getDevices();

      // Refresh cache from current device snapshot to avoid stale growth.
      deviceInfoCache.clear();

      // Cache device info for logging purposes
      devices.forEach((d) => {
        deviceInfoCache.set(d.id, { model: d.model, brand: d.brand });
      });

      // Transform to expected format
      return devices.map((d) => ({
        adb_id: d.id,
        model: d.model,
        brand: d.brand,
        android_sdk: d.androidSdk,
        android_version: d.androidVersion,
        users: [{ id: 0, index: 0 }], // Default user
      }));
    } catch (error) {
      console.error("[ADB LOCAL] Failed to get devices:", error);
      return [];
    }
  });

  // ============ PACKAGE HANDLERS (LOCAL ADB + LOCAL DATA) ============

  // Get packages for a device
  ipcMain.handle(
    "adb:get-packages",
    async (_, deviceId: string, userId = 0, systemOnly = true) => {
      try {
        console.log("[ADB LOCAL] Getting packages");
        const packageStates = await LocalAdb.getPackageStates(
          deviceId,
          userId,
          systemOnly,
        );

        console.log(`[ADB LOCAL] Found ${packageStates.length} packages`);

        return {
          packages: packageStates.map((p) => ({
            name: p.name,
            state: p.state,
          })),
          total: packageStates.length,
        };
      } catch (error) {
        console.error("[ADB LOCAL] Failed to get packages:", error);
        throw error;
      }
    },
  );

  // Get enriched packages (LOCAL ADB + LOCAL JSON DATA)
  ipcMain.handle(
    "adb:get-enriched-packages",
    async (_, deviceId: string, userId = 0, systemOnly = true) => {
      try {
        console.log("[ADB LOCAL] Getting enriched packages");

        // Step 1: Get packages locally via ADB
        const packageStates = await LocalAdb.getPackageStates(
          deviceId,
          userId,
          systemOnly,
        );
        console.log(`[ADB LOCAL] Got ${packageStates.length} packages`);

        const packagePathEntries = await LocalAdb.listPackagesWithPaths(
          deviceId,
          userId,
          false,
        );
        const packagePathMap = new Map(
          packagePathEntries.map((entry) => [entry.name, entry]),
        );

        // Step 2: Enrich with local debloat data
        const enriched = packageDataService.enrichPackages(packageStates);
        const bloatwarePackages = enriched.filter(
          (pkg) => pkg.category?.toUpperCase() === "BLOATWARE",
        );

        const sizeEntries = await Promise.all(
          bloatwarePackages.map(async (pkg) => {
            try {
              const pathEntry = packagePathMap.get(pkg.name);
              const sizeBytes = await LocalAdb.getPackageSizeBytes(deviceId, pkg.name, {
                codePathHint: pathEntry?.path,
                includeDataDir: false,
                resolveSplitApks: true,
              });
              return [pkg.name, sizeBytes] as const;
            } catch {
              return [pkg.name, null] as const;
            }
          }),
        );
        const sizeMap = new Map(sizeEntries);
        const enrichedWithSizes = enriched.map((pkg) => ({
          ...pkg,
          packageType: packagePathMap.get(pkg.name)?.isSystemPath === true ? "system" : "user",
          sizeBytes:
            pkg.category?.toUpperCase() === "BLOATWARE"
              ? sizeMap.get(pkg.name) ?? undefined
              : undefined,
        }));
        console.log(`[LOCAL DATA] Enriched ${enriched.length} packages`);

        return { packages: enrichedWithSizes, total: enrichedWithSizes.length };
      } catch (error) {
        console.error("[ADB LOCAL] Failed to get enriched packages:", error);
        throw error;
      }
    },
  );

  // Check package safety (LOCAL DATA)
  ipcMain.handle("adb:check-safety", async (_, packageNames: string[]) => {
    try {
      const dedupedPackageNames = [...new Set(packageNames.map((p) => p.trim()).filter(Boolean))];
      console.log(
        `[LOCAL DATA] Checking safety for ${dedupedPackageNames.length} packages`,
      );

      if (typeof fetch === "function" && dedupedPackageNames.length > 0) {
        try {
          const response = await fetch(`${resolveModelApiBaseUrl()}/api/check-packages`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ packages: dedupedPackageNames }),
          });

          if (response.ok) {
            const payload = (await response.json()) as {
              model_version?: string;
              packages?: Array<{
                package_id?: string;
                label?: string;
                confidence?: number;
                description?: string;
                top_factors?: string[];
                safety_gate?: string[];
                graph_risk_score?: number;
                graph_risk_reasons?: string[];
              }>;
            };

            if (Array.isArray(payload.packages) && payload.packages.length > 0) {
              const packages = payload.packages
                .map((entry) => {
                  const packageName =
                    typeof entry.package_id === "string" ? entry.package_id.trim() : "";
                  if (!packageName) return null;

                  const info = packageDataService.getPackageInfo(packageName);
                  const isCoreNamespace = isCoreNamespacePackage(packageName);

                  const modelLabel = normalizeRemovalType(entry.label) ?? info?.modelLabel ?? null;
                  const finalRemovalType: RemovalType =
                    modelLabel ?? info?.removal ?? (isCoreNamespace ? "UNSAFE" : "ADVANCED");
                  const modelConfidence =
                    typeof entry.confidence === "number"
                      ? Math.max(0, Math.min(1, entry.confidence))
                      : info?.modelConfidence ?? null;

                  const graphRiskScore =
                    typeof entry.graph_risk_score === "number"
                      ? Math.max(0, Math.min(1, entry.graph_risk_score))
                      : null;

                  const graphRiskReasons = Array.isArray(entry.graph_risk_reasons)
                    ? entry.graph_risk_reasons.filter(
                        (reason): reason is string => typeof reason === "string" && reason.length > 0,
                      )
                    : [];

                  const topFactors = Array.isArray(entry.top_factors)
                    ? entry.top_factors.filter(
                        (factor): factor is string => typeof factor === "string" && factor.length > 0,
                      )
                    : [];

                  const safetyGate = Array.isArray(entry.safety_gate)
                    ? entry.safety_gate.filter(
                        (gate): gate is string => typeof gate === "string" && gate.length > 0,
                      )
                    : [];

                  const canUninstall = finalRemovalType !== "UNSAFE" && !isCoreNamespace;
                  const fallbackDescription = isCoreNamespace
                    ? "Unknown core/OEM package - uninstall blocked for safety"
                    : "Unknown package - proceed with caution";

                  const safetyDescription =
                    (typeof entry.description === "string" && entry.description.trim()) ||
                    info?.description ||
                    graphRiskReasons[0] ||
                    fallbackDescription;

                  return {
                    package_name: packageName,
                    safety: packageDataService.getSafetyColor(finalRemovalType),
                    safety_description: safetyDescription,
                    can_uninstall: canUninstall,
                    description: safetyDescription,
                    category: info?.category ?? "UNKNOWN",
                    removal_type: finalRemovalType,
                    model_label: modelLabel,
                    model_confidence: modelConfidence,
                    model_version:
                      typeof payload.model_version === "string" ? payload.model_version : info?.modelVersion ?? null,
                    model_gate_applied: safetyGate.length > 0,
                    dependencies: info?.dependencies ?? [],
                    alternatives: info?.alternatives ?? [],
                    graph_risk_score: graphRiskScore,
                    graph_risk_reasons: graphRiskReasons.length ? graphRiskReasons : null,
                    model_top_factors: topFactors.length ? topFactors : null,
                  };
                })
                .filter((pkg): pkg is NonNullable<typeof pkg> => pkg !== null);

              if (packages.length > 0) {
                return { packages, total: packages.length };
              }
            }
          } else {
            console.warn(
              `[MODEL API] /api/check-packages returned ${response.status}; using local fallback`,
            );
          }
        } catch (error) {
          console.warn("[MODEL API] Safety check failed; using local fallback:", error);
        }
      }

      const packages = dedupedPackageNames.map((name) => {
        const info = packageDataService.getPackageInfo(name);
        const isCoreNamespace = isCoreNamespacePackage(name);

        if (info) {
          const modelUnsafeGate =
            info.modelLabel === "UNSAFE" &&
            typeof info.modelConfidence === "number" &&
            info.modelConfidence >= 0.8;

          const lowConfidenceGate =
            typeof info.modelConfidence === "number" && info.modelConfidence < 0.55;

          const finalRemovalType =
            info.removal === "UNSAFE" || modelUnsafeGate
              ? "UNSAFE"
              : lowConfidenceGate && info.removal === "RECOMMENDED"
                ? "ADVANCED"
              : info.removal;

          const canUninstall = finalRemovalType !== "UNSAFE" && !isCoreNamespace;

          return {
            package_name: name,
            safety: packageDataService.getSafetyColor(finalRemovalType),
            safety_description: info.description,
            can_uninstall: canUninstall,
            description: info.description,
            category: info.category,
            removal_type: finalRemovalType,
            model_label: info.modelLabel ?? null,
            model_confidence: info.modelConfidence ?? null,
            model_version: info.modelVersion ?? null,
            model_gate_applied: modelUnsafeGate,
            dependencies: info.dependencies,
            alternatives: info.alternatives,
            graph_risk_score: null,
            graph_risk_reasons: null,
            model_top_factors: info.modelTopFactors ?? null,
          };
        }

        // Unknown package
        return {
          package_name: name,
          safety: isCoreNamespace ? ("red" as const) : ("yellow" as const),
          safety_description: isCoreNamespace
            ? "Unknown core/OEM package - uninstall blocked for safety"
            : "Unknown package - proceed with caution",
          can_uninstall: !isCoreNamespace,
          description: "",
          category: "UNKNOWN",
          removal_type: isCoreNamespace ? "UNSAFE" : "ADVANCED",
          model_label: null,
          model_confidence: null,
          model_version: null,
          model_gate_applied: false,
          dependencies: [],
          alternatives: [],
          graph_risk_score: null,
          graph_risk_reasons: null,
          model_top_factors: null,
        };
      });

      return { packages, total: packages.length };
    } catch (error) {
      console.error("[LOCAL DATA] Failed to check safety:", error);
      throw error;
    }
  });

  // ============ PACKAGE ACTION HANDLERS (LOCAL ADB + LOCAL SQLITE) ============

  // Uninstall package
  ipcMain.handle(
    "adb:uninstall",
    async (
      _,
      deviceId: string,
      packageName: string,
      userId = 0,
      androidSdk = 30,
    ) => {
      try {
        console.log(`[ADB LOCAL] Uninstalling ${packageName}`);

        const result = await LocalAdb.uninstallPackage(
          deviceId,
          packageName,
          userId,
          androidSdk,
        );
        const success =
          result.success && !result.output.toLowerCase().includes("failure");

        console.log(
          `[ADB LOCAL] Uninstall result: ${success ? "success" : "failure"}`,
        );

        // Log to local SQLite
        const deviceInfo = getDeviceInfo(deviceId);
        historyService.createHistoryRecord({
          deviceId,
          deviceModel: deviceInfo.model,
          deviceBrand: deviceInfo.brand,
          packageName,
          action: "UNINSTALL",
          androidUser: userId,
          success,
          errorMessage: success ? undefined : result.error || result.output,
        });

        recordTelemetryForAction({
          deviceId,
          packageName,
          action: "UNINSTALL",
          success,
          errorMessage: success ? undefined : result.error || result.output,
          androidSdk,
        });

        return {
          package_name: packageName,
          action: "uninstall",
          success,
          message: result.output || result.error || "Unknown result",
        };
      } catch (error) {
        console.error("[ADB LOCAL] Failed to uninstall package:", error);
        throw error;
      }
    },
  );

  // Restore package
  ipcMain.handle(
    "adb:restore",
    async (
      _,
      deviceId: string,
      packageName: string,
      userId = 0,
      androidSdk = 30,
    ) => {
      try {
        console.log(`[ADB LOCAL] Restoring ${packageName}`);

        const result = await LocalAdb.restorePackage(
          deviceId,
          packageName,
          userId,
          androidSdk,
        );
        const success =
          result.success && !result.output.toLowerCase().includes("failure");

        console.log(
          `[ADB LOCAL] Restore result: ${success ? "success" : "failure"}`,
        );

        // Log to local SQLite
        const deviceInfo = getDeviceInfo(deviceId);
        historyService.createHistoryRecord({
          deviceId,
          deviceModel: deviceInfo.model,
          deviceBrand: deviceInfo.brand,
          packageName,
          action: "RESTORE",
          androidUser: userId,
          success,
          errorMessage: success ? undefined : result.error || result.output,
        });

        recordTelemetryForAction({
          deviceId,
          packageName,
          action: "RESTORE",
          success,
          errorMessage: success ? undefined : result.error || result.output,
          androidSdk,
        });

        return {
          package_name: packageName,
          action: "restore",
          success,
          message: result.output || result.error || "Unknown result",
        };
      } catch (error) {
        console.error("[ADB LOCAL] Failed to restore package:", error);
        throw error;
      }
    },
  );

  // Disable package
  ipcMain.handle(
    "adb:disable",
    async (_, deviceId: string, packageName: string, userId = 0) => {
      try {
        console.log(`[ADB LOCAL] Disabling ${packageName}`);

        const result = await LocalAdb.disablePackage(
          deviceId,
          packageName,
          userId,
        );
        const success =
          result.success && !result.output.toLowerCase().includes("failure");

        console.log(
          `[ADB LOCAL] Disable result: ${success ? "success" : "failure"}`,
        );

        // Log to local SQLite
        const deviceInfo = getDeviceInfo(deviceId);
        historyService.createHistoryRecord({
          deviceId,
          deviceModel: deviceInfo.model,
          deviceBrand: deviceInfo.brand,
          packageName,
          action: "DISABLE",
          androidUser: userId,
          success,
          errorMessage: success ? undefined : result.error || result.output,
        });

        recordTelemetryForAction({
          deviceId,
          packageName,
          action: "DISABLE",
          success,
          errorMessage: success ? undefined : result.error || result.output,
        });

        return {
          package_name: packageName,
          action: "disable",
          success,
          message: result.output || result.error || "Unknown result",
        };
      } catch (error) {
        console.error("[ADB LOCAL] Failed to disable package:", error);
        throw error;
      }
    },
  );

  // Enable package
  ipcMain.handle(
    "adb:enable",
    async (_, deviceId: string, packageName: string, userId = 0) => {
      try {
        console.log(`[ADB LOCAL] Enabling ${packageName}`);

        const result = await LocalAdb.enablePackage(
          deviceId,
          packageName,
          userId,
        );
        const success =
          result.success && !result.output.toLowerCase().includes("failure");

        console.log(
          `[ADB LOCAL] Enable result: ${success ? "success" : "failure"}`,
        );

        // Log to local SQLite
        const deviceInfo = getDeviceInfo(deviceId);
        historyService.createHistoryRecord({
          deviceId,
          deviceModel: deviceInfo.model,
          deviceBrand: deviceInfo.brand,
          packageName,
          action: "ENABLE",
          androidUser: userId,
          success,
          errorMessage: success ? undefined : result.error || result.output,
        });

        recordTelemetryForAction({
          deviceId,
          packageName,
          action: "ENABLE",
          success,
          errorMessage: success ? undefined : result.error || result.output,
        });

        return {
          package_name: packageName,
          action: "enable",
          success,
          message: result.output || result.error || "Unknown result",
        };
      } catch (error) {
        console.error("[ADB LOCAL] Failed to enable package:", error);
        throw error;
      }
    },
  );

  // Background optimization controls
  ipcMain.handle(
    "adb:get-background-restriction-status",
    async (_, deviceId: string, packageName: string, userId = 0) => {
      try {
        if (!deviceId || !packageName) {
          throw new Error("deviceId and packageName are required");
        }

        return await LocalAdb.getBackgroundRestrictionStatus(
          deviceId,
          packageName,
          userId,
        );
      } catch (error) {
        console.error(
          "[ADB LOCAL] Failed to get background restriction status:",
          error,
        );
        throw error;
      }
    },
  );

  ipcMain.handle(
    "adb:optimize-background-restriction",
    async (
      _,
      deviceId: string,
      packageName: string,
      mode: LocalAdb.BackgroundRestrictionMode = "restrict",
      userId = 0,
    ) => {
      try {
        if (!deviceId || !packageName) {
          throw new Error("deviceId and packageName are required");
        }

        const normalizedMode: LocalAdb.BackgroundRestrictionMode =
          mode === "relax" ? "relax" : "restrict";
        console.log(
          `[ADB LOCAL] ${normalizedMode} background for ${packageName}`,
        );

        return await LocalAdb.optimizeBackgroundRestriction(
          deviceId,
          packageName,
          normalizedMode,
          userId,
        );
      } catch (error) {
        console.error(
          "[ADB LOCAL] Failed to optimize background restriction:",
          error,
        );
        throw error;
      }
    },
  );

  // Bulk uninstall
  ipcMain.handle(
    "adb:bulk-uninstall",
    async (
      _,
      deviceId: string,
      packages: string[],
      userId = 0,
      androidSdk = 30,
    ) => {
      try {
        console.log(
          `[ADB LOCAL] Bulk uninstalling ${packages.length} packages`,
        );
        const deviceInfo = getDeviceInfo(deviceId);

        const results = [];
        for (const pkg of packages) {
          const result = await LocalAdb.uninstallPackage(
            deviceId,
            pkg,
            userId,
            androidSdk,
          );
          const success =
            result.success && !result.output.toLowerCase().includes("failure");

          results.push({
            package_name: pkg,
            action: "uninstall",
            success,
            message: result.output || result.error || "Unknown result",
          });

          // Log to local SQLite
          historyService.createHistoryRecord({
            deviceId,
            deviceModel: deviceInfo.model,
            deviceBrand: deviceInfo.brand,
            packageName: pkg,
            action: "UNINSTALL",
            androidUser: userId,
            success,
            errorMessage: success ? undefined : result.error || result.output,
          });

          recordTelemetryForAction({
            deviceId,
            packageName: pkg,
            action: "UNINSTALL",
            success,
            errorMessage: success ? undefined : result.error || result.output,
            androidSdk,
          });
        }

        const successCount = results.filter((r) => r.success).length;
        return {
          results,
          total: results.length,
          success_count: successCount,
          failure_count: results.length - successCount,
        };
      } catch (error) {
        console.error("[ADB LOCAL] Failed to bulk uninstall:", error);
        throw error;
      }
    },
  );

  // Health check
  ipcMain.handle("adb:health", async () => {
    try {
      const adbAvailable = await LocalAdb.checkAdbAvailable();
      return {
        status: adbAvailable ? "healthy" : "unavailable",
        adb_available: adbAvailable,
        mode: "local",
      };
    } catch (error) {
      return {
        status: "unavailable",
        adb_available: false,
        mode: "local",
      };
    }
  });

  ipcMain.handle("adb:run-connection-diagnostics", async () => {
    const timestamp = new Date().toISOString();

    try {
      const versionResult = await LocalAdb.executeAdbCommand("version", 10000);
      const adbAvailable = versionResult.success;
      const adbVersion = adbAvailable
        ? versionResult.output.split("\n")[0] || versionResult.output
        : null;

      const devicesResult = await LocalAdb.executeAdbCommand("devices -l", 15000);
      const devicesOutput = devicesResult.output || devicesResult.error || "";
      const lines = devicesOutput
        .split("\n")
        .slice(1)
        .map((line) => line.trim())
        .filter(Boolean);

      const connected = lines.filter((line) => /\sdevice\b/.test(line)).length;
      const unauthorized = lines.filter((line) => /\sunauthorized\b/.test(line)).length;
      const offline = lines.filter((line) => /\soffline\b/.test(line)).length;

      const checks = [
        {
          name: "ADB Installed",
          ok: adbAvailable,
          message: adbAvailable
            ? "ADB command is available"
            : "ADB command is not available in PATH",
        },
        {
          name: "ADB Device Scan",
          ok: devicesResult.success,
          message: devicesResult.success
            ? "ADB can list devices"
            : devicesResult.error || "Failed to list devices",
        },
        {
          name: "Authorized Device",
          ok: connected > 0,
          message:
            connected > 0
              ? `${connected} authorized device(s) connected`
              : "No authorized devices found",
        },
      ];

      const suggestions: string[] = [];

      if (!adbAvailable) {
        suggestions.push("Install Android Platform Tools and ensure `adb` is in PATH.");
      }

      if (unauthorized > 0) {
        suggestions.push(
          "Unlock phone and accept 'Allow USB debugging' prompt, then reconnect USB.",
        );
      }

      if (offline > 0) {
        suggestions.push(
          "Run `adb kill-server && adb start-server`, reconnect cable, and refresh devices.",
        );
      }

      if (connected === 0) {
        suggestions.push(
          "Enable Developer options + USB debugging, set USB mode to File Transfer, and try another data-capable cable.",
        );
        suggestions.push(
          "For wireless debugging, ensure phone and PC are on same Wi-Fi and re-run Pair then Connect.",
        );
      }

      const status: "healthy" | "warning" | "error" = !adbAvailable
        ? "error"
        : connected > 0
          ? "healthy"
          : "warning";

      return {
        timestamp,
        status,
        adb_available: adbAvailable,
        adb_version: adbVersion,
        connected_devices: connected,
        unauthorized_devices: unauthorized,
        offline_devices: offline,
        raw_devices_output: devicesOutput,
        checks,
        suggestions,
      };
    } catch (error) {
      return {
        timestamp,
        status: "error" as const,
        adb_available: false,
        adb_version: null,
        connected_devices: 0,
        unauthorized_devices: 0,
        offline_devices: 0,
        raw_devices_output: "",
        checks: [
          {
            name: "Diagnostics Runner",
            ok: false,
            message: error instanceof Error ? error.message : "Unknown diagnostics error",
          },
        ],
        suggestions: [
          "Restart the app and run diagnostics again.",
          "Verify Android Platform Tools are installed and `adb` is accessible.",
        ],
      };
    }
  });

  ipcMain.handle("adb:get-device-health-snapshot", async (_, deviceId: string) => {
    try {
      if (!deviceId) {
        throw new Error("Device ID is required");
      }

      return await LocalAdb.getDeviceHealthSnapshot(deviceId);
    } catch (error) {
      console.error("[ADB LOCAL] Failed to get device health snapshot:", error);
      return {
        collectedAt: new Date().toISOString(),
        battery: {
          status: "Unknown",
          charging: false,
        },
        memory: {},
        storage: {
          mountPoint: "/data",
        },
        performance: {
          topApps: [],
          thermalStatus: "Unknown",
          thermalWarning: false,
        },
        errors: [error instanceof Error ? error.message : "Failed to fetch health data"],
      };
    }
  });

  // ============ DEBLOAT DATA HANDLERS (LOCAL JSON) ============

  ipcMain.handle("debloat:get-packages", async () => {
    try {
      return packageDataService.getAllPackages();
    } catch (error) {
      console.error("Failed to get debloat packages:", error);
      throw error;
    }
  });

  ipcMain.handle("debloat:get-package-info", async (_, packageId: string) => {
    try {
      return packageDataService.getPackageInfo(packageId);
    } catch (error) {
      console.error("Failed to get package info:", error);
      throw error;
    }
  });

  ipcMain.handle("debloat:get-alternatives", async () => {
    try {
      return packageDataService.getAllAlternatives();
    } catch (error) {
      console.error("Failed to get alternatives:", error);
      throw error;
    }
  });

  ipcMain.handle("debloat:get-alternative", async (_, altId: string) => {
    try {
      return packageDataService.getAlternativeById(altId);
    } catch (error) {
      console.error("Failed to get alternative:", error);
      throw error;
    }
  });

  ipcMain.handle(
    "debloat:get-alternatives-for-package",
    async (_, packageId: string) => {
      try {
        return packageDataService.getAlternativesForPackage(packageId);
      } catch (error) {
        console.error("Failed to get alternatives for package:", error);
        throw error;
      }
    },
  );

  ipcMain.handle("debloat:get-categories", async () => {
    try {
      return packageDataService.getCategories();
    } catch (error) {
      console.error("Failed to get categories:", error);
      throw error;
    }
  });

  ipcMain.handle(
    "debloat:get-packages-by-category",
    async (_, category: string) => {
      try {
        return packageDataService.getPackagesByCategory(category);
      } catch (error) {
        console.error("Failed to get packages by category:", error);
        throw error;
      }
    },
  );

  ipcMain.handle("debloat:get-removal-types", async () => {
    try {
      return packageDataService.getRemovalTypes();
    } catch (error) {
      console.error("Failed to get removal types:", error);
      throw error;
    }
  });

  ipcMain.handle("debloat:get-lists", async () => {
    try {
      return packageDataService.getLists();
    } catch (error) {
      console.error("Failed to get lists:", error);
      throw error;
    }
  });

  // ============ BACKUP HANDLERS (LOCAL SQLITE) ============

  ipcMain.handle(
    "backup:create",
    async (
      _,
      deviceId: string,
      deviceModel: string,
      deviceBrand: string,
      _androidSdk: number,
      userId = 0,
      systemOnly = true,
    ) => {
      try {
        console.log("[BACKUP] Creating backup for device:", deviceId);

        // Get current packages from device
        const packageStates = await LocalAdb.getPackageStates(
          deviceId,
          userId,
          systemOnly,
        );

        // Store in SQLite
        const backup = backupService.createBackup({
          deviceId,
          deviceModel,
          deviceBrand,
          name: `Backup ${new Date().toISOString().split("T")[0]}`,
          packages: packageStates,
        });

        console.log(
          `[BACKUP] Created backup with ${packageStates.length} packages`,
        );

        return {
          ...backup,
          device_id: backup.device_id,
          device_model: backup.device_model,
          device_brand: backup.device_brand,
          created_at: backup.created_at,
          total_packages: backup.total_packages,
        };
      } catch (error) {
        console.error("Failed to create backup:", error);
        throw error;
      }
    },
  );

  ipcMain.handle(
    "backup:compare",
    async (
      _,
      deviceId: string,
      backupId: string,
      userId = 0,
      systemOnly = true,
    ) => {
      try {
        console.log("[BACKUP] Comparing backup with current state");

        // Get the saved backup
        const backup = backupService.getBackupById(backupId);
        if (!backup) {
          throw new Error("Backup not found");
        }

        // Get current packages from device
        const currentPackages = await LocalAdb.getPackageStates(
          deviceId,
          userId,
          systemOnly,
        );

        // Compare
        const comparison = backupService.compareBackupWithCurrent(
          backup.packages,
          currentPackages,
        );

        return {
          ...comparison,
          backup_info: {
            device_model: backup.device_model,
            created_at: backup.created_at,
            total_packages: backup.total_packages,
          },
        };
      } catch (error) {
        console.error("Failed to compare backup:", error);
        throw error;
      }
    },
  );

  // ============ WIRELESS ADB HANDLERS (LOCAL ADB) ============

  ipcMain.handle(
    "adb:wireless:enable-tcpip",
    async (_, deviceId: string, port = 5555) => {
      try {
        const result = await LocalAdb.executeAdbCommand(
          `-s ${deviceId} tcpip ${port}`,
        );
        return {
          success: result.success,
          message: result.output || result.error || "TCP/IP mode enabled",
          port,
        };
      } catch (error) {
        console.error("Failed to enable TCP/IP mode:", error);
        throw error;
      }
    },
  );

  ipcMain.handle(
    "adb:wireless:connect",
    async (_, ipAddress: string, port = 5555) => {
      try {
        const result = await LocalAdb.executeAdbCommand(
          `connect ${ipAddress}:${port}`,
        );
        const success = result.success && result.output.includes("connected");
        return {
          success,
          message: result.output || result.error || "Connection result unknown",
          ip_address: ipAddress,
          port,
        };
      } catch (error) {
        console.error("Failed to connect wirelessly:", error);
        throw error;
      }
    },
  );

  ipcMain.handle(
    "adb:wireless:disconnect",
    async (_, ipAddress: string, port = 5555) => {
      try {
        const result = await LocalAdb.executeAdbCommand(
          `disconnect ${ipAddress}:${port}`,
        );
        return {
          success: result.success,
          message: result.output || result.error || "Disconnected",
        };
      } catch (error) {
        console.error("Failed to disconnect:", error);
        throw error;
      }
    },
  );

  ipcMain.handle(
    "adb:wireless:pair",
    async (_, ipAddress: string, port: number, pairingCode: string) => {
      try {
        const result = await LocalAdb.executeAdbCommand(
          `pair ${ipAddress}:${port} ${pairingCode}`,
        );
        const success =
          result.success && result.output.includes("Successfully paired");
        return {
          success,
          message: result.output || result.error || "Pairing result unknown",
        };
      } catch (error) {
        console.error("Failed to pair:", error);
        throw error;
      }
    },
  );

  // ============ PACKAGE DETAILS HANDLERS (LOCAL ADB) ============

  ipcMain.handle(
    "adb:get-package-permissions",
    async (_, deviceId: string, packageName: string, userId = 0) => {
      try {
        console.log(`[ADB LOCAL] Getting permissions for ${packageName}`);
        const result = await Permissions.getPackagePermissions(
          deviceId,
          packageName,
          userId,
        );
        return result;
      } catch (error) {
        console.error("Failed to get package permissions:", error);
        throw error;
      }
    },
  );

  // Grant or revoke a permission
  ipcMain.handle(
    "adb:toggle-permission",
    async (
      _,
      deviceId: string,
      packageName: string,
      permission: string,
      action: "grant" | "revoke",
      userId = 0,
    ) => {
      try {
        console.log(`[ADB LOCAL] ${action} ${permission} for ${packageName}`);

        if (action === "grant") {
          return await Permissions.grantPermission(
            deviceId,
            packageName,
            permission,
            userId,
          );
        } else {
          return await Permissions.revokePermission(
            deviceId,
            packageName,
            permission,
            userId,
          );
        }
      } catch (error) {
        console.error(`Failed to ${action} permission:`, error);
        throw error;
      }
    },
  );

  ipcMain.handle(
    "adb:get-package-details",
    async (_, deviceId: string, packageName: string, userId = 0) => {
      try {
        const result = await LocalAdb.executeAdbCommand(
          `-s ${deviceId} shell dumpsys package ${packageName}`,
        );

        if (!result.success) {
          throw new Error(result.error || "Failed to load package details");
        }

        const permissionResult = await Permissions.getPackagePermissions(
          deviceId,
          packageName,
          userId,
        );

        // Get additional info from local data
        const localInfo = packageDataService.getPackageInfo(packageName);

        const metadata = parsePackageDetailsFromDumpsys(result.output);
        const permissions = mapPermissionsForDetails(permissionResult);
        const shouldFetchSize = localInfo?.category?.toUpperCase() === "BLOATWARE";
        const sizeBytes = shouldFetchSize
          ? await LocalAdb.getPackageSizeBytes(deviceId, packageName, {
              codePathHint: metadata.apk_path,
              includeDataDir: false,
              resolveSplitApks: true,
            })
          : null;

        return {
          package: packageName,
          ...metadata,
          size_bytes: sizeBytes,
          permissions,
          debloat_info: localInfo,
          dumpsys_output: result.output,
        };
      } catch (error) {
        console.error("Failed to get package details:", error);
        throw error;
      }
    },
  );

  ipcMain.handle(
    "adb:get-package-sizes",
    async (_, deviceId: string, packageNames: string[]) => {
      try {
        const uniquePackages = [...new Set(packageNames.filter(Boolean))];
        const sizes: Record<string, number> = {};
        const unavailable: string[] = [];

        for (const packageName of uniquePackages) {
          try {
            const sizeBytes = await LocalAdb.getPackageSizeBytes(deviceId, packageName, {
              includeDataDir: false,
              resolveSplitApks: true,
            });
            if (typeof sizeBytes === "number") {
              sizes[packageName] = sizeBytes;
            } else {
              unavailable.push(packageName);
            }
          } catch {
            unavailable.push(packageName);
          }
        }

        return {
          sizes,
          unavailable,
          total: uniquePackages.length,
        };
      } catch (error) {
        console.error("[ADB LOCAL] Failed to get package sizes:", error);
        throw error;
      }
    },
  );

  // ============ ALTERNATIVES HANDLERS (LOCAL JSON) ============

  ipcMain.handle("alternatives:get-all", async () => {
    try {
      return packageDataService.getAllAlternatives();
    } catch (error) {
      console.error("Failed to get alternatives:", error);
      throw error;
    }
  });

  ipcMain.handle("alternatives:search", async (_, query: string) => {
    try {
      const alternatives = packageDataService.getAllAlternatives();
      const lowerQuery = query.toLowerCase();

      return alternatives.filter(
        (alt) =>
          alt.name.toLowerCase().includes(lowerQuery) ||
          alt.description.toLowerCase().includes(lowerQuery) ||
          alt.packageId.toLowerCase().includes(lowerQuery),
      );
    } catch (error) {
      console.error("Failed to search alternatives:", error);
      throw error;
    }
  });

  // ============ F-DROID HANDLERS ============

  // Install app from F-Droid
  ipcMain.handle(
    "fdroid:install",
    async (_, deviceId: string, packageId: string) => {
      try {
        console.log(`[F-Droid] Installing ${packageId} on device ${deviceId}`);
        const result = await fdroidService.installFromFdroid(deviceId, packageId);
        return result;
      } catch (error) {
        console.error("[F-Droid] Failed to install:", error);
        return {
          success: false,
          packageId,
          install_message:
            error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  );

  // Get download info for an alternative app
  ipcMain.handle("fdroid:get-download-info", async (_, alternativeId: string) => {
    try {
      return fdroidService.getAppDownloadInfo(alternativeId);
    } catch (error) {
      console.error("[F-Droid] Failed to get download info:", error);
      throw error;
    }
  });

  // Open URL in external browser
  ipcMain.handle("fdroid:open-external", async (_, url: string) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      console.error("[F-Droid] Failed to open URL:", error);
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  });

  adbHandlersRegistered = true;
}

export class AdbIpcRegistrar {
  private static _instance: AdbIpcRegistrar | null = null;
  private _registered = false;

  private constructor() {}

  static getInstance(): AdbIpcRegistrar {
    if (!AdbIpcRegistrar._instance) {
      AdbIpcRegistrar._instance = new AdbIpcRegistrar();
    }
    return AdbIpcRegistrar._instance;
  }

  registerHandlers(): void {
    if (this._registered) {
      return;
    }

    registerAdbHandlers();
    this._registered = true;
  }

  unregisterHandlers(): void {
    clearAdbHandlers();
    adbHandlersRegistered = false;
    this._registered = false;
  }
}
