/**
 * Permission Manager - Handles Android app permissions via ADB
 */
import { executeAdbCommand } from "./index";

// Dangerous permissions that users should pay attention to
export const DANGEROUS_PERMISSIONS: Record<
  string,
  { category: string; description: string }
> = {
  // Location
  "android.permission.ACCESS_FINE_LOCATION": {
    category: "Location",
    description: "Access precise location (GPS)",
  },
  "android.permission.ACCESS_COARSE_LOCATION": {
    category: "Location",
    description: "Access approximate location",
  },
  "android.permission.ACCESS_BACKGROUND_LOCATION": {
    category: "Location",
    description: "Access location in background",
  },

  // Camera
  "android.permission.CAMERA": {
    category: "Camera",
    description: "Take pictures and record video",
  },

  // Microphone
  "android.permission.RECORD_AUDIO": {
    category: "Microphone",
    description: "Record audio",
  },

  // Contacts
  "android.permission.READ_CONTACTS": {
    category: "Contacts",
    description: "Read your contacts",
  },
  "android.permission.WRITE_CONTACTS": {
    category: "Contacts",
    description: "Modify your contacts",
  },
  "android.permission.GET_ACCOUNTS": {
    category: "Contacts",
    description: "Find accounts on device",
  },

  // Phone
  "android.permission.READ_PHONE_STATE": {
    category: "Phone",
    description: "Read phone status and identity",
  },
  "android.permission.READ_PHONE_NUMBERS": {
    category: "Phone",
    description: "Read phone numbers",
  },
  "android.permission.CALL_PHONE": {
    category: "Phone",
    description: "Directly call phone numbers",
  },
  "android.permission.READ_CALL_LOG": {
    category: "Phone",
    description: "Read call log",
  },
  "android.permission.WRITE_CALL_LOG": {
    category: "Phone",
    description: "Write call log",
  },
  "android.permission.ANSWER_PHONE_CALLS": {
    category: "Phone",
    description: "Answer incoming calls",
  },

  // SMS
  "android.permission.SEND_SMS": {
    category: "SMS",
    description: "Send SMS messages",
  },
  "android.permission.RECEIVE_SMS": {
    category: "SMS",
    description: "Receive SMS messages",
  },
  "android.permission.READ_SMS": {
    category: "SMS",
    description: "Read SMS messages",
  },
  "android.permission.RECEIVE_MMS": {
    category: "SMS",
    description: "Receive MMS messages",
  },

  // Storage
  "android.permission.READ_EXTERNAL_STORAGE": {
    category: "Storage",
    description: "Read external storage",
  },
  "android.permission.WRITE_EXTERNAL_STORAGE": {
    category: "Storage",
    description: "Write to external storage",
  },
  "android.permission.READ_MEDIA_IMAGES": {
    category: "Storage",
    description: "Read photos and images",
  },
  "android.permission.READ_MEDIA_VIDEO": {
    category: "Storage",
    description: "Read videos",
  },
  "android.permission.READ_MEDIA_AUDIO": {
    category: "Storage",
    description: "Read audio files",
  },
  "android.permission.MANAGE_EXTERNAL_STORAGE": {
    category: "Storage",
    description: "Access all files",
  },

  // Calendar
  "android.permission.READ_CALENDAR": {
    category: "Calendar",
    description: "Read calendar events",
  },
  "android.permission.WRITE_CALENDAR": {
    category: "Calendar",
    description: "Modify calendar events",
  },

  // Sensors
  "android.permission.BODY_SENSORS": {
    category: "Sensors",
    description: "Access body sensors",
  },
  "android.permission.ACTIVITY_RECOGNITION": {
    category: "Sensors",
    description: "Recognize physical activity",
  },

  // Bluetooth
  "android.permission.BLUETOOTH_CONNECT": {
    category: "Bluetooth",
    description: "Connect to Bluetooth devices",
  },
  "android.permission.BLUETOOTH_SCAN": {
    category: "Bluetooth",
    description: "Scan for Bluetooth devices",
  },

  // Notifications
  "android.permission.POST_NOTIFICATIONS": {
    category: "Notifications",
    description: "Post notifications",
  },
};

