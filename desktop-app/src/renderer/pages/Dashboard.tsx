import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DeviceSelector } from "../components/DeviceSelector";
import { DeviceIcon } from "../components/DeviceIcon";
import { useDeviceStore } from "../store/deviceStore";
import { useHistoryStore } from "../store/historyStore";

const DASHBOARD_CONNECTION_GUIDE_SEEN_KEY = "de-droid.dashboard.connection-guide.seen";

type LiveHealth = Awaited<
  ReturnType<typeof window.electronAPI.adb.getDeviceHealthSnapshot>
>;
type ConnectionDiagnostics = Awaited<
  ReturnType<typeof window.electronAPI.adb.runConnectionDiagnostics>
>;

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

function formatSize(mb: number): string {
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
}

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

function InfoCard({
  title,
  value,
  subtitle,
  icon,
  gradient,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  gradient: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-gray-700/70 bg-gradient-to-br from-gray-800 to-gray-900 p-5 shadow-lg shadow-black/20">
      <div className={`absolute inset-0 opacity-15 ${gradient}`} />
      <div className="relative">
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-300">{title}</p>
          <div className={`p-2 rounded-lg ${gradient}`}>{icon}</div>
        </div>
        <p className="text-3xl font-bold mt-2 tracking-tight">{value}</p>
        {subtitle && <p className="text-xs text-gray-400 mt-2">{subtitle}</p>}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const {
    selectedDevice,
    selectedUser,
    packages,
    fetchPackages,
    isLoadingPackages,
  } = useDeviceStore();
  const { stats, fetchStats } = useHistoryStore();
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [liveHealth, setLiveHealth] = useState<LiveHealth | null>(null);
  const [isHealthLoading, setIsHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [connectionGuideSeen, setConnectionGuideSeen] = useState(false);
  const [guideTab, setGuideTab] = useState<"usb" | "wireless" | "advanced">("usb");
  const [isRunningConnectionDiagnostics, setIsRunningConnectionDiagnostics] =
    useState(false);
  const [connectionDiagnostics, setConnectionDiagnostics] =
    useState<ConnectionDiagnostics | null>(null);
  const [connectionGuideError, setConnectionGuideError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setConnectionGuideSeen(
      localStorage.getItem(DASHBOARD_CONNECTION_GUIDE_SEEN_KEY) === "true",
    );
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    if (!selectedDevice) {
      setLastSyncedAt(null);
      setLiveHealth(null);
      return;
    }

    localStorage.setItem(DASHBOARD_CONNECTION_GUIDE_SEEN_KEY, "true");
    setConnectionGuideSeen(true);

    fetchPackages(true).then(() => setLastSyncedAt(new Date()));
  }, [selectedDevice, selectedUser, fetchPackages]);

  const runConnectionDiagnostics = async () => {
    setIsRunningConnectionDiagnostics(true);
    setConnectionGuideError(null);

    try {
      const result = await window.electronAPI.adb.runConnectionDiagnostics();
      setConnectionDiagnostics(result);
      setGuideTab("advanced");
    } catch (error) {
      setConnectionGuideError(
        error instanceof Error ? error.message : "Failed to run connection diagnostics",
      );
    } finally {
      setIsRunningConnectionDiagnostics(false);
    }
  };

  useEffect(() => {
    if (!selectedDevice) return;

    let disposed = false;

    if (!window.electronAPI?.adb?.getDeviceHealthSnapshot) {
      setHealthError(
        "Live health API not loaded. Restart the Electron app to load new IPC/preload changes.",
      );
      setLiveHealth(null);
      return;
    }

    const fetchLiveHealth = async () => {
      try {
        setIsHealthLoading(true);
        setHealthError(null);
        const snapshot = await window.electronAPI.adb.getDeviceHealthSnapshot(
          selectedDevice.adb_id,
        );
        if (!disposed) {
          setLiveHealth(snapshot);
        }
      } catch (error) {
        if (!disposed) {
          setLiveHealth(null);
          setHealthError(
            error instanceof Error
              ? error.message
              : "Failed to fetch live health data",
          );
        }
      } finally {
        if (!disposed) {
          setIsHealthLoading(false);
        }
      }
    };

    fetchLiveHealth();
    const timer = window.setInterval(fetchLiveHealth, 15000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [selectedDevice]);

  const packageSummary = useMemo(() => {
    const enabled = packages.filter((pkg) => pkg.state === "enabled").length;
    const disabled = packages.filter((pkg) => pkg.state === "disabled").length;
    const uninstalled = packages.filter(
      (pkg) => pkg.state === "uninstalled",
    ).length;
    const recommended = packages.filter(
      (pkg) => pkg.removal === "RECOMMENDED" && pkg.state === "enabled",
    ).length;

    return {
      total: packages.length,
      enabled,
      disabled,
      uninstalled,
      recommended,
    };
  }, [packages]);

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

    return {
      bloatwareSize: bloatwarePackages.reduce(
        (acc, p) => acc + estimatePackageSize(p.name),
        0,
      ),
      freedSpace: removedPackages.reduce(
        (acc, p) => acc + estimatePackageSize(p.name),
        0,
      ),
      potentialSavings: recommendedPackages.reduce(
        (acc, p) => acc + estimatePackageSize(p.name),
        0,
      ),
      bloatwareCount: bloatwarePackages.length,
      removedCount: removedPackages.length,
      recommendedCount: recommendedPackages.length,
    };
  }, [packages]);

  const cleanScore = useMemo(() => {
    const total = storageStats.bloatwareSize + storageStats.freedSpace;
    if (total <= 0) return 100;
    return Math.max(0, Math.min(100, Math.round((storageStats.freedSpace / total) * 100)));
  }, [storageStats.bloatwareSize, storageStats.freedSpace]);

  const modelSummary = useMemo(() => {
    const scored = packages.filter(
      (pkg) => typeof pkg.modelConfidence === "number" || !!pkg.modelLabel,
    );
    const unsafe = scored.filter((pkg) => pkg.modelLabel === "UNSAFE").length;
    const expert = scored.filter((pkg) => pkg.modelLabel === "EXPERT").length;
    const highConfidence = scored.filter(
      (pkg) => typeof pkg.modelConfidence === "number" && pkg.modelConfidence >= 0.8,
    ).length;

    return {
      scored: scored.length,
      unsafe,
      expert,
      highConfidence,
    };
  }, [packages]);

  const memoryUsagePercent = useMemo(() => {
    if (!liveHealth?.memory.totalMb || !liveHealth?.memory.usedMb) return undefined;
    const usage = (liveHealth.memory.usedMb / liveHealth.memory.totalMb) * 100;
    return Math.round(usage);
  }, [liveHealth]);

  const storageUsagePercent = useMemo(() => {
    if (liveHealth?.storage.usedPercent !== undefined) {
      return Math.round(liveHealth.storage.usedPercent);
    }

    if (!liveHealth?.storage.totalGb || !liveHealth?.storage.usedGb) return undefined;
    const usage = (liveHealth.storage.usedGb / liveHealth.storage.totalGb) * 100;
    return Math.round(usage);
  }, [liveHealth]);

  return (
    <div className="h-full flex flex-col bg-gray-900">
      <header className="bg-gradient-to-r from-gray-800 via-gray-800 to-primary-900/30 border-b border-gray-700/50 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-gray-100 to-primary-300 bg-clip-text text-transparent">
              Dashboard
            </h1>
            <p className="text-gray-400 mt-1 flex items-center gap-2">
              Device overview and system details
              {selectedDevice && (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full border border-green-500/30">
                  <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></span>
                  Connected
                </span>
              )}
            </p>
          </div>

          {selectedDevice && (
            <div className="flex items-center gap-4">
              <DeviceIcon
                brand={selectedDevice.brand}
                model={selectedDevice.model}
                size="sm"
              />
              <div className="text-right">
                <p className="font-semibold">{selectedDevice.model}</p>
                <p className="text-sm text-gray-400">{selectedDevice.brand}</p>
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 flex gap-6 p-6 overflow-hidden">
        <div className="w-80 flex-shrink-0 flex flex-col gap-4">
          <DeviceSelector />

          <div className="bg-gradient-to-br from-gray-800 to-gray-800/80 rounded-xl border border-gray-700/70 p-4 shadow-lg shadow-black/20">
            <h3 className="text-sm font-medium text-gray-300 mb-3">Connection</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Status:</span>
                <span
                  className={selectedDevice ? "text-green-400" : "text-yellow-400"}
                >
                  {selectedDevice ? "Connected" : "Waiting"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Android User:</span>
                <span className="text-white">{selectedUser}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Last Sync:</span>
                <span className="text-white text-xs">
                  {lastSyncedAt ? lastSyncedAt.toLocaleTimeString() : "-"}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-gray-800 to-primary-900/20 rounded-xl border border-gray-700/70 p-4 shadow-lg shadow-black/20">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-200">Live Device Health</h3>
              <span className="text-[11px] text-gray-400">
                {isHealthLoading
                  ? "Updating..."
                  : liveHealth?.collectedAt
                    ? new Date(liveHealth.collectedAt).toLocaleTimeString()
                    : "-"}
              </span>
            </div>
            <div className="space-y-2 text-sm">
              {healthError ? (
                <p className="text-[11px] text-yellow-400/90 pb-1">{healthError}</p>
              ) : null}
              <div className="flex justify-between gap-3">
                <span className="text-gray-400">Battery</span>
                <span className="text-white text-right">
                  {liveHealth?.battery.levelPercent !== undefined
                    ? `${liveHealth.battery.levelPercent}% (${liveHealth.battery.status})`
                    : "-"}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-gray-400">Charging</span>
                <span
                  className={
                    liveHealth?.battery.charging
                      ? "text-green-400"
                      : "text-yellow-400"
                  }
                >
                  {liveHealth?.battery.charging ? "Yes" : "No"}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-gray-400">Temperature</span>
                <span className="text-white">
                  {liveHealth?.battery.temperatureC !== undefined
                    ? `${liveHealth.battery.temperatureC}°C`
                    : "-"}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-gray-400">RAM</span>
                <span className="text-white text-right">
                  {liveHealth?.memory.usedMb !== undefined &&
                  liveHealth?.memory.totalMb !== undefined
                    ? `${liveHealth.memory.usedMb.toFixed(0)} / ${liveHealth.memory.totalMb.toFixed(0)} MB${
                        memoryUsagePercent !== undefined ? ` (${memoryUsagePercent}%)` : ""
                      }`
                    : "-"}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-gray-400">Storage</span>
                <span className="text-white text-right">
                  {liveHealth?.storage.usedGb !== undefined &&
                  liveHealth?.storage.totalGb !== undefined
                    ? `${liveHealth.storage.usedGb.toFixed(2)} / ${liveHealth.storage.totalGb.toFixed(2)} GB${
                        storageUsagePercent !== undefined ? ` (${storageUsagePercent}%)` : ""
                      }`
                    : "-"}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-gray-800 to-purple-900/20 rounded-xl border border-gray-700/70 p-4 shadow-lg shadow-black/20">
            <h3 className="text-sm font-medium text-gray-200 mb-3">Performance Snapshot</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-gray-400">CPU Load</span>
                <span className="text-white">
                  {liveHealth?.performance.cpuLoadPercent !== undefined
                    ? `${liveHealth.performance.cpuLoadPercent.toFixed(1)}%`
                    : "-"}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-gray-400">Thermal</span>
                <span
                  className={
                    liveHealth?.performance.thermalWarning
                      ? "text-red-400"
                      : "text-green-400"
                  }
                >
                  {liveHealth?.performance.thermalStatus || "Unknown"}
                </span>
              </div>
              <div className="pt-2 border-t border-gray-700/60">
                <p className="text-xs text-gray-400 mb-2">Top CPU Apps</p>
                <div className="space-y-1.5">
                  {(liveHealth?.performance.topApps || []).slice(0, 3).map((app) => (
                    <div key={app.name} className="flex justify-between gap-3 text-xs">
                      <span className="text-gray-300 truncate">{app.name}</span>
                      <span className="text-purple-300">{app.cpuPercent.toFixed(1)}%</span>
                    </div>
                  ))}
                  {(!liveHealth || liveHealth.performance.topApps.length === 0) && (
                    <p className="text-xs text-gray-500">No active process data</p>
                  )}
                </div>
              </div>
              {liveHealth?.errors?.length ? (
                <p className="text-[11px] text-yellow-400/90 pt-1">
                  Partial data: {liveHealth.errors[0]}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {selectedDevice ? (
            <div className="space-y-6 pr-1">
              <div className="grid grid-cols-4 gap-4">
                <InfoCard
                  title="Bloatware Found"
                  value={isLoadingPackages ? "..." : storageStats.bloatwareCount}
                  icon={
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  }
                  gradient="bg-gradient-to-br from-red-500 to-orange-500"
                  subtitle={
                    isLoadingPackages
                      ? "Calculating..."
                      : `~${formatSize(storageStats.bloatwareSize)} used`
                  }
                />
                <InfoCard
                  title="Space Freed"
                  value={isLoadingPackages ? "..." : formatSize(storageStats.freedSpace)}
                  icon={
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  }
                  gradient="bg-gradient-to-br from-green-500 to-emerald-500"
                  subtitle={
                    isLoadingPackages
                      ? "Calculating..."
                      : `${storageStats.removedCount} packages removed`
                  }
                />
                <InfoCard
                  title="Potential Savings"
                  value={
                    isLoadingPackages ? "..." : formatSize(storageStats.potentialSavings)
                  }
                  icon={
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                    </svg>
                  }
                  gradient="bg-gradient-to-br from-yellow-500 to-amber-500"
                  subtitle={
                    isLoadingPackages
                      ? "Calculating..."
                      : `${storageStats.recommendedCount} safe to remove`
                  }
                />
                <div className="relative overflow-hidden rounded-2xl border border-primary-500/30 bg-gradient-to-br from-gray-800 to-gray-900 p-5 shadow-lg shadow-black/20">
                  <div className="absolute inset-0 opacity-20 bg-gradient-to-br from-primary-500 to-purple-500" />
                  <div className="relative h-full flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-300">Debloat Score</p>
                      <p className="text-3xl font-bold mt-2">{cleanScore}%</p>
                      <p className="text-xs text-gray-400 mt-2">Based on removed vs detected bloatware</p>
                    </div>
                    <div className="w-16 h-16 rounded-full border-4 border-primary-400/40 flex items-center justify-center bg-primary-500/10">
                      <span className="text-sm font-semibold text-primary-300">{cleanScore}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-gradient-to-br from-gray-800 to-indigo-900/20 rounded-xl border border-gray-700/70 p-5 shadow-lg shadow-black/20">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-white">AI / ML Model Features</h2>
                    <p className="text-sm text-gray-300 mt-1">
                      View confidence scores, risky packages, and model reasoning in charts.
                    </p>
                  </div>
                  <Link
                    to="/ai-insights"
                    className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 transition-colors text-sm font-medium"
                  >
                    Open AI Insights
                  </Link>
                </div>

                <div className="grid grid-cols-4 gap-3 mt-4 text-sm">
                  <div className="rounded-lg border border-gray-700/70 bg-gray-800/70 p-3">
                    <p className="text-gray-400">Scored Apps</p>
                    <p className="text-2xl font-bold mt-1">{modelSummary.scored}</p>
                  </div>
                  <div className="rounded-lg border border-gray-700/70 bg-red-500/10 p-3">
                    <p className="text-red-300">Unsafe</p>
                    <p className="text-2xl font-bold mt-1 text-red-200">{modelSummary.unsafe}</p>
                  </div>
                  <div className="rounded-lg border border-gray-700/70 bg-orange-500/10 p-3">
                    <p className="text-orange-300">Expert</p>
                    <p className="text-2xl font-bold mt-1 text-orange-200">{modelSummary.expert}</p>
                  </div>
                  <div className="rounded-lg border border-gray-700/70 bg-emerald-500/10 p-3">
                    <p className="text-emerald-300">High Confidence</p>
                    <p className="text-2xl font-bold mt-1 text-emerald-200">{modelSummary.highConfidence}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4">
                <InfoCard
                  title="Android Version"
                  value={getAndroidVersion(selectedDevice.android_sdk)}
                  subtitle={`SDK ${selectedDevice.android_sdk}`}
                  icon={
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  }
                  gradient="bg-gradient-to-br from-purple-500 to-primary-600"
                />
                <InfoCard
                  title="Total Packages"
                  value={isLoadingPackages ? "..." : packageSummary.total}
                  subtitle="System + user apps"
                  icon={
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
                    </svg>
                  }
                  gradient="bg-gradient-to-br from-blue-500 to-cyan-500"
                />
                <InfoCard
                  title="Recommended To Remove"
                  value={isLoadingPackages ? "..." : packageSummary.recommended}
                  subtitle="Safe candidates"
                  icon={
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  }
                  gradient="bg-gradient-to-br from-green-500 to-emerald-500"
                />
                <InfoCard
                  title="Total Actions"
                  value={stats.total_actions}
                  subtitle="Across all sessions"
                  icon={
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  }
                  gradient="bg-gradient-to-br from-indigo-500 to-purple-500"
                />
                <InfoCard
                  title="Battery"
                  value={
                    liveHealth?.battery.levelPercent !== undefined
                      ? `${liveHealth.battery.levelPercent}%`
                      : "-"
                  }
                  subtitle={liveHealth?.battery.status || "Unknown"}
                  icon={
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h10v10H7z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 10h1a1 1 0 011 1v2a1 1 0 01-1 1h-1" />
                    </svg>
                  }
                  gradient="bg-gradient-to-br from-lime-500 to-green-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="bg-gradient-to-br from-gray-800 to-gray-800/80 rounded-xl border border-gray-700/70 p-5 shadow-lg shadow-black/20">
                  <h2 className="text-lg font-semibold mb-4">Phone Details</h2>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-400">Model</span>
                      <span className="text-white text-right break-all">
                        {selectedDevice.model}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-400">Brand</span>
                      <span className="text-white text-right break-all">
                        {selectedDevice.brand}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-400">ADB Device ID</span>
                      <span className="text-white text-right break-all font-mono text-xs">
                        {selectedDevice.adb_id}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-400">Available Users</span>
                      <span className="text-white text-right">
                        {selectedDevice.users.length}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-400">Selected User</span>
                      <span className="text-white text-right">{selectedUser}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-gray-800 to-gray-800/80 rounded-xl border border-gray-700/70 p-5 shadow-lg shadow-black/20">
                  <h2 className="text-lg font-semibold mb-4">Package State Overview</h2>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-400">Enabled</span>
                      <span className="text-green-400 font-medium">
                        {isLoadingPackages ? "..." : packageSummary.enabled}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-400">Disabled</span>
                      <span className="text-yellow-400 font-medium">
                        {isLoadingPackages ? "..." : packageSummary.disabled}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-400">Uninstalled (for user)</span>
                      <span className="text-red-400 font-medium">
                        {isLoadingPackages ? "..." : packageSummary.uninstalled}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-400">Successful Actions</span>
                      <span className="text-blue-400 font-medium">
                        {stats.successful_actions}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-400">Failed Actions</span>
                      <span className="text-orange-400 font-medium">
                        {stats.failed_actions}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full overflow-y-auto bg-gradient-to-br from-gray-800 via-gray-800 to-gray-900 rounded-xl border border-gray-700 p-6">
              <div className="max-w-3xl mx-auto space-y-5">
                <div className="text-center bg-gray-900/40 border border-gray-700 rounded-2xl p-8">
                  <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-primary-500 to-cyan-500 rounded-2xl flex items-center justify-center shadow-lg shadow-primary-900/40">
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
                  <p className="text-gray-300 max-w-xl mx-auto">
                    Select a connected Android phone from the sidebar to see phone
                    details and package health summary.
                  </p>

                  <div className="grid grid-cols-3 gap-3 mt-6 text-left">
                    <div className="rounded-xl border border-gray-700 bg-gray-800/70 p-3">
                      <p className="text-xs text-gray-400">Step 1</p>
                      <p className="text-sm text-white mt-1">Enable USB debugging</p>
                    </div>
                    <div className="rounded-xl border border-gray-700 bg-gray-800/70 p-3">
                      <p className="text-xs text-gray-400">Step 2</p>
                      <p className="text-sm text-white mt-1">Connect phone or pair wireless ADB</p>
                    </div>
                    <div className="rounded-xl border border-gray-700 bg-gray-800/70 p-3">
                      <p className="text-xs text-gray-400">Step 3</p>
                      <p className="text-sm text-white mt-1">Select device and start debloating</p>
                    </div>
                  </div>
                </div>

                {!connectionGuideSeen && (
                  <div className="bg-gray-900/60 rounded-xl border border-gray-700 p-5">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-lg font-semibold text-white">Device Connection Guide</h4>
                      <button
                        onClick={runConnectionDiagnostics}
                        disabled={isRunningConnectionDiagnostics}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/30 text-amber-300 disabled:opacity-60"
                      >
                        {isRunningConnectionDiagnostics
                          ? "Running Diagnostics..."
                          : "Run Connection Diagnostics"}
                      </button>
                    </div>

                    <div className="flex gap-1 mb-3 bg-gray-800 rounded-lg p-1">
                      <button
                        onClick={() => setGuideTab("usb")}
                        className={`flex-1 px-3 py-2 rounded text-xs font-medium ${
                          guideTab === "usb"
                            ? "bg-primary-600 text-white"
                            : "text-gray-300 hover:text-white"
                        }`}
                      >
                        USB Setup
                      </button>
                      <button
                        onClick={() => setGuideTab("wireless")}
                        className={`flex-1 px-3 py-2 rounded text-xs font-medium ${
                          guideTab === "wireless"
                            ? "bg-primary-600 text-white"
                            : "text-gray-300 hover:text-white"
                        }`}
                      >
                        Wireless
                      </button>
                      <button
                        onClick={() => setGuideTab("advanced")}
                        className={`flex-1 px-3 py-2 rounded text-xs font-medium ${
                          guideTab === "advanced"
                            ? "bg-primary-600 text-white"
                            : "text-gray-300 hover:text-white"
                        }`}
                      >
                        Advanced Fix
                      </button>
                    </div>

                    {guideTab === "usb" && (
                      <div className="space-y-2 text-sm text-gray-300">
                        <p className="font-medium text-gray-100">If your device is not detected via USB:</p>
                        <ol className="list-decimal pl-5 space-y-1">
                          <li>On phone: Settings to About phone, then tap Build number 7 times.</li>
                          <li>Open Developer options and enable USB debugging.</li>
                          <li>Reconnect cable and choose File Transfer mode.</li>
                          <li>Accept the Allow USB debugging prompt on phone.</li>
                          <li>Press refresh on the Connected Devices panel.</li>
                        </ol>
                      </div>
                    )}

                    {guideTab === "wireless" && (
                      <div className="space-y-2 text-sm text-gray-300">
                        <p className="font-medium text-gray-100">Wireless Debugging (Android 11+):</p>
                        <ol className="list-decimal pl-5 space-y-1">
                          <li>Enable Developer options and Wireless debugging.</li>
                          <li>Keep phone and computer on the same Wi-Fi network.</li>
                          <li>Use Wireless ADB in the sidebar to Pair first, then Connect.</li>
                          <li>Refresh Connected Devices once pairing is complete.</li>
                        </ol>
                      </div>
                    )}

                    {guideTab === "advanced" && (
                      <div className="space-y-2 text-sm text-gray-300">
                        <p className="font-medium text-gray-100">Advanced troubleshooting:</p>
                        <ul className="list-disc pl-5 space-y-1">
                          <li>Revoke USB debugging authorizations and reconnect.</li>
                          <li>Disable and re-enable USB/Wireless debugging.</li>
                          <li>Try another USB port or cable and keep phone unlocked.</li>
                          <li>Restart ADB server: adb kill-server && adb start-server.</li>
                        </ul>
                        {connectionGuideError && (
                          <p className="text-sm text-red-300">{connectionGuideError}</p>
                        )}
                        {connectionDiagnostics && (
                          <div className="mt-2 rounded-lg border border-gray-700 bg-gray-800/70 p-3">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-xs font-semibold text-white">Latest Diagnostics</p>
                              <span
                                className={`text-[10px] px-2 py-0.5 rounded-full ${
                                  connectionDiagnostics.status === "healthy"
                                    ? "bg-green-500/20 text-green-300"
                                    : connectionDiagnostics.status === "warning"
                                      ? "bg-yellow-500/20 text-yellow-300"
                                      : "bg-red-500/20 text-red-300"
                                }`}
                              >
                                {connectionDiagnostics.status.toUpperCase()}
                              </span>
                            </div>
                            <div className="space-y-1">
                              {connectionDiagnostics.checks.map((check: {
                                name: string;
                                ok: boolean;
                                message: string;
                              }) => (
                                <p key={check.name} className="text-xs text-gray-300">
                                  {check.ok ? "OK" : "ISSUE"}: {check.name} - {check.message}
                                </p>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
