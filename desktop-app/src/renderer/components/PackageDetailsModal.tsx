import { useState, useEffect } from 'react';

interface Permission {
  name: string;
  granted: boolean;
  category: string;
  description: string;
  is_dangerous?: boolean;
  is_special?: boolean;
  type?: string;
}

interface PackageDetails {
  package: string;
  version_name?: string;
  version_code?: number;
  target_sdk?: number;
  min_sdk?: number;
  install_time?: string;
  update_time?: string;
  data_dir?: string;
  apk_path?: string;
  is_system?: boolean;
  is_updated_system_app?: boolean;
  permissions?: {
    dangerous_permissions: Permission[];
    special_permissions: Permission[];
    normal_permissions: Permission[];
    total_count: number;
    dangerous_count: number;
    granted_dangerous: number;
  };
  debloat_info?: {
    id: string;
    list: string;
    description: string;
    removal: string;
    category: string;
    dependencies: string[];
    neededBy: string[];
    labels: string[];
    alternatives: string[];
  };
}

interface PackageDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  packageName: string;
  deviceId: string;
}

export function PackageDetailsModal({
  isOpen,
  onClose,
  packageName,
  deviceId,
}: PackageDetailsModalProps) {
  const [details, setDetails] = useState<PackageDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'info' | 'permissions' | 'dangerous'>('info');

  useEffect(() => {
    if (isOpen && packageName && deviceId) {
      loadPackageDetails();
    }
  }, [isOpen, packageName, deviceId]);

  const loadPackageDetails = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const api = window?.electronAPI?.adb;
      if (!api) {
        throw new Error('ADB API unavailable');
      }
      const data = await api.getPackageDetails(deviceId, packageName);
      setDetails(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load package details');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const getCategoryColor = (category?: string) => {
    switch (category?.toUpperCase()) {
      case 'BLOATWARE':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'OPTIONAL':
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'ESSENTIAL':
        return 'bg-green-500/20 text-green-400 border-green-500/30';
      default:
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const getRemovalColor = (removal?: string) => {
    switch (removal) {
      case 'RECOMMENDED':
        return 'text-green-400';
      case 'ADVANCED':
        return 'text-yellow-400';
      case 'EXPERT':
        return 'text-orange-400';
      case 'UNSAFE':
        return 'text-red-400';
      default:
        return 'text-gray-400';
    }
  };

  const getPermissionIcon = (category: string) => {
    const icons: Record<string, string> = {
      Location: '📍',
      Camera: '📷',
      Microphone: '🎤',
      Contacts: '👥',
      Phone: '📞',
      SMS: '💬',
      Storage: '💾',
      Calendar: '📅',
      Sensors: '📡',
      Bluetooth: '📶',
      Nearby: '📲',
      Notifications: '🔔',
      Display: '🖥️',
      Settings: '⚙️',
      Install: '📦',
      Admin: '🔐',
      Accessibility: '♿',
      Other: '📋',
    };
    return icons[category] || '📋';
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 border border-gray-700 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-700">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold truncate">{packageName}</h2>
              {details?.debloat_info && (
                <div className="flex items-center gap-2 mt-2">
                  <span
                    className={`text-xs px-2 py-1 rounded border ${getCategoryColor(
                      details.debloat_info.category
                    )}`}
                  >
                    {details.debloat_info.category}
                  </span>
                  <span className={`text-xs font-medium ${getRemovalColor(details.debloat_info.removal)}`}>
                    {details.debloat_info.removal}
                  </span>
                  <span className="text-xs text-gray-400">• {details.debloat_info.list}</span>
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-4 bg-gray-900/50 rounded-lg p-1">
            <button
              onClick={() => setActiveTab('info')}
              className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'info'
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              📋 Info
            </button>
            <button
              onClick={() => setActiveTab('dangerous')}
              className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'dangerous'
                  ? 'bg-red-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              ⚠️ Dangerous ({details?.permissions?.dangerous_count || 0})
            </button>
            <button
              onClick={() => setActiveTab('permissions')}
              className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'permissions'
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              🔐 All Permissions ({details?.permissions?.total_count || 0})
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-500"></div>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-48 text-red-400">
              <svg className="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p>{error}</p>
              <button
                onClick={loadPackageDetails}
                className="mt-3 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors text-sm"
              >
                Try Again
              </button>
            </div>
          ) : details ? (
            <>
              {/* Info Tab */}
              {activeTab === 'info' && (
                <div className="space-y-6">
                  {/* Description */}
                  {details.debloat_info?.description && (
                    <div className="p-4 bg-gray-700/50 rounded-lg">
                      <h3 className="text-sm font-medium text-gray-400 mb-2">Description</h3>
                      <p className="text-white">{details.debloat_info.description}</p>
                    </div>
                  )}

                  {/* Package Info Grid */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-gray-700/50 rounded-lg">
                      <h3 className="text-xs font-medium text-gray-400 mb-1">Version</h3>
                      <p className="text-white font-mono">
                        {details.version_name || 'Unknown'} ({details.version_code || '?'})
                      </p>
                    </div>
                    <div className="p-4 bg-gray-700/50 rounded-lg">
                      <h3 className="text-xs font-medium text-gray-400 mb-1">SDK Target</h3>
                      <p className="text-white">
                        Min: {details.min_sdk || '?'} • Target: {details.target_sdk || '?'}
                      </p>
                    </div>
                    <div className="p-4 bg-gray-700/50 rounded-lg">
                      <h3 className="text-xs font-medium text-gray-400 mb-1">Type</h3>
                      <p className="text-white">
                        {details.is_system ? (
                          <span className="text-yellow-400">System App</span>
                        ) : (
                          <span className="text-green-400">User App</span>
                        )}
                        {details.is_updated_system_app && (
                          <span className="text-blue-400 ml-2">(Updated)</span>
                        )}
                      </p>
                    </div>
                    <div className="p-4 bg-gray-700/50 rounded-lg">
                      <h3 className="text-xs font-medium text-gray-400 mb-1">Installed</h3>
                      <p className="text-white text-sm">
                        {details.install_time
                          ? new Date(details.install_time).toLocaleDateString()
                          : 'Unknown'}
                      </p>
                    </div>
                  </div>

                  {/* Paths */}
                  {details.apk_path && (
                    <div className="p-4 bg-gray-700/50 rounded-lg">
                      <h3 className="text-xs font-medium text-gray-400 mb-1">APK Path</h3>
                      <p className="text-white font-mono text-xs break-all">{details.apk_path}</p>
                    </div>
                  )}

                  {/* Dependencies */}
                  {details.debloat_info?.dependencies && details.debloat_info.dependencies.length > 0 && (
                    <div className="p-4 bg-gray-700/50 rounded-lg">
                      <h3 className="text-xs font-medium text-gray-400 mb-2">Dependencies</h3>
                      <div className="flex flex-wrap gap-2">
                        {details.debloat_info.dependencies.map((dep) => (
                          <span key={dep} className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs font-mono">
                            {dep}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Needed By */}
                  {details.debloat_info?.neededBy && details.debloat_info.neededBy.length > 0 && (
                    <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                      <h3 className="text-xs font-medium text-yellow-400 mb-2">⚠️ Needed By</h3>
                      <div className="flex flex-wrap gap-2">
                        {details.debloat_info.neededBy.map((pkg) => (
                          <span key={pkg} className="px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded text-xs font-mono">
                            {pkg}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Alternatives */}
                  {details.debloat_info?.alternatives && details.debloat_info.alternatives.length > 0 && (
                    <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                      <h3 className="text-xs font-medium text-green-400 mb-2">✨ Open Source Alternatives</h3>
                      <div className="flex flex-wrap gap-2">
                        {details.debloat_info.alternatives.map((alt) => (
                          <span key={alt} className="px-2 py-1 bg-green-500/20 text-green-400 rounded text-xs">
                            {alt}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Dangerous Permissions Tab */}
              {activeTab === 'dangerous' && (
                <div className="space-y-4">
                  {details.permissions?.dangerous_permissions &&
                  details.permissions.dangerous_permissions.length > 0 ? (
                    <>
                      <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-300">
                        ⚠️ These permissions can access sensitive data. {details.permissions.granted_dangerous} of{' '}
                        {details.permissions.dangerous_count} are granted.
                      </div>
                      <div className="space-y-2">
                        {details.permissions.dangerous_permissions.map((perm, idx) => (
                          <div
                            key={idx}
                            className={`p-4 rounded-lg border ${
                              perm.granted
                                ? 'bg-red-500/10 border-red-500/30'
                                : 'bg-gray-700/50 border-gray-600'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <span className="text-2xl">{getPermissionIcon(perm.category)}</span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{perm.description}</span>
                                  <span
                                    className={`text-xs px-2 py-0.5 rounded ${
                                      perm.granted
                                        ? 'bg-red-500/20 text-red-400'
                                        : 'bg-gray-600 text-gray-400'
                                    }`}
                                  >
                                    {perm.granted ? 'GRANTED' : 'DENIED'}
                                  </span>
                                </div>
                                <p className="text-xs text-gray-400 mt-1 font-mono truncate">
                                  {perm.name}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                      <svg className="w-12 h-12 mb-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-green-400">No dangerous permissions requested</p>
                      <p className="text-sm">This app doesn't require sensitive permissions</p>
                    </div>
                  )}

                  {/* Special Permissions */}
                  {details.permissions?.special_permissions &&
                    details.permissions.special_permissions.length > 0 && (
                      <div className="mt-6">
                        <h3 className="text-sm font-medium text-yellow-400 mb-3">
                          🔒 Special Permissions
                        </h3>
                        <div className="space-y-2">
                          {details.permissions.special_permissions.map((perm, idx) => (
                            <div
                              key={idx}
                              className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg"
                            >
                              <div className="flex items-center gap-2">
                                <span>{getPermissionIcon(perm.category)}</span>
                                <span className="font-medium text-sm">{perm.description}</span>
                                <span
                                  className={`text-xs px-2 py-0.5 rounded ${
                                    perm.granted
                                      ? 'bg-yellow-500/20 text-yellow-400'
                                      : 'bg-gray-600 text-gray-400'
                                  }`}
                                >
                                  {perm.granted ? 'ENABLED' : 'DISABLED'}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              )}

              {/* All Permissions Tab */}
              {activeTab === 'permissions' && (
                <div className="space-y-4">
                  <div className="text-sm text-gray-400 mb-4">
                    Showing all {details.permissions?.total_count || 0} permissions requested by this
                    app.
                  </div>

                  {/* Group by category */}
                  {(() => {
                    const allPerms = [
                      ...(details.permissions?.dangerous_permissions || []),
                      ...(details.permissions?.special_permissions || []),
                      ...(details.permissions?.normal_permissions || []),
                    ];

                    const grouped = allPerms.reduce((acc, perm) => {
                      const cat = perm.category || 'Other';
                      if (!acc[cat]) acc[cat] = [];
                      acc[cat].push(perm);
                      return acc;
                    }, {} as Record<string, Permission[]>);

                    return Object.entries(grouped).map(([category, perms]) => (
                      <div key={category} className="mb-4">
                        <h3 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                          <span>{getPermissionIcon(category)}</span>
                          <span>{category}</span>
                          <span className="text-xs text-gray-500">({perms.length})</span>
                        </h3>
                        <div className="space-y-1">
                          {perms.map((perm, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between p-2 bg-gray-700/30 rounded text-sm"
                            >
                              <span className="text-gray-300 truncate flex-1 mr-2">
                                {perm.description}
                              </span>
                              <span
                                className={`text-xs px-2 py-0.5 rounded flex-shrink-0 ${
                                  perm.granted
                                    ? perm.is_dangerous
                                      ? 'bg-red-500/20 text-red-400'
                                      : 'bg-green-500/20 text-green-400'
                                    : 'bg-gray-600 text-gray-400'
                                }`}
                              >
                                {perm.granted ? '✓' : '✗'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 bg-gray-800/50">
          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