// Mapping from Android permissions to AppOps operation names
// AppOps uses UPPER_CASE names without android: prefix
// Used as fallback when pm grant/revoke fails due to SecurityException
export const PERMISSION_TO_APPOP: Record<string, string> = {
  // Location
  "android.permission.ACCESS_FINE_LOCATION": "FINE_LOCATION",
  "android.permission.ACCESS_COARSE_LOCATION": "COARSE_LOCATION",
  "android.permission.ACCESS_BACKGROUND_LOCATION": "ACCESS_BACKGROUND_LOCATION",

  // Camera & Microphone
  "android.permission.CAMERA": "CAMERA",
  "android.permission.RECORD_AUDIO": "RECORD_AUDIO",

  // Contacts
  "android.permission.READ_CONTACTS": "READ_CONTACTS",
  "android.permission.WRITE_CONTACTS": "WRITE_CONTACTS",
  "android.permission.GET_ACCOUNTS": "GET_ACCOUNTS",

  // Phone
  "android.permission.READ_PHONE_STATE": "READ_PHONE_STATE",
  "android.permission.READ_PHONE_NUMBERS": "READ_PHONE_NUMBERS",
  "android.permission.CALL_PHONE": "CALL_PHONE",
  "android.permission.READ_CALL_LOG": "READ_CALL_LOG",
  "android.permission.WRITE_CALL_LOG": "WRITE_CALL_LOG",
  "android.permission.ANSWER_PHONE_CALLS": "ANSWER_PHONE_CALLS",

  // SMS
  "android.permission.SEND_SMS": "SEND_SMS",
  "android.permission.RECEIVE_SMS": "RECEIVE_SMS",
  "android.permission.READ_SMS": "READ_SMS",
  "android.permission.RECEIVE_MMS": "RECEIVE_MMS",

  // Storage
  "android.permission.READ_EXTERNAL_STORAGE": "READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE": "WRITE_EXTERNAL_STORAGE",
  "android.permission.READ_MEDIA_IMAGES": "READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO": "READ_MEDIA_VIDEO",
  "android.permission.READ_MEDIA_AUDIO": "READ_MEDIA_AUDIO",
  "android.permission.MANAGE_EXTERNAL_STORAGE": "MANAGE_EXTERNAL_STORAGE",

  // Calendar
  "android.permission.READ_CALENDAR": "READ_CALENDAR",
  "android.permission.WRITE_CALENDAR": "WRITE_CALENDAR",

  // Sensors
  "android.permission.BODY_SENSORS": "BODY_SENSORS",
  "android.permission.ACTIVITY_RECOGNITION": "ACTIVITY_RECOGNITION",

  // Bluetooth
  "android.permission.BLUETOOTH_CONNECT": "BLUETOOTH_CONNECT",
  "android.permission.BLUETOOTH_SCAN": "BLUETOOTH_SCAN",

  // Notifications
  "android.permission.POST_NOTIFICATIONS": "POST_NOTIFICATION",
};

// Category icons for UI
export const PERMISSION_CATEGORIES: Record<
  string,
  { icon: string; color: string }
> = {
  Location: { icon: "📍", color: "text-red-400" },
  Camera: { icon: "📷", color: "text-purple-400" },
  Microphone: { icon: "🎤", color: "text-orange-400" },
  Contacts: { icon: "👥", color: "text-blue-400" },
  Phone: { icon: "📞", color: "text-green-400" },
  SMS: { icon: "💬", color: "text-cyan-400" },
  Storage: { icon: "📁", color: "text-yellow-400" },
  Calendar: { icon: "📅", color: "text-pink-400" },
  Sensors: { icon: "⌚", color: "text-indigo-400" },
  Bluetooth: { icon: "📶", color: "text-blue-300" },
  Notifications: { icon: "🔔", color: "text-amber-400" },
  Other: { icon: "⚙️", color: "text-gray-400" },
};

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

interface TogglePermissionResult {
  success: boolean;
  error?: string;
  message?: string;
}

