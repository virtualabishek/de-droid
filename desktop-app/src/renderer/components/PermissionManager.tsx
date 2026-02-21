/**
 * Permission Manager Component - View and manage app permissions
 */
import { useState, useEffect, useMemo } from "react";
import { useDeviceStore } from "../store/deviceStore";
import { useToastStore } from "../store/toastStore";

interface Permission {
  name: string;
  granted: boolean;
  category: string;
  description: string;
  isDangerous: boolean;
  type: "runtime" | "install";
}

interface PermissionResult {
  packageName: string;
  permissions: Permission[];
  dangerousCount: number;
  grantedDangerousCount: number;
  totalCount: number;
}

// Category config
const CATEGORY_CONFIG: Record<
  string,
  { icon: string; color: string; bg: string }
> = {
  Location: { icon: "📍", color: "text-red-400", bg: "bg-red-500/20" },
  Camera: { icon: "📷", color: "text-purple-400", bg: "bg-purple-500/20" },
  Microphone: { icon: "🎤", color: "text-orange-400", bg: "bg-orange-500/20" },
  Contacts: { icon: "👥", color: "text-blue-400", bg: "bg-blue-500/20" },
  Phone: { icon: "📞", color: "text-green-400", bg: "bg-green-500/20" },
  SMS: { icon: "💬", color: "text-cyan-400", bg: "bg-cyan-500/20" },
  Storage: { icon: "📁", color: "text-yellow-400", bg: "bg-yellow-500/20" },
  Calendar: { icon: "📅", color: "text-pink-400", bg: "bg-pink-500/20" },
  Sensors: { icon: "⌚", color: "text-indigo-400", bg: "bg-indigo-500/20" },
  Bluetooth: { icon: "📶", color: "text-blue-300", bg: "bg-blue-500/20" },
  Notifications: { icon: "🔔", color: "text-amber-400", bg: "bg-amber-500/20" },
  Other: { icon: "⚙️", color: "text-gray-400", bg: "bg-gray-500/20" },
};

interface PermissionManagerProps {
  packageName: string;
  onClose: () => void;
}

