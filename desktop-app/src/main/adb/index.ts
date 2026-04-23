/**
 * Local ADB Wrapper for Electron
 * Executes ADB commands locally using Node.js child_process
 */
import { exec } from "child_process";
import { promises as fs } from "fs";
import * as path from "path";
import { promisify } from "util";
import { getSetting } from "../services/settingsService";

const execAsync = promisify(exec);
const ADB_EXECUTABLE = process.platform === "win32" ? "adb.exe" : "adb";
const PLATFORM_TOOLS_SUBDIR =
  process.platform === "win32"
    ? "win"
    : process.platform === "darwin"
      ? "mac"
      : "linux";

// ── Interfaces / types ─────────────────────────────────────────────────────

export interface AdbDevice {
  id: string;
  model: string;
  brand: string;
  androidVersion: string;
  androidSdk: number;
  status: "connected" | "offline" | "unauthorized";
}

export interface AdbCommandResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface PackageInfo {
  name: string;
  state: "enabled" | "disabled" | "uninstalled";
}

export interface PackagePathInfo {
  name: string;
  path: string;
  isSystemPath: boolean;
}

export interface PackageSizeOptions {
  codePathHint?: string;
  includeDataDir?: boolean;
  resolveSplitApks?: boolean;
}

export interface TopProcess {
  name: string;
  cpuPercent: number;
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
    topApps: TopProcess[];
    thermalStatus: string;
    thermalWarning: boolean;
  };
  errors: string[];
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

// ── AdbClient ──────────────────────────────────────────────────────────────

export class AdbClient {
  private static _instance: AdbClient | null = null;
  private _resolvedExecutablePath: string | null = null;

  private constructor() {}

  static getInstance(): AdbClient {
    if (!AdbClient._instance) {
      AdbClient._instance = new AdbClient();
    }
    return AdbClient._instance;
  }

  static reset(): void {
    AdbClient._instance = null;
  }

  // ── Executable resolution ─────────────────────────────────────────────

  async resolveExecutable(): Promise<string> {
    if (this._resolvedExecutablePath) {
      return this._resolvedExecutablePath;
    }

    const configuredPath = getSetting("adb_path");
    if (configuredPath && (await this.pathExists(configuredPath))) {
      this._resolvedExecutablePath = configuredPath;
      return this._resolvedExecutablePath;
    }

    const envCandidates = [process.env.ANDROID_SDK_ROOT, process.env.ANDROID_HOME]
      .filter((value): value is string => Boolean(value))
      .map((sdkRoot) => path.join(sdkRoot, "platform-tools", ADB_EXECUTABLE));

    const bundledCandidates = [
      path.join(
        process.resourcesPath,
        "platform-tools",
        PLATFORM_TOOLS_SUBDIR,
        ADB_EXECUTABLE,
      ),
      path.join(
        process.cwd(),
        "resources",
        "platform-tools",
        PLATFORM_TOOLS_SUBDIR,
        ADB_EXECUTABLE,
      ),
      path.resolve(
        __dirname,
        "../../../resources/platform-tools",
        PLATFORM_TOOLS_SUBDIR,
        ADB_EXECUTABLE,
      ),
    ];

    const candidates = [...bundledCandidates, ...envCandidates];

    for (const candidate of candidates) {
      if (await this.pathExists(candidate)) {
        this._resolvedExecutablePath = candidate;
        return this._resolvedExecutablePath;
      }
    }

    this._resolvedExecutablePath = ADB_EXECUTABLE;
    return this._resolvedExecutablePath;
  }

  // ── Low-level execution ───────────────────────────────────────────────

  async execute(command: string, timeout = 30000): Promise<AdbCommandResult> {
    try {
      const adbExecutablePath = await this.resolveExecutable();
      const { stdout, stderr } = await execAsync(
        `${this.shellEscape(adbExecutablePath)} ${command}`,
        { timeout },
      );
      return {
        success: true,
        output: stdout.trim(),
        error: stderr.trim() || undefined,
      };
    } catch (error: any) {
      return {
        success: false,
        output: error.stdout?.trim() || "",
        error: error.stderr?.trim() || error.message || "Unknown error",
      };
    }
  }

  async runShell(
    deviceId: string,
    shellCommand: string,
    timeout = 30000,
  ): Promise<AdbCommandResult> {
    return this.execute(`-s ${deviceId} shell ${shellCommand}`, timeout);
  }

  // ── Device management ─────────────────────────────────────────────────

  async checkAvailable(): Promise<boolean> {
    const result = await this.execute("version");
    return result.success;
  }

  async getDevices(): Promise<AdbDevice[]> {
    const result = await this.execute("devices -l");

    if (!result.success) {
      console.error("Failed to get devices:", result.error);
      return [];
    }

    const devices: AdbDevice[] = [];
    const lines = result.output.split("\n").slice(1);

    for (const line of lines) {
      if (!line.trim()) continue;

      const parts = line.split(/\s+/);
      if (parts.length < 2) continue;

      const deviceId = parts[0];
      const status = parts[1] as "device" | "offline" | "unauthorized";

      if (status !== "device") {
        devices.push({
          id: deviceId,
          model: "Unknown",
          brand: "Unknown",
          androidVersion: "Unknown",
          androidSdk: 0,
          status: status === "offline" ? "offline" : "unauthorized",
        });
        continue;
      }

      // Get device properties
      const model = await this.getDeviceProperty(deviceId, "ro.product.model");
      const brand = await this.getDeviceProperty(deviceId, "ro.product.brand");
      const androidVersion = await this.getDeviceProperty(
        deviceId,
        "ro.build.version.release",
      );
      const androidSdk = await this.getDeviceProperty(
        deviceId,
        "ro.build.version.sdk",
      );

      devices.push({
        id: deviceId,
        model: model || "Unknown",
        brand: brand || "Unknown",
        androidVersion: androidVersion || "Unknown",
        androidSdk: parseInt(androidSdk || "0", 10),
        status: "connected",
      });
    }

    return devices;
  }

  async getDeviceProperty(deviceId: string, property: string): Promise<string> {
    const result = await this.execute(
      `-s ${deviceId} shell getprop ${property}`,
    );
    return result.success ? result.output.trim() : "";
  }

