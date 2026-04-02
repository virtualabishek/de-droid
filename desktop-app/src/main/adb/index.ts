/**
 * Local ADB Wrapper for Electron
 * Executes ADB commands locally using Node.js child_process
 */
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

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

function parseInteger(text: string, regex: RegExp): number | undefined {
  const value = text.match(regex)?.[1]?.replace(/,/g, "");
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseFloatValue(text: string, regex: RegExp): number | undefined {
  const value = text.match(regex)?.[1];
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toMb(kb?: number): number | undefined {
  if (kb === undefined) return undefined;
  return Math.round((kb / 1024) * 10) / 10;
}

function toGb(kb?: number): number | undefined {
  if (kb === undefined) return undefined;
  return Math.round((kb / (1024 * 1024)) * 100) / 100;
}

function parseBatteryStatus(statusCode?: number): string {
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

function parseThermalStatusCode(statusCode?: number): string {
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

function parseTopProcesses(output: string): TopProcess[] {
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

    // Android top -b usually emits:
    // PID USER PR NI VIRT RES SHR S CPU MEM TIME+ ARGS
    if (parts.length >= 12 && /^\d+$/.test(parts[0])) {
      const cpuToken = parts[8]?.replace(/[\[\]%]/g, "");
      const parsedCpu = Number.parseFloat(cpuToken);
      if (Number.isFinite(parsedCpu)) {
        cpuPercent = parsedCpu;
        processName = parts.slice(11).join(" ");
      }
    }

    // Fallback for outputs that include percentages inline.
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

    if (typeof cpuPercent !== "number" || !Number.isFinite(cpuPercent) || cpuPercent <= 0) {
      continue;
    }
    const normalizedCpu = cpuPercent;

    if (!processName || processName === "ARGS" || processName.startsWith("[")) {
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

/**
 * Execute an ADB command
 */
async function executeAdb(
  command: string,
  timeout = 30000,
): Promise<AdbCommandResult> {
  try {
    const { stdout, stderr } = await execAsync(`adb ${command}`, { timeout });
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

function runShellCommand(
  deviceId: string,
  shellCommand: string,
  timeout = 30000,
): Promise<AdbCommandResult> {
  return executeAdb(`-s ${deviceId} shell ${shellCommand}`, timeout);
}

function isUnsupportedCommandError(text?: string): boolean {
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

function isPermissionDeniedError(text?: string): boolean {
  const value = (text || "").toLowerCase();
  if (!value) return false;
  return value.includes("permission denied") || value.includes("securityexception");
}

function parseStandbyBucket(output: string): string | null {
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

function parseAppOpsMode(output: string): string | null {
  const normalized = output.toLowerCase();
  if (normalized.includes("no operations")) return "default";
  const modeMatch = normalized.match(
    /\b(allow|ignore|deny|default|foreground|errored)\b/,
  );
  return modeMatch ? modeMatch[1] : null;
}

async function resolvePackageUid(
  deviceId: string,
  packageName: string,
): Promise<number | null> {
  const dumpsysResult = await runShellCommand(
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

  const listResult = await runShellCommand(
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

async function getStandbyBucket(
  deviceId: string,
  packageName: string,
  userId: number,
): Promise<string | null> {
  const withUser = await runShellCommand(
    deviceId,
    `am get-standby-bucket --user ${userId} ${packageName}`,
    12000,
  );
  if (withUser.success && withUser.output) {
    return parseStandbyBucket(withUser.output);
  }

  const withoutUser = await runShellCommand(
    deviceId,
    `am get-standby-bucket ${packageName}`,
    12000,
  );
  if (!withoutUser.success || !withoutUser.output) return null;

  return parseStandbyBucket(withoutUser.output);
}

async function setStandbyBucket(
  deviceId: string,
  packageName: string,
  userId: number,
  bucket: "restricted" | "active",
): Promise<AdbCommandResult> {
  const withUser = await runShellCommand(
    deviceId,
    `am set-standby-bucket --user ${userId} ${packageName} ${bucket}`,
    15000,
  );
  if (withUser.success) return withUser;

  return runShellCommand(
    deviceId,
    `am set-standby-bucket ${packageName} ${bucket}`,
    15000,
  );
}

async function getAppOpMode(
  deviceId: string,
  packageName: string,
  userId: number,
  opName: "RUN_IN_BACKGROUND" | "RUN_ANY_IN_BACKGROUND" | "WAKE_LOCK",
): Promise<string | null> {
  const withUser = await runShellCommand(
    deviceId,
    `cmd appops get --user ${userId} ${packageName} ${opName}`,
    12000,
  );
  if (withUser.success && withUser.output) {
    return parseAppOpsMode(withUser.output);
  }

  const withoutUser = await runShellCommand(
    deviceId,
    `cmd appops get ${packageName} ${opName}`,
    12000,
  );
  if (!withoutUser.success || !withoutUser.output) return null;

  return parseAppOpsMode(withoutUser.output);
}

async function setAppOpMode(
  deviceId: string,
  packageName: string,
  userId: number,
  opName: "RUN_IN_BACKGROUND" | "RUN_ANY_IN_BACKGROUND" | "WAKE_LOCK",
  mode: "allow" | "ignore",
): Promise<AdbCommandResult> {
  const withUser = await runShellCommand(
    deviceId,
    `cmd appops set --user ${userId} ${packageName} ${opName} ${mode}`,
    12000,
  );
  if (withUser.success) return withUser;

  return runShellCommand(
    deviceId,
    `cmd appops set ${packageName} ${opName} ${mode}`,
    12000,
  );
}

async function isUidInRestrictBackgroundBlacklist(
  deviceId: string,
  uid: number,
): Promise<boolean | null> {
  const result = await runShellCommand(
    deviceId,
    "cmd netpolicy list restrict-background-blacklist",
    12000,
  );
  if (!result.success) return null;

  return new RegExp(`\\b${uid}\\b`).test(result.output);
}

async function updateRestrictBackgroundBlacklist(
  deviceId: string,
  uid: number,
  mode: BackgroundRestrictionMode,
): Promise<AdbCommandResult> {
  const command =
    mode === "restrict"
      ? `cmd netpolicy add restrict-background-blacklist ${uid}`
      : `cmd netpolicy remove restrict-background-blacklist ${uid}`;
  return runShellCommand(deviceId, command, 12000);
}

function buildRestrictionControls(status: {
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
  if (status.wakeLockMode === "ignore" || status.wakeLockMode === "deny") {
    controls.push("wake_lock");
  }
  if (status.networkRestricted === true) controls.push("network_background_data");
  return controls;
}

/**
 * Execute an ADB command (public API)
 */
export async function executeAdbCommand(
  command: string,
  timeout = 30000,
): Promise<AdbCommandResult> {
  return executeAdb(command, timeout);
}

/**
 * Get list of connected devices
 */
export async function getDevices(): Promise<AdbDevice[]> {
  const result = await executeAdb("devices -l");

  if (!result.success) {
    console.error("Failed to get devices:", result.error);
    return [];
  }

  const devices: AdbDevice[] = [];
  const lines = result.output.split("\n").slice(1); // Skip header line

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
    const model = await getDeviceProperty(deviceId, "ro.product.model");
    const brand = await getDeviceProperty(deviceId, "ro.product.brand");
    const androidVersion = await getDeviceProperty(
      deviceId,
      "ro.build.version.release",
    );
    const androidSdk = await getDeviceProperty(
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

/**
 * Get a device property
 */
async function getDeviceProperty(
  deviceId: string,
  property: string,
): Promise<string> {
  const result = await executeAdb(`-s ${deviceId} shell getprop ${property}`);
  return result.success ? result.output.trim() : "";
}

/**
 * List all packages on a device
 */
export async function listPackages(
  deviceId: string,
  userId = 0,
  systemOnly = true,
): Promise<string[]> {
  const flags = systemOnly ? "-s" : "";
  const result = await executeAdb(
    `-s ${deviceId} shell pm list packages ${flags} --user ${userId}`,
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
 * Get package states (enabled, disabled, uninstalled)
 */
export async function getPackageStates(
  deviceId: string,
  userId = 0,
  systemOnly = true,
): Promise<PackageInfo[]> {
  // Get all packages (including uninstalled)
  const flags = systemOnly ? "-s" : "";
  const allResult = await executeAdb(
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
  const enabledResult = await executeAdb(
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
  const disabledResult = await executeAdb(
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
  const installedResult = await executeAdb(
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

/**
 * Uninstall a package
 */
export async function uninstallPackage(
  deviceId: string,
  packageName: string,
  userId = 0,
  androidSdk = 30,
): Promise<AdbCommandResult> {
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

  const result = await executeAdb(command);

  // Clear app data after uninstall (if successful)
  if (result.success && androidSdk >= 23) {
    const clearResult = await executeAdb(
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

/**
 * Restore a package
 */
export async function restorePackage(
  deviceId: string,
  packageName: string,
  userId = 0,
  androidSdk = 30,
): Promise<AdbCommandResult> {
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

  return await executeAdb(command);
}

/**
 * Disable a package
 */
export async function disablePackage(
  deviceId: string,
  packageName: string,
  userId = 0,
): Promise<AdbCommandResult> {
  const command = `-s ${deviceId} shell pm disable-user --user ${userId} ${packageName}`;
  const result = await executeAdb(command);

  // Force stop and clear if successful
  if (result.success) {
    await executeAdb(`-s ${deviceId} shell am force-stop ${packageName}`);
    await executeAdb(
      `-s ${deviceId} shell pm clear --user ${userId} ${packageName}`,
    );
  }

  return result;
}

/**
 * Enable a package
 */
export async function enablePackage(
  deviceId: string,
  packageName: string,
  userId = 0,
): Promise<AdbCommandResult> {
  const command = `-s ${deviceId} shell pm enable --user ${userId} ${packageName}`;
  return await executeAdb(command);
}

/**
 * Read current background restriction controls for one package.
 */
export async function getBackgroundRestrictionStatus(
  deviceId: string,
  packageName: string,
  userId = 0,
): Promise<BackgroundRestrictionStatus> {
  const warnings: string[] = [];

  const [standbyBucket, runInBackgroundMode, runAnyInBackgroundMode, wakeLockMode, packageUid] =
    await Promise.all([
      getStandbyBucket(deviceId, packageName, userId),
      getAppOpMode(deviceId, packageName, userId, "RUN_IN_BACKGROUND"),
      getAppOpMode(deviceId, packageName, userId, "RUN_ANY_IN_BACKGROUND"),
      getAppOpMode(deviceId, packageName, userId, "WAKE_LOCK"),
      resolvePackageUid(deviceId, packageName),
    ]);

  let networkRestricted: boolean | null = null;
  if (packageUid !== null) {
    networkRestricted = await isUidInRestrictBackgroundBlacklist(deviceId, packageUid);
  } else {
    warnings.push("Could not resolve package UID; network policy status unavailable.");
  }

  const controlsActive = buildRestrictionControls({
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
export async function optimizeBackgroundRestriction(
  deviceId: string,
  packageName: string,
  mode: BackgroundRestrictionMode = "restrict",
  userId = 0,
): Promise<BackgroundOptimizationResult> {
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
    if (isUnsupportedCommandError(failureDetails)) {
      warnings.push(`${label} is not supported on this device/Android build.`);
      return;
    }

    if (isPermissionDeniedError(failureDetails)) {
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
    () => runShellCommand(deviceId, `am force-stop ${packageName}`, 10000),
  );

  await applyStep(
    mode === "restrict" ? "Set standby bucket restricted" : "Set standby bucket active",
    () =>
      setStandbyBucket(
        deviceId,
        packageName,
        userId,
        mode === "restrict" ? "restricted" : "active",
      ),
  );

  await applyStep(
    `Set RUN_IN_BACKGROUND ${mode === "restrict" ? "ignore" : "allow"}`,
    () =>
      setAppOpMode(
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
      setAppOpMode(
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
      setAppOpMode(
        deviceId,
        packageName,
        userId,
        "WAKE_LOCK",
        mode === "restrict" ? "ignore" : "allow",
      ),
  );

  const uid = await resolvePackageUid(deviceId, packageName);
  if (uid === null) {
    warnings.push("Could not resolve package UID; skipped background network policy.");
  } else {
    await applyStep(
      mode === "restrict"
        ? "Restrict background network data"
        : "Allow background network data",
      () => updateRestrictBackgroundBlacklist(deviceId, uid, mode),
    );
  }

  const status = await getBackgroundRestrictionStatus(deviceId, packageName, userId);
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

/**
 * Check if ADB is available
 */
export async function checkAdbAvailable(): Promise<boolean> {
  const result = await executeAdb("version");
  return result.success;
}

/**
 * Install an APK file on a device
 */
export async function installApk(
  deviceId: string,
  apkPath: string,
): Promise<AdbCommandResult> {
  const command = `-s ${deviceId} install -r "${apkPath}"`;
  return await executeAdb(command, 120000); // 2 minute timeout for large APKs
}

/**
 * Check if a package is installed on the device
 */
export async function isPackageInstalled(
  deviceId: string,
  packageName: string,
): Promise<boolean> {
  const result = await executeAdb(
    `-s ${deviceId} shell pm list packages | grep ${packageName}`,
  );
  return result.success && result.output.includes(packageName);
}

export async function getDeviceHealthSnapshot(
  deviceId: string,
): Promise<DeviceHealthSnapshot> {
  const errors: string[] = [];

  const [batteryResult, memResult, procMemResult, dfResult, thermalResult] = await Promise.all([
    executeAdb(`-s ${deviceId} shell dumpsys battery`, 10000),
    executeAdb(`-s ${deviceId} shell dumpsys meminfo`, 15000),
    executeAdb(`-s ${deviceId} shell cat /proc/meminfo`, 10000),
    executeAdb(`-s ${deviceId} shell df /data`, 10000),
    executeAdb(`-s ${deviceId} shell dumpsys thermalservice`, 10000),
  ]);

  let topResult = await executeAdb(`-s ${deviceId} shell top -n 1 -b`, 15000);
  if (!topResult.success || !topResult.output) {
    topResult = await executeAdb(`-s ${deviceId} shell top -n 1`, 15000);
  }
  if (!topResult.success || !topResult.output) {
    topResult = await executeAdb(`-s ${deviceId} shell dumpsys cpuinfo`, 15000);
  }

  if (!batteryResult.success) errors.push(`battery: ${batteryResult.error || "unavailable"}`);
  if (!memResult.success && !procMemResult.success) {
    errors.push(`meminfo: ${(memResult.error || procMemResult.error || "unavailable")}`);
  }
  if (!dfResult.success) errors.push(`storage: ${dfResult.error || "unavailable"}`);
  if (!thermalResult.success) errors.push(`thermal: ${thermalResult.error || "unavailable"}`);
  if (!topResult.success) errors.push(`cpu/top: ${topResult.error || "unavailable"}`);

  const batteryText = batteryResult.output || "";
  const memText = memResult.output || "";
  const procMemText = procMemResult.output || "";
  const dfText = dfResult.output || "";
  const thermalText = thermalResult.output || "";
  const topText = topResult.output || "";

  const batteryStatusCode = parseInteger(batteryText, /^\s*status:\s*(\d+)/m);
  const plugged = parseInteger(batteryText, /^\s*plugged:\s*(\d+)/m) || 0;
  const levelPercent = parseInteger(batteryText, /^\s*level:\s*(\d+)/m);
  const tempTenths = parseInteger(batteryText, /^\s*temperature:\s*(-?\d+)/m);
  const voltageMv = parseInteger(batteryText, /^\s*voltage:\s*(\d+)/m);

  const totalRamKb =
    parseInteger(memText, /Total RAM:\s*([\d,]+)K/i) ||
    parseInteger(procMemText, /^MemTotal:\s*(\d+)\s*kB$/im) ||
    parseInteger(topText, /Mem:\s*([\d,]+)K\s+total/i);
  const usedRamKb =
    parseInteger(memText, /Used RAM:\s*([\d,]+)K/i) ||
    parseInteger(topText, /Mem:\s*[\d,]+K\s+total,\s*([\d,]+)K\s+used/i);
  const freeRamKb =
    parseInteger(memText, /Free RAM:\s*([\d,]+)K/i) ||
    parseInteger(procMemText, /^MemAvailable:\s*(\d+)\s*kB$/im) ||
    parseInteger(topText, /Mem:\s*[\d,]+K\s+total,\s*[\d,]+K\s+used,\s*([\d,]+)K\s+free/i);
  const derivedUsedKb =
    usedRamKb !== undefined
      ? usedRamKb
      : totalRamKb !== undefined && freeRamKb !== undefined
        ? Math.max(totalRamKb - freeRamKb, 0)
        : undefined;

  const dataLine =
    dfText
      .split("\n")
      .find((line) => /\s\/data\s*$/.test(line) || line.trim().endsWith(" /data")) ||
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

  const thermalStatusCode = parseInteger(
    thermalText,
    /(?:Thermal Status|mStatus)\s*[:=]\s*(\d+)/i,
  );
  const thermalStatusText = parseThermalStatusCode(thermalStatusCode);

  const cpuLoadPercent =
    parseFloatValue(topText, /(\d+(?:\.\d+)?)%\s*cpu/i) ||
    parseFloatValue(topText, /Load:\s*([\d.]+)\s*\/\s*/i);

  const topApps = parseTopProcesses(topText);

  return {
    collectedAt: new Date().toISOString(),
    battery: {
      levelPercent,
      status: parseBatteryStatus(batteryStatusCode),
      charging: plugged > 0 || batteryStatusCode === 2 || batteryStatusCode === 5,
      temperatureC: tempTenths !== undefined ? Math.round((tempTenths / 10) * 10) / 10 : undefined,
      voltageMv,
    },
    memory: {
      totalMb: toMb(totalRamKb),
      usedMb: toMb(derivedUsedKb),
      freeMb: toMb(freeRamKb),
    },
    storage: {
      mountPoint: "/data",
      totalGb: toGb(totalStorageKb),
      usedGb: toGb(usedStorageKb),
      freeGb: toGb(freeStorageKb),
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
