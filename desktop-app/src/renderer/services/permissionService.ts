export interface Permission {
  name: string;
  granted: boolean;
  category: string;
  description: string;
  isDangerous: boolean;
  type: "runtime" | "install";
}

export interface PermissionResult {
  packageName: string;
  permissions: Permission[];
  dangerousCount: number;
  grantedDangerousCount: number;
  totalCount: number;
}

export interface AppPermissionSummary {
  packageName: string;
  appName: string;
  permissions: Permission[];
  dangerousCount: number;
  grantedDangerousCount: number;
  totalCount: number;
  privacyScore: number;
  isScanning?: boolean;
}

export interface CategoryConfig {
  icon: string;
  color: string;
  bg: string;
  description: string;
}

export interface ScanProgressState {
  processed: number;
  total: number;
  percent: number;
}

export interface PermissionStats {
  totalApps: number;
  totalDangerous: number;
  grantedDangerous: number;
  averagePrivacyScore: number;
  categoryStats: Record<string, { apps: number; granted: number; total: number }>;
}

export type PermissionSortMode = "privacy" | "dangerous" | "name";
export type PermissionFilterMode = "all" | "dangerous" | "granted";

const CATEGORY_CONFIG: Record<string, CategoryConfig> = {
  Location: { icon: "📍", color: "text-red-400", bg: "bg-red-500/20", description: "Track your physical location" },
  Camera: { icon: "📷", color: "text-purple-400", bg: "bg-purple-500/20", description: "Access your camera" },
  Microphone: { icon: "🎤", color: "text-orange-400", bg: "bg-orange-500/20", description: "Record audio" },
  Contacts: { icon: "👥", color: "text-blue-400", bg: "bg-blue-500/20", description: "Read your contacts" },
  Phone: { icon: "📞", color: "text-green-400", bg: "bg-green-500/20", description: "Access call logs and make calls" },
  SMS: { icon: "💬", color: "text-cyan-400", bg: "bg-cyan-500/20", description: "Read and send messages" },
  Storage: { icon: "📁", color: "text-yellow-400", bg: "bg-yellow-500/20", description: "Access your files" },
  Calendar: { icon: "📅", color: "text-pink-400", bg: "bg-pink-500/20", description: "Read calendar events" },
  Sensors: { icon: "⌚", color: "text-indigo-400", bg: "bg-indigo-500/20", description: "Access body sensors" },
  Bluetooth: { icon: "📶", color: "text-blue-300", bg: "bg-blue-500/20", description: "Connect to Bluetooth devices" },
  Notifications: { icon: "🔔", color: "text-amber-400", bg: "bg-amber-500/20", description: "Post notifications" },
  Other: { icon: "⚙️", color: "text-gray-400", bg: "bg-gray-500/20", description: "Other system permissions" },
};

const PRIVACY_WEIGHTS: Record<string, number> = {
  Location: 10,
  Camera: 9,
  Microphone: 9,
  Contacts: 7,
  Phone: 8,
  SMS: 8,
  Storage: 6,
  Calendar: 5,
  Sensors: 7,
  Bluetooth: 4,
  Notifications: 2,
  Other: 1,
};

export class PermissionAnalyticsService {
  static readonly categoryConfig = CATEGORY_CONFIG;

  calculatePrivacyScore(permissions: Permission[]): number {
    const dangerousGranted = permissions.filter(
      (permission) => permission.isDangerous && permission.granted,
    );

    if (dangerousGranted.length === 0) {
      return 100;
    }

    let totalWeight = 0;
    for (const permission of dangerousGranted) {
      totalWeight += PRIVACY_WEIGHTS[permission.category] || 1;
    }

    const maxWeight = Object.values(PRIVACY_WEIGHTS).reduce(
      (sum, value) => sum + value,
      0,
    );

    return Math.max(0, Math.round(100 - (totalWeight / maxWeight) * 100));
  }

