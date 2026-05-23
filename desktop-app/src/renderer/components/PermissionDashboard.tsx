/**
 * Permission Dashboard - Comprehensive view of all app permissions
 * Shows permission analytics, privacy scores, and bulk management
 */
import { useState, useMemo } from "react";
import { useDeviceStore } from "../store/deviceStore";
import { useToastStore } from "../store/toastStore";
import { usePermissionStore } from "../store/permissionStore";
import { permissionAnalyticsService } from "../services/permissionService";

interface PermissionDashboardProps {
  onOpenAppPermissions: (packageName: string) => void;
}

export function PermissionDashboard({ onOpenAppPermissions }: PermissionDashboardProps) {
  const { selectedDevice, selectedUser, packages } = useDeviceStore();
  const toast = useToastStore();
  const { 
    appPermissions, 
    stats: storeStats, 
    isScanning, 
    scanProgress, 
    scanAllApps: storeScanAllApps,
    bulkRevokePermissions: storeBulkRevokePermissions
  } = usePermissionStore();

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"privacy" | "dangerous" | "name">("privacy");
  const [viewMode, setViewMode] = useState<"overview" | "apps" | "categories">("overview");
  const [expandedApp, setExpandedApp] = useState<string | null>(null);
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  // Scan all apps for permissions
  const scanAllApps = async () => {
    if (!selectedDevice) return;

    try {
      await storeScanAllApps(selectedDevice.adb_id, selectedUser, packages);
      toast.success("Scan Complete", `Scanned apps with permissions`);
    } catch (error) {
      console.error("Failed to scan permissions:", error);
      toast.error(
        "Failed to scan permissions",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  };

  // Aggregate stats
  const stats = useMemo(() => {
    if (storeStats) return storeStats;
    return permissionAnalyticsService.buildStats(appPermissions);
  }, [appPermissions, storeStats]);

  // Bulk revoke all dangerous permissions for selected apps
  const bulkRevokePermissions = async (categoryFilter?: string) => {
    if (!selectedDevice || selectedApps.size === 0) return;

    setBulkActionLoading(true);
    try {
      const { successCount, failCount } = await storeBulkRevokePermissions(
        selectedDevice.adb_id,
        selectedUser,
        selectedApps,
        categoryFilter
      );

      toast.success(
        "Bulk Revoke Complete",
        `Revoked ${successCount} permissions${failCount > 0 ? `, ${failCount} failed` : ""}`
      );

      // Rescan to update
      await scanAllApps();
      setSelectedApps(new Set());
    } catch (error) {
      toast.error("Bulk Revoke Failed", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setBulkActionLoading(false);
    }
  };


  // Filtered and sorted apps
  const filteredApps = useMemo(() => {
    return permissionAnalyticsService.filterAndSortApps(
      appPermissions,
      searchQuery,
      selectedCategory,
      sortBy,
    );
  }, [appPermissions, searchQuery, selectedCategory, sortBy]);

  // Apps with permissions in selected category
  const appsInCategory = useMemo(() => {
    return permissionAnalyticsService.findAppsInCategory(
      appPermissions,
      selectedCategory,
    );
  }, [appPermissions, selectedCategory]);

  // Toggle app selection
  const toggleAppSelection = (packageName: string) => {
    const newSelected = new Set(selectedApps);
    if (newSelected.has(packageName)) {
      newSelected.delete(packageName);
    } else {
      newSelected.add(packageName);
    }
    setSelectedApps(newSelected);
  };

  // Select all visible apps
  const selectAllVisible = () => {
    const newSelected = new Set(filteredApps.map(app => app.packageName));
    setSelectedApps(newSelected);
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedApps(new Set());
  };

  // Get privacy score color
  const getPrivacyScoreColor = (score: number) => {
    return permissionAnalyticsService.getPrivacyScoreColor(score);
  };

  const getPrivacyScoreBg = (score: number) => {
    return permissionAnalyticsService.getPrivacyScoreBg(score);
  };

  return (
    <div className="h-full flex flex-col bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-gray-700 bg-gradient-to-r from-gray-800 to-primary-600/10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-primary-600 rounded-xl shadow-lg shadow-primary-500/30">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold">Permission Dashboard</h2>
              <p className="text-sm text-gray-400">Analyze and manage app permissions</p>
            </div>
          </div>

          <button
            onClick={scanAllApps}
            disabled={isScanning}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-500 rounded-xl font-medium transition-all shadow-lg shadow-primary-500/30 disabled:opacity-50 text-white"
          >
            {isScanning ? (
              <>
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Scanning... {scanProgress}%</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <span>{appPermissions.length > 0 ? "Rescan" : "Scan All Apps"}</span>
              </>
            )}
          </button>
        </div>

        {/* Scan Progress Bar */}
        {isScanning && (
          <div className="mb-4">
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary-500 transition-all duration-300"
                style={{ width: `${scanProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* View Mode Tabs */}
        <div className="flex gap-2">
          {(["overview", "apps", "categories"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                viewMode === mode
                  ? "bg-primary-600 text-white shadow-lg shadow-primary-500/30"
                  : "bg-gray-700/50 text-gray-400 hover:text-white hover:bg-gray-700"
              }`}
            >
              {mode === "overview" && "Overview"}
              {mode === "apps" && "By App"}
              {mode === "categories" && "By Category"}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {appPermissions.length === 0 && !isScanning ? (
          /* Empty State */
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-md">
              <div className="w-24 h-24 mx-auto mb-6 bg-primary-600/10 rounded-3xl flex items-center justify-center border border-primary-500/30">
                <svg className="w-12 h-12 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold mb-3">Permission Scanner</h3>
              <p className="text-gray-400 mb-6">
                Scan all your apps to see which permissions they have access to. 
                Identify privacy-invasive apps and revoke unnecessary permissions.
              </p>
              <button
                onClick={scanAllApps}
                className="px-6 py-3 bg-primary-600 hover:bg-primary-500 rounded-xl font-medium transition-all shadow-lg shadow-primary-500/30 text-white"
              >
                Start Scanning
              </button>
            </div>
          </div>
        ) : viewMode === "overview" ? (
          /* Overview Mode */
          <div className="space-y-6">
            {/* Stats Grid */}
            <div className="grid grid-cols-4 gap-4">
              <div className="bg-gradient-to-br from-gray-700/50 to-gray-800/50 rounded-xl p-5 border border-gray-700">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-blue-500/20 rounded-lg">
                    <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                    </svg>
                  </div>
                  <span className="text-sm text-gray-400">Apps Scanned</span>
                </div>
                <p className="text-3xl font-bold">{stats.totalApps}</p>
              </div>

              <div className="bg-gradient-to-br from-gray-700/50 to-gray-800/50 rounded-xl p-5 border border-gray-700">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-red-500/20 rounded-lg">
                    <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <span className="text-sm text-gray-400">Dangerous Granted</span>
                </div>
                <p className="text-3xl font-bold text-red-400">{stats.grantedDangerous}</p>
                <p className="text-xs text-gray-500 mt-1">of {stats.totalDangerous} total</p>
              </div>

              <div className="bg-gradient-to-br from-gray-700/50 to-gray-800/50 rounded-xl p-5 border border-gray-700">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-yellow-500/20 rounded-lg">
                    <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <span className="text-sm text-gray-400">High Risk Apps</span>
                </div>
                <p className="text-3xl font-bold text-yellow-400">
                  {appPermissions.filter(a => a.privacyScore < 40).length}
                </p>
              </div>

              <div className="bg-gradient-to-br from-gray-700/50 to-gray-800/50 rounded-xl p-5 border border-gray-700">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`p-2 rounded-lg ${getPrivacyScoreBg(stats.averagePrivacyScore)}/20`}>
                    <svg className={`w-5 h-5 ${getPrivacyScoreColor(stats.averagePrivacyScore)}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                  <span className="text-sm text-gray-400">Privacy Score</span>
                </div>
                <p className={`text-3xl font-bold ${getPrivacyScoreColor(stats.averagePrivacyScore)}`}>
                  {stats.averagePrivacyScore}%
                </p>
              </div>
            </div>

            {/* Permission Categories */}
            <div>
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                Permission Categories
              </h3>
              <div className="grid grid-cols-3 gap-3">
                {Object.entries(stats.categoryStats)
                  .sort((a, b) => b[1].granted - a[1].granted)
                  .map(([category, data]) => {
                    const config = permissionAnalyticsService.getCategoryConfig(category);
                    return (
                      <button
                        key={category}
                        onClick={() => {
                          setSelectedCategory(category);
                          setViewMode("categories");
                        }}
                        className={`${config.bg} border border-gray-700 hover:border-gray-600 rounded-xl p-4 text-left transition-all hover:scale-[1.02]`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-2xl">{config.icon}</span>
                          <span className={`text-lg font-bold ${config.color}`}>{data.granted}</span>
                        </div>
                        <p className="font-medium">{category}</p>
                        <p className="text-xs text-gray-400">{data.apps} apps</p>
                      </button>
                    );
                  })}
              </div>
            </div>

            {/* Most Privacy-Invasive Apps */}
            <div>
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Most Privacy-Invasive Apps
              </h3>
              <div className="space-y-2">
                {filteredApps.slice(0, 5).map((app, index) => (
                  <div
                    key={app.packageName}
                    className="flex items-center gap-4 p-4 bg-gray-700/30 hover:bg-gray-700/50 rounded-xl border border-gray-700 cursor-pointer transition-all"
                    onClick={() => onOpenAppPermissions(app.packageName)}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg ${
                      index === 0 ? "bg-red-500/30 text-red-400" :
                      index === 1 ? "bg-orange-500/30 text-orange-400" :
                      index === 2 ? "bg-yellow-500/30 text-yellow-400" :
                      "bg-gray-600 text-gray-400"
                    }`}>
                      {index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{app.appName}</p>
                      <p className="text-xs text-gray-500 truncate">{app.packageName}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-sm font-medium text-red-400">{app.grantedDangerousCount} dangerous</p>
                        <p className="text-xs text-gray-500">{app.totalCount} total</p>
                      </div>
                      <div className={`px-3 py-1.5 rounded-lg ${getPrivacyScoreBg(app.privacyScore)}/20`}>
                        <span className={`text-sm font-bold ${getPrivacyScoreColor(app.privacyScore)}`}>
                          {app.privacyScore}%
                        </span>
                      </div>
                      <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : viewMode === "apps" ? (
          /* Apps View */
          <div className="space-y-4">
            {/* Search and Sort */}
            <div className="flex gap-4">
              <div className="flex-1 relative">
                <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search apps..."
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as "privacy" | "dangerous" | "name")}
                className="bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="privacy">Sort by Privacy Risk</option>
                <option value="dangerous">Sort by Dangerous Count</option>
                <option value="name">Sort by Name</option>
              </select>
            </div>

            {/* Bulk Actions */}
            {selectedApps.size > 0 && (
              <div className="flex items-center justify-between p-4 bg-primary-500/20 border border-primary-500/30 rounded-xl">
                <div className="flex items-center gap-3">
                  <span className="font-medium">{selectedApps.size} apps selected</span>
                  <button onClick={clearSelection} className="text-sm text-gray-400 hover:text-white">
                    Clear
                  </button>
                </div>
                <button
                  onClick={() => bulkRevokePermissions()}
                  disabled={bulkActionLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg font-medium transition-all disabled:opacity-50"
                >
                  {bulkActionLoading ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                  )}
                  Revoke All Dangerous
                </button>
              </div>
            )}

            {/* Select All */}
            <div className="flex justify-between items-center text-sm text-gray-400">
              <span>{filteredApps.length} apps</span>
              <button onClick={selectAllVisible} className="hover:text-primary-400">
                Select all visible
              </button>
            </div>

            {/* App List */}
            <div className="space-y-2">
              {filteredApps.map((app) => (
                <div key={app.packageName} className="bg-gray-700/30 rounded-xl border border-gray-700 overflow-hidden">
                  <div
                    className="flex items-center gap-4 p-4 cursor-pointer hover:bg-gray-700/50 transition-all"
                    onClick={() => setExpandedApp(expandedApp === app.packageName ? null : app.packageName)}
                  >
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={selectedApps.has(app.packageName)}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleAppSelection(app.packageName);
                      }}
                      className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-primary-600 focus:ring-primary-500"
                    />

                    {/* Privacy Score Circle */}
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold ${getPrivacyScoreBg(app.privacyScore)}/20 border border-gray-600`}>
                      <span className={getPrivacyScoreColor(app.privacyScore)}>{app.privacyScore}</span>
                    </div>

                    {/* App Info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{app.appName}</p>
                      <p className="text-xs text-gray-500 truncate">{app.packageName}</p>
                    </div>

                    {/* Permission Categories Preview */}
                    <div className="flex gap-1">
                      {Array.from(new Set(app.permissions.filter(p => p.isDangerous && p.granted).map(p => p.category)))
                        .slice(0, 5)
                        .map((cat) => {
                          const config = permissionAnalyticsService.getCategoryConfig(cat);
                          return (
                            <span key={cat} className={`${config.bg} p-1.5 rounded-lg`} title={cat}>
                              {config.icon}
                            </span>
                          );
                        })}
                    </div>

                    {/* Stats */}
                    <div className="text-right">
                      <p className="text-sm font-medium text-red-400">{app.grantedDangerousCount}</p>
                      <p className="text-xs text-gray-500">dangerous</p>
                    </div>

                    {/* Expand Arrow */}
                    <svg 
                      className={`w-5 h-5 text-gray-500 transition-transform ${expandedApp === app.packageName ? "rotate-90" : ""}`} 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>

                  {/* Expanded Permissions */}
                  {expandedApp === app.packageName && (
                    <div className="border-t border-gray-700 p-4 bg-gray-800/50">
                      <div className="flex justify-between items-center mb-4">
                        <h4 className="font-medium">Dangerous Permissions</h4>
                        <button
                          onClick={() => onOpenAppPermissions(app.packageName)}
                          className="text-sm text-primary-400 hover:text-primary-300"
                        >
                          Manage All Permissions →
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {app.permissions
                          .filter(p => p.isDangerous && p.granted)
                          .map((perm) => {
                            const config = permissionAnalyticsService.getCategoryConfig(perm.category);
                            return (
                              <div
                                key={perm.name}
                                className={`flex items-center gap-3 p-3 rounded-lg ${config.bg} border border-gray-700`}
                              >
                                <span className="text-lg">{config.icon}</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate">{perm.description}</p>
                                  <p className="text-xs text-gray-500">{perm.type}</p>
                                </div>
                                {perm.type === "runtime" && (
                                  <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded">
                                    Revocable
                                  </span>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* Categories View */
          <div className="space-y-6">
            {/* Category Selector */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedCategory(null)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  !selectedCategory
                    ? "bg-primary-600 text-white"
                    : "bg-gray-700/50 text-gray-400 hover:text-white hover:bg-gray-700"
                }`}
              >
                All Categories
              </button>
              {Object.entries(stats.categoryStats)
                .sort((a, b) => b[1].granted - a[1].granted)
                .map(([category, data]) => {
                  const config = permissionAnalyticsService.getCategoryConfig(category);
                  return (
                    <button
                      key={category}
                      onClick={() => setSelectedCategory(category === selectedCategory ? null : category)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        selectedCategory === category
                          ? `${config.bg} ${config.color} border border-current`
                          : "bg-gray-700/50 text-gray-400 hover:text-white hover:bg-gray-700"
                      }`}
                    >
                      <span>{config.icon}</span>
                      <span>{category}</span>
                      <span className="px-1.5 py-0.5 bg-gray-800/50 rounded text-xs">{data.granted}</span>
                    </button>
                  );
                })}
            </div>

            {/* Category Detail */}
            {selectedCategory && (
              <div className={`p-5 rounded-xl ${permissionAnalyticsService.getCategoryConfig(selectedCategory).bg || "bg-gray-700/50"} border border-gray-700`}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{permissionAnalyticsService.getCategoryConfig(selectedCategory).icon}</span>
                    <div>
                      <h3 className={`text-xl font-bold ${permissionAnalyticsService.getCategoryConfig(selectedCategory).color}`}>
                        {selectedCategory}
                      </h3>
                      <p className="text-sm text-gray-400">
                        {permissionAnalyticsService.getCategoryConfig(selectedCategory).description}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold">{stats.categoryStats[selectedCategory]?.granted || 0}</p>
                    <p className="text-sm text-gray-400">permissions granted</p>
                  </div>
                </div>

                {/* Bulk revoke for category */}
                {appsInCategory.length > 0 && (
                  <button
                    onClick={() => {
                      setSelectedApps(new Set(appsInCategory.map(a => a.packageName)));
                      bulkRevokePermissions(selectedCategory);
                    }}
                    disabled={bulkActionLoading}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-600/80 hover:bg-red-600 rounded-xl font-medium transition-all disabled:opacity-50"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                    Revoke {selectedCategory} from All Apps ({appsInCategory.length})
                  </button>
                )}
              </div>
            )}

            {/* Apps with selected category */}
            <div className="space-y-2">
              {(selectedCategory ? appsInCategory : filteredApps).map((app) => {
                const categoryPerms = selectedCategory 
                  ? app.permissions.filter(p => p.category === selectedCategory && p.isDangerous && p.granted)
                  : app.permissions.filter(p => p.isDangerous && p.granted);

                return (
                  <div
                    key={app.packageName}
                    className="flex items-center gap-4 p-4 bg-gray-700/30 hover:bg-gray-700/50 rounded-xl border border-gray-700 cursor-pointer transition-all"
                    onClick={() => onOpenAppPermissions(app.packageName)}
                  >
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold ${getPrivacyScoreBg(app.privacyScore)}/20`}>
                      <span className={getPrivacyScoreColor(app.privacyScore)}>{app.privacyScore}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{app.appName}</p>
                      <p className="text-xs text-gray-500 truncate">{app.packageName}</p>
                    </div>
                    <div className="flex flex-wrap gap-1 max-w-xs">
                      {categoryPerms.slice(0, 3).map((perm) => (
                        <span 
                          key={perm.name}
                          className="px-2 py-1 bg-gray-700 rounded text-xs truncate max-w-[120px]"
                          title={perm.name}
                        >
                          {perm.description}
                        </span>
                      ))}
                      {categoryPerms.length > 3 && (
                        <span className="px-2 py-1 bg-gray-700 rounded text-xs">
                          +{categoryPerms.length - 3}
                        </span>
                      )}
                    </div>
                    <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer with tips */}
      <div className="p-4 border-t border-gray-700 bg-gray-800/50">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              80-100: Excellent
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
              60-79: Good
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-orange-500"></span>
              40-59: Fair
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-500"></span>
              0-39: High Risk
            </span>
          </div>
          <span>Only runtime permissions can be revoked via ADB</span>
        </div>
      </div>
    </div>
  );
}
