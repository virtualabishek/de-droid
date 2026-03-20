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
