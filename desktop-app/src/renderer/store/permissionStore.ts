import { create } from "zustand";
import { AppPermissionSummary, PermissionStats, permissionAnalyticsService, permissionApiService } from "../services/permissionService";

interface PermissionState {
  appPermissions: AppPermissionSummary[];
  stats: PermissionStats | null;
  isScanning: boolean;
  scanProgress: number;
  lastScannedDeviceId: string | null;
  lastScannedUserId: number | null;
  error: string | null;

  // Actions
  scanAllApps: (deviceId: string, userId: number, packages: any[]) => Promise<void>;
  clearScanResults: () => void;
  bulkRevokePermissions: (
    deviceId: string,
    userId: number,
    selectedPackages: Set<string>,
    categoryFilter?: string
  ) => Promise<{ successCount: number; failCount: number }>;
}

export const usePermissionStore = create<PermissionState>((set, get) => ({
  appPermissions: [],
  stats: null,
  isScanning: false,
  scanProgress: 0,
  lastScannedDeviceId: null,
  lastScannedUserId: null,
  error: null,

  scanAllApps: async (deviceId, userId, packages) => {
    set({ isScanning: true, scanProgress: 0, error: null });
    
    try {
      const results = await permissionApiService.scanEnabledPackages(
        deviceId,
        userId,
        packages,
        ({ percent }) => {
          set({ scanProgress: percent });
        }
      );

      const stats = permissionAnalyticsService.buildStats(results);

      set({
        appPermissions: results,
        stats,
        isScanning: false,
        lastScannedDeviceId: deviceId,
        lastScannedUserId: userId,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to scan permissions",
        isScanning: false,
      });
      throw error;
    }
  },

  clearScanResults: () => {
    set({
      appPermissions: [],
      stats: null,
      lastScannedDeviceId: null,
      lastScannedUserId: null,
      scanProgress: 0,
    });
  },

  bulkRevokePermissions: async (deviceId, userId, selectedPackages, categoryFilter) => {
    const { appPermissions } = get();
    
    try {
      const result = await permissionApiService.bulkRevokeDangerousPermissions(
        deviceId,
        userId,
        appPermissions,
        selectedPackages,
        categoryFilter
      );

      // We should probably rescan or at least update the local state after revocation
      // For now, let's just return the result and let the UI decide if it wants to rescan
      return result;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to revoke permissions",
      });
      throw error;
    }
  },
}));
