import { useEffect, useState } from 'react';
import { useHistoryStore, ActionHistoryItem } from '../store/historyStore';
import { useDeviceStore } from '../store/deviceStore';

// Action descriptions for user-friendly display
const getActionDescription = (action: string, packageName: string, success: boolean) => {
  const actionDescriptions: Record<string, { past: string; icon: string; color: string }> = {
    UNINSTALL: {
      past: 'Uninstalled',
      icon: '🗑️',
      color: success ? 'text-red-400' : 'text-red-600',
    },
    DISABLE: {
      past: 'Disabled',
      icon: '⏸️',
      color: success ? 'text-yellow-400' : 'text-yellow-600',
    },
    RESTORE: {
      past: 'Restored',
      icon: '♻️',
      color: success ? 'text-green-400' : 'text-green-600',
    },
    ENABLE: {
      past: 'Enabled',
      icon: '▶️',
      color: success ? 'text-blue-400' : 'text-blue-600',
    },
  };

  const info = actionDescriptions[action] || { past: action, icon: '📦', color: 'text-gray-400' };
  return {
    ...info,
    description: `${info.past} package "${packageName}"`,
  };
};

// Get the reverse action for undo functionality
const getReverseAction = (action: string): 'uninstall' | 'restore' | 'disable' | 'enable' | null => {
  switch (action) {
    case 'UNINSTALL':
      return 'restore';
    case 'DISABLE':
      return 'enable';
    case 'RESTORE':
      return 'uninstall';
    case 'ENABLE':
      return 'disable';
    default:
      return null;
  }
};

