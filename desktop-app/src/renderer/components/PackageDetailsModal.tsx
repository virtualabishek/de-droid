import { useState, useEffect, useCallback, useMemo } from 'react';

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
  size_bytes?: number | null;
  version_name?: string;
  version_code?: number;
  target_sdk?: number;
  min_sdk?: number;
  install_time?: string;
  update_time?: string;
  data_dir?: string;
  apk_path?: string;
  is_system_path?: boolean;
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
    modelLabel?: string;
    modelConfidence?: number;
    modelVersion?: string;
    modelTopFactors?: string[];
    oemOverrideApplied?: boolean;
    oemOverrideReason?: string;
  };
}

interface BackgroundRestrictionStatus {
  packageName: string;
  userId: number;
  packageUid: number | null;
  standbyBucket: string | null;
  runInBackgroundMode: string | null;
  runAnyInBackgroundMode: string | null;
  wakeLockMode: string | null;
  networkRestricted: boolean | null;
  controlsActive: string[];
  warnings: string[];
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
  const [backgroundStatus, setBackgroundStatus] = useState<BackgroundRestrictionStatus | null>(null);
  const [isLoadingBackground, setIsLoadingBackground] = useState(false);
  const [isUpdatingBackground, setIsUpdatingBackground] = useState(false);
  const [backgroundMessage, setBackgroundMessage] = useState<string | null>(null);

  const loadBackgroundStatus = useCallback(async () => {
    setIsLoadingBackground(true);
    try {
      const api = window?.electronAPI?.adb;
      if (!api?.getBackgroundRestrictionStatus) {
        setBackgroundStatus(null);
        return;
      }

      const status = await api.getBackgroundRestrictionStatus(deviceId, packageName, 0);
      setBackgroundStatus(status);
    } catch (err) {
      console.warn('Failed to load background status:', err);
      setBackgroundStatus(null);
    } finally {
      setIsLoadingBackground(false);
    }
  }, [deviceId, packageName]);

