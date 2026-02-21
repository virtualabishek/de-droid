import { useEffect, useState, useMemo } from "react";
import { DeviceSelector } from "../components/DeviceSelector";
import { PackageList } from "../components/PackageList";
import { BackupPanel } from "../components/BackupPanel";
import { DeviceIcon } from "../components/DeviceIcon";
import { PermissionManager } from "../components/PermissionManager";
import { useDeviceStore } from "../store/deviceStore";
import { useHistoryStore } from "../store/historyStore";
import { useAuthStore } from "../store/authStore";
import { useToastStore } from "../store/toastStore";

// Map SDK level to Android version
function getAndroidVersion(sdkLevel: number): string {
  const sdkToVersion: Record<number, string> = {
    34: "14",
    33: "13",
    32: "12L",
    31: "12",
    30: "11",
    29: "10",
    28: "9",
    27: "8.1",
    26: "8.0",
    25: "7.1",
    24: "7.0",
    23: "6.0",
    22: "5.1",
    21: "5.0",
    19: "4.4",
  };
  return sdkToVersion[sdkLevel] || `SDK ${sdkLevel}`;
}

// Map action names to ActionType enum values
function getActionType(
  action: string,
): "UNINSTALL" | "DISABLE" | "RESTORE" | "ENABLE" {
  switch (action) {
    case "uninstall":
      return "UNINSTALL";
    case "disable":
      return "DISABLE";
    case "restore":
      return "RESTORE";
    case "enable":
      return "ENABLE";
    default:
      return "UNINSTALL";
  }
}

// Estimate package size (in MB) - in real app, would get from ADB
function estimatePackageSize(packageName: string): number {
  if (
    packageName.includes("facebook") ||
    packageName.includes("google.android.apps")
  )
    return 150;
  if (packageName.includes("samsung") || packageName.includes("miui"))
    return 80;
  if (packageName.includes("game") || packageName.includes("play")) return 200;
  return Math.floor(20 + Math.random() * 60);
}

// Format bytes to human readable
function formatSize(mb: number): string {
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
}

// Stats Card Component
function StatsCard({
  icon,
  label,
  value,
  subValue,
  color,
  gradient,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  subValue?: string;
  color: string;
  gradient: string;
}) {
  return (
    <div className={`relative overflow-hidden rounded-xl border ${color} p-4`}>
      <div className={`absolute inset-0 opacity-10 ${gradient}`}></div>
      <div className="relative">
        <div className="flex items-center gap-3 mb-2">
          <div className={`p-2 rounded-lg ${gradient}`}>{icon}</div>
          <span className="text-sm text-gray-400">{label}</span>
        </div>
        <p className="text-2xl font-bold">{value}</p>
        {subValue && <p className="text-xs text-gray-500 mt-1">{subValue}</p>}
      </div>
    </div>
  );
}

// Circular Progress Component
function CircularProgress({
  percentage,
  size = 120,
  strokeWidth = 10,
  color = "#22c55e",
}: {
  percentage: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          stroke="currentColor"
          fill="transparent"
          className="text-gray-700"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          stroke={color}
          fill="transparent"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center flex-col">
        <span className="text-2xl font-bold">{percentage}%</span>
        <span className="text-xs text-gray-400">Clean</span>
      </div>
    </div>
  );
}

