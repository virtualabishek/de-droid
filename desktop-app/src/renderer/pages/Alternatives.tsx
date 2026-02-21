import { useState, useEffect } from 'react';
import { useDeviceStore } from '../store/deviceStore';

interface Alternative {
  id: string;
  name: string;
  description: string;
  packageId: string;
  source: string;
  sourceUrl: string;
  githubUrl: string;
  icon: string;
  fdroid_url?: string;
  download_available?: boolean;
}

interface InstallProgress {
  packageId: string;
  status: 'downloading' | 'installing' | 'success' | 'error';
  message?: string;
}

export default function Alternatives() {
  const { selectedDevice } = useDeviceStore();
  const [alternatives, setAlternatives] = useState<Alternative[]>([]);
  const [filteredAlternatives, setFilteredAlternatives] = useState<Alternative[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [installProgress, setInstallProgress] = useState<Record<string, InstallProgress>>({});

  const categories = [
    { id: 'all', name: 'All Apps', icon: '📱' },
    { id: 'media', name: 'Media & Video', icon: '🎬' },
    { id: 'browser', name: 'Browsers', icon: '🌐' },
    { id: 'email', name: 'Email', icon: '📧' },
    { id: 'cloud', name: 'Cloud Storage', icon: '☁️' },
    { id: 'social', name: 'Social', icon: '💬' },
    { id: 'productivity', name: 'Productivity', icon: '📝' },
    { id: 'store', name: 'App Stores', icon: '🏪' },
  ];

  useEffect(() => {
    loadAlternatives();
  }, []);

  useEffect(() => {
    filterAlternatives();
  }, [alternatives, searchQuery, categoryFilter]);

  const loadAlternatives = async () => {
    setIsLoading(true);
    try {
      const api = window?.electronAPI?.alternatives;
      if (!api) {
        throw new Error('Alternatives API unavailable');
      }
      const data = await api.getAll();
      setAlternatives(data);
    } catch (error) {
      console.error('Failed to load alternatives:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const filterAlternatives = () => {
    let filtered = [...alternatives];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (app) =>
          app.name.toLowerCase().includes(query) ||
          app.description.toLowerCase().includes(query) ||
          app.packageId.toLowerCase().includes(query)
      );
    }

    if (categoryFilter !== 'all') {
      const categoryKeywords: Record<string, string[]> = {
        media: ['video', 'youtube', 'music', 'player', 'gallery', 'photo', 'tube'],
        browser: ['browser', 'firefox', 'chromium', 'web'],
        email: ['email', 'mail'],
        cloud: ['cloud', 'storage', 'sync', 'nextcloud', 'drive'],
        social: ['social', 'facebook', 'messenger', 'chat'],
        productivity: ['calendar', 'notes', 'office', 'document'],
        store: ['store', 'f-droid', 'aurora', 'market'],
      };
      const keywords = categoryKeywords[categoryFilter] || [];
      filtered = filtered.filter((app) => {
        const searchText = `${app.name} ${app.description}`.toLowerCase();
        return keywords.some((keyword) => searchText.includes(keyword));
      });
    }

    setFilteredAlternatives(filtered);
  };

  const handleInstall = async (app: Alternative) => {
    if (!selectedDevice) {
      alert('Please connect a device first');
      return;
    }

    setInstallProgress((prev) => ({
      ...prev,
      [app.packageId]: { packageId: app.packageId, status: 'downloading' },
    }));

    try {
      const fdroidApi = window?.electronAPI?.fdroid;
      if (!fdroidApi) {
        throw new Error('F-Droid API unavailable');
      }

      setInstallProgress((prev) => ({
        ...prev,
        [app.packageId]: { packageId: app.packageId, status: 'installing' },
      }));

      const result = await fdroidApi.install(selectedDevice.adb_id, app.packageId);
      
      if (result.success) {
        setInstallProgress((prev) => ({
          ...prev,
          [app.packageId]: {
            packageId: app.packageId,
            status: 'success',
            message: 'Installed successfully!',
          },
        }));
      } else {
        throw new Error(result.install_message || 'Installation failed');
      }
    } catch (error) {
      setInstallProgress((prev) => ({
        ...prev,
        [app.packageId]: {
          packageId: app.packageId,
          status: 'error',
          message: error instanceof Error ? error.message : 'Failed to install',
        },
      }));
    }

    // Clear progress after 5 seconds
    setTimeout(() => {
      setInstallProgress((prev) => {
        const newProgress = { ...prev };
        delete newProgress[app.packageId];
        return newProgress;
      });
    }, 5000);
  };

  const openExternal = (url: string) => {
    window.open(url, '_blank');
  };

  const getStatusBadge = (packageId: string) => {
    const progress = installProgress[packageId];
    if (!progress) return null;

    const statusColors = {
      downloading: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      installing: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      success: 'bg-green-500/20 text-green-400 border-green-500/30',
      error: 'bg-red-500/20 text-red-400 border-red-500/30',
    };

    const statusText = {
      downloading: '⬇️ Downloading...',
      installing: '📦 Installing...',
      success: '✓ Installed!',
      error: `✗ ${progress.message}`,
    };

    return (
      <span className={`text-xs px-2 py-1 rounded border ${statusColors[progress.status]}`}>
        {statusText[progress.status]}
      </span>
    );
  };

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Header */}
      <div className="p-6 border-b border-gray-700">
        <h1 className="text-2xl font-bold mb-2">Open Source Alternatives</h1>
        <p className="text-gray-400">
          Discover and install privacy-respecting, open source alternatives to common apps
        </p>
      </div>

      {/* Filters */}
      <div className="p-4 border-b border-gray-700 bg-gray-800/50">
        <div className="flex gap-4 items-center mb-4">
          {/* Search */}
          <div className="flex-1 relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
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
              placeholder="Search apps..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg pl-10 pr-4 py-3 text-white placeholder-gray-400 text-lg"
            />
          </div>

          {/* Device indicator */}
          {selectedDevice ? (
            <div className="flex items-center gap-2 px-4 py-2 bg-green-500/20 border border-green-500/30 rounded-lg">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <span className="text-green-400 text-sm">{selectedDevice.model}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-4 py-2 bg-yellow-500/20 border border-yellow-500/30 rounded-lg">
              <span className="text-yellow-400 text-sm">No device connected</span>
            </div>
          )}
        </div>

        {/* Category tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategoryFilter(cat.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                categoryFilter === cat.id
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              <span>{cat.icon}</span>
              <span>{cat.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* App Grid */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
          </div>
        ) : filteredAlternatives.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-lg">No apps found</p>
            <p className="text-sm">Try adjusting your search or filters</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAlternatives.map((app) => (
              <div
                key={app.id}
                className="bg-gray-800 border border-gray-700 rounded-xl p-5 hover:border-primary-500/50 transition-colors"
              >
                {/* App header */}
                <div className="flex items-start gap-4 mb-4">
                  <div className="w-14 h-14 rounded-xl bg-linear-to-br from-primary-500 to-primary-700 flex items-center justify-center text-2xl font-bold text-white">
                    {app.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-lg truncate">{app.name}</h3>
                    <p className="text-xs text-gray-400 font-mono truncate">{app.packageId}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400 border border-green-500/30">
                        {app.source}
                      </span>
                      {getStatusBadge(app.packageId)}
                    </div>
                  </div>
                </div>

                {/* Description */}
                <p className="text-sm text-gray-300 mb-4 line-clamp-2">{app.description}</p>

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleInstall(app)}
                    disabled={!selectedDevice || !!installProgress[app.packageId]}
                    className="flex-1 px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors font-medium text-sm"
                  >
                    {installProgress[app.packageId]?.status === 'downloading'
                      ? 'Downloading...'
                      : installProgress[app.packageId]?.status === 'installing'
                      ? 'Installing...'
                      : 'Install'}
                  </button>
                  <button
                    onClick={() => openExternal(app.sourceUrl)}
                    className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
                    title="View on F-Droid"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                  </button>
                  {app.githubUrl && (
                    <button
                      onClick={() => openExternal(app.githubUrl)}
                      className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
                      title="View on GitHub"
                    >
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <path
                          fillRule="evenodd"
                          d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Info footer */}
      <div className="p-4 border-t border-gray-700 bg-gray-800/50">
        <div className="flex items-center justify-between text-sm text-gray-400">
          <span>{filteredAlternatives.length} apps available</span>
          <span>Apps are sourced from F-Droid • Install requires connected device</span>
        </div>
      </div>
    </div>
  );
}
