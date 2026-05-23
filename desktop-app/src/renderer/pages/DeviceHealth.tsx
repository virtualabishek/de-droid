import { useCallback, useEffect, useState } from "react";
import { DeviceIcon } from "../components/DeviceIcon";
import { useDeviceStore } from "../store/deviceStore";

type LiveHealth = Awaited<
  ReturnType<typeof window.electronAPI.adb.getDeviceHealthSnapshot>
>;

function HealthCard({
  title,
  value,
  subtitle,
  accent,
}: {
  title: string;
  value: string;
  subtitle?: string;
  accent: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-gray-700/70 bg-gradient-to-br from-gray-800 to-gray-900 p-5 shadow-lg shadow-black/20">
      <div className={`absolute inset-0 opacity-15 ${accent}`} />
      <div className="relative">
        <p className="text-sm text-gray-300">{title}</p>
        <p className="text-3xl font-bold mt-2 tracking-tight">{value}</p>
        {subtitle ? <p className="text-xs text-gray-400 mt-2">{subtitle}</p> : null}
      </div>
    </div>
  );
}

export default function DeviceHealth() {
  const { selectedDevice } = useDeviceStore();
  const [snapshot, setSnapshot] = useState<LiveHealth | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSnapshot = useCallback(async () => {
    if (!selectedDevice) return;

    if (!window.electronAPI?.adb?.getDeviceHealthSnapshot) {
      setError("Device health API is unavailable. Restart the app to load latest IPC handlers.");
      setSnapshot(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI.adb.getDeviceHealthSnapshot(
        selectedDevice.adb_id,
      );
      setSnapshot(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load device health");
      setSnapshot(null);
    } finally {
      setIsLoading(false);
    }
  }, [selectedDevice]);

  useEffect(() => {
    if (!selectedDevice) {
      setSnapshot(null);
      setError(null);
      return;
    }

    fetchSnapshot();
    const interval = window.setInterval(fetchSnapshot, 5 * 60 * 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [selectedDevice, fetchSnapshot]);

  return (
    <div className="h-full flex flex-col bg-gray-900">
      <header className="bg-gradient-to-r from-gray-800 via-gray-800 to-cyan-900/30 border-b border-gray-700/50 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-cyan-100 to-cyan-300 bg-clip-text text-transparent">
              Device Health
            </h1>
            <p className="text-gray-400 mt-1">
              Real-time ADB telemetry with manual refresh and automatic updates every 5 minutes
            </p>
          </div>

          <button
            onClick={fetchSnapshot}
            disabled={!selectedDevice || isLoading}
            className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 disabled:text-gray-400 transition-colors text-sm font-medium"
          >
            {isLoading ? "Refreshing..." : "Refresh Now"}
          </button>
        </div>
      </header>

      <div className="flex-1 p-6 overflow-hidden">
        <div className="h-full overflow-y-auto">
          {!selectedDevice ? (
            <div className="h-full flex items-center justify-center bg-gray-800 rounded-xl border border-gray-700">
              <div className="text-center max-w-md">
                <h3 className="text-2xl font-bold text-white mb-2">Select a Device</h3>
                <p className="text-gray-400">
                  Pick a connected Android device from Dashboard to view battery, RAM, storage, CPU usage and thermal state.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-6 pr-1">
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-gradient-to-br from-gray-800 to-gray-800/80 rounded-xl border border-gray-700/70 p-4 shadow-lg shadow-black/20">
                  <h3 className="text-sm font-medium text-gray-300 mb-3">Telemetry Mode</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Update Interval</span>
                      <span className="text-white">5 minutes</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Snapshot Type</span>
                      <span className="text-white">Current usage</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Last Collected</span>
                      <span className="text-white text-xs">
                        {snapshot?.collectedAt
                          ? new Date(snapshot.collectedAt).toLocaleTimeString()
                          : "-"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-gray-800 to-cyan-900/20 rounded-xl border border-gray-700/70 p-4 shadow-lg shadow-black/20">
                  <div className="flex items-center gap-3">
                    <DeviceIcon
                      brand={selectedDevice.brand}
                      model={selectedDevice.model}
                      size="sm"
                    />
                    <div>
                      <p className="font-semibold text-sm">{selectedDevice.model}</p>
                      <p className="text-xs text-gray-400">{selectedDevice.brand}</p>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-3 break-all">{selectedDevice.adb_id}</p>
                </div>
              </div>

              {error ? (
                <div className="p-4 rounded-xl border border-yellow-500/30 bg-yellow-500/10 text-yellow-300 text-sm">
                  {error}
                </div>
              ) : null}

              <div className="grid grid-cols-4 gap-4">
                <HealthCard
                  title="Battery"
                  value={
                    snapshot?.battery.levelPercent !== undefined
                      ? `${snapshot.battery.levelPercent}%`
                      : "-"
                  }
                  subtitle={snapshot?.battery.status || "Unknown"}
                  accent="bg-gradient-to-br from-lime-500 to-green-600"
                />
                <HealthCard
                  title="Temperature"
                  value={
                    snapshot?.battery.temperatureC !== undefined
                      ? `${snapshot.battery.temperatureC}°C`
                      : "-"
                  }
                  subtitle={snapshot?.battery.charging ? "Charging" : "Not charging"}
                  accent="bg-gradient-to-br from-orange-500 to-red-600"
                />
                <HealthCard
                  title="RAM"
                  value={
                    snapshot?.memory.usedMb !== undefined &&
                    snapshot?.memory.totalMb !== undefined
                      ? `${snapshot.memory.usedMb.toFixed(0)} / ${snapshot.memory.totalMb.toFixed(0)} MB`
                      : "-"
                  }
                  subtitle={
                    snapshot?.memory.freeMb !== undefined
                      ? `${snapshot.memory.freeMb.toFixed(0)} MB free`
                      : undefined
                  }
                  accent="bg-gradient-to-br from-blue-500 to-cyan-600"
                />
                <HealthCard
                  title="Storage"
                  value={
                    snapshot?.storage.usedGb !== undefined &&
                    snapshot?.storage.totalGb !== undefined
                      ? `${snapshot.storage.usedGb.toFixed(2)} / ${snapshot.storage.totalGb.toFixed(2)} GB`
                      : "-"
                  }
                  subtitle={
                    snapshot?.storage.usedPercent !== undefined
                      ? `${snapshot.storage.usedPercent}% used`
                      : undefined
                  }
                  accent="bg-gradient-to-br from-blue-500 to-primary-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="bg-gradient-to-br from-gray-800 to-gray-800/80 rounded-xl border border-gray-700/70 p-5 shadow-lg shadow-black/20">
                  <h2 className="text-lg font-semibold mb-4">Performance Snapshot</h2>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-400">CPU Load</span>
                      <span className="text-white">
                        {snapshot?.performance.cpuLoadPercent !== undefined
                          ? `${snapshot.performance.cpuLoadPercent.toFixed(1)}%`
                          : "-"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-400">Thermal Status</span>
                      <span
                        className={
                          snapshot?.performance.thermalWarning
                            ? "text-red-400"
                            : "text-green-400"
                        }
                      >
                        {snapshot?.performance.thermalStatus || "Unknown"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-400">Battery Voltage</span>
                      <span className="text-white">
                        {snapshot?.battery.voltageMv !== undefined
                          ? `${snapshot.battery.voltageMv} mV`
                          : "-"}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 pt-2 border-t border-gray-700/60">
                      CPU process list below is from current snapshot only. Press refresh to capture latest usage right now.
                    </p>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-gray-800 to-gray-800/80 rounded-xl border border-gray-700/70 p-5 shadow-lg shadow-black/20">
                  <h2 className="text-lg font-semibold mb-4">Data Quality</h2>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-400">Commands with issues</span>
                      <span className="text-white">{snapshot?.errors.length || 0}</span>
                    </div>
                    <div className="max-h-44 overflow-y-auto pr-1 space-y-1">
                      {snapshot?.errors.length ? (
                        snapshot.errors.map((item) => (
                          <p key={item} className="text-xs text-yellow-300/90">
                            • {item}
                          </p>
                        ))
                      ) : (
                        <p className="text-xs text-green-300">All health commands succeeded.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-gradient-to-br from-gray-800 to-gray-800/80 rounded-xl border border-gray-700/70 p-5 shadow-lg shadow-black/20">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">CPU Usage by App/Process</h2>
                  <span className="text-xs text-gray-400">
                    {snapshot?.performance.topApps.length || 0} active entries
                  </span>
                </div>

                <div className="max-h-[420px] overflow-y-auto border border-gray-700/60 rounded-lg">
                  <div className="grid grid-cols-[1fr_auto] text-xs font-medium text-gray-300 bg-gray-900/70 px-4 py-2 border-b border-gray-700/60">
                    <span>Process / App</span>
                    <span>CPU %</span>
                  </div>

                  {(snapshot?.performance.topApps || []).length > 0 ? (
                    snapshot!.performance.topApps.map((entry) => (
                      <div
                        key={`${entry.name}-${entry.cpuPercent}`}
                        className="grid grid-cols-[1fr_auto] px-4 py-2.5 text-sm border-b border-gray-700/30 last:border-b-0"
                      >
                        <span className="text-gray-200 truncate pr-3">{entry.name}</span>
                        <span className="text-cyan-300 font-medium">{entry.cpuPercent.toFixed(1)}%</span>
                      </div>
                    ))
                  ) : (
                    <p className="px-4 py-6 text-sm text-gray-500">No active process data in this snapshot.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