  // ── Package management ────────────────────────────────────────────────

  /**
   * List packages on a device.
   *
   * `options.includeSystemApps = false` (default) → `-s` flag → system packages only.
   * `options.includeSystemApps = true`            → no flag  → all packages.
   */
  async listPackages(
    deviceId: string,
    options: {
      user?: number;
      includeUninstalled?: boolean;
      includeSystemApps?: boolean;
    } = {},
  ): Promise<string[]> {
    const userId = options.user ?? 0;
    const flags = options.includeSystemApps ? "" : "-s";
    const uninstalledFlag = options.includeUninstalled ? "-u" : "";

    const result = await this.execute(
      `-s ${deviceId} shell pm list packages ${flags} ${uninstalledFlag} --user ${userId}`
        .replace(/\s+/g, " ")
        .trim(),
    );

    if (!result.success) {
      console.error("Failed to list packages:", result.error);
      return [];
    }

    return result.output
      .split("\n")
      .filter((line) => line.startsWith("package:"))
      .map((line) => line.replace("package:", "").trim());
  }

  /**
   * List installed packages with resolved code paths (`pm list packages -f`).
   */
  async listPackagesWithPaths(
    deviceId: string,
    options: {
      user?: number;
      includeUninstalled?: boolean;
    } = {},
  ): Promise<PackagePathInfo[]> {
    const userId = options.user ?? 0;
    const userFlag = Number.isFinite(userId) ? `--user ${userId}` : "";
    const uninstalledFlag = options.includeUninstalled ? "-u" : "";

    const command = `-s ${deviceId} shell pm list packages -f ${userFlag} ${uninstalledFlag}`
      .replace(/\s+/g, " ")
      .trim();

    const result = await this.execute(command);
    if (!result.success) {
      console.error("Failed to list package paths:", result.error);
      return [];
    }

    return this.parsePackagePathListOutput(result.output);
  }

  /**
   * Get package states (enabled, disabled, uninstalled) for a user.
   *
   * `options.systemOnly = true` (default) → `-s` flag → only system packages examined.
   * `options.systemOnly = false`           → no flag  → all packages examined.
   */
  async getPackageStates(
    deviceId: string,
    options: {
      user?: number;
      systemOnly?: boolean;
    } = {},
  ): Promise<PackageInfo[]> {
    const userId = options.user ?? 0;
    const systemOnly = options.systemOnly !== false; // default true
    const flags = systemOnly ? "-s" : "";

    // Get all packages (including uninstalled)
    const allResult = await this.execute(
      `-s ${deviceId} shell pm list packages ${flags} -u`,
    );

    if (!allResult.success) {
      console.error("Failed to get all packages:", allResult.error);
      return [];
    }

    const allPackages = allResult.output
      .split("\n")
      .filter((line) => line.startsWith("package:"))
      .map((line) => line.replace("package:", "").trim());

    // Get enabled packages
    const enabledResult = await this.execute(
      `-s ${deviceId} shell pm list packages ${flags} -e --user ${userId}`,
    );
    const enabledPackages = new Set(
      enabledResult.success
        ? enabledResult.output
            .split("\n")
            .filter((line) => line.startsWith("package:"))
            .map((line) => line.replace("package:", "").trim())
        : [],
    );

    // Get disabled packages
    const disabledResult = await this.execute(
      `-s ${deviceId} shell pm list packages ${flags} -d --user ${userId}`,
    );
    const disabledPackages = new Set(
      disabledResult.success
        ? disabledResult.output
            .split("\n")
            .filter((line) => line.startsWith("package:"))
            .map((line) => line.replace("package:", "").trim())
        : [],
    );

    // Get installed packages for user
    const installedResult = await this.execute(
      `-s ${deviceId} shell pm list packages ${flags} --user ${userId}`,
    );
    const installedPackages = new Set(
      installedResult.success
        ? installedResult.output
            .split("\n")
            .filter((line) => line.startsWith("package:"))
            .map((line) => line.replace("package:", "").trim())
        : [],
    );

    // Determine state for each package
    return allPackages.map((pkg) => {
      let state: "enabled" | "disabled" | "uninstalled";

      if (!installedPackages.has(pkg)) {
        state = "uninstalled";
      } else if (disabledPackages.has(pkg)) {
        state = "disabled";
      } else {
        state = "enabled";
      }

      return { name: pkg, state };
    });
  }

  async uninstallPackage(
    deviceId: string,
    packageName: string,
    options: {
      user?: number;
      androidSdk?: number;
      keepData?: boolean;
      viaDisable?: boolean;
    } = {},
  ): Promise<AdbCommandResult> {
    const userId = options.user ?? 0;
    const androidSdk = options.androidSdk ?? 30;
    let command: string;

    if (androidSdk >= 23) {
      command = `-s ${deviceId} shell pm uninstall --user ${userId} ${packageName}`;
    } else if (androidSdk >= 21) {
      command = `-s ${deviceId} shell pm hide --user ${userId} ${packageName}`;
    } else if (androidSdk >= 19) {
      command = `-s ${deviceId} shell pm block ${packageName}`;
    } else {
      command = `-s ${deviceId} shell pm uninstall ${packageName}`;
    }

    const result = await this.execute(command);

    // Clear app data after uninstall (if successful)
    if (result.success && androidSdk >= 23) {
      const clearResult = await this.execute(
        `-s ${deviceId} shell pm clear --user ${userId} ${packageName}`,
      );
      if (!clearResult.success) {
        console.warn(
          `Failed to clear data for ${packageName}:`,
          clearResult.error,
        );
      }
    }

    return result;
  }

  async restorePackage(
    deviceId: string,
    packageName: string,
    options: {
      user?: number;
      androidSdk?: number;
    } = {},
  ): Promise<AdbCommandResult> {
    const userId = options.user ?? 0;
    const androidSdk = options.androidSdk ?? 30;
    let command: string;

    if (androidSdk >= 23) {
      command = `-s ${deviceId} shell cmd package install-existing --user ${userId} ${packageName}`;
    } else if (androidSdk >= 21) {
      command = `-s ${deviceId} shell pm unhide --user ${userId} ${packageName}`;
    } else if (androidSdk >= 19) {
      command = `-s ${deviceId} shell pm unblock ${packageName}`;
    } else {
      return {
        success: false,
        output: "",
        error: "Cannot restore on this Android version without root",
      };
    }

    return await this.execute(command);
  }

