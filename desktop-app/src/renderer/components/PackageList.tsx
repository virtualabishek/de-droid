import { useState, useMemo, useEffect } from "react";
import { useDeviceStore } from "../store/deviceStore";
import { PackageDetailsModal } from "./PackageDetailsModal";

interface PackageListProps {
  onAction: (
    action: "uninstall" | "restore" | "disable" | "enable",
    packages: string[],
  ) => void;
  isLoading: boolean;
  onOpenPermissions?: (packageName: string) => void;
}

interface AlternativeApp {
  id: string;
  name: string;
  description: string;
  packageId: string;
  source: string;
  sourceUrl: string;
  githubUrl: string;
  icon: string;
}

// Common system package prefixes that indicate system/pre-installed apps
const SYSTEM_PACKAGE_PREFIXES = [
  "com.android.",
  "com.google.",
  "com.samsung.",
  "com.huawei.",
  "com.xiaomi.",
  "com.miui.",
  "com.oppo.",
  "com.vivo.",
  "com.oneplus.",
  "com.qualcomm.",
  "com.mediatek.",
  "com.sec.",
  "android.",
  "org.chromium.",
];

function isSystemPackage(packageName: string): boolean {
  const lowerPackageName = packageName.toLowerCase();
  return SYSTEM_PACKAGE_PREFIXES.some((prefix) =>
    lowerPackageName.startsWith(prefix),
  );
}

type SortOption = "name-asc" | "name-desc" | "state" | "category" | "removal";

