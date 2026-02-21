import { create } from "zustand";

export interface ActionHistoryItem {
  id: string;
  device_id: string;
  device_model?: string | null;
  device_brand?: string | null;
  package_name: string;
  action: "UNINSTALL" | "DISABLE" | "RESTORE" | "ENABLE";
  android_user: number;
  success: boolean;
  error_message?: string | null;
  created_at: string;
  is_undone?: boolean;
  // Aliased properties for compatibility
  deviceId?: string;
  packageName?: string;
  androidUser?: number;
  errorMessage?: string | null;
  createdAt?: string;
}

export interface ActionStats {
  total_actions: number;
  successful_actions: number;
  failed_actions: number;
  uninstall_count: number;
  restore_count: number;
  disable_count: number;
  enable_count: number;
  devices_count: number;
  packages_count: number;
  // Legacy aliases
  uninstalled?: number;
  disabled?: number;
  restored?: number;
}

export interface SavedBackup {
  id: string;
  device_id: string;
  device_model?: string | null;
  device_brand?: string | null;
  name: string;
  packages: Array<{ name: string; state: string }>;
  total_packages: number;
  created_at: string;
  // Aliased properties for compatibility
  deviceId?: string;
  createdAt?: string;
}

interface HistoryState {
  history: ActionHistoryItem[];
  stats: ActionStats;
  savedBackups: SavedBackup[];
  isLoadingHistory: boolean;
  isLoadingStats: boolean;
  isLoadingBackups: boolean;
  error: string | null;

  // Actions
  fetchHistory: (limit?: number) => Promise<void>;
  fetchStats: () => Promise<void>;
  fetchSavedBackups: () => Promise<void>;
  fetchDeviceHistory: (deviceId: string, limit?: number) => Promise<void>;
  fetchUndoableActions: (deviceId: string) => Promise<ActionHistoryItem[]>;
  recordAction: (action: {
    deviceId: string;
    deviceModel?: string;
    deviceBrand?: string;
    packageName: string;
    action: "UNINSTALL" | "DISABLE" | "RESTORE" | "ENABLE";
    androidUser: number;
    success: boolean;
    errorMessage?: string;
  }) => Promise<void>;
  saveBackup: (backup: {
    deviceId: string;
    deviceModel?: string;
    deviceBrand?: string;
    name: string;
    packages: Array<{ name: string; state: string }>;
  }) => Promise<void>;
  deleteBackup: (id: string) => Promise<void>;
  clearError: () => void;
}

// Helper to normalize history item for compatibility
function normalizeHistoryItem(item: any): ActionHistoryItem {
  return {
    ...item,
    // Aliases for compatibility
    deviceId: item.device_id,
    packageName: item.package_name,
    androidUser: item.android_user,
    errorMessage: item.error_message,
    createdAt: item.created_at,
  };
}

// Helper to normalize backup for compatibility
function normalizeBackup(backup: any): SavedBackup {
  return {
    ...backup,
    // Aliases for compatibility
    deviceId: backup.device_id,
    createdAt: backup.created_at,
  };
}

// Helper to normalize stats for compatibility
function normalizeStats(stats: any): ActionStats {
  return {
    ...stats,
    // Legacy aliases
    uninstalled: stats.uninstall_count,
    disabled: stats.disable_count,
    restored: stats.restore_count,
  };
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  history: [],
  stats: {
    total_actions: 0,
    successful_actions: 0,
    failed_actions: 0,
    uninstall_count: 0,
    restore_count: 0,
    disable_count: 0,
    enable_count: 0,
    devices_count: 0,
    packages_count: 0,
    uninstalled: 0,
    disabled: 0,
    restored: 0,
  },
  savedBackups: [],
  isLoadingHistory: false,
  isLoadingStats: false,
  isLoadingBackups: false,
  error: null,

  fetchHistory: async (limit = 100) => {
    set({ isLoadingHistory: true, error: null });
    try {
      const api = window?.electronAPI?.history;
      if (!api) {
        throw new Error("History API unavailable");
      }
      const rawHistory = await api.getAll(limit);
      const history = rawHistory.map(normalizeHistoryItem);
      set({ history, isLoadingHistory: false });
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : "Failed to fetch history",
        isLoadingHistory: false,
      });
    }
  },

  fetchStats: async () => {
    set({ isLoadingStats: true, error: null });
    try {
      const api = window?.electronAPI?.history;
      if (!api) {
        throw new Error("History API unavailable");
      }
      const rawStats = await api.getStats();
      const stats = normalizeStats(rawStats);
      set({ stats, isLoadingStats: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to fetch stats",
        isLoadingStats: false,
      });
    }
  },

  fetchSavedBackups: async () => {
    set({ isLoadingBackups: true, error: null });
    try {
      const api = window?.electronAPI?.savedBackups;
      if (!api) {
        throw new Error("Backups API unavailable");
      }
      const rawBackups = await api.getAll();
      const savedBackups = rawBackups.map(normalizeBackup);
      set({ savedBackups, isLoadingBackups: false });
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : "Failed to fetch backups",
        isLoadingBackups: false,
      });
    }
  },

  fetchDeviceHistory: async (deviceId: string, limit = 100) => {
    set({ isLoadingHistory: true, error: null });
    try {
      const api = window?.electronAPI?.history;
      if (!api) {
        throw new Error("History API unavailable");
      }
      const rawHistory = await api.getDevice(deviceId, limit);
      const history = rawHistory.map(normalizeHistoryItem);
      set({ history, isLoadingHistory: false });
    } catch (error) {
      set({
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch device history",
        isLoadingHistory: false,
      });
    }
  },

  fetchUndoableActions: async (deviceId: string) => {
    try {
      const api = window?.electronAPI?.history;
      if (!api) {
        throw new Error("History API unavailable");
      }
      const rawActions = await api.getUndoable(deviceId);
      return rawActions.map(normalizeHistoryItem);
    } catch (error) {
      console.error("Failed to fetch undoable actions:", error);
      return [];
    }
  },

  recordAction: async (action) => {
    try {
      const api = window?.electronAPI?.history;
      if (!api) {
        console.warn("History API unavailable - action not recorded");
        return;
      }
      const rawItem = await api.create(action);
      const newItem = normalizeHistoryItem(rawItem);
      set((state) => ({
        history: [newItem, ...state.history],
      }));
      // Also refresh stats
      get().fetchStats();
    } catch (error) {
      console.error("Failed to record action:", error);
    }
  },

  saveBackup: async (backup) => {
    try {
      const api = window?.electronAPI?.savedBackups;
      if (!api) {
        throw new Error("Backups API unavailable");
      }
      const rawBackup = await api.create(backup);
      const newBackup = normalizeBackup(rawBackup);
      set((state) => ({
        savedBackups: [newBackup, ...state.savedBackups],
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to save backup",
      });
      throw error;
    }
  },

  deleteBackup: async (id: string) => {
    try {
      const api = window?.electronAPI?.savedBackups;
      if (!api) {
        throw new Error("Backups API unavailable");
      }
      await api.delete(id);
      set((state) => ({
        savedBackups: state.savedBackups.filter((b) => b.id !== id),
      }));
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : "Failed to delete backup",
      });
      throw error;
    }
  },

  clearError: () => set({ error: null }),
}));