  async disablePackage(
    deviceId: string,
    packageName: string,
    options: { user?: number } = {},
  ): Promise<AdbCommandResult> {
    const userId = options.user ?? 0;
    const command = `-s ${deviceId} shell pm disable-user --user ${userId} ${packageName}`;
    const result = await this.execute(command);

    // Force stop and clear if successful
    if (result.success) {
      await this.execute(`-s ${deviceId} shell am force-stop ${packageName}`);
      await this.execute(
        `-s ${deviceId} shell pm clear --user ${userId} ${packageName}`,
      );
    }

    return result;
  }

  async enablePackage(
    deviceId: string,
    packageName: string,
    options: { user?: number } = {},
  ): Promise<AdbCommandResult> {
    const userId = options.user ?? 0;
    const command = `-s ${deviceId} shell pm enable --user ${userId} ${packageName}`;
    return await this.execute(command);
  }

  async installApk(
    deviceId: string,
    apkPath: string,
  ): Promise<AdbCommandResult> {
    const command = `-s ${deviceId} install -r "${apkPath}"`;
    return await this.execute(command, 120000); // 2 minute timeout for large APKs
  }

  async isPackageInstalled(
    deviceId: string,
    packageName: string,
  ): Promise<boolean> {
    const result = await this.execute(
      `-s ${deviceId} shell pm list packages | grep ${packageName}`,
    );
    return result.success && result.output.includes(packageName);
  }

  // ── Package size ──────────────────────────────────────────────────────

  async getPackageSizeBytes(
    deviceId: string,
    packageName: string,
    options: PackageSizeOptions = {},
  ): Promise<number | null> {
    const includeDataDir = options.includeDataDir !== false;
    const resolveSplitApks = options.resolveSplitApks !== false;

    const pathCandidates = new Set<string>();

    if (resolveSplitApks) {
      const apkPaths = await this.getPackageApkPaths(deviceId, packageName);
      for (const apkPath of apkPaths) {
        pathCandidates.add(apkPath);
      }
    }

    if (options.codePathHint && options.codePathHint.startsWith("/")) {
      pathCandidates.add(options.codePathHint);
    }

    if (pathCandidates.size === 0) {
      const codePath = await this.getPackageCodePathFromPm(
        deviceId,
        packageName,
      );
      if (codePath) {
        pathCandidates.add(codePath);
      }
    }

    if (pathCandidates.size === 0) {
      const codePath = await this.getPackageCodePathFromPmList(
        deviceId,
        packageName,
      );
      if (codePath) {
        pathCandidates.add(codePath);
      }
    }

    let totalBytes = 0;
    let foundAny = false;

    for (const apkPath of pathCandidates) {
      const fileBytes = await this.getFileSizeBytes(deviceId, apkPath);
      if (typeof fileBytes === "number" && fileBytes >= 0) {
        totalBytes += fileBytes;
        foundAny = true;
        continue;
      }

      const sizeKb = await this.getPathSizeKilobytes(deviceId, apkPath);
      if (typeof sizeKb === "number" && sizeKb >= 0) {
        totalBytes += sizeKb * 1024;
        foundAny = true;
      }
    }

    if (includeDataDir) {
      const dumpsys = await this.runShell(
        deviceId,
        `dumpsys package ${packageName}`,
        15000,
      );

      if (dumpsys.success && dumpsys.output) {
        const details = this.extractPackagePathDetails(dumpsys.output);
        if (details.dataDir) {
          const dataSizeKb = await this.getPathSizeKilobytes(
            deviceId,
            details.dataDir,
          );
          if (typeof dataSizeKb === "number" && dataSizeKb >= 0) {
            totalBytes += dataSizeKb * 1024;
            foundAny = true;
          }
        }

        if (!foundAny && details.codePath) {
          const codeSizeKb = await this.getPathSizeKilobytes(
            deviceId,
            details.codePath,
          );
          if (typeof codeSizeKb === "number" && codeSizeKb >= 0) {
            totalBytes += codeSizeKb * 1024;
            foundAny = true;
          }
        }
      }
    }

    return foundAny ? totalBytes : null;
  }

  // ── Background restriction ────────────────────────────────────────────

  /**
   * Read current background restriction controls for one package.
   */
  async getBackgroundRestrictionStatus(
    deviceId: string,
    packageName: string,
    options: { user?: number } = {},
  ): Promise<BackgroundRestrictionStatus> {
    const userId = options.user ?? 0;
    const warnings: string[] = [];

    const [
      standbyBucket,
      runInBackgroundMode,
      runAnyInBackgroundMode,
      wakeLockMode,
      packageUid,
    ] = await Promise.all([
      this.getStandbyBucket(deviceId, packageName, userId),
      this.getAppOpMode(deviceId, packageName, userId, "RUN_IN_BACKGROUND"),
      this.getAppOpMode(
        deviceId,
        packageName,
        userId,
        "RUN_ANY_IN_BACKGROUND",
      ),
      this.getAppOpMode(deviceId, packageName, userId, "WAKE_LOCK"),
      this.resolvePackageUid(deviceId, packageName),
    ]);

    let networkRestricted: boolean | null = null;
    if (packageUid !== null) {
      networkRestricted = await this.isUidInRestrictBackgroundBlacklist(
        deviceId,
        packageUid,
      );
    } else {
      warnings.push(
        "Could not resolve package UID; network policy status unavailable.",
      );
    }

    const controlsActive = this.buildRestrictionControls({
      standbyBucket,
      runInBackgroundMode,
      runAnyInBackgroundMode,
      wakeLockMode,
      networkRestricted,
    });

    return {
      packageName,
      userId,
      packageUid,
      standbyBucket,
      runInBackgroundMode,
      runAnyInBackgroundMode,
      wakeLockMode,
      networkRestricted,
      controlsActive,
      warnings,
    };
  }

