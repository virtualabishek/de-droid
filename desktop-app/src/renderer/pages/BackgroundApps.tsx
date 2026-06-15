import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DeviceIcon } from "../components/DeviceIcon";
import { DeviceSelector } from "../components/DeviceSelector";
import { useDeviceStore } from "../store/deviceStore";
import { useToastStore } from "../store/toastStore";
import type {
  BackgroundAppOp,
  BackgroundAppOpMode,
  BackgroundRestrictionStatus,
} from "../../@types/electron-api";

type FilterMode = "allowed" | "restricted" | "all";

type AppPackage = {
  name: string;
  state: "enabled" | "disabled" | "uninstalled";
  packageType?: "system" | "user";
  description?: string;
  category?: string;
};

const BACKGROUND_OPS: Array<{
  op: BackgroundAppOp;
  title: string;
  description: string;
}> = [
  {
    op: "RUN_IN_BACKGROUND",
    title: "Run in background",
    description: "Controls normal background execution for the app.",
  },
  {
    op: "RUN_ANY_IN_BACKGROUND",
    title: "Run any in background",
    description:
      "Stricter app-op used by newer Android builds for background work.",
  },
];

function isBlockedMode(mode: string | null | undefined) {
  return mode === "ignore" || mode === "deny";
}

function isAllowedMode(mode: string | null | undefined) {
  return !isBlockedMode(mode);
}

function getOpMode(
  status: BackgroundRestrictionStatus | undefined,
  op: BackgroundAppOp,
) {
  return op === "RUN_IN_BACKGROUND"
    ? status?.runInBackgroundMode
    : status?.runAnyInBackgroundMode;
}

function formatMode(mode: string | null | undefined) {
  if (!mode) return "default / allowed";
  return mode.replace(/_/g, " ");
}

