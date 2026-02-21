import { useState } from 'react';
import { useDeviceStore } from '../store/deviceStore';
import { useHistoryStore } from '../store/historyStore';

interface BackupInfo {
  device_id: string;
  device_model: string;
  created_at: string;
  total_packages: number;
}

interface StateChange {
  name: string;
  backup_state: string;
  current_state: string;
}

interface RestoreSuggestion {
  package: string;
  action: string;
  reason: string;
  priority: string;
}

interface CompareResult {
  missing_packages: string[];
  new_packages: string[];
  state_changes: StateChange[];
  unchanged: number;
  suggestions: RestoreSuggestion[];
  backup_info: {
    device_model: string;
    created_at: string;
    total_packages: number;
  };
}

interface BackupPanelProps {
  onRestorePackages?: (packages: string[]) => void;
}

export function BackupPanel({ onRestorePackages }: BackupPanelProps) {
  const { selectedDevice } = useDeviceStore();
  const { saveBackup } = useHistoryStore();
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [isSavingBackup, setIsSavingBackup] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [backupData, setBackupData] = useState<string | null>(null);
  const [backupInfo, setBackupInfo] = useState<BackupInfo | null>(null);
  const [backupPackages, setBackupPackages] = useState<Array<{ name: string; state: string }> | null>(null);
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleCreateBackup = async () => {
    if (!selectedDevice) return;

    setIsCreatingBackup(true);
    setError(null);
    setSaveSuccess(false);

    try {
      const api = window?.electronAPI?.backup;
      if (!api) {
        throw new Error('Backup API unavailable');
      }

      const result = await api.create(
        selectedDevice.adb_id,
        selectedDevice.model,
        selectedDevice.brand,
        selectedDevice.android_sdk,
        0,
        true
      );

      setBackupData(result.backup_json);
      setBackupInfo({
        device_id: result.device_id,
        device_model: result.device_model,
        created_at: result.created_at,
        total_packages: result.total_packages,
      });
      
      // Parse and store packages for saving
      try {
        const parsed = JSON.parse(result.backup_json);
        if (parsed.packages) {
          setBackupPackages(parsed.packages);
        } else {
          console.warn('Backup JSON does not contain packages array');
        }
      } catch (parseErr) {
        console.error('Failed to parse backup JSON for saving:', parseErr);
        // The backup was created successfully, just can't save to history
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create backup');
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const handleSaveBackup = async () => {
    if (!selectedDevice || !backupPackages) return;

    setIsSavingBackup(true);
    setError(null);

    try {
      const backupName = `${selectedDevice.brand} ${selectedDevice.model} - ${new Date().toLocaleDateString()}`;
      await saveBackup({
        deviceId: selectedDevice.adb_id,
        deviceModel: selectedDevice.model,
        deviceBrand: selectedDevice.brand,
        name: backupName,
        packages: backupPackages,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save backup');
    } finally {
      setIsSavingBackup(false);
    }
  };

  const handleDownloadBackup = () => {
    if (!backupData || !backupInfo) return;

    const blob = new Blob([backupData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup-${backupInfo.device_model}-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyBackup = () => {
    if (!backupData) return;
    navigator.clipboard.writeText(backupData);
  };

  const handleImportBackup = () => {
    setShowImportModal(true);
  };

  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setImportText(content);
    };
    reader.readAsText(file);
  };

  const handleCompareBackup = async () => {
    if (!selectedDevice || !importText) return;

    setIsComparing(true);
    setError(null);

    try {
      const api = window?.electronAPI?.backup;
      if (!api) {
        throw new Error('Backup API unavailable');
      }

      const result = await api.compare(
        selectedDevice.adb_id,
        importText,
        0,
        true
      );

      setCompareResult(result);
      setShowImportModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compare backup');
    } finally {
      setIsComparing(false);
    }
  };

  const handleRestoreMissing = () => {
    if (!compareResult || !onRestorePackages) return;
    onRestorePackages(compareResult.missing_packages);
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'text-red-400';
      case 'medium':
        return 'text-yellow-400';
      case 'low':
        return 'text-green-400';
      default:
        return 'text-gray-400';
    }
  };

  if (!selectedDevice) {
    return (
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <p className="text-gray-400 text-center">Select a device to manage backups</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
      <h3 className="text-lg font-semibold mb-4">Package Backup</h3>

      {error && (
        <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {/* Create Backup */}
        <div className="flex gap-3">
          <button
            onClick={handleCreateBackup}
            disabled={isCreatingBackup}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors font-medium"
          >
            {isCreatingBackup ? 'Creating...' : 'Create Backup'}
          </button>
          <button
            onClick={handleImportBackup}
            className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors font-medium"
          >
            Import & Compare
          </button>
        </div>

        {/* Backup Info */}
        {backupInfo && (
          <div className="bg-gray-700/50 border border-gray-600 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-medium text-green-400">✓ Backup Created</h4>
              <span className="text-xs text-gray-400">
                {new Date(backupInfo.created_at).toLocaleString()}
              </span>
            </div>
            <div className="text-sm text-gray-300 space-y-1">
              <p>Device: {backupInfo.device_model}</p>
              <p>Packages: {backupInfo.total_packages}</p>
            </div>
            {saveSuccess && (
              <div className="mt-3 p-2 bg-green-500/20 border border-green-500/30 rounded text-green-300 text-sm">
                ✓ Backup saved to history
              </div>
            )}
            <div className="flex gap-2 mt-3 flex-wrap">
              <button
                onClick={handleSaveBackup}
                disabled={isSavingBackup || saveSuccess}
                className="px-3 py-1 text-sm bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded transition-colors font-medium"
              >
                {isSavingBackup ? 'Saving...' : saveSuccess ? 'Saved ✓' : 'Save to History'}
              </button>
              <button
                onClick={handleDownloadBackup}
                className="px-3 py-1 text-sm bg-green-600/30 hover:bg-green-600/50 text-green-300 rounded transition-colors"
              >
                Download JSON
              </button>
              <button
                onClick={handleCopyBackup}
                className="px-3 py-1 text-sm bg-gray-600/50 hover:bg-gray-600/70 text-gray-300 rounded transition-colors"
              >
                Copy to Clipboard
              </button>
            </div>
          </div>
        )}

        {/* Compare Result */}
        {compareResult && (
          <div className="bg-gray-700/50 border border-gray-600 rounded-lg p-4">
            <h4 className="font-medium mb-3">Comparison Result</h4>
            <div className="text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-400">Backup from:</span>
                <span>{compareResult.backup_info.device_model}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Backup date:</span>
                <span>{new Date(compareResult.backup_info.created_at).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Unchanged packages:</span>
                <span className="text-green-400">{compareResult.unchanged}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Missing (need restore):</span>
                <span className="text-red-400">{compareResult.missing_packages.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">New packages:</span>
                <span className="text-blue-400">{compareResult.new_packages.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">State changes:</span>
                <span className="text-yellow-400">{compareResult.state_changes.length}</span>
              </div>
            </div>

            {compareResult.missing_packages.length > 0 && (
              <div className="mt-4">
                <h5 className="text-sm font-medium text-red-400 mb-2">Missing Packages:</h5>
                <div className="max-h-32 overflow-auto bg-gray-800 rounded p-2 text-xs font-mono">
                  {compareResult.missing_packages.map((pkg) => (
                    <div key={pkg} className="text-gray-300">{pkg}</div>
                  ))}
                </div>
                {onRestorePackages && (
                  <button
                    onClick={handleRestoreMissing}
                    className="mt-2 px-3 py-1 text-sm bg-green-600/30 hover:bg-green-600/50 text-green-300 rounded transition-colors"
                  >
                    Restore Missing Packages
                  </button>
                )}
              </div>
            )}

            {compareResult.suggestions.length > 0 && (
              <div className="mt-4">
                <h5 className="text-sm font-medium mb-2">Suggestions:</h5>
                <div className="space-y-2">
                  {compareResult.suggestions.slice(0, 5).map((suggestion, idx) => (
                    <div
                      key={idx}
                      className="bg-gray-800 rounded p-2 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`font-medium ${getPriorityColor(suggestion.priority)}`}>
                          [{suggestion.priority.toUpperCase()}]
                        </span>
                        <span className="font-mono">{suggestion.package}</span>
                      </div>
                      <p className="text-gray-400 mt-1">{suggestion.reason}</p>
                    </div>
                  ))}
                  {compareResult.suggestions.length > 5 && (
                    <p className="text-xs text-gray-400">
                      And {compareResult.suggestions.length - 5} more suggestions...
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 max-w-lg mx-4 w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Import Backup</h3>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-gray-400 hover:text-white"
              >
                ×
              </button>
            </div>
            <p className="text-sm text-gray-400 mb-4">
              Import a backup file to compare with current device state
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Upload JSON file:</label>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImportFile}
                  className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-gray-700 file:text-gray-300 hover:file:bg-gray-600"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Or paste JSON:</label>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder="Paste backup JSON here..."
                  className="w-full h-32 bg-gray-700 border border-gray-600 rounded-lg p-3 text-sm font-mono text-white placeholder-gray-400 resize-none"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowImportModal(false)}
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCompareBackup}
                  disabled={!importText || isComparing}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors font-medium"
                >
                  {isComparing ? 'Comparing...' : 'Compare with Device'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