// Device Nickname Editor
function DeviceNicknameEditor({
  currentNickname,
  deviceModel,
  onSave,
}: {
  deviceId: string;
  currentNickname: string | null;
  deviceModel: string;
  onSave: (nickname: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [nickname, setNickname] = useState(currentNickname || "");

  const handleSave = () => {
    onSave(nickname || deviceModel);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder={deviceModel}
          className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm w-40"
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
        />
        <button
          onClick={handleSave}
          className="text-green-400 hover:text-green-300"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </button>
        <button
          onClick={() => setIsEditing(false)}
          className="text-gray-400 hover:text-gray-300"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setIsEditing(true)}
      className="flex items-center gap-2 group"
    >
      <span className="font-semibold text-lg">
        {currentNickname || deviceModel}
      </span>
      <svg
        className="w-4 h-4 text-gray-500 group-hover:text-primary-400 transition-colors"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
        />
      </svg>
    </button>
  );
}

export default function Dashboard() {
  const {
    selectedDevice,
    selectedUser,
    fetchPackages,
    isLoadingPackages,
    packages,
    clearSelection,
  } = useDeviceStore();
  const { recordAction, stats, fetchStats } = useHistoryStore();
  const { user } = useAuthStore();
  const toast = useToastStore();

  const [actionLoading, setActionLoading] = useState(false);
  const [notification, setNotification] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<"packages" | "backup">("packages");
  const [deviceNickname, setDeviceNickname] = useState<string | null>(null);
  const [showQuickDebloat, setShowQuickDebloat] = useState(false);
  const [permissionPackage, setPermissionPackage] = useState<string | null>(
    null,
  );

  // Fetch stats on mount
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    if (selectedDevice) {
      fetchPackages(true);
      loadDeviceNickname();
    }
  }, [selectedDevice, fetchPackages]);

  const loadDeviceNickname = async () => {
    if (!user?.id || !selectedDevice) return;
    try {
      const devices = await window.electronAPI.auth.getDevices(user.id);
      const saved = devices.find((d) => d.device_id === selectedDevice.adb_id);
      setDeviceNickname(saved?.nickname || null);
    } catch (e) {
      console.error("Failed to load device nickname:", e);
    }
  };

  const saveDeviceNickname = async (nickname: string) => {
    if (!user?.id || !selectedDevice) return;
    try {
      await window.electronAPI.auth.saveDevice(
        user.id,
        selectedDevice.adb_id,
        selectedDevice.model,
        selectedDevice.brand,
        nickname,
      );
      setDeviceNickname(nickname);
      showNotification("success", "Device nickname saved!");
    } catch (e) {
      console.error("Failed to save nickname:", e);
    }
  };

  // Calculate storage stats
  const storageStats = useMemo(() => {
    const bloatwarePackages = packages.filter(
      (p) => p.category?.toUpperCase() === "BLOATWARE" && p.state === "enabled",
    );
    const removedPackages = packages.filter(
      (p) => p.state === "uninstalled" || p.state === "disabled",
    );
    const recommendedPackages = packages.filter(
      (p) => p.removal === "RECOMMENDED" && p.state === "enabled",
    );

    const bloatwareSize = bloatwarePackages.reduce(
      (acc, p) => acc + estimatePackageSize(p.name),
      0,
    );
    const freedSpace = removedPackages.reduce(
      (acc, p) => acc + estimatePackageSize(p.name),
      0,
    );
    const potentialSavings = recommendedPackages.reduce(
      (acc, p) => acc + estimatePackageSize(p.name),
      0,
    );

    const totalBloat = bloatwareSize + freedSpace;
    const cleanPercentage =
      totalBloat > 0 ? Math.round((freedSpace / totalBloat) * 100) : 100;

    return {
      bloatwareSize,
      freedSpace,
      potentialSavings,
      cleanPercentage,
      bloatwareCount: bloatwarePackages.length,
      removedCount: removedPackages.length,
      recommendedCount: recommendedPackages.length,
    };
  }, [packages]);

  const showNotification = (
    type: "success" | "error" | "info",
    message: string,
  ) => {
    // Show inline notification
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);

    // Also show toast
    if (type === "success") {
      toast.success("Action Complete", message);
    } else if (type === "error") {
      toast.error("Action Failed", message);
    } else {
      toast.info("Info", message);
    }
  };

  const handleAction = async (
    action: "uninstall" | "restore" | "disable" | "enable",
    packageNames: string[],
  ) => {
    if (!selectedDevice) return;

    setActionLoading(true);
    try {
      let successCount = 0;
      let failCount = 0;

      for (const packageName of packageNames) {
        let success = false;
        let errorMessage: string | undefined;

        try {
          let result;
          switch (action) {
            case "uninstall":
              result = await window.electronAPI.adb.uninstallPackage(
                selectedDevice.adb_id,
                packageName,
                selectedUser,
                selectedDevice.android_sdk,
              );
              break;
            case "restore":
              result = await window.electronAPI.adb.restorePackage(
                selectedDevice.adb_id,
                packageName,
                selectedUser,
                selectedDevice.android_sdk,
              );
              break;
            case "disable":
              result = await window.electronAPI.adb.disablePackage(
                selectedDevice.adb_id,
                packageName,
                selectedUser,
              );
              break;
            case "enable":
              result = await window.electronAPI.adb.enablePackage(
                selectedDevice.adb_id,
                packageName,
                selectedUser,
              );
              break;
          }
          if (result?.success) {
            success = true;
            successCount++;
          } else {
            errorMessage = result?.message || "Operation failed";
            failCount++;
          }
        } catch (err) {
          errorMessage = err instanceof Error ? err.message : "Unknown error";
          failCount++;
        }

        recordAction({
          deviceId: selectedDevice.adb_id,
          deviceModel: selectedDevice.model,
          deviceBrand: selectedDevice.brand,
          packageName,
          action: getActionType(action),
          androidUser: selectedUser,
          success,
          errorMessage,
        });
      }

      await fetchPackages(true);
      await fetchStats();
      clearSelection();

      showNotification(
        failCount === 0 ? "success" : "error",
        `${action}: ${successCount} succeeded, ${failCount} failed`,
      );
    } finally {
      setActionLoading(false);
    }
  };

  // Quick debloat - remove all recommended packages
  const handleQuickDebloat = async () => {
    const recommendedPackages = packages.filter(
      (p) => p.removal === "RECOMMENDED" && p.state === "enabled",
    );

    if (recommendedPackages.length === 0) {
      showNotification("info", "No recommended packages to remove!");
      return;
    }

    setShowQuickDebloat(false);
    await handleAction(
      "uninstall",
      recommendedPackages.map((p) => p.name),
    );
  };

  const handleRestorePackages = async (packageNames: string[]) => {
    await handleAction("restore", packageNames);
  };

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Enhanced Header */}
      <header className="bg-gradient-to-r from-gray-800 via-gray-800 to-primary-900/20 border-b border-gray-700 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
              Dashboard
            </h1>
            <p className="text-gray-400 mt-1">
              Manage packages on your Android device
            </p>
          </div>

          {selectedDevice && (
            <div className="flex items-center gap-6">
              {/* Quick Debloat Button */}
              {storageStats.recommendedCount > 0 && (
                <button
                  onClick={() => setShowQuickDebloat(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 rounded-lg font-medium transition-all shadow-lg shadow-green-500/20"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                  Quick Debloat ({storageStats.recommendedCount})
                </button>
              )}

              {/* Device Preview Icon */}
              <DeviceIcon
                brand={selectedDevice.brand}
                model={selectedDevice.model}
                size="sm"
              />

              {/* Device Info */}
              <div className="text-right">
                <DeviceNicknameEditor
                  deviceId={selectedDevice.adb_id}
                  currentNickname={deviceNickname}
                  deviceModel={selectedDevice.model}
                  onSave={saveDeviceNickname}
                />
                <div className="flex items-center gap-2 mt-1 text-sm text-gray-400">
                  <span className="px-2 py-0.5 bg-gray-700 rounded text-xs">
                    {selectedDevice.brand}
                  </span>
                  <span>•</span>
                  <span>
                    Android {getAndroidVersion(selectedDevice.android_sdk)}
                  </span>
                  <span>•</span>
                  <span>{packages.length} packages</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Quick Debloat Modal */}
      {showQuickDebloat && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 max-w-md w-full mx-4 shadow-2xl">
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-green-500/20 rounded-full">
                <svg
                  className="w-8 h-8 text-green-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              </div>
              <div>
                <h3 className="text-xl font-bold">Quick Debloat</h3>
                <p className="text-gray-400 text-sm">One-click safe cleanup</p>
              </div>
            </div>

            <div className="bg-gray-700/50 rounded-lg p-4 mb-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-300">Packages to remove:</span>
                <span className="text-green-400 font-bold">
                  {storageStats.recommendedCount}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-300">Estimated space freed:</span>
                <span className="text-green-400 font-bold">
                  {formatSize(storageStats.potentialSavings)}
                </span>
              </div>
            </div>

            <p className="text-sm text-gray-400 mb-4">
              This will safely remove all packages marked as
              &quot;Recommended&quot; for removal. These are safe to remove and
              won&apos;t affect your device&apos;s functionality.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowQuickDebloat(false)}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleQuickDebloat}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg font-medium transition-colors"
              >
                Start Debloat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notification */}
      {notification && (
        <div
          className={`mx-6 mt-4 p-4 rounded-lg flex items-center justify-between transition-all ${
            notification.type === "success"
              ? "bg-green-500/20 border border-green-500/30 text-green-400"
              : notification.type === "error"
                ? "bg-red-500/20 border border-red-500/30 text-red-400"
                : "bg-blue-500/20 border border-blue-500/30 text-blue-400"
          }`}
        >
          <span>{notification.message}</span>
          <button onClick={() => setNotification(null)}>×</button>
        </div>
      )}

      {/* Stats Cards - Show when device is selected */}
      {selectedDevice && (
        <div className="px-6 pt-4">
          <div className="grid grid-cols-4 gap-4">
            <StatsCard
              icon={
                <svg
                  className="w-5 h-5 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              }
              label="Bloatware Found"
              value={storageStats.bloatwareCount}
              subValue={`~${formatSize(storageStats.bloatwareSize)} used`}
              color="border-red-500/30"
              gradient="bg-gradient-to-br from-red-500 to-orange-500"
            />
            <StatsCard
              icon={
                <svg
                  className="w-5 h-5 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              }
              label="Space Freed"
              value={formatSize(storageStats.freedSpace)}
              subValue={`${storageStats.removedCount} packages removed`}
              color="border-green-500/30"
              gradient="bg-gradient-to-br from-green-500 to-emerald-500"
            />
            <StatsCard
              icon={
                <svg
                  className="w-5 h-5 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                  />
                </svg>
              }
              label="Potential Savings"
              value={formatSize(storageStats.potentialSavings)}
              subValue={`${storageStats.recommendedCount} safe to remove`}
              color="border-yellow-500/30"
              gradient="bg-gradient-to-br from-yellow-500 to-amber-500"
            />
            <div className="relative overflow-hidden rounded-xl border border-primary-500/30 p-4 flex items-center justify-center">
              <div className="absolute inset-0 opacity-10 bg-gradient-to-br from-primary-500 to-purple-500"></div>
              <CircularProgress
                percentage={storageStats.cleanPercentage}
                color={
                  storageStats.cleanPercentage > 70
                    ? "#22c55e"
                    : storageStats.cleanPercentage > 40
                      ? "#eab308"
                      : "#ef4444"
                }
              />
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex gap-6 p-6 overflow-hidden">
        {/* Device selector sidebar */}
        <div className="w-80 flex-shrink-0 flex flex-col gap-4">
          <DeviceSelector />

          {/* Tab buttons */}
          {selectedDevice && (
            <div className="flex gap-1 bg-gray-800 rounded-lg p-1 border border-gray-700">
              <button
                onClick={() => setActiveTab("packages")}
                className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === "packages"
                    ? "bg-primary-600 text-white"
                    : "text-gray-300 hover:bg-gray-700"
                }`}
              >
                📦 Packages
              </button>
              <button
                onClick={() => setActiveTab("backup")}
                className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === "backup"
                    ? "bg-primary-600 text-white"
                    : "text-gray-300 hover:bg-gray-700"
                }`}
              >
                💾 Backup
              </button>
            </div>
          )}

          {/* Backup Panel */}
          {selectedDevice && activeTab === "backup" && (
            <BackupPanel onRestorePackages={handleRestorePackages} />
          )}

          {/* Quick Stats in Sidebar */}
          {selectedDevice && activeTab === "packages" && (
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
              <h3 className="text-sm font-medium text-gray-400 mb-3">
                Session Stats
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Total Actions:</span>
                  <span className="text-white font-medium">
                    {stats?.total_actions || 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Packages Removed:</span>
                  <span className="text-red-400 font-medium">
                    {stats?.uninstall_count || 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Packages Restored:</span>
                  <span className="text-green-400 font-medium">
                    {stats?.restore_count || 0}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Package list */}
        <div className="flex-1 overflow-hidden">
          {selectedDevice ? (
            activeTab === "packages" ? (
              isLoadingPackages && packages.length === 0 ? (
                <div className="h-full flex items-center justify-center bg-gray-800 rounded-lg border border-gray-700">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto mb-4"></div>
                    <p className="text-gray-400">Loading packages...</p>
                  </div>
                </div>
              ) : (
                <PackageList
                  onAction={handleAction}
                  isLoading={actionLoading}
                  onOpenPermissions={(pkg) => setPermissionPackage(pkg)}
                />
              )
            ) : (
              <div className="h-full flex items-center justify-center bg-gray-800 rounded-lg border border-gray-700">
                <div className="text-center">
                  <svg
                    className="w-16 h-16 mx-auto text-gray-600 mb-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
                    />
                  </svg>
                  <h3 className="text-xl font-medium text-gray-300 mb-2">
                    Backup & Restore
                  </h3>
                  <p className="text-gray-500">
                    Use the backup panel on the left to create and compare
                    backups
                  </p>
                </div>
              </div>
            )
          ) : (
            <div className="h-full flex items-center justify-center bg-gray-800 rounded-lg border border-gray-700">
              <div className="text-center max-w-md">
                <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-primary-500 to-purple-600 rounded-2xl flex items-center justify-center">
                  <svg
                    className="w-10 h-10 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
                    />
                  </svg>
                </div>
                <h3 className="text-2xl font-bold text-white mb-2">
                  Connect Your Device
                </h3>
                <p className="text-gray-400 mb-6">
                  Connect an Android device via USB or wireless ADB to start
                  managing packages
                </p>
                <div className="flex flex-wrap gap-2 justify-center text-sm">
                  <span className="px-3 py-1 bg-gray-700 rounded-full text-gray-300">
                    USB Debugging
                  </span>
                  <span className="px-3 py-1 bg-gray-700 rounded-full text-gray-300">
                    Wireless ADB
                  </span>
                  <span className="px-3 py-1 bg-gray-700 rounded-full text-gray-300">
                    QR Pairing
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Permission Manager Modal */}
      {permissionPackage && (
        <PermissionManager
          packageName={permissionPackage}
          onClose={() => setPermissionPackage(null)}
        />
      )}
    </div>
  );
}