function BackgroundToggle({
  checked,
  disabled,
  title,
  description,
  mode,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  title: string;
  description: string;
  mode: string | null | undefined;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-white">{title}</p>
          <p className="mt-1 text-xs text-gray-400">{description}</p>
          <p className="mt-2 text-[11px] uppercase tracking-wide text-gray-500">
            mode: <span className="text-gray-300">{formatMode(mode)}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange(!checked)}
          disabled={disabled}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            checked ? "bg-green-500" : "bg-red-600"
          }`}
          title={
            checked ? "Background access allowed" : "Background access off"
          }
          aria-pressed={checked}
        >
          <span
            className={`inline-block h-5 w-5 rounded-full bg-white transition-transform ${
              checked ? "translate-x-5" : "translate-x-1"
            }`}
          />
        </button>
      </div>
    </div>
  );
}

export default function BackgroundApps() {
  const {
    selectedDevice,
    selectedUser,
    packages,
    isLoadingPackages,
    fetchPackages,
  } = useDeviceStore();
  const { success: showSuccess, error: showError } = useToastStore();

  const [statuses, setStatuses] = useState<
    Record<string, BackgroundRestrictionStatus>
  >({});
  const [statusErrors, setStatusErrors] = useState<Record<string, string>>({});
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 });
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("allowed");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const scanRunRef = useRef(0);

  const enabledPackages = useMemo(
    () => (packages as AppPackage[]).filter((pkg) => pkg.state === "enabled"),
    [packages],
  );

  const summary = useMemo(() => {
    const scanned = Object.values(statuses);
    const runAllowed = scanned.filter((status) =>
      isAllowedMode(status.runInBackgroundMode),
    ).length;
    const runAnyAllowed = scanned.filter((status) =>
      isAllowedMode(status.runAnyInBackgroundMode),
    ).length;
    const fullyOff = scanned.filter(
      (status) =>
        isBlockedMode(status.runInBackgroundMode) &&
        isBlockedMode(status.runAnyInBackgroundMode),
    ).length;

    return {
      scanned: scanned.length,
      runAllowed,
      runAnyAllowed,
      fullyOff,
    };
  }, [statuses]);

  const visiblePackages = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return enabledPackages.filter((pkg) => {
      const status = statuses[pkg.name];
      const runAllowed = isAllowedMode(status?.runInBackgroundMode);
      const runAnyAllowed = isAllowedMode(status?.runAnyInBackgroundMode);
      const hasAnyAllowed = runAllowed || runAnyAllowed;
      const fullyRestricted = !runAllowed && !runAnyAllowed;

      if (filterMode === "allowed" && status && !hasAnyAllowed) return false;
      if (filterMode === "restricted" && status && !fullyRestricted)
        return false;
      if (filterMode !== "all" && !status) return false;

      if (!query) return true;
      return (
        pkg.name.toLowerCase().includes(query) ||
        pkg.description?.toLowerCase().includes(query) ||
        pkg.category?.toLowerCase().includes(query)
      );
    });
  }, [enabledPackages, filterMode, searchQuery, statuses]);

  const scanStatuses = useCallback(async () => {
    if (!selectedDevice) return;

    const api = window.electronAPI?.adb;
    if (!api?.getBackgroundRestrictionStatus) {
      showError(
        "Background app management API is unavailable. Restart the app to load the latest preload.",
      );
      return;
    }

    const currentRun = scanRunRef.current + 1;
    scanRunRef.current = currentRun;
    setIsScanning(true);
    setScanProgress({ done: 0, total: enabledPackages.length });
    setStatuses({});
    setStatusErrors({});

    let nextIndex = 0;
    let done = 0;
    const concurrency = 6;

    const worker = async () => {
      while (
        nextIndex < enabledPackages.length &&
        scanRunRef.current === currentRun
      ) {
        const pkg = enabledPackages[nextIndex];
        nextIndex += 1;

        try {
          const status = await api.getBackgroundRestrictionStatus(
            selectedDevice.adb_id,
            pkg.name,
            selectedUser,
          );
          if (scanRunRef.current !== currentRun) return;
          setStatuses((current) => ({ ...current, [pkg.name]: status }));
        } catch (error) {
          if (scanRunRef.current !== currentRun) return;
          const message =
            error instanceof Error
              ? error.message
              : "Failed to read background status";
          setStatusErrors((current) => ({ ...current, [pkg.name]: message }));
        } finally {
          if (scanRunRef.current === currentRun) {
            done += 1;
            setScanProgress({ done, total: enabledPackages.length });
          }
        }
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(concurrency, enabledPackages.length) },
        () => worker(),
      ),
    );

    if (scanRunRef.current === currentRun) {
      setIsScanning(false);
    }
  }, [enabledPackages, selectedDevice, selectedUser, showError]);

  useEffect(() => {
    if (!selectedDevice) {
      setStatuses({});
      setStatusErrors({});
      return;
    }

    fetchPackages(true);
  }, [fetchPackages, selectedDevice, selectedUser]);

  useEffect(() => {
    if (!selectedDevice || isLoadingPackages || enabledPackages.length === 0)
      return;
    scanStatuses();
  }, [enabledPackages.length, isLoadingPackages, scanStatuses, selectedDevice]);

  const isMissingHandlerError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes(
      "No handler registered for 'adb:set-background-app-op-mode'",
    );
  };

  const setAppOp = async (
    packageName: string,
    opName: BackgroundAppOp,
    mode: BackgroundAppOpMode,
  ) => {
    if (!selectedDevice) return;

    const api = window.electronAPI?.adb;
    if (!api?.setBackgroundAppOpMode) {
      showError(
        "Background app-op toggle API is unavailable. Restart the app to load the latest preload.",
      );
      return;
    }

    const key = `${packageName}:${opName}`;
    setBusyKey(key);

    try {
      const result = await api.setBackgroundAppOpMode(
        selectedDevice.adb_id,
        packageName,
        opName,
        mode,
        selectedUser,
      );

      setStatuses((current) => ({ ...current, [packageName]: result.status }));

      if (result.success) {
        showSuccess(
          `${opName} ${mode === "ignore" ? "turned off" : "allowed"} for ${packageName}`,
        );
      } else {
        showError(result.error || result.message);
      }
    } catch (error) {
      showError(
        error instanceof Error
          ? error.message
          : "Failed to update background app-op",
      );
    } finally {
      setBusyKey(null);
    }
  };

  const turnOffBoth = async (packageName: string) => {
    if (!selectedDevice) return;

    const api = window.electronAPI?.adb;
    setBusyKey(`${packageName}:RUN_IN_BACKGROUND`);

    try {
      if (api?.setBackgroundAppOpMode) {
        const first = await api.setBackgroundAppOpMode(
          selectedDevice.adb_id,
          packageName,
          "RUN_IN_BACKGROUND",
          "ignore",
          selectedUser,
        );
        setStatuses((current) => ({ ...current, [packageName]: first.status }));

        const second = await api.setBackgroundAppOpMode(
          selectedDevice.adb_id,
          packageName,
          "RUN_ANY_IN_BACKGROUND",
          "ignore",
          selectedUser,
        );
        setStatuses((current) => ({
          ...current,
          [packageName]: second.status,
        }));

        if (first.success && second.success) {
          showSuccess(`Both background controls turned off for ${packageName}`);
        } else {
          showError(
            first.error ||
              second.error ||
              "One background control could not be turned off",
          );
        }
        return;
      }

      throw new Error("Background app-op toggle API is unavailable");
    } catch (error) {
      if (api?.optimizeBackgroundRestriction && isMissingHandlerError(error)) {
        try {
          const result = await api.optimizeBackgroundRestriction(
            selectedDevice.adb_id,
            packageName,
            "restrict",
            selectedUser,
          );
          setStatuses((current) => ({
            ...current,
            [packageName]: result.status,
          }));

          if (result.success) {
            showSuccess(`Background restricted for ${packageName}`);
          } else {
            showError(result.message);
          }
          return;
        } catch (fallbackError) {
          showError(
            fallbackError instanceof Error
              ? fallbackError.message
              : "Failed to turn off both background controls",
          );
          return;
        }
      }

      showError(
        error instanceof Error
          ? error.message
          : "Failed to turn off both background controls",
      );
    } finally {
      setBusyKey(null);
    }
  };

  const isBusy = (packageName: string, opName?: BackgroundAppOp) => {
    if (!busyKey) return false;
    return opName
      ? busyKey === `${packageName}:${opName}`
      : busyKey.startsWith(`${packageName}:`);
  };

  return (
    <div className="h-full flex flex-col bg-gray-900">
      <header className="bg-gradient-to-r from-gray-800 via-gray-800 to-purple-900/30 border-b border-gray-700/50 p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-purple-100 to-purple-300 bg-clip-text text-transparent">
              Background Apps
            </h1>
            <p className="text-gray-400 mt-1">
              View apps that can work in the background and turn off
              RUN_IN_BACKGROUND or RUN_ANY_IN_BACKGROUND per app.
            </p>
          </div>

          <button
            onClick={scanStatuses}
            disabled={!selectedDevice || isLoadingPackages || isScanning}
            className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-400 transition-colors text-sm font-medium"
          >
            {isScanning
              ? `Scanning ${scanProgress.done}/${scanProgress.total}`
              : "Rescan Apps"}
          </button>
        </div>
      </header>

      <div className="flex-1 flex gap-6 p-6 overflow-hidden">
        <aside className="w-80 flex-shrink-0 space-y-4 overflow-y-auto pr-1">
          <DeviceSelector />

          {selectedDevice ? (
            <>
              <div className="rounded-xl border border-gray-700 bg-gray-800 p-4">
                <div className="flex items-center gap-3">
                  <DeviceIcon
                    brand={selectedDevice.brand}
                    model={selectedDevice.model}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">
                      {selectedDevice.model}
                    </p>
                    <p className="text-xs text-gray-400 truncate">
                      {selectedDevice.brand} • User {selectedUser}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-gray-500 break-all">
                  {selectedDevice.adb_id}
                </p>
              </div>

              <div className="rounded-xl border border-purple-500/20 bg-purple-500/10 p-4">
                <h3 className="text-sm font-semibold text-purple-200 mb-2">
                  What these switches do
                </h3>
                <ul className="space-y-2 text-xs text-purple-100/80">
                  <li>
                    • ON means Android currently allows/defaults that background
                    app-op.
                  </li>
                  <li>
                    • OFF sets the app-op to{" "}
                    <code className="text-purple-100">ignore</code> via ADB.
                  </li>
                  <li>
                    • Some OEMs may override or hide support for one of these
                    controls.
                  </li>
                </ul>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-gray-700 bg-gray-800 p-4">
                  <p className="text-xs text-gray-400">Scanned</p>
                  <p className="mt-1 text-2xl font-bold text-white">
                    {summary.scanned}
                  </p>
                </div>
                <div className="rounded-xl border border-gray-700 bg-gray-800 p-4">
                  <p className="text-xs text-gray-400">Both off</p>
                  <p className="mt-1 text-2xl font-bold text-red-300">
                    {summary.fullyOff}
                  </p>
                </div>
                <div className="rounded-xl border border-gray-700 bg-gray-800 p-4">
                  <p className="text-xs text-gray-400">RUN allowed</p>
                  <p className="mt-1 text-2xl font-bold text-green-300">
                    {summary.runAllowed}
                  </p>
                </div>
                <div className="rounded-xl border border-gray-700 bg-gray-800 p-4">
                  <p className="text-xs text-gray-400">RUN_ANY allowed</p>
                  <p className="mt-1 text-2xl font-bold text-green-300">
                    {summary.runAnyAllowed}
                  </p>
                </div>
              </div>
            </>
          ) : null}
        </aside>

        <main className="flex-1 overflow-hidden">
          {!selectedDevice ? (
            <div className="h-full flex items-center justify-center bg-gray-800 rounded-xl border border-gray-700">
              <div className="text-center max-w-md">
                <div className="w-24 h-24 mx-auto mb-6 bg-purple-600/10 rounded-3xl flex items-center justify-center border border-purple-500/30">
                  <svg
                    className="w-12 h-12 text-purple-300"
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
                <h3 className="text-2xl font-bold text-white mb-3">
                  Select a Device
                </h3>
                <p className="text-gray-400">
                  Connect or select an Android device to scan apps and manage
                  background execution controls.
                </p>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col rounded-xl border border-gray-700 bg-gray-800 overflow-hidden">
              <div className="border-b border-gray-700 p-4 space-y-4">
                <div className="flex flex-col xl:flex-row xl:items-center gap-3">
                  <div className="relative flex-1">
                    <input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Search package, app description, or category..."
                      className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                  </div>

                  <div className="flex rounded-lg border border-gray-700 bg-gray-900 p-1">
                    {[
                      ["allowed", "Allowed"],
                      ["restricted", "Both off"],
                      ["all", "All"],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        onClick={() => setFilterMode(value as FilterMode)}
                        className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                          filterMode === value
                            ? "bg-purple-600 text-white"
                            : "text-gray-400 hover:text-white hover:bg-gray-800"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {(isLoadingPackages || isScanning) && (
                  <div>
                    <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
                      <span>
                        {isLoadingPackages
                          ? "Loading packages..."
                          : "Reading app-op status..."}
                      </span>
                      <span>
                        {scanProgress.total
                          ? `${scanProgress.done}/${scanProgress.total}`
                          : ""}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-900 overflow-hidden">
                      <div
                        className="h-full bg-purple-500 transition-all"
                        style={{
                          width: scanProgress.total
                            ? `${Math.round((scanProgress.done / scanProgress.total) * 100)}%`
                            : "15%",
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {visiblePackages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-center">
                    <div>
                      <p className="text-lg font-semibold text-white">
                        No apps to show
                      </p>
                      <p className="mt-2 text-sm text-gray-400">
                        {isScanning
                          ? "Apps will appear here as their background status is read."
                          : "Try switching to All, clearing search, or rescanning."}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {visiblePackages.map((pkg) => {
                      const status = statuses[pkg.name];
                      const error = statusErrors[pkg.name];
                      const runAllowed = isAllowedMode(
                        status?.runInBackgroundMode,
                      );
                      const runAnyAllowed = isAllowedMode(
                        status?.runAnyInBackgroundMode,
                      );

                      return (
                        <section
                          key={pkg.name}
                          className="rounded-2xl border border-gray-700 bg-gradient-to-br from-gray-800 to-gray-900 p-4 shadow-lg shadow-black/10"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="font-semibold text-white break-all">
                                  {pkg.name}
                                </h3>
                                {pkg.packageType && (
                                  <span className="rounded-full bg-gray-700 px-2 py-0.5 text-[11px] uppercase tracking-wide text-gray-300">
                                    {pkg.packageType}
                                  </span>
                                )}
                                {pkg.category && (
                                  <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-[11px] uppercase tracking-wide text-purple-200">
                                    {pkg.category}
                                  </span>
                                )}
                                {status && (
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-[11px] uppercase tracking-wide ${
                                      runAllowed || runAnyAllowed
                                        ? "bg-green-500/15 text-green-300"
                                        : "bg-red-500/15 text-red-300"
                                    }`}
                                  >
                                    {runAllowed || runAnyAllowed
                                      ? "background allowed"
                                      : "background off"}
                                  </span>
                                )}
                              </div>
                              {pkg.description &&
                                pkg.description !== pkg.name && (
                                  <p className="mt-1 text-sm text-gray-400">
                                    {pkg.description}
                                  </p>
                                )}
                              {status?.warnings.length ? (
                                <p className="mt-2 text-xs text-yellow-300">
                                  {status.warnings.join(" ")}
                                </p>
                              ) : null}
                              {error ? (
                                <p className="mt-2 text-xs text-red-300">
                                  {error}
                                </p>
                              ) : null}
                            </div>

                            <button
                              onClick={() => turnOffBoth(pkg.name)}
                              disabled={!status || isBusy(pkg.name)}
                              className="shrink-0 rounded-lg bg-red-600/90 px-3 py-2 text-xs font-medium text-white hover:bg-red-500 disabled:bg-gray-700 disabled:text-gray-400"
                            >
                              Turn Off Both
                            </button>
                          </div>

                          <div className="mt-4 grid grid-cols-1 2xl:grid-cols-2 gap-3">
                            {BACKGROUND_OPS.map((item) => {
                              const mode = getOpMode(status, item.op);
                              const checked = isAllowedMode(mode);
                              return (
                                <BackgroundToggle
                                  key={item.op}
                                  checked={checked}
                                  disabled={
                                    !status || isBusy(pkg.name, item.op)
                                  }
                                  title={item.title}
                                  description={item.description}
                                  mode={mode}
                                  onChange={(nextChecked) =>
                                    setAppOp(
                                      pkg.name,
                                      item.op,
                                      nextChecked ? "allow" : "ignore",
                                    )
                                  }
                                />
                              );
                            })}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
