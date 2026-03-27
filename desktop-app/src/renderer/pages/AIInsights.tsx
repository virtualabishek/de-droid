import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useDeviceStore } from "../store/deviceStore";

type ModelLabel = "RECOMMENDED" | "ADVANCED" | "EXPERT" | "UNSAFE";

const LABELS: ModelLabel[] = ["RECOMMENDED", "ADVANCED", "EXPERT", "UNSAFE"];

function packagesLinkForLabel(label: ModelLabel): string {
  const params = new URLSearchParams({
    source: "ai-insights",
    modelLabel: label,
  });
  return `/packages?${params.toString()}`;
}

function packagesLinkForPackage(packageName: string): string {
  const params = new URLSearchParams({
    source: "ai-insights",
    package: packageName,
    openDetails: "1",
  });
  return `/packages?${params.toString()}`;
}

function labelTone(label: ModelLabel): string {
  switch (label) {
    case "RECOMMENDED":
      return "text-green-300 border-green-500/40 bg-green-500/10";
    case "ADVANCED":
      return "text-blue-300 border-blue-500/40 bg-blue-500/10";
    case "EXPERT":
      return "text-orange-300 border-orange-500/40 bg-orange-500/10";
    case "UNSAFE":
      return "text-red-300 border-red-500/40 bg-red-500/10";
    default:
      return "text-gray-300 border-gray-500/40 bg-gray-500/10";
  }
}

function progressTone(label: ModelLabel): string {
  switch (label) {
    case "RECOMMENDED":
      return "bg-green-500";
    case "ADVANCED":
      return "bg-blue-500";
    case "EXPERT":
      return "bg-orange-500";
    case "UNSAFE":
      return "bg-red-500";
    default:
      return "bg-gray-500";
  }
}