function didCommandFail(result: {
  success: boolean;
  output?: string;
  error?: string;
}): boolean {
  if (!result.success) return true;

  const combined = `${result.output || ""}\n${result.error || ""}`.toLowerCase();
  if (!combined.trim()) return false;

  return (
    combined.includes("securityexception") ||
    combined.includes("unknown package") ||
    combined.includes("not a changeable permission") ||
    combined.includes("operation not allowed") ||
    combined.includes("unknown operation") ||
    combined.includes("exception:") ||
    combined.includes("error:")
  );
}

function isAppOpsAllowed(mode: string | null): boolean {
  if (!mode) return false;
  const normalizedMode = mode.toLowerCase();
  return normalizedMode === "allow" || normalizedMode === "foreground";
}

async function setAppOpsMode(
  deviceId: string,
  packageName: string,
  appOp: string,
  mode: "allow" | "deny",
  userId: number,
): Promise<boolean> {
  const withUser = await executeAdbCommand(
    `-s ${deviceId} shell appops set --user ${userId} ${packageName} ${appOp} ${mode}`,
  );
  if (!didCommandFail(withUser)) {
    return true;
  }

  const withoutUser = await executeAdbCommand(
    `-s ${deviceId} shell appops set ${packageName} ${appOp} ${mode}`,
  );
  return !didCommandFail(withoutUser);
}

/**
 * Get all permissions for a package
 */
export async function getPackagePermissions(
  deviceId: string,
  packageName: string,
  userId = 0,
): Promise<PermissionResult> {
  const result = await executeAdbCommand(
    `-s ${deviceId} shell dumpsys package ${packageName}`,
  );

  if (!result.success) {
    throw new Error(result.error || "Failed to get package permissions");
  }

  const permissions = parsePermissions(result.output, packageName);
  const appOpsModes = await getAppOpsModes(deviceId, packageName, userId);
  const effectivePermissions = permissions.map((permission) => {
    if (permission.type !== "runtime") {
      return permission;
    }

    const appOp = PERMISSION_TO_APPOP[permission.name];
    if (!appOp) {
      return permission;
    }

    const mode = appOpsModes[appOp];
    if (isAppOpsBlocking(mode)) {
      return { ...permission, granted: false };
    }

    return permission;
  });
  const dangerous = effectivePermissions.filter((p) => p.isDangerous);

  return {
    packageName,
    permissions: effectivePermissions,
    dangerousCount: dangerous.length,
    grantedDangerousCount: dangerous.filter((p) => p.granted).length,
    totalCount: effectivePermissions.length,
  };
}

/**
 * Grant a runtime permission to a package
 * Uses pm grant first, falls back to appops if that fails (common on non-rooted devices)
 */
export async function grantPermission(
  deviceId: string,
  packageName: string,
  permission: string,
  userId = 0,
): Promise<TogglePermissionResult> {
  let usedAppOpsFallback = false;

  // Try pm grant first
  const result = await executeAdbCommand(
    `-s ${deviceId} shell pm grant --user ${userId} ${packageName} ${permission}`,
  );

  // If pm grant succeeded, also reset appops to allow
  if (!didCommandFail(result)) {
    const appOp = PERMISSION_TO_APPOP[permission];
    if (appOp) {
      await setAppOpsMode(deviceId, packageName, appOp, "allow", userId);
    }
  } else {
    // If pm grant failed (SecurityException), try appops as fallback
    const appOp = PERMISSION_TO_APPOP[permission];
    if (appOp) {
      usedAppOpsFallback = true;
      console.log(
        `[Permissions] pm grant failed, trying appops for ${permission}`,
      );
      const appOpsSuccess = await setAppOpsMode(
        deviceId,
        packageName,
        appOp,
        "allow",
        userId,
      );

      if (!appOpsSuccess) {
        return {
          success: false,
          error: `Permission grant not supported on this device. Try granting from device Settings > Apps > ${packageName} > Permissions.`,
        };
      }
    } else {
      return {
        success: false,
        error:
          result.error ||
          "Failed to grant permission. This permission may not support runtime granting.",
      };
    }
  }

  const state = await getEffectivePermissionState(
    deviceId,
    packageName,
    permission,
    userId,
  );

  if (state.effectiveGranted) {
    return {
      success: true,
      message: usedAppOpsFallback
        ? "Permission enabled via AppOps fallback."
        : "Permission granted successfully.",
    };
  }

  return {
    success: false,
    error: `Permission state could not be verified after grant. Android may have blocked this change. Try granting from Settings > Apps > ${packageName} > Permissions.`,
  };
}