  getPrivacyScoreColor(score: number): string {
    if (score >= 80) return "text-green-400";
    if (score >= 60) return "text-yellow-400";
    if (score >= 40) return "text-orange-400";
    return "text-red-400";
  }

  getPrivacyScoreBg(score: number): string {
    if (score >= 80) return "bg-green-500";
    if (score >= 60) return "bg-yellow-500";
    if (score >= 40) return "bg-orange-500";
    return "bg-red-500";
  }

  getCategoryConfig(category: string): CategoryConfig {
    return CATEGORY_CONFIG[category] || CATEGORY_CONFIG.Other;
  }

  groupPermissionsByCategory(permissions: Permission[]): Record<string, Permission[]> {
    const grouped: Record<string, Permission[]> = {};

    for (const permission of permissions) {
      if (!grouped[permission.category]) {
        grouped[permission.category] = [];
      }
      grouped[permission.category].push(permission);
    }

    return grouped;
  }

  filterPermissions(
    permissions: Permission[],
    filter: PermissionFilterMode,
    searchQuery: string,
  ): Permission[] {
    let result = permissions;

    if (filter === "dangerous") {
      result = result.filter((permission) => permission.isDangerous);
    } else if (filter === "granted") {
      result = result.filter((permission) => permission.granted);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (permission) =>
          permission.name.toLowerCase().includes(query) ||
          permission.description.toLowerCase().includes(query) ||
          permission.category.toLowerCase().includes(query),
      );
    }

    return result;
  }

  buildStats(appPermissions: AppPermissionSummary[]): PermissionStats {
    const totalApps = appPermissions.length;
    const totalDangerous = appPermissions.reduce(
      (sum, app) => sum + app.dangerousCount,
      0,
    );
    const grantedDangerous = appPermissions.reduce(
      (sum, app) => sum + app.grantedDangerousCount,
      0,
    );
    const averagePrivacyScore =
      totalApps > 0
        ? Math.round(
            appPermissions.reduce((sum, app) => sum + app.privacyScore, 0) /
              totalApps,
          )
        : 100;

    const categoryStats: Record<string, { apps: number; granted: number; total: number }> = {};

    for (const app of appPermissions) {
      for (const permission of app.permissions) {
        if (!permission.isDangerous) {
          continue;
        }

        if (!categoryStats[permission.category]) {
          categoryStats[permission.category] = { apps: 0, granted: 0, total: 0 };
        }

        categoryStats[permission.category].total += 1;
        if (permission.granted) {
          categoryStats[permission.category].granted += 1;
        }
      }
    }

    for (const category of Object.keys(categoryStats)) {
      const appsWithCategory = new Set(
        appPermissions
          .filter((app) =>
            app.permissions.some(
              (permission) =>
                permission.category === category &&
                permission.isDangerous &&
                permission.granted,
            ),
          )
          .map((app) => app.packageName),
      );

      categoryStats[category].apps = appsWithCategory.size;
    }

    return {
      totalApps,
      totalDangerous,
      grantedDangerous,
      averagePrivacyScore,
      categoryStats,
    };
  }

  filterAndSortApps(
    appPermissions: AppPermissionSummary[],
    searchQuery: string,
    selectedCategory: string | null,
    sortBy: PermissionSortMode,
  ): AppPermissionSummary[] {
    let apps = [...appPermissions];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      apps = apps.filter(
        (app) =>
          app.packageName.toLowerCase().includes(query) ||
          app.appName.toLowerCase().includes(query),
      );
    }

    if (selectedCategory) {
      apps = apps.filter((app) =>
        app.permissions.some(
          (permission) =>
            permission.category === selectedCategory &&
            permission.isDangerous &&
            permission.granted,
        ),
      );
    }

    switch (sortBy) {
      case "privacy":
        apps.sort((a, b) => a.privacyScore - b.privacyScore);
        break;
      case "dangerous":
        apps.sort((a, b) => b.grantedDangerousCount - a.grantedDangerousCount);
        break;
      case "name":
        apps.sort((a, b) => a.appName.localeCompare(b.appName));
        break;
    }

    return apps;
  }

  findAppsInCategory(
    appPermissions: AppPermissionSummary[],
    selectedCategory: string | null,
  ): AppPermissionSummary[] {
    if (!selectedCategory) {
      return [];
    }

    return appPermissions.filter((app) =>
      app.permissions.some(
        (permission) =>
          permission.category === selectedCategory &&
          permission.isDangerous &&
          permission.granted,
      ),
    );
  }
}

