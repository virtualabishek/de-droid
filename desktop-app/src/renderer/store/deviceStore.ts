import { create } from 'zustand';

interface Device {
  adb_id: string;
  model: string;
  brand: string;
  android_sdk: number;
  users: Array<{ id: number; index: number }>;
}

interface Package {
  name: string;
  state: 'enabled' | 'disabled' | 'uninstalled';
  packageType?: 'system' | 'user';
  selected?: boolean;
  sizeBytes?: number;
  description?: string;
  removal?: string;
  category?: string;
  list?: string;
  labels?: string[];
  dependencies?: string[];
  neededBy?: string[];
  alternatives?: string[];
  modelLabel?: string;
  modelConfidence?: number;
  modelVersion?: string;
  modelTopFactors?: string[];
  oemOverrideApplied?: boolean;
  oemOverrideReason?: string;
}

interface AlternativeApp {
  id: string;
  name: string;
  description: string;
  packageId: string;
  source: string;
  sourceUrl: string;
  githubUrl: string;
  icon: string;
}

interface Category {
  id: string;
  name: string;
  description: string;
  color: string;
}

interface DeviceState {
  devices: Device[];
  selectedDevice: Device | null;
  selectedUser: number;
  packages: Package[];
  categories: Category[];
  alternatives: AlternativeApp[];
  isLoadingDevices: boolean;
  isLoadingPackages: boolean;
  error: string | null;
  fetchDevices: () => Promise<void>;
  selectDevice: (device: Device | null) => void;
  selectUser: (userId: number) => void;
  fetchPackages: (enriched?: boolean) => Promise<void>;
  fetchCategories: () => Promise<void>;
  fetchAlternatives: () => Promise<void>;
  fetchAlternativesForPackage: (packageId: string) => Promise<AlternativeApp[]>;
  togglePackageSelection: (packageName: string) => void;
  selectAllPackages: (state?: 'enabled' | 'disabled' | 'uninstalled') => void;
  selectAllByCategory: (category: string) => void;
  clearSelection: () => void;
  getSelectedPackages: () => Package[];
}

export const useDeviceStore = create<DeviceState>((set, get) => ({
  devices: [],
  selectedDevice: null,
  selectedUser: 0,
  packages: [],
  categories: [],
  alternatives: [],
  isLoadingDevices: false,
  isLoadingPackages: false,
  error: null,

  fetchDevices: async () => {
    set({ isLoadingDevices: true, error: null });
    try {
      const api = window?.electronAPI?.adb;
      if (!api) {
        throw new Error('Electron API unavailable. Run via Electron (npm start).');
      }
      const devices = await api.getDevices();
      set({ devices, isLoadingDevices: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch devices',
        isLoadingDevices: false,
      });
    }
  },

  selectDevice: (device: Device | null) => {
    set({ selectedDevice: device, selectedUser: 0, packages: [] });
  },

  selectUser: (userId: number) => {
    set({ selectedUser: userId });
  },

  fetchPackages: async (enriched = true) => {
    const { selectedDevice, selectedUser } = get();
    if (!selectedDevice) return;

    set({ isLoadingPackages: true, error: null });
    try {
      const api = window?.electronAPI?.adb;
      if (!api) {
        throw new Error('Electron API unavailable. Run via Electron (npm start).');
      }

      let result;
      // Fetch ALL packages (system_only = false) to include user-installed apps
      if (enriched && api.getEnrichedPackages) {
        result = await api.getEnrichedPackages(
          selectedDevice.adb_id,
          selectedUser,
          false  // Include all packages, not just system
        );
      } else {
        result = await api.getPackages(
          selectedDevice.adb_id,
          selectedUser,
          false  // Include all packages, not just system
        );
      }

      set({
        packages: result.packages.map((pkg: Package) => ({
          ...pkg,
          selected: false,
        })),
        isLoadingPackages: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch packages',
        isLoadingPackages: false,
      });
    }
  },

  fetchCategories: async () => {
    try {
      const api = window?.electronAPI?.debloat;
      if (!api) {
        throw new Error('Electron API unavailable. Run via Electron (npm start).');
      }
      const result = await api.getCategories();
      set({ categories: result.categories });
    } catch (error) {
      console.error('Failed to fetch categories:', error);
    }
  },

  fetchAlternatives: async () => {
    try {
      const api = window?.electronAPI?.debloat;
      if (!api) {
        throw new Error('Electron API unavailable. Run via Electron (npm start).');
      }
      const result = await api.getAlternatives();
      set({ alternatives: result.alternatives });
    } catch (error) {
      console.error('Failed to fetch alternatives:', error);
    }
  },

  fetchAlternativesForPackage: async (packageId: string) => {
    try {
      const api = window?.electronAPI?.debloat;
      if (!api) {
        throw new Error('Electron API unavailable. Run via Electron (npm start).');
      }
      const result = await api.getAlternativesForPackage(packageId);
      return result.alternatives;
    } catch (error) {
      console.error('Failed to fetch alternatives for package:', error);
      return [];
    }
  },

  togglePackageSelection: (packageName: string) => {
    set((state) => ({
      packages: state.packages.map((pkg) =>
        pkg.name === packageName ? { ...pkg, selected: !pkg.selected } : pkg
      ),
    }));
  },

  selectAllPackages: (filterState?: 'enabled' | 'disabled' | 'uninstalled') => {
    set((state) => ({
      packages: state.packages.map((pkg) => ({
        ...pkg,
        selected: filterState ? pkg.state === filterState : true,
      })),
    }));
  },

  selectAllByCategory: (category: string) => {
    set((state) => ({
      packages: state.packages.map((pkg) => ({
        ...pkg,
        selected: pkg.category?.toUpperCase() === category.toUpperCase(),
      })),
    }));
  },

  clearSelection: () => {
    set((state) => ({
      packages: state.packages.map((pkg) => ({ ...pkg, selected: false })),
    }));
  },

  getSelectedPackages: () => {
    return get().packages.filter((pkg) => pkg.selected);
  },
}));