export function PermissionManager({
  packageName,
  onClose,
}: PermissionManagerProps) {
  const { selectedDevice, selectedUser } = useDeviceStore();
  const toast = useToastStore();

  const [permissions, setPermissions] = useState<PermissionResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "dangerous" | "granted">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch permissions
  useEffect(() => {
    if (selectedDevice && packageName) {
      loadPermissions();
    }
  }, [selectedDevice, packageName]);

  const loadPermissions = async () => {
    if (!selectedDevice) return;

    setIsLoading(true);
    try {
      const result = await window.electronAPI.adb.getPackagePermissions(
        selectedDevice.adb_id,
        packageName,
      );
      setPermissions(result);
    } catch (error) {
      console.error("Failed to load permissions:", error);
      toast.error("Failed to load permissions");
    } finally {
      setIsLoading(false);
    }
  };

  // Toggle permission (grant/revoke)
  const togglePermission = async (permission: Permission) => {
    if (!selectedDevice || permission.type !== "runtime") return;

    setActionLoading(permission.name);
    try {
      const action = permission.granted ? "revoke" : "grant";
      const result = await window.electronAPI.adb.togglePermission(
        selectedDevice.adb_id,
        packageName,
        permission.name,
        action,
        selectedUser,
      );

      if (result.success) {
        toast.success(`Permission ${action}ed`, `${permission.description}`);
        // Refresh permissions
        await loadPermissions();
      } else {
        toast.error(`Failed to ${action} permission`, result.error);
      }
    } catch (error) {
      toast.error(
        "Permission change failed",
        error instanceof Error ? error.message : "Unknown error",
      );
    } finally {
      setActionLoading(null);
    }
  };

  // Filter and search permissions
  const filteredPermissions = useMemo(() => {
    if (!permissions) return [];

    let filtered = permissions.permissions;

    // Apply filter
    if (filter === "dangerous") {
      filtered = filtered.filter((p) => p.isDangerous);
    } else if (filter === "granted") {
      filtered = filtered.filter((p) => p.granted);
    }

    // Apply search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.description.toLowerCase().includes(query) ||
          p.category.toLowerCase().includes(query),
      );
    }

    return filtered;
  }, [permissions, filter, searchQuery]);

  // Group permissions by category
  const groupedPermissions = useMemo(() => {
    const groups: Record<string, Permission[]> = {};

    for (const perm of filteredPermissions) {
      if (!groups[perm.category]) {
        groups[perm.category] = [];
      }
      groups[perm.category].push(perm);
    }

    return groups;
  }, [filteredPermissions]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-6 border-b border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary-500/20 rounded-lg">
                <svg
                  className="w-6 h-6 text-primary-400"
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
              </div>
              <div>
                <h2 className="text-xl font-bold">Permission Manager</h2>
                <p className="text-sm text-gray-400 font-mono">{packageName}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
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
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Stats */}
          {permissions && (
            <div className="flex gap-4 mb-4">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-700/50 rounded-lg">
                <span className="text-gray-400 text-sm">Total:</span>
                <span className="font-medium">{permissions.totalCount}</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/20 rounded-lg">
                <span className="text-red-400 text-sm">Dangerous:</span>
                <span className="font-medium text-red-400">
                  {permissions.dangerousCount}
                </span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-500/20 rounded-lg">
                <span className="text-yellow-400 text-sm">
                  Granted (Dangerous):
                </span>
                <span className="font-medium text-yellow-400">
                  {permissions.grantedDangerousCount}
                </span>
              </div>
            </div>
          )}

          {/* Search and Filter */}
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <svg
                className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
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
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search permissions..."
                className="w-full bg-gray-700 border border-gray-600 rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div className="flex bg-gray-700 rounded-lg p-1">
              {(["all", "dangerous", "granted"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    filter === f
                      ? "bg-primary-600 text-white"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-500"></div>
            </div>
          ) : Object.keys(groupedPermissions).length === 0 ? (
            <div className="text-center py-12">
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
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
              <p className="text-gray-400">
                No permissions found matching your criteria
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedPermissions).map(([category, perms]) => {
                const config =
                  CATEGORY_CONFIG[category] || CATEGORY_CONFIG["Other"];

                return (
                  <div key={category}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className={`${config.bg} p-1.5 rounded`}>
                        <span className="text-lg">{config.icon}</span>
                      </span>
                      <h3 className={`font-medium ${config.color}`}>
                        {category}
                      </h3>
                      <span className="text-xs text-gray-500">
                        ({perms.length})
                      </span>
                    </div>

                    <div className="space-y-2">
                      {perms.map((perm) => (
                        <div
                          key={perm.name}
                          className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                            perm.isDangerous
                              ? "bg-red-500/5 border-red-500/20 hover:bg-red-500/10"
                              : "bg-gray-700/30 border-gray-700 hover:bg-gray-700/50"
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-sm truncate">
                                {perm.description}
                              </p>
                              {perm.isDangerous && (
                                <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 text-xs rounded">
                                  Dangerous
                                </span>
                              )}
                              {perm.type === "install" && (
                                <span className="px-1.5 py-0.5 bg-gray-600 text-gray-300 text-xs rounded">
                                  Install
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 font-mono mt-0.5 truncate">
                              {perm.name}
                            </p>
                          </div>

                          <div className="flex items-center gap-3 ml-4">
                            {/* Status badge */}
                            <span
                              className={`px-2 py-1 rounded text-xs font-medium ${
                                perm.granted
                                  ? "bg-green-500/20 text-green-400"
                                  : "bg-gray-600 text-gray-400"
                              }`}
                            >
                              {perm.granted ? "Granted" : "Denied"}
                            </span>

                            {/* Toggle button - only for runtime permissions */}
                            {perm.type === "runtime" && (
                              <button
                                onClick={() => togglePermission(perm)}
                                disabled={actionLoading === perm.name}
                                className={`relative w-12 h-6 rounded-full transition-colors ${
                                  perm.granted ? "bg-green-500" : "bg-gray-600"
                                } ${actionLoading === perm.name ? "opacity-50" : ""}`}
                              >
                                <div
                                  className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                                    perm.granted ? "left-7" : "left-1"
                                  }`}
                                >
                                  {actionLoading === perm.name && (
                                    <div className="w-full h-full rounded-full border-2 border-gray-400 border-t-transparent animate-spin" />
                                  )}
                                </div>
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 bg-gray-800/50">
          <p className="text-xs text-gray-500 text-center">
            💡 Only runtime permissions can be toggled. Install permissions are
            granted at installation time.
          </p>
        </div>
      </div>
    </div>
  );
}