export default function AIInsights() {
  const {
    selectedDevice,
    selectedUser,
    packages,
    fetchPackages,
    isLoadingPackages,
  } = useDeviceStore();

  useEffect(() => {
    if (!selectedDevice) return;
    fetchPackages(true);
  }, [selectedDevice, selectedUser, fetchPackages]);

  const modelPackages = useMemo(
    () =>
      packages.filter(
        (pkg) =>
          typeof pkg.modelConfidence === "number" ||
          (pkg.modelLabel && pkg.modelLabel.length > 0),
      ),
    [packages],
  );

  const labelCounts = useMemo(() => {
    const counts: Record<ModelLabel, number> = {
      RECOMMENDED: 0,
      ADVANCED: 0,
      EXPERT: 0,
      UNSAFE: 0,
    };

    for (const pkg of modelPackages) {
      if (!pkg.modelLabel) continue;
      const normalized = pkg.modelLabel.toUpperCase() as ModelLabel;
      if (normalized in counts) {
        counts[normalized] += 1;
      }
    }

    return counts;
  }, [modelPackages]);

  const confidenceBuckets = useMemo(() => {
    let high = 0;
    let medium = 0;
    let low = 0;
    let unknown = 0;

    for (const pkg of modelPackages) {
      if (typeof pkg.modelConfidence !== "number") {
        unknown += 1;
        continue;
      }

      if (pkg.modelConfidence >= 0.8) high += 1;
      else if (pkg.modelConfidence >= 0.6) medium += 1;
      else low += 1;
    }

    return { high, medium, low, unknown };
  }, [modelPackages]);

  const topRiskPackages = useMemo(() => {
    return modelPackages
      .filter((pkg) => pkg.modelLabel === "UNSAFE" || pkg.modelLabel === "EXPERT")
      .sort((a, b) => (b.modelConfidence || 0) - (a.modelConfidence || 0))
      .slice(0, 10);
  }, [modelPackages]);

  const topFactors = useMemo(() => {
    const factorMap = new Map<string, number>();

    for (const pkg of modelPackages) {
      if (!pkg.modelTopFactors || pkg.modelTopFactors.length === 0) continue;

      for (const factor of pkg.modelTopFactors) {
        const cleaned = factor.trim();
        if (!cleaned) continue;
        factorMap.set(cleaned, (factorMap.get(cleaned) || 0) + 1);
      }
    }

    return Array.from(factorMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [modelPackages]);

  const overrideCount = useMemo(
    () => modelPackages.filter((pkg) => pkg.oemOverrideApplied).length,
    [modelPackages],
  );

  const totalModelPackages = modelPackages.length;
  const maxLabelCount = Math.max(1, ...Object.values(labelCounts));
  const maxConfidenceBucket = Math.max(1, ...Object.values(confidenceBuckets));

  return (
    <div className="h-full flex flex-col bg-gray-900">
      <header className="bg-gradient-to-r from-gray-800 via-gray-800 to-indigo-900/30 border-b border-gray-700/50 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-gray-100 to-indigo-300 bg-clip-text text-transparent">
              AI / ML Model Insights
            </h1>
            <p className="text-gray-400 mt-1">
              Understand app risk scores, confidence, and why the model made each decision.
            </p>
          </div>
          <Link
            to="/packages"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-600 text-gray-200 hover:bg-gray-800 transition-colors"
          >
            Open Packages
          </Link>
        </div>
      </header>

      <div className="flex-1 p-6 overflow-hidden">
        <div className="h-full overflow-y-auto pr-1">
          {!selectedDevice ? (
            <div className="h-full flex items-center justify-center bg-gray-800 rounded-xl border border-gray-700">
              <div className="text-center max-w-md px-8">
                <h3 className="text-2xl font-bold text-white mb-2">Select a Device</h3>
                <p className="text-gray-400">
                  Connect and select an Android device from Dashboard to view AI/ML model analysis for installed apps.
                </p>
                <Link
                  to="/dashboard"
                  className="inline-flex mt-4 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-500 text-sm font-medium"
                >
                  Open Dashboard
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-gradient-to-br from-gray-800 to-gray-800/80 rounded-xl border border-gray-700/70 p-4 shadow-lg shadow-black/20">
                  <h3 className="text-sm font-medium text-gray-300 mb-3">Model Summary</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Scored Packages</span>
                      <span className="text-white">{isLoadingPackages ? "..." : totalModelPackages}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Unsafe Flags</span>
                      <span className="text-red-300">{labelCounts.UNSAFE}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Expert Caution</span>
                      <span className="text-orange-300">{labelCounts.EXPERT}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">OEM Overrides</span>
                      <span className="text-amber-300">{overrideCount}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-gray-800 to-indigo-900/20 rounded-xl border border-gray-700/70 p-4 shadow-lg shadow-black/20">
                  <h3 className="text-sm font-medium text-gray-200 mb-2">How to Read This</h3>
                  <ul className="space-y-2 text-xs text-gray-300 list-disc pl-4">
                    <li>Higher confidence means the model is more certain about that package score.</li>
                    <li>UNSAFE and EXPERT packages should be reviewed before any uninstall action.</li>
                    <li>Top factors are model clues that influenced the score.</li>
                    <li>OEM overrides are extra safety rules for specific phone brands.</li>
                  </ul>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4">
                {LABELS.map((label) => {
                  const count = labelCounts[label];
                  const width = Math.round((count / maxLabelCount) * 100);
                  return (
                    <Link
                      key={label}
                      to={packagesLinkForLabel(label)}
                      className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl border border-gray-700/70 p-4 shadow-lg shadow-black/20"
                    >
                      <div className={`inline-flex px-2 py-1 rounded-md border text-xs ${labelTone(label)}`}>
                        {label}
                      </div>
                      <p className="text-3xl font-bold mt-3">{count}</p>
                      <p className="text-xs text-gray-400 mt-1">Open in Packages</p>
                      <div className="mt-3 h-2 w-full rounded-full bg-gray-700">
                        <div
                          className={`h-full rounded-full ${progressTone(label)}`}
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </Link>
                  );
                })}
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl border border-gray-700/70 p-5 shadow-lg shadow-black/20">
                  <h2 className="text-lg font-semibold mb-4">Confidence Distribution</h2>
                  <div className="space-y-4 text-sm">
                    {[
                      {
                        name: "High (80%+)",
                        value: confidenceBuckets.high,
                        tone: "bg-emerald-500",
                      },
                      {
                        name: "Medium (60-79%)",
                        value: confidenceBuckets.medium,
                        tone: "bg-yellow-500",
                      },
                      {
                        name: "Low (<60%)",
                        value: confidenceBuckets.low,
                        tone: "bg-orange-500",
                      },
                      {
                        name: "Unknown",
                        value: confidenceBuckets.unknown,
                        tone: "bg-gray-500",
                      },
                    ].map((bucket) => {
                      const width = Math.round((bucket.value / maxConfidenceBucket) * 100);
                      return (
                        <div key={bucket.name}>
                          <div className="flex justify-between mb-1.5">
                            <span className="text-gray-300">{bucket.name}</span>
                            <span className="text-white">{bucket.value}</span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-gray-700">
                            <div
                              className={`h-full rounded-full ${bucket.tone}`}
                              style={{ width: `${width}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl border border-gray-700/70 p-5 shadow-lg shadow-black/20">
                  <h2 className="text-lg font-semibold mb-4">Most Common Model Factors</h2>
                  <div className="space-y-2">
                    {topFactors.length > 0 ? (
                      topFactors.map(([factor, count]) => (
                        <div key={factor} className="flex items-center justify-between gap-4 p-2 rounded-lg bg-gray-800/70 border border-gray-700/70">
                          <span className="text-sm text-gray-200 truncate">{factor}</span>
                          <span className="text-xs text-indigo-300 flex-shrink-0">{count} packages</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-gray-400">No model explanation factors available yet.</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl border border-gray-700/70 p-5 shadow-lg shadow-black/20">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">Risky Apps to Review</h2>
                  <span className="text-xs text-gray-400">UNSAFE + EXPERT (top confidence)</span>
                </div>
                {topRiskPackages.length === 0 ? (
                  <p className="text-sm text-gray-400">No high-risk model results detected for this device.</p>
                ) : (
                  <div className="space-y-2">
                    {topRiskPackages.map((pkg) => (
                      <div
                        key={pkg.name}
                        className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 p-3 rounded-lg bg-gray-800/70 border border-gray-700/70"
                      >
                        <div>
                          <p className="text-sm font-medium text-white truncate">{pkg.name}</p>
                          <p className="text-xs text-gray-400 truncate">
                            {(pkg.modelTopFactors && pkg.modelTopFactors[0]) || "No factor provided"}
                          </p>
                        </div>
                        <span
                          className={`text-xs px-2 py-1 rounded border ${
                            pkg.modelLabel === "UNSAFE"
                              ? "text-red-300 border-red-500/40 bg-red-500/10"
                              : "text-orange-300 border-orange-500/40 bg-orange-500/10"
                          }`}
                        >
                          {pkg.modelLabel || "UNKNOWN"}
                        </span>
                        <span className="text-sm text-indigo-300 min-w-[56px] text-right">
                          {typeof pkg.modelConfidence === "number"
                            ? `${Math.round(pkg.modelConfidence * 100)}%`
                            : "-"}
                        </span>
                        <Link
                          to={packagesLinkForPackage(pkg.name)}
                          className="text-xs px-2 py-1 rounded border border-gray-600 text-gray-200 hover:bg-gray-700"
                        >
                          View in Packages
                        </Link>
                      </div>
                    ))}
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