  /**
   * Apply or relax background restriction controls for one package.
   */
  async optimizeBackgroundRestriction(
    deviceId: string,
    packageName: string,
    options: {
      mode?: BackgroundRestrictionMode;
      user?: number;
    } = {},
  ): Promise<BackgroundOptimizationResult> {
    const mode = options.mode ?? "restrict";
    const userId = options.user ?? 0;
    const warnings: string[] = [];
    const appliedSteps: string[] = [];
    const failedSteps: string[] = [];

    const applyStep = async (
      label: string,
      work: () => Promise<AdbCommandResult>,
      optional = true,
    ) => {
      const result = await work();
      if (result.success) {
        appliedSteps.push(label);
        return;
      }

      const failureDetails = `${result.error || result.output || "unknown error"}`;
      if (this.isUnsupportedCommandError(failureDetails)) {
        warnings.push(
          `${label} is not supported on this device/Android build.`,
        );
        return;
      }

      if (this.isPermissionDeniedError(failureDetails)) {
        warnings.push(`${label} was denied by device policy.`);
        if (!optional) failedSteps.push(label);
        return;
      }

      if (optional) {
        warnings.push(`${label} could not be applied (${failureDetails}).`);
        return;
      }

      failedSteps.push(label);
    };

    await applyStep(
      "Force stop app",
      () => this.runShell(deviceId, `am force-stop ${packageName}`, 10000),
    );

    await applyStep(
      mode === "restrict"
        ? "Set standby bucket restricted"
        : "Set standby bucket active",
      () =>
        this.setStandbyBucket(
          deviceId,
          packageName,
          userId,
          mode === "restrict" ? "restricted" : "active",
        ),
    );

    await applyStep(
      `Set RUN_IN_BACKGROUND ${mode === "restrict" ? "ignore" : "allow"}`,
      () =>
        this.setAppOpMode(
          deviceId,
          packageName,
          userId,
          "RUN_IN_BACKGROUND",
          mode === "restrict" ? "ignore" : "allow",
        ),
    );

    await applyStep(
      `Set RUN_ANY_IN_BACKGROUND ${mode === "restrict" ? "ignore" : "allow"}`,
      () =>
        this.setAppOpMode(
          deviceId,
          packageName,
          userId,
          "RUN_ANY_IN_BACKGROUND",
          mode === "restrict" ? "ignore" : "allow",
        ),
    );

    await applyStep(
      `Set WAKE_LOCK ${mode === "restrict" ? "ignore" : "allow"}`,
      () =>
        this.setAppOpMode(
          deviceId,
          packageName,
          userId,
          "WAKE_LOCK",
          mode === "restrict" ? "ignore" : "allow",
        ),
    );

    const uid = await this.resolvePackageUid(deviceId, packageName);
    if (uid === null) {
      warnings.push(
        "Could not resolve package UID; skipped background network policy.",
      );
    } else {
      await applyStep(
        mode === "restrict"
          ? "Restrict background network data"
          : "Allow background network data",
        () =>
          this.updateRestrictBackgroundBlacklist(
            deviceId,
            uid,
            mode === "restrict",
          ),
      );
    }

    const status = await this.getBackgroundRestrictionStatus(
      deviceId,
      packageName,
      { user: userId },
    );
    const success = appliedSteps.length > 0 && failedSteps.length === 0;

    return {
      success,
      packageName,
      mode,
      userId,
      message: success
        ? `${mode === "restrict" ? "Background restricted" : "Background limits relaxed"} for ${packageName}`
        : `${mode === "restrict" ? "Partial restriction" : "Partial relaxation"} applied for ${packageName}`,
      appliedSteps,
      failedSteps,
      warnings: [...warnings, ...status.warnings],
      status,
    };
  }

  // ── Device health ─────────────────────────────────────────────────────