  const loadPackageDetails = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setBackgroundMessage(null);
    try {
      const api = window?.electronAPI?.adb;
      if (!api) {
        throw new Error('ADB API unavailable');
      }
      const data = await api.getPackageDetails(deviceId, packageName);
      setDetails(data);
      await loadBackgroundStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load package details');
    } finally {
      setIsLoading(false);
    }
  }, [deviceId, packageName, loadBackgroundStatus]);

  useEffect(() => {
    let mounted = true;
    
    const init = async () => {
      if (isOpen && packageName && deviceId && mounted) {
        await loadPackageDetails();
      }
    };

    init();
    
    return () => {
      mounted = false;
    };
  }, [isOpen, packageName, deviceId, loadPackageDetails]);

  const applyBackgroundMode = async (mode: 'restrict' | 'relax') => {
    setIsUpdatingBackground(true);
    setBackgroundMessage(null);
    try {
      const api = window?.electronAPI?.adb;
      if (!api?.optimizeBackgroundRestriction) {
        throw new Error('Background optimizer API unavailable');
      }

      const result = await api.optimizeBackgroundRestriction(
        deviceId,
        packageName,
        mode,
        0,
      );

      setBackgroundStatus(result.status);
      if (result.success) {
        setBackgroundMessage(result.message);
      } else {
        const fallback = result.failedSteps.length
          ? `Could not apply: ${result.failedSteps.join(', ')}`
          : result.message;
        setBackgroundMessage(fallback);
      }
    } catch (err) {
      setBackgroundMessage(
        err instanceof Error ? err.message : 'Failed to update background controls',
      );
    } finally {
      setIsUpdatingBackground(false);
    }
  };

  const formatBucket = (bucket?: string | null) => {
    if (!bucket) return 'Unknown';
    return bucket.replace(/_/g, ' ');
  };

  const formatBytes = (bytes?: number | null, isBloatware?: boolean, isSystemPath?: boolean) => {
    if (!isBloatware) {
      return 'Only shown for bloatware';
    }
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) {
      if (isSystemPath) {
        return 'Unavailable on this device policy';
      }
      return 'Unknown';
    }
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    if (bytes >= 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${Math.round(bytes)} B`;
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

                  {details.debloat_info?.oemOverrideApplied && (
                    <div className="p-4 bg-orange-500/10 border border-orange-500/30 rounded-lg">
                      <h3 className="text-sm font-medium text-orange-300 mb-1">OEM Safety Override Applied</h3>
                      <p className="text-sm text-orange-200">
                        {details.debloat_info.oemOverrideReason || 'OEM-specific safety rule was applied for this package.'}
                      </p>
                    </div>
                  )}

                  {typeof details.debloat_info?.modelConfidence === 'number' && (
                    <div className="p-4 bg-gray-700/50 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-medium text-gray-400">Model Confidence</h3>
                        <span className="text-xs text-gray-300">
                          {Math.round(details.debloat_info.modelConfidence * 100)}%
                        </span>
                      </div>
                      <div className="w-full bg-gray-900 rounded-full h-2 overflow-hidden">
                        <div
                          className="h-full bg-primary-600"
                          style={{ width: `${Math.round(details.debloat_info.modelConfidence * 100)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between mt-2 text-xs text-gray-400">
                        <span>Model: {details.debloat_info.modelLabel || 'N/A'}</span>
                        <span>{details.debloat_info.modelVersion || 'safety-model'}</span>
                      </div>
                    </div>
                  )}

                  {details.debloat_info?.modelTopFactors && details.debloat_info.modelTopFactors.length > 0 && (
                    <div className="p-4 bg-gray-700/50 rounded-lg">
                      <h3 className="text-sm font-medium text-gray-400 mb-2">Why this prediction</h3>
                      <ul className="space-y-1">
                        {details.debloat_info.modelTopFactors.map((factor, index) => (
                          <li key={`${factor}-${index}`} className="text-sm text-gray-200">
                            • {factor}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="p-4 bg-gray-700/50 rounded-lg border border-gray-600/60">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <h3 className="text-sm font-medium text-gray-300">Background Control Optimizer</h3>
                      <button
                        onClick={loadBackgroundStatus}
                        className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 rounded transition-colors"
                        disabled={isLoadingBackground || isUpdatingBackground}
                      >
                        Refresh
                      </button>
                    </div>

                    {isLoadingBackground ? (
                      <p className="text-sm text-gray-400">Loading background control status...</p>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                          <div className="bg-gray-800/70 border border-gray-600 rounded px-2 py-1.5">
                            <span className="text-gray-400">Standby bucket: </span>
                            <span className="text-white capitalize">{formatBucket(backgroundStatus?.standbyBucket)}</span>
                          </div>
                          <div className="bg-gray-800/70 border border-gray-600 rounded px-2 py-1.5">
                            <span className="text-gray-400">RUN_IN_BACKGROUND: </span>
                            <span className="text-white">{backgroundStatus?.runInBackgroundMode || 'Unknown'}</span>
                          </div>
                          <div className="bg-gray-800/70 border border-gray-600 rounded px-2 py-1.5">
                            <span className="text-gray-400">RUN_ANY_IN_BACKGROUND: </span>
                            <span className="text-white">{backgroundStatus?.runAnyInBackgroundMode || 'Unknown'}</span>
                          </div>
                          <div className="bg-gray-800/70 border border-gray-600 rounded px-2 py-1.5">
                            <span className="text-gray-400">Network restricted: </span>
                            <span className="text-white">
                              {backgroundStatus?.networkRestricted === null
                                ? 'Unknown'
                                : backgroundStatus.networkRestricted
                                  ? 'Yes'
                                  : 'No'}
                            </span>
                          </div>
                        </div>

                        {backgroundStatus?.controlsActive?.length ? (
                          <p className="text-xs text-emerald-300 mb-3">
                            Active controls: {backgroundStatus.controlsActive.join(', ')}
                          </p>
                        ) : (
                          <p className="text-xs text-gray-400 mb-3">No explicit background controls detected yet.</p>
                        )}

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => applyBackgroundMode('restrict')}
                            disabled={isUpdatingBackground}
                            className="px-3 py-2 text-xs font-medium bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg transition-colors"
                          >
                            Restrict background
                          </button>
                          <button
                            onClick={() => applyBackgroundMode('relax')}
                            disabled={isUpdatingBackground}
                            className="px-3 py-2 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-lg transition-colors"
                          >
                            Relax restrictions
                          </button>
                        </div>

                        {backgroundMessage && (
                          <p className="text-xs text-gray-300 mt-3">{backgroundMessage}</p>
                        )}

                        {backgroundStatus?.warnings?.length ? (
                          <ul className="mt-2 space-y-1">
                            {backgroundStatus.warnings.map((warning, idx) => (
                              <li key={`${warning}-${idx}`} className="text-xs text-yellow-300">• {warning}</li>
                            ))}
                          </ul>
                        ) : null}
                      </>
                    )}
                  </div>

                  {/* Package Info Grid */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-gray-700/50 rounded-lg">
                      <h3 className="text-xs font-medium text-gray-400 mb-1">Version</h3>
                      <p className="text-white font-mono">{details.version_name || 'Unknown'}</p>
                      {details.version_code && (
                        <p className="text-xs text-gray-400 mt-1">Code: {details.version_code}</p>
                      )}
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
                      <h3 className="text-xs font-medium text-gray-400 mb-1">Installed Size</h3>
                      <p className="text-white text-sm">
                        {formatBytes(
                          details.size_bytes,
                          details.debloat_info?.category?.toUpperCase() === 'BLOATWARE',
                          details.is_system_path,
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
                    <div className="p-4 bg-gray-700/50 rounded-lg">
                      <h3 className="text-xs font-medium text-gray-400 mb-1">Last Updated</h3>
                      <p className="text-white text-sm">
                        {details.update_time
                          ? new Date(details.update_time).toLocaleDateString()
                          : 'Unknown'}
                      </p>
                    </div>
                    <div className="p-4 bg-gray-700/50 rounded-lg col-span-2">
                      <h3 className="text-xs font-medium text-gray-400 mb-1">Permission Risk</h3>
                      <p className="text-white text-sm">
                        Dangerous granted: {details.permissions?.granted_dangerous || 0} / {details.permissions?.dangerous_count || 0}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        Total permissions: {details.permissions?.total_count || 0}
                      </p>
                    </div>
                  </div>
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
                      <p className="text-sm">This app doesn&apos;t require sensitive permissions</p>
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
