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
    const cpuMatch = line.match(/(\d+(?:\.\d+)?)%/);
    if (!cpuMatch) continue;

    const cpuPercent = Number.parseFloat(cpuMatch[1]);
    if (!Number.isFinite(cpuPercent) || cpuPercent <= 0) continue;

    let processName: string | undefined;

    const cpuInfoMatch = line.match(/\d+(?:\.\d+)?%\s+\d+\/(\S+)/);
    if (cpuInfoMatch?.[1]) {
      processName = cpuInfoMatch[1];
    } else {
      const parts = line.trim().split(/\s+/);
      processName = parts[parts.length - 1];
    }

    if (!processName || processName === "ARGS" || processName.startsWith("[")) {
      continue;
    }

    const previous = entries.get(processName) || 0;
    if (cpuPercent > previous) {
      entries.set(processName, cpuPercent);
    }
  }

  return Array.from(entries.entries())
    .map(([name, cpuPercent]) => ({ name, cpuPercent: Math.round(cpuPercent * 10) / 10 }))
    .sort((a, b) => b.cpuPercent - a.cpuPercent)
    .slice(0, 3);
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
