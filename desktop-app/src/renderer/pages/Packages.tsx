import { useEffect, useState, useMemo } from "react";
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

export default function Packages() {
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
  const [isFocusMode, setIsFocusMode] = useState(false);

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

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setIsFocusMode(false);
      }
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const enterFocusMode = async () => {
    setIsFocusMode(true);
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Fallback keeps in-app focus overlay even if fullscreen API fails
    }
  };

  const exitFocusMode = async () => {
    setIsFocusMode(false);
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      // Ignore fullscreen API failures
    }
  };


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
      <header className="bg-gradient-to-r from-gray-800 via-gray-800 to-primary-900/30 border-b border-gray-700/50 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-gray-100 to-primary-300 bg-clip-text text-transparent">
              Packages
            </h1>
            <p className="text-gray-400 mt-1 flex items-center gap-2">
              <span>Manage all packages on your Android device</span>
              {selectedDevice && (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full">
                  <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></span>
                  Connected
                </span>
              )}
            </p>
          </div>

          {selectedDevice && (
            <div className="flex items-center gap-6">
              {/* Quick Debloat Button */}
              {storageStats.recommendedCount > 0 && (
                <button
                  onClick={() => setShowQuickDebloat(true)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 rounded-xl font-medium transition-all shadow-lg shadow-green-500/30 hover:shadow-green-500/50 hover:scale-105"
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
                  <span>Quick Debloat</span>
                  <span className="px-2 py-0.5 bg-white/20 rounded-lg text-sm">{storageStats.recommendedCount}</span>
                </button>
              )}

              {activeTab === "packages" && (
                <button
                  onClick={isFocusMode ? exitFocusMode : enterFocusMode}
                  className="flex items-center gap-2 px-4 py-2.5 bg-gray-700/90 hover:bg-gray-600 rounded-xl font-medium transition-colors border border-gray-600"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d={
                        isFocusMode
                          ? "M9 9L4 4m0 0h5M4 4v5m11 0l5-5m0 0v5m0-5h-5m-6 11l-5 5m0 0h5m-5 0v-5m11 5l5 5m0 0v-5m0 5h-5"
                          : "M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5"
                      }
                    />
                  </svg>
                  {isFocusMode ? "Exit Full Screen" : "Full Screen"}
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
                <div className="flex items-center gap-2 mt-1.5 text-sm text-gray-400">
                  <span className="px-2.5 py-1 bg-gray-700/80 rounded-lg text-xs font-medium border border-gray-600/50">
                    {selectedDevice.brand}
                  </span>
                  <span className="text-gray-600">•</span>
                  <span className="flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    Android {getAndroidVersion(selectedDevice.android_sdk)}
                  </span>
                  <span className="text-gray-600">•</span>
                  <span className="flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                    {packages.length} packages
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Quick Debloat Modal */}
      {showQuickDebloat && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-2xl border border-gray-700/50 p-6 max-w-md w-full mx-4 shadow-2xl">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-4 bg-gradient-to-br from-green-500/30 to-emerald-500/30 rounded-2xl border border-green-500/20">
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
                <h3 className="text-2xl font-bold">Quick Debloat</h3>
                <p className="text-gray-400 text-sm">One-click safe cleanup</p>
              </div>
            </div>

            <div className="bg-gradient-to-br from-gray-700/50 to-gray-700/30 rounded-xl p-5 mb-5 border border-gray-600/30">
              <div className="flex justify-between items-center mb-4 pb-4 border-b border-gray-600/30">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  <span className="text-gray-300">Packages to remove</span>
                </div>
                <span className="text-2xl font-bold text-green-400">
                  {storageStats.recommendedCount}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                  </svg>
                  <span className="text-gray-300">Estimated space freed</span>
                </div>
                <span className="text-2xl font-bold text-green-400">
                  {formatSize(storageStats.potentialSavings)}
                </span>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl mb-6">
              <svg className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-blue-300/90">
                This will safely remove all packages marked as &quot;Recommended&quot; for removal. These packages are safe to remove and won&apos;t affect your device&apos;s core functionality.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowQuickDebloat(false)}
                className="flex-1 px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleQuickDebloat}
                className="flex-1 px-4 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 rounded-xl font-medium transition-all shadow-lg shadow-green-500/20 flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
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

      {/* Main content */}
      <div className={`flex-1 p-6 overflow-hidden ${isFocusMode ? "hidden" : ""}`}>
        {/* Package list */}
        <div className="h-full overflow-hidden flex flex-col gap-4">
          {selectedDevice ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-800/70 border border-gray-700 rounded-xl p-3">
                <div className="flex gap-1 bg-gray-900 rounded-lg p-1 border border-gray-700">
                  <button
                    onClick={() => setActiveTab("packages")}
                    className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      activeTab === "packages"
                        ? "bg-primary-600 text-white"
                        : "text-gray-300 hover:bg-gray-700"
                    }`}
                  >
                    Packages
                  </button>
                  <button
                    onClick={() => setActiveTab("backup")}
                    className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      activeTab === "backup"
                        ? "bg-primary-600 text-white"
                        : "text-gray-300 hover:bg-gray-700"
                    }`}
                  >
                    Backup
                  </button>
                </div>

                <div className="flex items-center gap-3 text-xs text-gray-300">
                  <span className="px-2.5 py-1 rounded bg-gray-900 border border-gray-700">
                    Total Actions: <span className="text-white">{stats?.total_actions || 0}</span>
                  </span>
                  <span className="px-2.5 py-1 rounded bg-red-500/10 border border-red-500/30 text-red-300">
                    Removed: {stats?.uninstall_count || 0}
                  </span>
                  <span className="px-2.5 py-1 rounded bg-green-500/10 border border-green-500/30 text-green-300">
                    Restored: {stats?.restore_count || 0}
                  </span>
                </div>
              </div>

              <div className="flex-1 overflow-hidden">
                {activeTab === "packages" ? (
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
                      userId={user?.id}
                    />
                  )
                ) : (
                  <div className="h-full overflow-y-auto pr-1">
                    <BackupPanel onRestorePackages={handleRestorePackages} />
                  </div>
                )}
              </div>
            </>
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
                  Connect and select your phone on Dashboard first, then manage packages here.
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

      {isFocusMode && selectedDevice && activeTab === "packages" && (
        <div className="fixed inset-0 z-[70] bg-gray-900 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800">
            <div>
              <h2 className="text-lg font-semibold">Packages - Full Screen</h2>
              <p className="text-xs text-gray-400">Focused mode with full filter controls</p>
            </div>
            <button
              onClick={exitFocusMode}
              className="px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm"
            >
              Exit
            </button>
          </div>
          <div className="flex-1 p-3 overflow-hidden">
            <PackageList
              onAction={handleAction}
              isLoading={actionLoading}
              onOpenPermissions={(pkg) => setPermissionPackage(pkg)}
              userId={user?.id}
            />
          </div>
        </div>
      )}
    </div>
  );
}