/**
 * Revoke a runtime permission from a package
 * Uses pm revoke first, falls back to appops if that fails (common on non-rooted devices)
 */
export async function revokePermission(
  deviceId: string,
  packageName: string,
  permission: string,
  userId = 0,
): Promise<TogglePermissionResult> {
  let usedAppOpsFallback = false;

  // First try the standard pm revoke command
  const result = await executeAdbCommand(
    `-s ${deviceId} shell pm revoke --user ${userId} ${packageName} ${permission}`,
  );

  if (didCommandFail(result)) {
    // If pm revoke failed (likely SecurityException), try appops as fallback
    // appops blocks the app from using the permission at runtime
    const appOp = PERMISSION_TO_APPOP[permission];
    if (appOp) {
      usedAppOpsFallback = true;
      console.log(
        `[Permissions] pm revoke failed, trying appops for ${permission}`,
      );
      const appOpsSuccess = await setAppOpsMode(
        deviceId,
        packageName,
        appOp,
        "deny",
        userId,
      );

      if (!appOpsSuccess) {
        return {
          success: false,
          error: `Permission revocation not supported on this device. Try revoking from device Settings > Apps > ${packageName} > Permissions.`,
        };
      }
    } else {
      return {
        success: false,
        error:
          result.error ||
          "Failed to revoke permission. This permission may not support runtime revocation.",
      };
    }
  }

  const state = await getEffectivePermissionState(
    deviceId,
    packageName,
    permission,
    userId,
  );

  if (!state.effectiveGranted) {
    return {
      success: true,
      message: usedAppOpsFallback
        ? "Permission blocked via AppOps fallback."
        : "Permission revoked successfully.",
    };
  }

  return {
    success: false,
    error: `Permission still appears active after revoke. Android may enforce this permission for this app/version. Try revoking from Settings > Apps > ${packageName} > Permissions.`,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseRuntimeGranted(
  dumpsysOutput: string,
  permission: string,
): boolean | null {
  const pattern = new RegExp(
    `${escapeRegex(permission)}:\\s*granted=(true|false)`,
    "i",
  );
  const match = dumpsysOutput.match(pattern);
  if (!match) return null;
  return match[1].toLowerCase() === "true";
}

function parseAppOpMode(appOpsOutput: string, appOp: string): string | null {
  const opPattern = new RegExp(`${escapeRegex(appOp)}:\\s*([a-z_]+)`, "i");
  const opMatch = appOpsOutput.match(opPattern);
  if (opMatch?.[1]) return opMatch[1].toLowerCase();

  const modePattern = /mode=([a-z_]+)/i;
  const modeMatch = appOpsOutput.match(modePattern);
  if (modeMatch?.[1]) return modeMatch[1].toLowerCase();

  return null;
}

function isAppOpsBlocking(mode: string | null): boolean {
  if (!mode) return false;
  return ["deny", "ignore", "errored"].includes(mode.toLowerCase());
}

async function getEffectivePermissionState(
  deviceId: string,
  packageName: string,
  permission: string,
  userId: number,
): Promise<{ effectiveGranted: boolean }> {
  const dumpsysResult = await executeAdbCommand(
    `-s ${deviceId} shell dumpsys package ${packageName}`,
  );

  const runtimeGranted = dumpsysResult.success
    ? parseRuntimeGranted(dumpsysResult.output, permission)
    : null;

  const appOp = PERMISSION_TO_APPOP[permission];
  let appOpMode: string | null = null;

  if (appOp) {
    const appOpsResultWithUser = await executeAdbCommand(
      `-s ${deviceId} shell appops get --user ${userId} ${packageName} ${appOp}`,
    );
    if (!didCommandFail(appOpsResultWithUser)) {
      appOpMode = parseAppOpMode(appOpsResultWithUser.output, appOp);
    } else {
      const appOpsResultWithoutUser = await executeAdbCommand(
        `-s ${deviceId} shell appops get ${packageName} ${appOp}`,
      );
      if (!didCommandFail(appOpsResultWithoutUser)) {
        appOpMode = parseAppOpMode(appOpsResultWithoutUser.output, appOp);
      }
    }
  }

  if (appOpMode && appOpMode !== "default") {
    return { effectiveGranted: isAppOpsAllowed(appOpMode) };
  }

  if (isAppOpsBlocking(appOpMode)) {
    return { effectiveGranted: false };
  }

  if (runtimeGranted !== null) {
    return { effectiveGranted: runtimeGranted };
  }

  if (appOpMode) {
    return { effectiveGranted: appOpMode === "allow" };
  }

  return { effectiveGranted: false };
}

async function getAppOpsModes(
  deviceId: string,
  packageName: string,
  userId: number,
): Promise<Record<string, string>> {
  const withUserResult = await executeAdbCommand(
    `-s ${deviceId} shell appops get --user ${userId} ${packageName}`,
  );

  let output = withUserResult.output;
  if (didCommandFail(withUserResult) || !output) {
    const withoutUserResult = await executeAdbCommand(
      `-s ${deviceId} shell appops get ${packageName}`,
    );
    if (didCommandFail(withoutUserResult) || !withoutUserResult.output) {
      return {};
    }
    output = withoutUserResult.output;
  }

  if (!output) {
    return {};
  }

  const modes: Record<string, string> = {};
  const lines = output.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^([A-Z0-9_]+):\s*([a-z_]+)/i);
    if (!match) continue;

    const appOp = match[1].toUpperCase();
    const mode = match[2].toLowerCase();
    modes[appOp] = mode;
  }

  return modes;
}