export class PermissionApiService {
  private getAdbApi() {
    return typeof window === "undefined" ? null : window.electronAPI?.adb || null;
  }

  private requireAdbApi() {
    const adbApi = this.getAdbApi();
    if (!adbApi) {
      throw new Error("Electron API unavailable. Run via Electron (npm start).");
    }

    return adbApi;
  }

  async getPackagePermissions(deviceId: string, packageName: string, userId?: number): Promise<PermissionResult> {
    const adbApi = this.requireAdbApi();
    return adbApi.getPackagePermissions(deviceId, packageName, userId);
  }

  async togglePermission(
    deviceId: string,
    packageName: string,
    permission: string,
    action: "grant" | "revoke",
    userId?: number,
  ) {
    const adbApi = this.requireAdbApi();
    return adbApi.togglePermission(deviceId, packageName, permission, action, userId);
  }

  async scanEnabledPackages(
    deviceId: string,
    selectedUser: number,
    packages: Array<{ name: string; description?: string | null; state: string }>,
    onProgress?: (state: ScanProgressState) => void,
  ): Promise<AppPermissionSummary[]> {
    const enabledPackages = packages.filter((pkg) => pkg.state === "enabled");
    const results: AppPermissionSummary[] = [];
    const analytics = new PermissionAnalyticsService();

    if (enabledPackages.length === 0) {
      onProgress?.({ processed: 0, total: 0, percent: 0 });
      return results;
    }

    for (let index = 0; index < enabledPackages.length; index += 1) {
      const pkg = enabledPackages[index];
      const result = await this.getPackagePermissions(deviceId, pkg.name, selectedUser);

      if (result && result.permissions.length > 0) {
        results.push({
          packageName: pkg.name,
          appName: pkg.description || pkg.name.split(".").pop() || pkg.name,
          permissions: result.permissions,
          dangerousCount: result.dangerousCount,
          grantedDangerousCount: result.grantedDangerousCount,
          totalCount: result.totalCount,
          privacyScore: analytics.calculatePrivacyScore(result.permissions),
        });
      }

      onProgress?.({
        processed: index + 1,
        total: enabledPackages.length,
        percent: Math.round(((index + 1) / enabledPackages.length) * 100),
      });
    }

    return results;
  }

  async bulkRevokeDangerousPermissions(
    deviceId: string,
    selectedUser: number,
    appPermissions: AppPermissionSummary[],
    selectedPackages: Set<string>,
    categoryFilter?: string,
  ): Promise<{ successCount: number; failCount: number }> {
    let successCount = 0;
    let failCount = 0;

    for (const packageName of selectedPackages) {
      const app = appPermissions.find((item) => item.packageName === packageName);
      if (!app) {
        continue;
      }

      const permissionsToRevoke = app.permissions.filter(
        (permission) =>
          permission.isDangerous &&
          permission.granted &&
          permission.type === "runtime" &&
          (!categoryFilter || permission.category === categoryFilter),
      );

      for (const permission of permissionsToRevoke) {
        try {
          const result = await this.togglePermission(
            deviceId,
            packageName,
            permission.name,
            "revoke",
            selectedUser,
          );

          if (result.success) {
            successCount += 1;
          } else {
            failCount += 1;
          }
        } catch {
          failCount += 1;
        }
      }
    }

    return { successCount, failCount };
  }
}

export const permissionAnalyticsService = new PermissionAnalyticsService();
export const permissionApiService = new PermissionApiService();