export function PackageList({
  onAction,
  isLoading,
  onOpenPermissions,
}: PackageListProps) {
  const {
    packages,
    togglePackageSelection,
    selectAllPackages,
    selectAllByCategory,
    clearSelection,
    fetchAlternativesForPackage,
    fetchCategories,
    categories,
  } = useDeviceStore();

  const [searchQuery, setSearchQuery] = useState("");
  const [filterState, setFilterState] = useState<
    "all" | "enabled" | "disabled" | "uninstalled"
  >("all");
  const [filterCategory, setFilterCategory] = useState<
    "all" | "BLOATWARE" | "OPTIONAL" | "ESSENTIAL"
  >("all");
  const [packageTypeFilter, setPackageTypeFilter] = useState<
    "all" | "system" | "user"
  >("all");
  const [sortBy, setSortBy] = useState<SortOption>("name-asc");
  const [showWarningDialog, setShowWarningDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    action: "uninstall" | "restore" | "disable" | "enable";
    packages: string[];
  } | null>(null);
  const [selectedPackageAlternatives, setSelectedPackageAlternatives] =
    useState<AlternativeApp[]>([]);
  const [showAlternativesModal, setShowAlternativesModal] = useState(false);
  const [selectedPackageForAlternatives, setSelectedPackageForAlternatives] =
    useState<string | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedPackageForDetails, setSelectedPackageForDetails] = useState<
    string | null
  >(null);

  // Get selected device for details modal
  const { selectedDevice } = useDeviceStore();

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const filteredAndSortedPackages = useMemo(() => {
    // First filter
    const filtered = packages.filter((pkg) => {
      const matchesSearch =
        pkg.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pkg.description?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesState = filterState === "all" || pkg.state === filterState;
      const matchesCategory =
        filterCategory === "all" ||
        pkg.category?.toUpperCase() === filterCategory;

      // Package type filtering (system vs user-installed)
      let matchesPackageType = true;
      if (packageTypeFilter === "system") {
        matchesPackageType = isSystemPackage(pkg.name);
      } else if (packageTypeFilter === "user") {
        matchesPackageType = !isSystemPackage(pkg.name);
      }

      return (
        matchesSearch && matchesState && matchesCategory && matchesPackageType
      );
    });

    // Then sort
    return filtered.sort((a, b) => {
      switch (sortBy) {
        case "name-asc":
          return a.name.localeCompare(b.name);
        case "name-desc":
          return b.name.localeCompare(a.name);
        case "state":
          const stateOrder = { enabled: 0, disabled: 1, uninstalled: 2 };
          return (stateOrder[a.state] || 0) - (stateOrder[b.state] || 0);
        case "category":
          const catOrder = {
            ESSENTIAL: 0,
            OPTIONAL: 1,
            BLOATWARE: 2,
            undefined: 3,
          };
          return (
            (catOrder[a.category?.toUpperCase() as keyof typeof catOrder] ??
              3) -
            (catOrder[b.category?.toUpperCase() as keyof typeof catOrder] ?? 3)
          );
        case "removal":
          const removalOrder = {
            RECOMMENDED: 0,
            ADVANCED: 1,
            EXPERT: 2,
            UNSAFE: 3,
            undefined: 4,
          };
          return (
            (removalOrder[a.removal as keyof typeof removalOrder] ?? 4) -
            (removalOrder[b.removal as keyof typeof removalOrder] ?? 4)
          );
        default:
          return 0;
      }
    });
  }, [
    packages,
    searchQuery,
    filterState,
    filterCategory,
    packageTypeFilter,
    sortBy,
  ]);

  // For backwards compatibility, rename filtered variable
  const filteredPackages = filteredAndSortedPackages;

  // Calculate counts for tabs
  const packageCounts = useMemo(() => {
    const systemCount = packages.filter((pkg) =>
      isSystemPackage(pkg.name),
    ).length;
    const userCount = packages.length - systemCount;
    const enabledCount = packages.filter(
      (pkg) => pkg.state === "enabled",
    ).length;
    const disabledCount = packages.filter(
      (pkg) => pkg.state === "disabled",
    ).length;
    const uninstalledCount = packages.filter(
      (pkg) => pkg.state === "uninstalled",
    ).length;
    return {
      system: systemCount,
      user: userCount,
      all: packages.length,
      enabled: enabledCount,
      disabled: disabledCount,
      uninstalled: uninstalledCount,
    };
  }, [packages]);

  const selectedPackages = packages.filter((pkg) => pkg.selected);
  const selectedCount = selectedPackages.length;

  // Check if any selected package is essential
  const hasEssentialPackages = selectedPackages.some(
    (pkg) => pkg.category?.toUpperCase() === "ESSENTIAL",
  );

  const getStateColor = (state: string) => {
    switch (state) {
      case "enabled":
        return "text-green-400";
      case "disabled":
        return "text-yellow-400";
      case "uninstalled":
        return "text-red-400";
      default:
        return "text-gray-400";
    }
  };

  const getCategoryColor = (category?: string) => {
    switch (category?.toUpperCase()) {
      case "BLOATWARE":
        return "bg-red-500/20 text-red-400 border-red-500/30";
      case "OPTIONAL":
        return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      case "ESSENTIAL":
        return "bg-green-500/20 text-green-400 border-green-500/30";
      default:
        return "bg-gray-500/20 text-gray-400 border-gray-500/30";
    }
  };

  const getRemovalColor = (removal?: string) => {
    switch (removal) {
      case "RECOMMENDED":
        return "text-green-400";
      case "ADVANCED":
        return "text-yellow-400";
      case "EXPERT":
        return "text-orange-400";
      case "UNSAFE":
        return "text-red-400";
      default:
        return "text-gray-400";
    }
  };

  const getStateBorderClass = (state: string) => {
    switch (state) {
      case "enabled":
        return "package-enabled";
      case "disabled":
        return "package-disabled";
      case "uninstalled":
        return "package-uninstalled";
      default:
        return "";
    }
  };

  const handleActionClick = (
    action: "uninstall" | "restore" | "disable" | "enable",
  ) => {
    const packageNames = selectedPackages.map((p) => p.name);

    // Check for essential packages when uninstalling or disabling
    if (
      (action === "uninstall" || action === "disable") &&
      hasEssentialPackages
    ) {
      setPendingAction({ action, packages: packageNames });
      setShowWarningDialog(true);
      return;
    }

    onAction(action, packageNames);
  };

  const confirmWarningAction = () => {
    if (pendingAction) {
      onAction(pendingAction.action, pendingAction.packages);
    }
    setShowWarningDialog(false);
    setPendingAction(null);
  };

  const cancelWarningAction = () => {
    setShowWarningDialog(false);
    setPendingAction(null);
  };

  const handleShowAlternatives = async (packageName: string) => {
    setSelectedPackageForAlternatives(packageName);
    const alternatives = await fetchAlternativesForPackage(packageName);
    setSelectedPackageAlternatives(alternatives);
    setShowAlternativesModal(true);
  };

  const closeAlternativesModal = () => {
    setShowAlternativesModal(false);
    setSelectedPackageForAlternatives(null);
    setSelectedPackageAlternatives([]);
  };

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        {/* Package Type Tabs */}
        <div className="flex gap-1 mb-4 bg-gray-700/50 rounded-lg p-1">
          <button
            onClick={() => setPackageTypeFilter("all")}
            className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              packageTypeFilter === "all"
                ? "bg-primary-600 text-white"
                : "text-gray-300 hover:bg-gray-600"
            }`}
          >
            All ({packageCounts.all})
          </button>
          <button
            onClick={() => setPackageTypeFilter("system")}
            className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              packageTypeFilter === "system"
                ? "bg-primary-600 text-white"
                : "text-gray-300 hover:bg-gray-600"
            }`}
          >
            System ({packageCounts.system})
          </button>
          <button
            onClick={() => setPackageTypeFilter("user")}
            className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              packageTypeFilter === "user"
                ? "bg-green-600 text-white"
                : "text-gray-300 hover:bg-gray-600"
            }`}
          >
            User Apps ({packageCounts.user})
          </button>
        </div>

        {/* State summary chips */}
        <div className="flex gap-2 mb-4">
          <span className="px-2 py-1 text-xs rounded bg-green-500/20 text-green-400 border border-green-500/30">
            {packageCounts.enabled} Enabled
          </span>
          <span className="px-2 py-1 text-xs rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
            {packageCounts.disabled} Disabled
          </span>
          <span className="px-2 py-1 text-xs rounded bg-red-500/20 text-red-400 border border-red-500/30">
            {packageCounts.uninstalled} Uninstalled
          </span>
        </div>

        {/* Search Bar */}
        <div className="mb-4">
          <div className="relative">
            <input
              type="text"
              placeholder="Search packages or descriptions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded-xl pl-12 pr-4 py-3 text-white placeholder-gray-400 text-lg focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-colors"
            />
            <svg
              className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white text-xl"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Filter Dropdowns - Larger and Clearer */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="relative">
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              State
            </label>
            <select
              value={filterState}
              onChange={(e) =>
                setFilterState(e.target.value as typeof filterState)
              }
              className="w-full bg-gray-700 border-2 border-gray-600 rounded-xl px-4 py-3 text-white text-base font-medium appearance-none cursor-pointer hover:border-gray-500 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-colors"
            >
              <option value="all">📦 All States</option>
              <option value="enabled">✅ Enabled</option>
              <option value="disabled">⏸️ Disabled</option>
              <option value="uninstalled">🗑️ Uninstalled</option>
            </select>
            <svg
              className="absolute right-4 bottom-3.5 w-5 h-5 text-gray-400 pointer-events-none"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>

          <div className="relative">
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Category
            </label>
            <select
              value={filterCategory}
              onChange={(e) =>
                setFilterCategory(e.target.value as typeof filterCategory)
              }
              className="w-full bg-gray-700 border-2 border-gray-600 rounded-xl px-4 py-3 text-white text-base font-medium appearance-none cursor-pointer hover:border-gray-500 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-colors"
            >
              <option value="all">🏷️ All Categories</option>
              <option value="BLOATWARE">🗑️ Bloatware</option>
              <option value="OPTIONAL">⚡ Optional</option>
              <option value="ESSENTIAL">⭐ Essential</option>
            </select>
            <svg
              className="absolute right-4 bottom-3.5 w-5 h-5 text-gray-400 pointer-events-none"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>

          <div className="relative">
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Sort By
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="w-full bg-gray-700 border-2 border-gray-600 rounded-xl px-4 py-3 text-white text-base font-medium appearance-none cursor-pointer hover:border-gray-500 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-colors"
            >
              <option value="name-asc">🔤 Name A-Z</option>
              <option value="name-desc">🔤 Name Z-A</option>
              <option value="state">📊 By State</option>
              <option value="category">🏷️ By Category</option>
              <option value="removal">⚠️ By Removal Type</option>
            </select>
            <svg
              className="absolute right-4 bottom-3.5 w-5 h-5 text-gray-400 pointer-events-none"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => selectAllPackages()}
              className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors font-medium"
            >
              Select All
            </button>
            <button
              onClick={() => selectAllByCategory("BLOATWARE")}
              className="px-4 py-2 text-sm bg-red-600/30 hover:bg-red-600/50 text-red-300 rounded-lg transition-colors font-medium"
            >
              Select Bloatware
            </button>
            <button
              onClick={() => clearSelection()}
              className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors font-medium"
            >
              Clear
            </button>
          </div>
          <span className="text-sm text-gray-400">
            {selectedCount} selected / {filteredPackages.length} packages
          </span>
        </div>
      </div>

      {/* Package list */}
      <div className="flex-1 overflow-auto p-4">
        {filteredPackages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <svg
              className="w-12 h-12 mb-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
              />
            </svg>
            <p>No packages found</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredPackages.map((pkg) => (
              <div
                key={pkg.name}
                className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                  pkg.selected
                    ? "bg-primary-600/20"
                    : "bg-gray-700/50 hover:bg-gray-700"
                } ${getStateBorderClass(pkg.state)}`}
              >
                <input
                  type="checkbox"
                  checked={pkg.selected || false}
                  onChange={() => togglePackageSelection(pkg.name)}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-primary-600"
                />
                <div
                  className="flex-1 min-w-0"
                  onClick={() => togglePackageSelection(pkg.name)}
                >
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-sm truncate">{pkg.name}</p>
                    {pkg.category && (
                      <span
                        className={`text-xs px-2 py-0.5 rounded border ${getCategoryColor(
                          pkg.category,
                        )}`}
                      >
                        {pkg.category}
                      </span>
                    )}
                  </div>
                  {pkg.description && (
                    <p className="text-xs text-gray-400 mt-1 truncate">
                      {pkg.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {/* Permissions button */}
                  {onOpenPermissions && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenPermissions(pkg.name);
                      }}
                      className="p-1.5 text-gray-400 hover:text-primary-400 hover:bg-gray-600 rounded transition-colors"
                      title="Manage permissions"
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
                          d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                        />
                      </svg>
                    </button>
                  )}
                  {/* Details button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedPackageForDetails(pkg.name);
                      setShowDetailsModal(true);
                    }}
                    className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-600 rounded transition-colors"
                    title="View package details & permissions"
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
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </button>
                  {pkg.alternatives && pkg.alternatives.length > 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleShowAlternatives(pkg.name);
                      }}
                      className="px-2 py-1 text-xs bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 rounded transition-colors"
                      title="View alternative apps"
                    >
                      Alternatives
                    </button>
                  )}
                  {pkg.removal && (
                    <span
                      className={`text-xs font-medium ${getRemovalColor(pkg.removal)}`}
                    >
                      {pkg.removal}
                    </span>
                  )}
                  <span
                    className={`text-xs font-medium uppercase ${getStateColor(pkg.state)}`}
                  >
                    {pkg.state}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      {selectedCount > 0 && (
        <div className="p-4 border-t border-gray-700 bg-gray-800/50">
          {hasEssentialPackages && (
            <div className="mb-3 p-2 bg-red-500/20 border border-red-500/30 rounded-lg text-red-300 text-sm">
              ⚠️ Warning: Some selected packages are marked as ESSENTIAL.
              Removing them may break your device.
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleActionClick("uninstall")}
              disabled={isLoading}
              className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors font-medium"
            >
              Uninstall
            </button>
            <button
              onClick={() => handleActionClick("restore")}
              disabled={isLoading}
              className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors font-medium"
            >
              Restore
            </button>
            <button
              onClick={() => handleActionClick("disable")}
              disabled={isLoading}
              className="flex-1 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors font-medium"
            >
              Disable
            </button>
            <button
              onClick={() => handleActionClick("enable")}
              disabled={isLoading}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors font-medium"
            >
              Enable
            </button>
          </div>
        </div>
      )}

      {/* Warning Dialog */}
      {showWarningDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 max-w-md mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-red-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-red-400">
                  Warning: Essential Packages
                </h3>
                <p className="text-sm text-gray-400">
                  This action may break your device
                </p>
              </div>
            </div>
            <p className="text-gray-300 mb-6">
              You are about to {pendingAction?.action} essential system
              packages. This may cause your device to malfunction, lose
              functionality, or become unusable. Are you absolutely sure you
              want to continue?
            </p>
            <div className="flex gap-3">
              <button
                onClick={cancelWarningAction}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmWarningAction}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors font-medium"
              >
                I understand, proceed
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alternatives Modal */}
      {showAlternativesModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 max-w-lg mx-4 max-h-[80vh] overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Alternative Apps</h3>
              <button
                onClick={closeAlternativesModal}
                className="text-gray-400 hover:text-white"
              >
                ×
              </button>
            </div>
            <p className="text-sm text-gray-400 mb-4">
              Open-source alternatives for{" "}
              <span className="font-mono text-white">
                {selectedPackageForAlternatives}
              </span>
            </p>
            {selectedPackageAlternatives.length === 0 ? (
              <p className="text-gray-400">
                No alternatives found for this package.
              </p>
            ) : (
              <div className="space-y-3">
                {selectedPackageAlternatives.map((alt) => (
                  <div
                    key={alt.id}
                    className="bg-gray-700/50 border border-gray-600 rounded-lg p-4"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium text-white">{alt.name}</h4>
                      <span className="text-xs bg-blue-600/30 text-blue-300 px-2 py-1 rounded">
                        {alt.source}
                      </span>
                    </div>
                    <p className="text-sm text-gray-400 mb-3">
                      {alt.description}
                    </p>
                    <div className="flex gap-2">
                      <a
                        href={alt.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs px-3 py-1 bg-green-600/30 hover:bg-green-600/50 text-green-300 rounded transition-colors"
                      >
                        Get from {alt.source}
                      </a>
                      <a
                        href={alt.githubUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs px-3 py-1 bg-gray-600/50 hover:bg-gray-600/70 text-gray-300 rounded transition-colors"
                      >
                        View Source
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Package Details Modal */}
      {selectedDevice && (
        <PackageDetailsModal
          isOpen={showDetailsModal}
          onClose={() => {
            setShowDetailsModal(false);
            setSelectedPackageForDetails(null);
          }}
          packageName={selectedPackageForDetails || ""}
          deviceId={selectedDevice.adb_id}
        />
      )}
    </div>
  );
}