/**
 * Parse permissions from dumpsys output
 */
function parsePermissions(
  dumpsysOutput: string,
  packageName: string,
): Permission[] {
  const permissions: Permission[] = [];
  const seen = new Set<string>();

  const lines = dumpsysOutput.split("\n");
  let inRuntimeSection = false;
  let inInstallSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect sections
    if (trimmed.includes("runtime permissions:")) {
      inRuntimeSection = true;
      inInstallSection = false;
      continue;
    }
    if (trimmed.includes("install permissions:")) {
      inInstallSection = true;
      inRuntimeSection = false;
      continue;
    }
    if (trimmed.startsWith("User ") && !trimmed.includes("permission")) {
      inRuntimeSection = false;
      inInstallSection = false;
      continue;
    }

    // Parse runtime permissions (format: android.permission.XXX: granted=true)
    if (inRuntimeSection && trimmed.includes("android.permission.")) {
      const match = trimmed.match(
        /(android\.permission\.[A-Z_]+):\s*granted=(\w+)/,
      );
      if (match) {
        const permName = match[1];
        if (!seen.has(permName)) {
          seen.add(permName);
          const dangerousInfo = DANGEROUS_PERMISSIONS[permName];
          permissions.push({
            name: permName,
            granted: match[2].toLowerCase() === "true",
            category: dangerousInfo?.category || "Other",
            description:
              dangerousInfo?.description || formatPermissionName(permName),
            isDangerous: !!dangerousInfo,
            type: "runtime",
          });
        }
      }
    }

    // Parse install permissions
    if (inInstallSection && trimmed.startsWith("android.permission.")) {
      const permName = trimmed.split(":")[0].trim();
      if (!seen.has(permName)) {
        seen.add(permName);
        const dangerousInfo = DANGEROUS_PERMISSIONS[permName];
        permissions.push({
          name: permName,
          granted: true, // Install permissions are always granted
          category: dangerousInfo?.category || "Other",
          description:
            dangerousInfo?.description || formatPermissionName(permName),
          isDangerous: !!dangerousInfo,
          type: "install",
        });
      }
    }
  }

  // Sort: dangerous first, then by category
  return permissions.sort((a, b) => {
    if (a.isDangerous !== b.isDangerous) return a.isDangerous ? -1 : 1;
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.name.localeCompare(b.name);
  });
}

/**
 * Format permission name for display
 */
function formatPermissionName(permission: string): string {
  return permission
    .replace("android.permission.", "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