export default function History() {
  const {
    history,
    stats,
    savedBackups,
    isLoadingHistory,
    isLoadingStats,
    isLoadingBackups,
    error,
    fetchHistory,
    fetchStats,
    fetchSavedBackups,
    deleteBackup,
    clearError,
  } = useHistoryStore();

  const { selectedDevice } = useDeviceStore();

  const [filterAction, setFilterAction] = useState<'all' | 'UNINSTALL' | 'DISABLE' | 'RESTORE' | 'ENABLE'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'success' | 'failed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'history' | 'backups'>('history');
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [isUndoing, setIsUndoing] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    fetchHistory();
    fetchStats();
    fetchSavedBackups();
  }, [fetchHistory, fetchStats, fetchSavedBackups]);

  // Filter history based on current filters
  const filteredHistory = history.filter((item) => {
    const matchesAction = filterAction === 'all' || item.action === filterAction;
    const matchesStatus =
      filterStatus === 'all' ||
      (filterStatus === 'success' && item.success) ||
      (filterStatus === 'failed' && !item.success);
    const matchesSearch = item.packageName.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesAction && matchesStatus && matchesSearch;
  });

  // Group history by date
  const groupedHistory = filteredHistory.reduce((groups, item) => {
    const date = new Date(item.createdAt).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(item);
    return groups;
  }, {} as Record<string, ActionHistoryItem[]>);

  const handleSelectItem = (id: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedItems(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedItems.size === filteredHistory.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredHistory.map((item) => item.id)));
    }
  };

  // Undo a single action
  const handleUndoSingle = async (item: ActionHistoryItem) => {
    if (!selectedDevice || !item.success) return;

    setIsUndoing(true);
    const reverseAction = getReverseAction(item.action);
    if (!reverseAction) {
      setIsUndoing(false);
      return;
    }

    try {
      const api = window?.electronAPI?.adb;
      if (!api) {
        setNotification({ type: 'error', message: 'ADB API unavailable' });
        setIsUndoing(false);
        return;
      }

      let result;
      switch (reverseAction) {
        case 'restore':
          result = await api.restorePackage(
            selectedDevice.adb_id,
            item.packageName,
            item.androidUser,
            selectedDevice.android_sdk
          );
          break;
        case 'uninstall':
          result = await api.uninstallPackage(
            selectedDevice.adb_id,
            item.packageName,
            item.androidUser,
            selectedDevice.android_sdk
          );
          break;
        case 'enable':
          result = await api.enablePackage(
            selectedDevice.adb_id,
            item.packageName,
            item.androidUser
          );
          break;
        case 'disable':
          result = await api.disablePackage(
            selectedDevice.adb_id,
            item.packageName,
            item.androidUser
          );
          break;
      }

      if (result?.success) {
        setNotification({
          type: 'success',
          message: `Successfully ${reverseAction}d ${item.packageName}`,
        });
      } else {
        setNotification({
          type: 'error',
          message: `Failed to ${reverseAction} ${item.packageName}`,
        });
      }
    } catch (err) {
      setNotification({
        type: 'error',
        message: err instanceof Error ? err.message : 'Undo failed',
      });
    } finally {
      setIsUndoing(false);
      fetchHistory();
      fetchStats();
      setTimeout(() => setNotification(null), 5000);
    }
  };

  const handleUndoSelected = async () => {
    if (!selectedDevice || selectedItems.size === 0) return;

    setIsUndoing(true);
    let successCount = 0;
    let failCount = 0;

    for (const id of selectedItems) {
      const item = history.find((h) => h.id === id);
      if (!item || !item.success) continue;

      const reverseAction = getReverseAction(item.action);
      if (!reverseAction) continue;

      try {
        let result;
        const api = window?.electronAPI?.adb;
        if (!api) continue;

        switch (reverseAction) {
          case 'restore':
            result = await api.restorePackage(
              selectedDevice.adb_id,
              item.packageName,
              item.androidUser,
              selectedDevice.android_sdk
            );
            break;
          case 'uninstall':
            result = await api.uninstallPackage(
              selectedDevice.adb_id,
              item.packageName,
              item.androidUser,
              selectedDevice.android_sdk
            );
            break;
          case 'enable':
            result = await api.enablePackage(
              selectedDevice.adb_id,
              item.packageName,
              item.androidUser
            );
            break;
          case 'disable':
            result = await api.disablePackage(
              selectedDevice.adb_id,
              item.packageName,
              item.androidUser
            );
            break;
        }

        if (result?.success) {
          successCount++;
        } else {
          failCount++;
        }
      } catch {
        failCount++;
      }
    }

    setIsUndoing(false);
    setSelectedItems(new Set());

    setNotification({
      type: failCount === 0 ? 'success' : 'error',
      message: `Undo completed: ${successCount} succeeded, ${failCount} failed`,
    });

    // Refresh history and stats
    fetchHistory();
    fetchStats();

    setTimeout(() => setNotification(null), 5000);
  };

  const handleDeleteBackup = async (id: string) => {
    try {
      await deleteBackup(id);
      setNotification({ type: 'success', message: 'Backup deleted successfully' });
      setTimeout(() => setNotification(null), 3000);
    } catch {
      setNotification({ type: 'error', message: 'Failed to delete backup' });
      setTimeout(() => setNotification(null), 3000);
    }
  };

  // Helper function to get backup JSON
  const getBackupJson = (backup: { name: string; createdAt: string; packages: Array<{ name: string; state: string }> }) => {
    return JSON.stringify(
      {
        name: backup.name,
        createdAt: backup.createdAt,
        packages: backup.packages,
      },
      null,
      2
    );
  };

  // Copy text to clipboard with error handling
  const copyToClipboard = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotification({ type: 'success', message: successMessage });
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      setNotification({ type: 'error', message: 'Failed to copy to clipboard' });
    }
    setTimeout(() => setNotification(null), 3000);
  };

  // Download backup as JSON file
  const downloadBackupFile = (backup: { name: string; createdAt: string; packages: Array<{ name: string; state: string }> }) => {
    const json = getBackupJson(backup);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${backup.name}-${formatDate(backup.createdAt)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="h-full overflow-auto">
      <header className="bg-gray-800 border-b border-gray-700 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Action History</h1>
            <p className="text-gray-400 mt-1">
              View your past actions, restore packages, and manage backups
            </p>
          </div>
          {selectedDevice && (
            <div className="text-right">
              <p className="text-sm text-gray-400">Connected Device</p>
              <p className="font-medium">{selectedDevice.model}</p>
            </div>
          )}
        </div>
      </header>

      {/* Notification */}
      {notification && (
        <div
          className={`mx-6 mt-4 p-4 rounded-lg flex items-center justify-between ${
            notification.type === 'success'
              ? 'bg-green-500/20 border border-green-500/30 text-green-400'
              : 'bg-red-500/20 border border-red-500/30 text-red-400'
          }`}
        >
          <span>{notification.message}</span>
          <button onClick={() => setNotification(null)} className="ml-4">
            ×
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mx-6 mt-4 p-4 rounded-lg bg-red-500/20 border border-red-500/30 text-red-400 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={clearError} className="ml-4">
            ×
          </button>
        </div>
      )}

      <div className="p-6">
        {/* Stats */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-4">Quick Stats</h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
              <div className="text-3xl font-bold text-red-400">
                {isLoadingStats ? '...' : stats.uninstalled}
              </div>
              <div className="text-sm text-gray-400 mt-1">Packages Uninstalled</div>
            </div>
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
              <div className="text-3xl font-bold text-yellow-400">
                {isLoadingStats ? '...' : stats.disabled}
              </div>
              <div className="text-sm text-gray-400 mt-1">Packages Disabled</div>
            </div>
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
              <div className="text-3xl font-bold text-green-400">
                {isLoadingStats ? '...' : stats.restored}
              </div>
              <div className="text-sm text-gray-400 mt-1">Packages Restored</div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'history'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Action History
          </button>
          <button
            onClick={() => setActiveTab('backups')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'backups'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Saved Backups ({savedBackups.length})
          </button>
        </div>

        {activeTab === 'history' ? (
          <>
            {/* Filters */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 mb-4">
              <div className="flex items-center gap-4">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    placeholder="Search packages..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg pl-10 pr-4 py-2 text-white placeholder-gray-400"
                  />
                  <svg
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
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
                </div>
                <select
                  value={filterAction}
                  onChange={(e) => setFilterAction(e.target.value as typeof filterAction)}
                  className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white"
                >
                  <option value="all">All Actions</option>
                  <option value="UNINSTALL">Uninstall</option>
                  <option value="DISABLE">Disable</option>
                  <option value="RESTORE">Restore</option>
                  <option value="ENABLE">Enable</option>
                </select>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
                  className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white"
                >
                  <option value="all">All Status</option>
                  <option value="success">Successful</option>
                  <option value="failed">Failed</option>
                </select>
              </div>

              {/* Selection actions */}
              {selectedItems.size > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-700 flex items-center justify-between">
                  <span className="text-sm text-gray-400">
                    {selectedItems.size} item{selectedItems.size > 1 ? 's' : ''} selected
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSelectAll}
                      className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
                    >
                      {selectedItems.size === filteredHistory.length ? 'Deselect All' : 'Select All'}
                    </button>
                    <button
                      onClick={() => setSelectedItems(new Set())}
                      className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
                    >
                      Clear Selection
                    </button>
                    <button
                      onClick={handleUndoSelected}
                      disabled={isUndoing || !selectedDevice}
                      className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors font-medium"
                    >
                      {isUndoing ? 'Undoing...' : 'Undo Selected'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* History List */}
            {isLoadingHistory ? (
              <div className="bg-gray-800 rounded-lg border border-gray-700 p-8 text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto mb-4"></div>
                <p className="text-gray-400">Loading history...</p>
              </div>
            ) : filteredHistory.length === 0 ? (
              <div className="bg-gray-800 rounded-lg border border-gray-700 p-8 text-center">
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
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <h3 className="text-xl font-medium text-gray-300 mb-2">
                  {history.length === 0 ? 'No actions yet' : 'No matching actions'}
                </h3>
                <p className="text-gray-500">
                  {history.length === 0
                    ? 'Your action history will appear here once you start managing packages'
                    : 'Try adjusting your filters to see more results'}
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {Object.entries(groupedHistory).map(([date, items]) => (
                  <div key={date}>
                    <h3 className="text-sm font-medium text-gray-400 mb-3 sticky top-0 bg-gray-900 py-2">
                      {date}
                    </h3>
                    <div className="space-y-2">
                      {items.map((item) => {
                        const actionInfo = getActionDescription(item.action, item.packageName, item.success);
                        return (
                          <div
                            key={item.id}
                            className={`bg-gray-800 rounded-lg border p-4 transition-colors cursor-pointer ${
                              selectedItems.has(item.id)
                                ? 'border-primary-500 bg-primary-600/10'
                                : 'border-gray-700 hover:border-gray-600'
                            }`}
                            onClick={() => handleSelectItem(item.id)}
                          >
                            <div className="flex items-start gap-4">
                              <div className="flex items-center gap-3">
                                <input
                                  type="checkbox"
                                  checked={selectedItems.has(item.id)}
                                  onChange={() => handleSelectItem(item.id)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-primary-600"
                                />
                                <span className="text-2xl">{actionInfo.icon}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className={`font-medium ${actionInfo.color}`}>
                                    {item.action}
                                  </span>
                                  <span
                                    className={`text-xs px-2 py-0.5 rounded ${
                                      item.success
                                        ? 'bg-green-500/20 text-green-400'
                                        : 'bg-red-500/20 text-red-400'
                                    }`}
                                  >
                                    {item.success ? 'Success' : 'Failed'}
                                  </span>
                                </div>
                                <p className="font-mono text-sm text-white truncate">
                                  {item.packageName}
                                </p>
                                {item.errorMessage && (
                                  <p className="text-xs text-red-400 mt-1">{item.errorMessage}</p>
                                )}
                                <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                                  <span>🕐 {formatTime(item.createdAt)}</span>
                                  {item.device && (
                                    <span>
                                      📱 {item.device.brand} {item.device.model}
                                    </span>
                                  )}
                                  <span>👤 User {item.androidUser}</span>
                                </div>
                              </div>
                              {item.success && selectedDevice && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleUndoSingle(item);
                                  }}
                                  disabled={isUndoing}
                                  className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded transition-colors"
                                  title={`Undo this action (${getReverseAction(item.action)})`}
                                >
                                  {isUndoing ? 'Undoing...' : 'Undo'}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          /* Backups Tab */
          <div>
            {isLoadingBackups ? (
              <div className="bg-gray-800 rounded-lg border border-gray-700 p-8 text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto mb-4"></div>
                <p className="text-gray-400">Loading backups...</p>
              </div>
            ) : savedBackups.length === 0 ? (
              <div className="bg-gray-800 rounded-lg border border-gray-700 p-8 text-center">
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
                    d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
                  />
                </svg>
                <h3 className="text-xl font-medium text-gray-300 mb-2">No saved backups</h3>
                <p className="text-gray-500">
                  Create a backup from the Dashboard to save your device's package state
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {savedBackups.map((backup) => (
                  <div
                    key={backup.id}
                    className="bg-gray-800 rounded-lg border border-gray-700 p-4"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-medium text-white">{backup.name}</h3>
                        <p className="text-sm text-gray-400">
                          {formatDate(backup.createdAt)} at {formatTime(backup.createdAt)}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeleteBackup(backup.id)}
                        className="text-gray-400 hover:text-red-400 transition-colors"
                        title="Delete backup"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </div>
                    <div className="space-y-2 text-sm">
                      {backup.device && (
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500">Device:</span>
                          <span className="text-gray-300">
                            {backup.device.brand} {backup.device.model}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">Packages:</span>
                        <span className="text-gray-300">{backup.packages.length} packages</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">States:</span>
                        <div className="flex gap-2">
                          <span className="text-green-400 text-xs">
                            {backup.packages.filter((p) => p.state === 'enabled').length} enabled
                          </span>
                          <span className="text-yellow-400 text-xs">
                            {backup.packages.filter((p) => p.state === 'disabled').length} disabled
                          </span>
                          <span className="text-red-400 text-xs">
                            {backup.packages.filter((p) => p.state === 'uninstalled').length} uninstalled
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 flex gap-2">
                      <button
                        onClick={() => copyToClipboard(getBackupJson(backup), 'Backup copied to clipboard')}
                        className="flex-1 px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
                      >
                        Copy JSON
                      </button>
                      <button
                        onClick={() => downloadBackupFile(backup)}
                        className="flex-1 px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors font-medium"
                      >
                        Download
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