  async getDeviceHealthSnapshot(
    deviceId: string,
  ): Promise<DeviceHealthSnapshot> {
    const errors: string[] = [];

    const [
      batteryResult,
      memResult,
      procMemResult,
      dfResult,
      thermalResult,
    ] = await Promise.all([
      this.execute(`-s ${deviceId} shell dumpsys battery`, 10000),
      this.execute(`-s ${deviceId} shell dumpsys meminfo`, 15000),
      this.execute(`-s ${deviceId} shell cat /proc/meminfo`, 10000),
      this.execute(`-s ${deviceId} shell df /data`, 10000),
      this.execute(`-s ${deviceId} shell dumpsys thermalservice`, 10000),
    ]);

    let topResult = await this.execute(
      `-s ${deviceId} shell top -n 1 -b`,
      15000,
    );
    if (!topResult.success || !topResult.output) {
      topResult = await this.execute(`-s ${deviceId} shell top -n 1`, 15000);
    }
    if (!topResult.success || !topResult.output) {
      topResult = await this.execute(
        `-s ${deviceId} shell dumpsys cpuinfo`,
        15000,
      );
    }

    if (!batteryResult.success)
      errors.push(`battery: ${batteryResult.error || "unavailable"}`);
    if (!memResult.success && !procMemResult.success) {
      errors.push(
        `meminfo: ${memResult.error || procMemResult.error || "unavailable"}`,
      );
    }
    if (!dfResult.success)
      errors.push(`storage: ${dfResult.error || "unavailable"}`);
    if (!thermalResult.success)
      errors.push(`thermal: ${thermalResult.error || "unavailable"}`);
    if (!topResult.success)
      errors.push(`cpu/top: ${topResult.error || "unavailable"}`);

    const batteryText = batteryResult.output || "";
    const memText = memResult.output || "";
    const procMemText = procMemResult.output || "";
    const dfText = dfResult.output || "";
    const thermalText = thermalResult.output || "";
    const topText = topResult.output || "";

    const batteryStatusCode = this.parseInteger(
      batteryText,
      /^\s*status:\s*(\d+)/m,
    );
    const plugged =
      this.parseInteger(batteryText, /^\s*plugged:\s*(\d+)/m) || 0;
    const levelPercent = this.parseInteger(
      batteryText,
      /^\s*level:\s*(\d+)/m,
    );
    const tempTenths = this.parseInteger(
      batteryText,
      /^\s*temperature:\s*(-?\d+)/m,
    );
    const voltageMv = this.parseInteger(
      batteryText,
      /^\s*voltage:\s*(\d+)/m,
    );

    const totalRamKb =
      this.parseInteger(memText, /Total RAM:\s*([\d,]+)K/i) ||
      this.parseInteger(procMemText, /^MemTotal:\s*(\d+)\s*kB$/im) ||
      this.parseInteger(topText, /Mem:\s*([\d,]+)K\s+total/i);
    const usedRamKb =
      this.parseInteger(memText, /Used RAM:\s*([\d,]+)K/i) ||
      this.parseInteger(
        topText,
        /Mem:\s*[\d,]+K\s+total,\s*([\d,]+)K\s+used/i,
      );
    const freeRamKb =
      this.parseInteger(memText, /Free RAM:\s*([\d,]+)K/i) ||
      this.parseInteger(procMemText, /^MemAvailable:\s*(\d+)\s*kB$/im) ||
      this.parseInteger(
        topText,
        /Mem:\s*[\d,]+K\s+total,\s*[\d,]+K\s+used,\s*([\d,]+)K\s+free/i,
      );
    const derivedUsedKb =
      usedRamKb !== undefined
        ? usedRamKb
        : totalRamKb !== undefined && freeRamKb !== undefined
          ? Math.max(totalRamKb - freeRamKb, 0)
          : undefined;

    const dataLine =
      dfText
        .split("\n")
        .find(
          (line) =>
            /\s\/data\s*$/.test(line) || line.trim().endsWith(" /data"),
        ) ||
      dfText.split("\n")[1] ||
      "";
    const dfParts = dataLine.trim().split(/\s+/);

    let totalStorageKb: number | undefined;
    let usedStorageKb: number | undefined;
    let freeStorageKb: number | undefined;
    let usedPercent: number | undefined;

    if (dfParts.length >= 6) {
      totalStorageKb = Number.parseInt(dfParts[1], 10);
      usedStorageKb = Number.parseInt(dfParts[2], 10);
      freeStorageKb = Number.parseInt(dfParts[3], 10);
      usedPercent = Number.parseInt(dfParts[4].replace("%", ""), 10);
    }

    const thermalStatusCode = this.parseInteger(
      thermalText,
      /(?:Thermal Status|mStatus)\s*[:=]\s*(\d+)/i,
    );
    const thermalStatusText = this.parseThermalStatusCode(thermalStatusCode);

    const cpuLoadPercent =
      this.parseFloatValue(topText, /(\d+(?:\.\d+)?)%\s*cpu/i) ||
      this.parseFloatValue(topText, /Load:\s*([\d.]+)\s*\/\s*/i);

    const topApps = this.parseTopProcesses(topText);

    return {
      collectedAt: new Date().toISOString(),
      battery: {
        levelPercent,
        status: this.parseBatteryStatus(batteryStatusCode),
        charging:
          plugged > 0 ||
          batteryStatusCode === 2 ||
          batteryStatusCode === 5,
        temperatureC:
          tempTenths !== undefined
            ? Math.round((tempTenths / 10) * 10) / 10
            : undefined,
        voltageMv,
      },
      memory: {
        totalMb: this.toMb(totalRamKb),
        usedMb: this.toMb(derivedUsedKb),
        freeMb: this.toMb(freeRamKb),
      },
      storage: {
        mountPoint: "/data",
        totalGb: this.toGb(totalStorageKb),
        usedGb: this.toGb(usedStorageKb),
        freeGb: this.toGb(freeStorageKb),
        usedPercent: Number.isFinite(usedPercent) ? usedPercent : undefined,
      },
      performance: {
        cpuLoadPercent,
        topApps,
        thermalStatus: thermalStatusText,
        thermalWarning:
          thermalStatusText === "Severe" ||
          thermalStatusText === "Critical" ||
          thermalStatusText === "Emergency" ||
          thermalStatusText === "Shutdown",
      },
      errors,
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private shellEscape(value: string): string {
    return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
  }

  private async pathExists(filePath: string): Promise<boolean> {
    if (!filePath) return false;
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private escapeShellArg(value: string): string {
    return value.replace(/(["\\$`])/g, "\\$1");
  }

  private extractPackagePathDetails(dumpsysOutput: string): {
    dataDir?: string;
    codePath?: string;
    resourcePath?: string;
  } {
    const dataDirMatch = dumpsysOutput.match(/^\s*dataDir=([^\n\r]+)/m);
    const codePathMatch = dumpsysOutput.match(/^\s*codePath=([^\n\r]+)/m);
    const resourcePathMatch = dumpsysOutput.match(
      /^\s*resourcePath=([^\n\r]+)/m,
    );

    return {
      dataDir: dataDirMatch?.[1]?.trim(),
      codePath: codePathMatch?.[1]?.trim(),
      resourcePath: resourcePathMatch?.[1]?.trim(),
    };
  }

  private parseDuKilobytes(output: string): number | null {
    const lines = output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    for (let index = lines.length - 1; index >= 0; index--) {
      const line = lines[index];
      const firstToken = line.split(/\s+/)[0];
      const parsed = Number.parseInt(firstToken, 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return null;
  }

  private parseLsSizeBytes(output: string): number | null {
    const firstLine = output.split("\n")[0]?.trim();
    if (!firstLine) return null;
    const parts = firstLine.split(/\s+/);
    if (parts.length < 5) return null;
    const parsed = Number.parseInt(parts[4], 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private parseStatSizeBytes(output: string): number | null {
    const firstLine = output.split("\n")[0]?.trim();
    if (!firstLine) return null;
    const parsed = Number.parseInt(firstLine, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private async getPathSizeKilobytes(
    deviceId: string,
    absolutePath: string,
  ): Promise<number | null> {
    if (!absolutePath || !absolutePath.startsWith("/")) return null;
    const escapedPath = this.escapeShellArg(absolutePath);
    const result = await this.runShell(
      deviceId,
      `du -sk \"${escapedPath}\"`,
      15000,
    );
    if (!result.success) return null;
    return this.parseDuKilobytes(result.output);
  }

  private async getFileSizeBytes(
    deviceId: string,
    absolutePath: string,
  ): Promise<number | null> {
    if (!absolutePath || !absolutePath.startsWith("/")) return null;
    const escapedPath = this.escapeShellArg(absolutePath);

    const statResult = await this.runShell(
      deviceId,
      `stat -c %s \"${escapedPath}\"`,
      10000,
    );
    if (statResult.success) {
      const statBytes = this.parseStatSizeBytes(statResult.output);
      if (typeof statBytes === "number" && statBytes >= 0) {
        return statBytes;
      }
    }

    const result = await this.runShell(
      deviceId,
      `ls -ln \"${escapedPath}\"`,
      10000,
    );
    if (!result.success) return null;
    return this.parseLsSizeBytes(result.output);
  }

  private async getPackageApkPaths(
    deviceId: string,
    packageName: string,
  ): Promise<string[]> {
    const result = await this.runShell(
      deviceId,
      `pm path ${packageName}`,
      10000,
    );
    if (!result.success) return [];

    const paths = result.output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("package:"))
      .map((line) => line.replace("package:", "").trim())
      .filter((line) => line.startsWith("/"));

    return [...new Set(paths)];
  }

  private async getPackageCodePathFromPm(
    deviceId: string,
    packageName: string,
  ): Promise<string | null> {
    const result = await this.runShell(
      deviceId,
      `pm path ${packageName}`,
      10000,
    );
    if (!result.success) return null;

    const line = result.output
      .split("\n")
      .find((entry) => entry.trim().startsWith("package:"));
    if (!line) return null;

    const pathValue = line.replace("package:", "").trim();
    return pathValue.startsWith("/") ? pathValue : null;
  }

  private async getPackageCodePathFromPmList(
    deviceId: string,
    packageName: string,
  ): Promise<string | null> {
    const result = await this.runShell(
      deviceId,
      `pm list packages -f -u ${packageName}`,
      10000,
    );
    if (!result.success) return null;

    const line = result.output
      .split("\n")
      .map((entry) => entry.trim())
      .find((entry) => {
        if (!entry.startsWith("package:")) return false;
        const parts = entry.replace("package:", "").split("=");
        return parts[1]?.trim() === packageName;
      });

    if (!line) return null;
    const [pathValue] = line.replace("package:", "").split("=");
    const normalizedPath = pathValue?.trim();
    return normalizedPath && normalizedPath.startsWith("/")
      ? normalizedPath
      : null;
  }

  private parsePackagePathListOutput(output: string): PackagePathInfo[] {
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("package:"))
      .map((line) => line.replace("package:", ""))
      .map((line) => {
        const equalsIndex = line.lastIndexOf("=");
        if (equalsIndex <= 0) return null;
        const pkgPath = line.slice(0, equalsIndex).trim();
        const name = line.slice(equalsIndex + 1).trim();
        if (!pkgPath.startsWith("/") || !name) return null;

        const normalizedPath = pkgPath.toLowerCase();
        const isSystemPath =
          normalizedPath.startsWith("/system/") ||
          normalizedPath.startsWith("/product/") ||
          normalizedPath.startsWith("/vendor/") ||
          normalizedPath.startsWith("/system_ext/") ||
          normalizedPath.startsWith("/odm/");

        return { name, path: pkgPath, isSystemPath };
      })
      .filter((entry): entry is PackagePathInfo => entry !== null);
  }

  private isUnsupportedCommandError(text?: string): boolean {
    const value = (text || "").toLowerCase();
    if (!value) return false;
    return (
      value.includes("unknown command") ||
      value.includes("not found") ||
      value.includes("unknown option") ||
      value.includes("unsupported") ||
      value.includes("no shell command implementation") ||
      value.includes("can't find service")
    );
  }

  private isPermissionDeniedError(text?: string): boolean {
    const value = (text || "").toLowerCase();
    if (!value) return false;
    return (
      value.includes("permission denied") ||
      value.includes("securityexception")
    );
  }

  private parseStandbyBucket(output: string): string | null {
    const normalized = output.toLowerCase();
    const namedMatch = normalized.match(
      /\b(active|working_set|frequent|rare|restricted|exempted|never)\b/,
    );
    if (namedMatch) return namedMatch[1];

    const numericMatch = normalized.match(/\b(\d{2})\b/);
    if (!numericMatch) return null;

    switch (numericMatch[1]) {
      case "10":
        return "active";
      case "20":
        return "working_set";
      case "30":
        return "frequent";
      case "40":
        return "rare";
      case "45":
      case "50":
        return "restricted";
      default:
        return null;
    }
  }

  private parseAppOpsMode(output: string): string | null {
    const normalized = output.toLowerCase();
    if (normalized.includes("no operations")) return "default";
    const modeMatch = normalized.match(
      /\b(allow|ignore|deny|default|foreground|errored)\b/,
    );
    return modeMatch ? modeMatch[1] : null;
  }

  private async resolvePackageUid(
    deviceId: string,
    packageName: string,
  ): Promise<number | null> {
    const dumpsysResult = await this.runShell(
      deviceId,
      `dumpsys package ${packageName}`,
      20000,
    );

    if (dumpsysResult.success) {
      const uidMatch = dumpsysResult.output.match(/\buserId=(\d+)\b/);
      if (uidMatch) {
        const parsed = Number.parseInt(uidMatch[1], 10);
        if (Number.isFinite(parsed)) return parsed;
      }
    }

    const listResult = await this.runShell(
      deviceId,
      `cmd package list packages -U ${packageName}`,
      15000,
    );
    if (!listResult.success) return null;

    const uidMatch = listResult.output.match(/\buid:(\d+)\b/);
    if (!uidMatch) return null;

    const parsed = Number.parseInt(uidMatch[1], 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private async getStandbyBucket(
    deviceId: string,
    packageName: string,
    userId: number,
  ): Promise<string | null> {
    const withUser = await this.runShell(
      deviceId,
      `am get-standby-bucket --user ${userId} ${packageName}`,
      12000,
    );
    if (withUser.success && withUser.output) {
      return this.parseStandbyBucket(withUser.output);
    }

    const withoutUser = await this.runShell(
      deviceId,
      `am get-standby-bucket ${packageName}`,
      12000,
    );
    if (!withoutUser.success || !withoutUser.output) return null;

    return this.parseStandbyBucket(withoutUser.output);
  }

  private async setStandbyBucket(
    deviceId: string,
    packageName: string,
    userId: number,
    bucket: "restricted" | "active",
  ): Promise<AdbCommandResult> {
    const withUser = await this.runShell(
      deviceId,
      `am set-standby-bucket --user ${userId} ${packageName} ${bucket}`,
      15000,
    );
    if (withUser.success) return withUser;

    return this.runShell(
      deviceId,
      `am set-standby-bucket ${packageName} ${bucket}`,
      15000,
    );
  }

  private async getAppOpMode(
    deviceId: string,
    packageName: string,
    userId: number,
    opName: "RUN_IN_BACKGROUND" | "RUN_ANY_IN_BACKGROUND" | "WAKE_LOCK",
  ): Promise<string | null> {
    const withUser = await this.runShell(
      deviceId,
      `cmd appops get --user ${userId} ${packageName} ${opName}`,
      12000,
    );
    if (withUser.success && withUser.output) {
      return this.parseAppOpsMode(withUser.output);
    }

    const withoutUser = await this.runShell(
      deviceId,
      `cmd appops get ${packageName} ${opName}`,
      12000,
    );
    if (!withoutUser.success || !withoutUser.output) return null;

    return this.parseAppOpsMode(withoutUser.output);
  }

  private async setAppOpMode(
    deviceId: string,
    packageName: string,
    userId: number,
    opName: "RUN_IN_BACKGROUND" | "RUN_ANY_IN_BACKGROUND" | "WAKE_LOCK",
    mode: "allow" | "ignore",
  ): Promise<AdbCommandResult> {
    const withUser = await this.runShell(
      deviceId,
      `cmd appops set --user ${userId} ${packageName} ${opName} ${mode}`,
      12000,
    );
    if (withUser.success) return withUser;

    return this.runShell(
      deviceId,
      `cmd appops set ${packageName} ${opName} ${mode}`,
      12000,
    );
  }

  private async isUidInRestrictBackgroundBlacklist(
    deviceId: string,
    uid: number,
  ): Promise<boolean | null> {
    const result = await this.runShell(
      deviceId,
      "cmd netpolicy list restrict-background-blacklist",
      12000,
    );
    if (!result.success) return null;

    return new RegExp(`\\b${uid}\\b`).test(result.output);
  }

  private async updateRestrictBackgroundBlacklist(
    deviceId: string,
    uid: number,
    add: boolean,
  ): Promise<AdbCommandResult> {
    const command = add
      ? `cmd netpolicy add restrict-background-blacklist ${uid}`
      : `cmd netpolicy remove restrict-background-blacklist ${uid}`;
    return this.runShell(deviceId, command, 12000);
  }

  private buildRestrictionControls(status: {
    standbyBucket: string | null;
    runInBackgroundMode: string | null;
    runAnyInBackgroundMode: string | null;
    wakeLockMode: string | null;
    networkRestricted: boolean | null;
  }): string[] {
    const controls: string[] = [];
    if (status.standbyBucket === "restricted") controls.push("standby_bucket");
    if (
      status.runInBackgroundMode === "ignore" ||
      status.runInBackgroundMode === "deny"
    ) {
      controls.push("run_in_background");
    }
    if (
      status.runAnyInBackgroundMode === "ignore" ||
      status.runAnyInBackgroundMode === "deny"
    ) {
      controls.push("run_any_in_background");
    }
    if (
      status.wakeLockMode === "ignore" ||
      status.wakeLockMode === "deny"
    ) {
      controls.push("wake_lock");
    }
    if (status.networkRestricted === true)
      controls.push("network_background_data");
    return controls;
  }

  private parseInteger(text: string, regex: RegExp): number | undefined {
    const value = text.match(regex)?.[1]?.replace(/,/g, "");
    if (!value) return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private parseFloatValue(text: string, regex: RegExp): number | undefined {
    const value = text.match(regex)?.[1];
    if (!value) return undefined;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private toMb(kb?: number): number | undefined {
    if (kb === undefined) return undefined;
    return Math.round((kb / 1024) * 10) / 10;
  }

  private toGb(kb?: number): number | undefined {
    if (kb === undefined) return undefined;
    return Math.round((kb / (1024 * 1024)) * 100) / 100;
  }

  private parseBatteryStatus(statusCode?: number): string {
    switch (statusCode) {
      case 2:
        return "Charging";
      case 3:
        return "Discharging";
      case 4:
        return "Not charging";
      case 5:
        return "Full";
      default:
        return "Unknown";
    }
  }

  private parseThermalStatusCode(statusCode?: number): string {
    switch (statusCode) {
      case 0:
        return "None";
      case 1:
        return "Light";
      case 2:
        return "Moderate";
      case 3:
        return "Severe";
      case 4:
        return "Critical";
      case 5:
        return "Emergency";
      case 6:
        return "Shutdown";
      default:
        return "Unknown";
    }
  }

  private parseTopProcesses(output: string): TopProcess[] {
    const entries = new Map<string, number>();
    const lines = output.split("\n");

    for (const line of lines) {
      const normalized = line.trim();
      if (
        !normalized ||
        /tasks:/i.test(normalized) ||
        /^mem:/i.test(normalized) ||
        /^swap:/i.test(normalized) ||
        /%cpu/i.test(normalized) ||
        /^pid\s+user/i.test(normalized)
      ) {
        continue;
      }

      const parts = line.trim().split(/\s+/);
      let cpuPercent: number | undefined;
      let processName: string | undefined;

      // regex for the user performance evaluation
      if (parts.length >= 12 && /^\d+$/.test(parts[0])) {
        const cpuToken = parts[8]?.replace(/[\[\]%]/g, "");
        const parsedCpu = Number.parseFloat(cpuToken);
        if (Number.isFinite(parsedCpu)) {
          cpuPercent = parsedCpu;
          processName = parts.slice(11).join(" ");
        }
      }

      // Fallback for outputs that include percentages inline
      if (cpuPercent === undefined) {
        const cpuMatch = line.match(/(\d+(?:\.\d+)?)%/);
        if (cpuMatch) {
          const parsedCpu = Number.parseFloat(cpuMatch[1]);
          if (Number.isFinite(parsedCpu)) {
            cpuPercent = parsedCpu;
            processName = parts[parts.length - 1];
          }
        }
      }

      if (
        typeof cpuPercent !== "number" ||
        !Number.isFinite(cpuPercent) ||
        cpuPercent <= 0
      ) {
        continue;
      }
      const normalizedCpu = cpuPercent;

      if (
        !processName ||
        processName === "ARGS" ||
        processName.startsWith("[")
      ) {
        continue;
      }

      const previous = entries.get(processName) || 0;
      if (normalizedCpu > previous) {
        entries.set(processName, normalizedCpu);
      }
    }

    return Array.from(entries.entries())
      .map(([name, cpuPercent]) => ({
        name,
        cpuPercent: Math.round(cpuPercent * 10) / 10,
      }))
      .sort((a, b) => b.cpuPercent - a.cpuPercent)
      .slice(0, 20);
  }
}

// ── Backward-compat exports ────────────────────────────────────────────────
// All original exported function names are preserved as thin delegates to the
// AdbClient singleton. Every import of `"../adb"` continues to work unchanged.

/**
 * Execute an ADB command
 */
export async function executeAdbCommand(
  command: string,
  timeout = 30000,
): Promise<AdbCommandResult> {
  return AdbClient.getInstance().execute(command, timeout);
}

/**
 * Get list of connected devices
 */
export async function getDevices(): Promise<AdbDevice[]> {
  return AdbClient.getInstance().getDevices();
}

/**
 * Check if ADB is available
 */
export async function checkAdbAvailable(): Promise<boolean> {
  return AdbClient.getInstance().checkAvailable();
}

/**
 * Get a device property
 */
export async function getDeviceProperty(
  deviceId: string,
  prop: string,
): Promise<string> {
  return AdbClient.getInstance().getDeviceProperty(deviceId, prop);
}

/**
 * List all packages on a device.
 * `systemOnly = true` (default) → only system packages (-s flag).
 * `systemOnly = false`          → all packages (no flag).
 */
export async function listPackages(
  deviceId: string,
  userId = 0,
  systemOnly = true,
): Promise<string[]> {
  return AdbClient.getInstance().listPackages(deviceId, {
    user: userId,
    // systemOnly=true  → includeSystemApps=false → -s flag (system only)
    // systemOnly=false → includeSystemApps=true  → no flag (all packages)
    includeSystemApps: !systemOnly,
  });
}

/**
 * List installed packages with resolved code paths.
 */
export async function listPackagesWithPaths(
  deviceId: string,
  userId = 0,
  includeUninstalled = false,
): Promise<PackagePathInfo[]> {
  return AdbClient.getInstance().listPackagesWithPaths(deviceId, {
    user: userId,
    includeUninstalled,
  });
}

/**
 * Get package states (enabled, disabled, uninstalled).
 */
export async function getPackageStates(
  deviceId: string,
  userId = 0,
  systemOnly = true,
): Promise<PackageInfo[]> {
  return AdbClient.getInstance().getPackageStates(deviceId, {
    user: userId,
    systemOnly,
  });
}

/**
 * Uninstall a package
 */
export async function uninstallPackage(
  deviceId: string,
  packageName: string,
  userId = 0,
  androidSdk = 30,
): Promise<AdbCommandResult> {
  return AdbClient.getInstance().uninstallPackage(deviceId, packageName, {
    user: userId,
    androidSdk,
  });
}

/**
 * Restore a package
 */
export async function restorePackage(
  deviceId: string,
  packageName: string,
  userId = 0,
  androidSdk = 30,
): Promise<AdbCommandResult> {
  return AdbClient.getInstance().restorePackage(deviceId, packageName, {
    user: userId,
    androidSdk,
  });
}

/**
 * Disable a package
 */
export async function disablePackage(
  deviceId: string,
  packageName: string,
  userId = 0,
): Promise<AdbCommandResult> {
  return AdbClient.getInstance().disablePackage(deviceId, packageName, {
    user: userId,
  });
}

/**
 * Enable a package
 */
export async function enablePackage(
  deviceId: string,
  packageName: string,
  userId = 0,
): Promise<AdbCommandResult> {
  return AdbClient.getInstance().enablePackage(deviceId, packageName, {
    user: userId,
  });
}

/**
 * Install an APK file on a device
 */
export async function installApk(
  deviceId: string,
  apkPath: string,
): Promise<AdbCommandResult> {
  return AdbClient.getInstance().installApk(deviceId, apkPath);
}

/**
 * Check if a package is installed on the device
 */
export async function isPackageInstalled(
  deviceId: string,
  packageName: string,
): Promise<boolean> {
  return AdbClient.getInstance().isPackageInstalled(deviceId, packageName);
}

/**
 * Get installed package size in bytes.
 */
export async function getPackageSizeBytes(
  deviceId: string,
  packageName: string,
  options?: PackageSizeOptions,
): Promise<number | null> {
  return AdbClient.getInstance().getPackageSizeBytes(
    deviceId,
    packageName,
    options,
  );
}

/**
 * Read current background restriction controls for one package.
 */
export async function getBackgroundRestrictionStatus(
  deviceId: string,
  packageName: string,
  userId = 0,
): Promise<BackgroundRestrictionStatus> {
  return AdbClient.getInstance().getBackgroundRestrictionStatus(
    deviceId,
    packageName,
    { user: userId },
  );
}

/**
 * Apply or relax background restriction controls for one package.
 */
export async function optimizeBackgroundRestriction(
  deviceId: string,
  packageName: string,
  mode: BackgroundRestrictionMode = "restrict",
  userId = 0,
): Promise<BackgroundOptimizationResult> {
  return AdbClient.getInstance().optimizeBackgroundRestriction(
    deviceId,
    packageName,
    { mode, user: userId },
  );
}

/**
 * Get a health snapshot of a device.
 */
export async function getDeviceHealthSnapshot(
  deviceId: string,
): Promise<DeviceHealthSnapshot> {
  return AdbClient.getInstance().getDeviceHealthSnapshot(deviceId);
}
