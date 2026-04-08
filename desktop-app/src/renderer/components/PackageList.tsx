import { useState, useMemo, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import Fuse from "fuse.js";
import { useLocation } from "react-router-dom";
import { useDeviceStore } from "../store/deviceStore";
import { PackageDetailsModal } from "./PackageDetailsModal";

interface PackageListProps {
  onAction: (
    action:
      | "uninstall"
      | "restore"
      | "disable"
      | "enable"
      | "restrict-background"
      | "relax-background",
    packages: string[],
  ) => void;
  isLoading: boolean;
  onOpenPermissions?: (packageName: string) => void;
  userId?: string;
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

interface Package {
  name: string;
  state: "enabled" | "disabled" | "uninstalled";
  packageType?: "system" | "user";
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

// Vendor detection for grouping
const VENDOR_PREFIXES: Record<string, string> = {
  "com.google.": "Google",
  "com.android.": "Android System",
  "com.samsung.": "Samsung",
  "com.sec.": "Samsung",
  "com.huawei.": "Huawei",
  "com.xiaomi.": "Xiaomi",
  "com.miui.": "Xiaomi/MIUI",
  "com.oppo.": "Oppo",
  "com.coloros.": "Oppo/ColorOS",
  "com.vivo.": "Vivo",
  "com.oneplus.": "OnePlus",
  "com.qualcomm.": "Qualcomm",
  "com.mediatek.": "MediaTek",
  "com.facebook.": "Facebook/Meta",
  "com.microsoft.": "Microsoft",
  "com.amazon.": "Amazon",
  "org.chromium.": "Chromium",
  "android.": "Android Core",
};

function getVendor(packageName: string): string {
  const lowerName = packageName.toLowerCase();
  for (const [prefix, vendor] of Object.entries(VENDOR_PREFIXES)) {
    if (lowerName.startsWith(prefix)) return vendor;
  }
  return "Other";
}

function isSystemPackage(packageName: string): boolean {
  const lowerPackageName = packageName.toLowerCase();
  return Object.keys(VENDOR_PREFIXES).some((prefix) =>
    lowerPackageName.startsWith(prefix),
  );
}

function resolvePackageType(pkg: Package): "system" | "user" {
  if (pkg.packageType === "system" || pkg.packageType === "user") {
    return pkg.packageType;
  }
  return isSystemPackage(pkg.name) ? "system" : "user";
}

function formatBytes(bytes?: number): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) {
    return "Size N/A";
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
}

type SortOption = "name-asc" | "name-desc" | "state" | "category" | "removal" | "vendor" | "confidence";
type ViewMode = "list" | "compact" | "grid";
type GroupBy = "none" | "category" | "vendor" | "state" | "removal";
type ModelLabelFilter = "RECOMMENDED" | "ADVANCED" | "EXPERT" | "UNSAFE";

interface FilterPreset {
  id: string;
  name: string;
  icon: string;
  filters: {
    states?: Array<"enabled" | "disabled" | "uninstalled">;
    categories?: Array<"BLOATWARE" | "OPTIONAL" | "ESSENTIAL">;
    packageTypes?: Array<"system" | "user">;
    removals?: Array<"RECOMMENDED" | "ADVANCED" | "EXPERT" | "UNSAFE">;
  };
}

type CustomFilterPreset = {
  id: string;
  name: string;
  filters: FilterPreset["filters"];
};

type PersistedFilterState = {
  states: Array<"enabled" | "disabled" | "uninstalled">;
  categories: Array<"BLOATWARE" | "OPTIONAL" | "ESSENTIAL">;
  packageTypes: Array<"system" | "user">;
  removals: Array<"RECOMMENDED" | "ADVANCED" | "EXPERT" | "UNSAFE">;
  modelConfidence: "all" | "high" | "medium" | "low" | "unknown";
  searchQuery: string;
};

const DEFAULT_STATES: Array<"enabled" | "disabled" | "uninstalled"> = [
  "enabled",
  "disabled",
  "uninstalled",
];
const DEFAULT_CATEGORIES: Array<"BLOATWARE" | "OPTIONAL" | "ESSENTIAL"> = [
  "BLOATWARE",
  "OPTIONAL",
  "ESSENTIAL",
];
const DEFAULT_PACKAGE_TYPES: Array<"system" | "user"> = ["system", "user"];
const DEFAULT_REMOVALS: Array<"RECOMMENDED" | "ADVANCED" | "EXPERT" | "UNSAFE"> = [
  "RECOMMENDED",
  "ADVANCED",
  "EXPERT",
  "UNSAFE",
];

const FILTER_PRESETS: FilterPreset[] = [
  { id: "all", name: "All Packages", icon: "📦", filters: {} },
  {
    id: "bloatware",
    name: "System Bloatware",
    icon: "🗑️",
    filters: { categories: ["BLOATWARE"], packageTypes: ["system"] },
  },
  {
    id: "user-bloatware",
    name: "User Bloatware",
    icon: "👤",
    filters: { categories: ["BLOATWARE"], packageTypes: ["user"] },
  },
  {
    id: "removed-bloatware",
    name: "Removed Bloatware",
    icon: "♻️",
    filters: { categories: ["BLOATWARE"], states: ["uninstalled", "disabled"] },
  },
  {
    id: "safe-remove",
    name: "Safe to Remove",
    icon: "✅",
    filters: { removals: ["RECOMMENDED"], states: ["enabled"] },
  },
  { id: "disabled", name: "Disabled", icon: "⏸️", filters: { states: ["disabled"] } },
  {
    id: "uninstalled",
    name: "Removed",
    icon: "❌",
    filters: { states: ["uninstalled"] },
  },
  {
    id: "essential",
    name: "Essential",
    icon: "⚠️",
    filters: { categories: ["ESSENTIAL"] },
  },
  { id: "user-apps", name: "User Apps", icon: "👤", filters: { packageTypes: ["user"] } },
];

export function PackageList({
  onAction,
  isLoading,
  onOpenPermissions,
  userId,
}: PackageListProps) {
  const location = useLocation();
  const {
    packages,
    togglePackageSelection,
    selectAllByCategory,
    clearSelection,
    fetchAlternativesForPackage,
    fetchCategories,
  } = useDeviceStore();

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [showSearchSuggestions, setShowSearchSuggestions] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Filter state
  const [filterStates, setFilterStates] =
    useState<Array<"enabled" | "disabled" | "uninstalled">>(DEFAULT_STATES);
  const [filterCategories, setFilterCategories] =
    useState<Array<"BLOATWARE" | "OPTIONAL" | "ESSENTIAL">>(DEFAULT_CATEGORIES);
  const [packageTypeFilter, setPackageTypeFilter] =
    useState<Array<"system" | "user">>(DEFAULT_PACKAGE_TYPES);
  const [filterRemovals, setFilterRemovals] =
    useState<Array<"RECOMMENDED" | "ADVANCED" | "EXPERT" | "UNSAFE">>(DEFAULT_REMOVALS);
  const [deepLinkModelLabels, setDeepLinkModelLabels] = useState<ModelLabelFilter[] | null>(null);
  const [filterModelConfidence, setFilterModelConfidence] = useState<"all" | "high" | "medium" | "low" | "unknown">("all");
  const [activePreset, setActivePreset] = useState<string>("all");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [customPresets, setCustomPresets] = useState<CustomFilterPreset[]>([]);

  // View state
  const [sortBy, setSortBy] = useState<SortOption>("name-asc");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);

  // Modal state
  const [showWarningDialog, setShowWarningDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    action:
      | "uninstall"
      | "restore"
      | "disable"
      | "enable"
      | "restrict-background"
      | "relax-background";
    packages: string[];
  } | null>(null);
  const [selectedPackageAlternatives, setSelectedPackageAlternatives] = useState<AlternativeApp[]>([]);
  const [showAlternativesModal, setShowAlternativesModal] = useState(false);
  const [selectedPackageForAlternatives, setSelectedPackageForAlternatives] = useState<string | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedPackageForDetails, setSelectedPackageForDetails] = useState<string | null>(null);

  // Virtualization
  const parentRef = useRef<HTMLDivElement>(null);

  const { selectedDevice } = useDeviceStore();

  const scopedStorageKey = (baseKey: string) =>
    `${baseKey}:${userId || "anonymous"}`;

  const applyPersistedState = (state: PersistedFilterState) => {
    setFilterStates(state.states?.length ? state.states : DEFAULT_STATES);
    setFilterCategories(state.categories?.length ? state.categories : DEFAULT_CATEGORIES);
    setPackageTypeFilter(state.packageTypes?.length ? state.packageTypes : DEFAULT_PACKAGE_TYPES);
    setFilterRemovals(state.removals?.length ? state.removals : DEFAULT_REMOVALS);
    setFilterModelConfidence(state.modelConfidence || "all");
    setSearchQuery(state.searchQuery || "");
    setActivePreset("all");
  };

  // Load recent searches from localStorage
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const source = params.get("source");
    const modelLabelParam = params.get("modelLabel");
    const packageParam = params.get("package");
    const shouldOpenDetails = params.get("openDetails") === "1";

    if (source !== "ai-insights") {
      setDeepLinkModelLabels(null);
      return;
    }

    if (modelLabelParam) {
      const labels = modelLabelParam
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter((value): value is ModelLabelFilter =>
          ["RECOMMENDED", "ADVANCED", "EXPERT", "UNSAFE"].includes(value),
        );
      setDeepLinkModelLabels(labels.length > 0 ? labels : null);
    } else {
      setDeepLinkModelLabels(null);
    }

    if (packageParam) {
      setSearchQuery(packageParam);
      setActivePreset("all");
      if (shouldOpenDetails) {
        setSelectedPackageForDetails(packageParam);
        setShowDetailsModal(true);
      }
    }
  }, [location.search]);

  useEffect(() => {
    const saved = localStorage.getItem(scopedStorageKey("recentPackageSearches"));
    if (saved) {
      setRecentSearches(JSON.parse(saved).slice(0, 5));
    }
    const savedPresets = localStorage.getItem(scopedStorageKey("packageCustomFilterPresets"));
    if (savedPresets) {
      try {
        const parsed = JSON.parse(savedPresets) as CustomFilterPreset[];
        if (Array.isArray(parsed)) {
          setCustomPresets(parsed.slice(0, 10));
        }
      } catch {
        setCustomPresets([]);
      }
    }

    const savedFilters = localStorage.getItem(scopedStorageKey("packageLastFilters"));
    if (savedFilters) {
      try {
        const parsed = JSON.parse(savedFilters) as PersistedFilterState;
        applyPersistedState(parsed);
      } catch {
        // ignore invalid persisted state
      }
    }
  }, [userId]);

  useEffect(() => {
    localStorage.setItem(
      scopedStorageKey("packageCustomFilterPresets"),
      JSON.stringify(customPresets),
    );
  }, [customPresets, userId]);

  useEffect(() => {
    const payload: PersistedFilterState = {
      states: filterStates,
      categories: filterCategories,
      packageTypes: packageTypeFilter,
      removals: filterRemovals,
      modelConfidence: filterModelConfidence,
      searchQuery,
    };

    localStorage.setItem(scopedStorageKey("packageLastFilters"), JSON.stringify(payload));
  }, [filterStates, filterCategories, packageTypeFilter, filterRemovals, filterModelConfidence, searchQuery, userId]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  // Fuzzy search setup
  const fuse = useMemo(() => {
    return new Fuse(packages, {
      keys: [
        { name: "name", weight: 0.7 },
        { name: "description", weight: 0.3 },
        { name: "labels", weight: 0.2 },
      ],
      threshold: 0.4,
      includeScore: true,
      ignoreLocation: true,
    });
  }, [packages]);

  // Search suggestions based on package names and labels
  const searchSuggestions = useMemo(() => {
    if (!searchQuery || searchQuery.length < 2) return [];
    
    const results = fuse.search(searchQuery).slice(0, 5);
    return results.map((r) => ({
      name: r.item.name,
      description: r.item.description,
      score: r.score || 0,
    }));
  }, [fuse, searchQuery]);

  // Filtered and sorted packages
  const filteredAndSortedPackages = useMemo(() => {
    let filtered: Package[];

    // Use fuzzy search if query exists
    if (searchQuery.trim()) {
      const results = fuse.search(searchQuery);
      filtered = results.map((r) => r.item);
    } else {
      filtered = [...packages];
    }

    // Apply filters
    filtered = filtered.filter((pkg) => {
      const matchesState = filterStates.includes(pkg.state);
      const matchesCategory = filterCategories.includes(
        (pkg.category?.toUpperCase() as "BLOATWARE" | "OPTIONAL" | "ESSENTIAL") ||
          "OPTIONAL",
      );
      const matchesRemoval = filterRemovals.includes(
        (pkg.removal as "RECOMMENDED" | "ADVANCED" | "EXPERT" | "UNSAFE") ||
          "ADVANCED",
      );
      const normalizedModelLabel = (pkg.modelLabel?.toUpperCase() as ModelLabelFilter) || null;
      const matchesDeepLinkModelLabel =
        !deepLinkModelLabels ||
        (normalizedModelLabel !== null && deepLinkModelLabels.includes(normalizedModelLabel));
      const modelConfidence = pkg.modelConfidence;

      let matchesModelConfidence = true;
      if (filterModelConfidence === "high") {
        matchesModelConfidence = typeof modelConfidence === "number" && modelConfidence >= 0.8;
      } else if (filterModelConfidence === "medium") {
        matchesModelConfidence = typeof modelConfidence === "number" && modelConfidence >= 0.6 && modelConfidence < 0.8;
      } else if (filterModelConfidence === "low") {
        matchesModelConfidence = typeof modelConfidence === "number" && modelConfidence < 0.6;
      } else if (filterModelConfidence === "unknown") {
        matchesModelConfidence = typeof modelConfidence !== "number";
      }

      const packageType = resolvePackageType(pkg);
      const matchesPackageType = packageTypeFilter.includes(packageType);

      return (
        matchesState &&
        matchesCategory &&
        matchesPackageType &&
        matchesRemoval &&
        matchesModelConfidence &&
        matchesDeepLinkModelLabel
      );
    });

    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case "name-asc":
          return a.name.localeCompare(b.name);
        case "name-desc":
          return b.name.localeCompare(a.name);
        case "state":
          const stateOrder = { enabled: 0, disabled: 1, uninstalled: 2 };
          return (stateOrder[a.state] || 0) - (stateOrder[b.state] || 0);
        case "category":
          const catOrder = { ESSENTIAL: 0, OPTIONAL: 1, BLOATWARE: 2, undefined: 3 };
          return (catOrder[a.category?.toUpperCase() as keyof typeof catOrder] ?? 3) -
                 (catOrder[b.category?.toUpperCase() as keyof typeof catOrder] ?? 3);
        case "removal":
          const removalOrder = { RECOMMENDED: 0, ADVANCED: 1, EXPERT: 2, UNSAFE: 3, undefined: 4 };
          return (removalOrder[a.removal as keyof typeof removalOrder] ?? 4) -
                 (removalOrder[b.removal as keyof typeof removalOrder] ?? 4);
        case "vendor":
          return getVendor(a.name).localeCompare(getVendor(b.name));
        case "confidence":
          return (b.modelConfidence ?? -1) - (a.modelConfidence ?? -1);
        default:
          return 0;
      }
    });

    return filtered;
  }, [packages, searchQuery, filterStates, filterCategories, packageTypeFilter, filterRemovals, deepLinkModelLabels, filterModelConfidence, sortBy, fuse]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredAndSortedPackages.length / itemsPerPage)),
    [filteredAndSortedPackages.length, itemsPerPage],
  );

  const paginatedPackages = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredAndSortedPackages.slice(start, start + itemsPerPage);
  }, [filteredAndSortedPackages, currentPage, itemsPerPage]);

  const visiblePageNumbers = useMemo(() => {
    const pages: number[] = [];
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, currentPage + 2);
    for (let page = start; page <= end; page++) {
      pages.push(page);
    }
    return pages;
  }, [currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filterStates, filterCategories, packageTypeFilter, filterRemovals, filterModelConfidence, sortBy, groupBy, itemsPerPage]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  // Grouped packages
  const groupedPackages = useMemo(() => {
    if (groupBy === "none") {
      return [{ group: "all", packages: paginatedPackages }];
    }

    const groups = new Map<string, Package[]>();

    paginatedPackages.forEach((pkg) => {
      let groupKey: string;
      switch (groupBy) {
        case "category":
          groupKey = pkg.category?.toUpperCase() || "Unknown";
          break;
        case "vendor":
          groupKey = getVendor(pkg.name);
          break;
        case "state":
          groupKey = pkg.state.charAt(0).toUpperCase() + pkg.state.slice(1);
          break;
        case "removal":
          groupKey = pkg.removal || "Unknown";
          break;
        default:
          groupKey = "all";
      }

      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(pkg);
    });

    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, pkgs]) => ({ group, packages: pkgs }));
  }, [paginatedPackages, groupBy]);

  // Flatten grouped packages for virtualization
  const flattenedItems = useMemo(() => {
    const items: Array<{ type: "header" | "package"; group?: string; package?: Package }> = [];
    
    groupedPackages.forEach(({ group, packages: pkgs }) => {
      if (groupBy !== "none") {
        items.push({ type: "header", group });
      }
      if (!collapsedGroups.has(group)) {
        pkgs.forEach((pkg) => items.push({ type: "package", package: pkg, group }));
      }
    });

    return items;
  }, [groupedPackages, groupBy, collapsedGroups]);

  // Virtualizer
  const rowVirtualizer = useVirtualizer({
    count: flattenedItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const item = flattenedItems[index];
      if (item.type === "header") return 48;
      if (viewMode === "compact") return 48;
      if (viewMode === "grid") return 120;
      return 72;
    },
    overscan: 10,
  });

  // Package counts
  const packageCounts = useMemo(() => {
    const systemCount = packages.filter((pkg) => resolvePackageType(pkg) === "system").length;
    const userCount = packages.length - systemCount;
    const enabledCount = packages.filter((pkg) => pkg.state === "enabled").length;
    const disabledCount = packages.filter((pkg) => pkg.state === "disabled").length;
    const uninstalledCount = packages.filter((pkg) => pkg.state === "uninstalled").length;
    const bloatwareCount = packages.filter((pkg) => pkg.category?.toUpperCase() === "BLOATWARE").length;
    const recommendedCount = packages.filter((pkg) => pkg.removal === "RECOMMENDED" && pkg.state === "enabled").length;

    return { system: systemCount, user: userCount, all: packages.length, enabled: enabledCount, disabled: disabledCount, uninstalled: uninstalledCount, bloatware: bloatwareCount, recommended: recommendedCount };
  }, [packages]);

  const selectedPackages = packages.filter((pkg) => pkg.selected);
  const selectedCount = selectedPackages.length;
  const hasEssentialPackages = selectedPackages.some((pkg) => pkg.category?.toUpperCase() === "ESSENTIAL");

  const getActionablePackageNames = (
    action:
      | "uninstall"
      | "restore"
      | "disable"
      | "enable"
      | "restrict-background"
      | "relax-background",
  ) => {
    return selectedPackages
      .filter((pkg) => {
        switch (action) {
          case "uninstall":
            return pkg.state !== "uninstalled";
          case "restore":
            return pkg.state === "uninstalled";
          case "disable":
            return pkg.state === "enabled";
          case "enable":
            return pkg.state === "disabled";
          case "restrict-background":
          case "relax-background":
            return pkg.state !== "uninstalled";
          default:
            return false;
        }
      })
      .map((pkg) => pkg.name);
  };

  const actionableCounts = {
    uninstall: getActionablePackageNames("uninstall").length,
    restore: getActionablePackageNames("restore").length,
    disable: getActionablePackageNames("disable").length,
    enable: getActionablePackageNames("enable").length,
    restrictBackground: getActionablePackageNames("restrict-background").length,
    relaxBackground: getActionablePackageNames("relax-background").length,
  };

  // Active filters count
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (filterStates.length !== DEFAULT_STATES.length) count++;
    if (filterCategories.length !== DEFAULT_CATEGORIES.length) count++;
    if (packageTypeFilter.length !== DEFAULT_PACKAGE_TYPES.length) count++;
    if (filterRemovals.length !== DEFAULT_REMOVALS.length) count++;
    if (deepLinkModelLabels && deepLinkModelLabels.length > 0) count++;
    if (filterModelConfidence !== "all") count++;
    if (searchQuery) count++;
    return count;
  }, [filterStates, filterCategories, packageTypeFilter, filterRemovals, deepLinkModelLabels, filterModelConfidence, searchQuery]);

  const toggleMultiFilter = <T extends string>(
    value: T,
    current: T[],
    setter: (next: T[]) => void,
  ) => {
    if (current.includes(value)) {
      setter(current.filter((item) => item !== value));
      return;
    }
    setter([...current, value]);
  };

  // Handlers
  const handleSearch = (query: string) => {
    setSearchQuery(query);
    setActivePreset("all");
  };

  const handleSearchSubmit = () => {
    if (searchQuery.trim() && !recentSearches.includes(searchQuery.trim())) {
      const newRecent = [searchQuery.trim(), ...recentSearches].slice(0, 5);
      setRecentSearches(newRecent);
      localStorage.setItem(scopedStorageKey("recentPackageSearches"), JSON.stringify(newRecent));
    }
    setShowSearchSuggestions(false);
  };

  const applyPreset = (preset: FilterPreset) => {
    setActivePreset(preset.id);
    setFilterStates(preset.filters.states || DEFAULT_STATES);
    setFilterCategories(preset.filters.categories || DEFAULT_CATEGORIES);
    setPackageTypeFilter(preset.filters.packageTypes || DEFAULT_PACKAGE_TYPES);
    setFilterRemovals(preset.filters.removals || DEFAULT_REMOVALS);
    setSearchQuery("");
  };

  const applyCustomPreset = (preset: CustomFilterPreset) => {
    setActivePreset(preset.id);
    setFilterStates(preset.filters.states || DEFAULT_STATES);
    setFilterCategories(preset.filters.categories || DEFAULT_CATEGORIES);
    setPackageTypeFilter(preset.filters.packageTypes || DEFAULT_PACKAGE_TYPES);
    setFilterRemovals(preset.filters.removals || DEFAULT_REMOVALS);
    setSearchQuery("");
  };

  const saveCurrentPreset = () => {
    const name = window.prompt("Preset name", "My Filter Preset")?.trim();
    if (!name) return;

    const preset: CustomFilterPreset = {
      id: `custom-${Date.now()}`,
      name,
      filters: {
        states: filterStates,
        categories: filterCategories,
        packageTypes: packageTypeFilter,
        removals: filterRemovals,
      },
    };

    setCustomPresets((current) => [preset, ...current].slice(0, 10));
  };

  const removeCustomPreset = (presetId: string) => {
    setCustomPresets((current) => current.filter((preset) => preset.id !== presetId));
    if (activePreset === presetId) {
      setActivePreset("all");
    }
  };

  const clearAllFilters = () => {
    setFilterStates(DEFAULT_STATES);
    setFilterCategories(DEFAULT_CATEGORIES);
    setPackageTypeFilter(DEFAULT_PACKAGE_TYPES);
    setFilterRemovals(DEFAULT_REMOVALS);
    setFilterModelConfidence("all");
    setSearchQuery("");
    setActivePreset("all");
  };

  const handleSelectFiltered = () => {
    filteredAndSortedPackages.forEach((pkg) => {
      if (!pkg.selected) {
        togglePackageSelection(pkg.name);
      }
    });
  };

  const toggleGroupCollapse = (group: string) => {
    const newCollapsed = new Set(collapsedGroups);
    if (newCollapsed.has(group)) {
      newCollapsed.delete(group);
    } else {
      newCollapsed.add(group);
    }
    setCollapsedGroups(newCollapsed);
  };

  const handleActionClick = (
    action:
      | "uninstall"
      | "restore"
      | "disable"
      | "enable"
      | "restrict-background"
      | "relax-background",
  ) => {
    const packageNames = getActionablePackageNames(action);
    if (packageNames.length === 0) {
      return;
    }
    const hasEssentialActionable = selectedPackages.some(
      (pkg) =>
        packageNames.includes(pkg.name) &&
        pkg.category?.toUpperCase() === "ESSENTIAL",
    );

    if ((action === "uninstall" || action === "disable") && hasEssentialActionable) {
      setPendingAction({ action, packages: packageNames });
      setShowWarningDialog(true);
      return;
    }
    onAction(action, packageNames);
  };

  const confirmWarningAction = () => {
    if (pendingAction) {
      onAction(pendingAction.action, pendingAction.packages);
    }
    setShowWarningDialog(false);
    setPendingAction(null);
  };

  const handleShowAlternatives = async (packageName: string) => {
    setSelectedPackageForAlternatives(packageName);
    const alternatives = await fetchAlternativesForPackage(packageName);
    setSelectedPackageAlternatives(alternatives);
    setShowAlternativesModal(true);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + F to focus search
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      // Ctrl/Cmd + A to select all (when not in input)
      if ((e.ctrlKey || e.metaKey) && e.key === "a" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        handleSelectFiltered();
      }
      // Escape to clear selection
      if (e.key === "Escape") {
        clearSelection();
        setShowSearchSuggestions(false);
      }
      // Number keys for presets
      if (e.key >= "1" && e.key <= "9" && !e.ctrlKey && !e.metaKey && document.activeElement?.tagName !== "INPUT") {
        const presetIndex = parseInt(e.key) - 1;
        if (FILTER_PRESETS[presetIndex]) {
          applyPreset(FILTER_PRESETS[presetIndex]);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clearSelection, filteredAndSortedPackages]);

  // Color helpers
  const getStateColor = (state: string) => {
    switch (state) {
      case "enabled": return "text-green-400";
      case "disabled": return "text-yellow-400";
      case "uninstalled": return "text-red-400";
      default: return "text-gray-400";
    }
  };

  const getStateBgColor = (state: string) => {
    switch (state) {
      case "enabled": return "bg-green-500/20 border-green-500/30";
      case "disabled": return "bg-yellow-500/20 border-yellow-500/30";
      case "uninstalled": return "bg-red-500/20 border-red-500/30";
      default: return "bg-gray-500/20 border-gray-500/30";
    }
  };

  const getCategoryColor = (category?: string) => {
    switch (category?.toUpperCase()) {
      case "BLOATWARE": return "bg-red-500/20 text-red-400 border-red-500/30";
      case "OPTIONAL": return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      case "ESSENTIAL": return "bg-green-500/20 text-green-400 border-green-500/30";
      default: return "bg-gray-500/20 text-gray-400 border-gray-500/30";
    }
  };

  const getRemovalColor = (removal?: string) => {
    switch (removal) {
      case "RECOMMENDED": return "text-green-400 bg-green-500/10";
      case "ADVANCED": return "text-yellow-400 bg-yellow-500/10";
      case "EXPERT": return "text-orange-400 bg-orange-500/10";
      case "UNSAFE": return "text-red-400 bg-red-500/10";
      default: return "text-gray-400";
    }
  };

  const getStateBorderClass = (state: string) => {
    switch (state) {
      case "enabled": return "border-l-4 border-l-green-500";
      case "disabled": return "border-l-4 border-l-yellow-500";
      case "uninstalled": return "border-l-4 border-l-red-500";
      default: return "";
    }
  };

  // Render package item based on view mode
  const renderPackageItem = (pkg: Package, style: React.CSSProperties) => {
    const isCompact = viewMode === "compact";
    const isGrid = viewMode === "grid";

    if (isGrid) {
      return (
        <div
          style={style}
          className={`p-3 m-1 rounded-xl cursor-pointer transition-all duration-200 border ${
            pkg.selected
              ? "bg-primary-600/30 border-primary-500/50 shadow-lg shadow-primary-500/20"
              : "bg-gray-700/50 border-gray-600/50 hover:bg-gray-700 hover:border-gray-500"
          }`}
          onClick={() => togglePackageSelection(pkg.name)}
        >
          <div className="flex items-start justify-between mb-2">
            <input
              type="checkbox"
              checked={pkg.selected || false}
              onChange={() => togglePackageSelection(pkg.name)}
              className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-primary-600"
              onClick={(e) => e.stopPropagation()}
            />
            <span className={`text-xs font-medium uppercase px-2 py-0.5 rounded ${getStateBgColor(pkg.state)}`}>
              {pkg.state}
            </span>
          </div>
          <p className="font-mono text-xs truncate mb-1" title={pkg.name}>{pkg.name}</p>
          {pkg.description && (
            <p className="text-xs text-gray-400 line-clamp-2">{pkg.description}</p>
          )}
          <div className="flex flex-wrap gap-1 mt-2">
            {pkg.category?.toUpperCase() === "BLOATWARE" && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800/80 text-gray-200 border border-gray-600/60">
                {formatBytes(pkg.sizeBytes)}
              </span>
            )}
            {pkg.category && (
              <span className={`text-xs px-1.5 py-0.5 rounded ${getCategoryColor(pkg.category)}`}>
                {pkg.category}
              </span>
            )}
            {pkg.removal && (
              <span className={`text-xs px-1.5 py-0.5 rounded ${getRemovalColor(pkg.removal)}`}>
                {pkg.removal}
              </span>
            )}
            {typeof pkg.modelConfidence === "number" && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-primary-600/20 text-primary-300 border border-primary-500/30">
                ML {Math.round(pkg.modelConfidence * 100)}%
              </span>
            )}
            {pkg.oemOverrideApplied && (
              <span
                className="text-xs px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 border border-orange-500/30"
                title={pkg.oemOverrideReason || "OEM-specific safety override applied"}
              >
                OEM Override
              </span>
            )}
          </div>
        </div>
      );
    }

    return (
      <div
        style={style}
        className={`flex items-center gap-3 ${isCompact ? "py-2 px-3" : "p-3"} mx-1 rounded-lg cursor-pointer transition-all duration-200 ${
          pkg.selected
            ? "bg-primary-600/20 border border-primary-500/30"
            : "bg-gray-700/30 hover:bg-gray-700/60 border border-transparent"
        } ${getStateBorderClass(pkg.state)}`}
        onClick={() => togglePackageSelection(pkg.name)}
      >
        <input
          type="checkbox"
          checked={pkg.selected || false}
          onChange={() => togglePackageSelection(pkg.name)}
          className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-primary-600 flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
        />
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className={`font-mono ${isCompact ? "text-xs" : "text-sm"} truncate`}>{pkg.name}</p>
            {pkg.category && (
              <span className={`text-xs px-2 py-0.5 rounded border ${getCategoryColor(pkg.category)} flex-shrink-0`}>
                {pkg.category}
              </span>
            )}
          </div>
          {!isCompact && pkg.description && (
            <p className="text-xs text-gray-400 mt-1 truncate">{pkg.description}</p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {onOpenPermissions && (
            <button
              onClick={(e) => { e.stopPropagation(); onOpenPermissions(pkg.name); }}
              className="p-1.5 text-gray-400 hover:text-primary-400 hover:bg-gray-600 rounded transition-colors"
              title="Manage permissions"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setSelectedPackageForDetails(pkg.name); setShowDetailsModal(true); }}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-600 rounded transition-colors"
            title="View details"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          {pkg.alternatives && pkg.alternatives.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); handleShowAlternatives(pkg.name); }}
              className="px-2 py-1 text-xs bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 rounded transition-colors"
              title="View alternatives"
            >
              Alt
            </button>
          )}
          {pkg.removal && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded ${getRemovalColor(pkg.removal)}`}>
              {pkg.removal}
            </span>
          )}
          {pkg.category?.toUpperCase() === "BLOATWARE" && (
            <span className="text-xs font-medium px-2 py-0.5 rounded bg-gray-800/80 text-gray-200 border border-gray-600/60">
              {formatBytes(pkg.sizeBytes)}
            </span>
          )}
          {typeof pkg.modelConfidence === "number" && (
            <span className="text-xs font-medium px-2 py-0.5 rounded bg-primary-600/20 text-primary-300 border border-primary-500/30">
              ML {Math.round(pkg.modelConfidence * 100)}%
            </span>
          )}
          {pkg.oemOverrideApplied && (
            <span
              className="text-xs font-medium px-2 py-0.5 rounded bg-orange-500/20 text-orange-300 border border-orange-500/30"
              title={pkg.oemOverrideReason || "OEM-specific safety override applied"}
            >
              OEM
            </span>
          )}
          <span className={`text-xs font-medium uppercase ${getStateColor(pkg.state)} ${isCompact ? "" : "w-20 text-right"}`}>
            {pkg.state}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 flex flex-col h-full overflow-hidden">
      {/* Header with Search and Presets */}
      <div className="p-4 border-b border-gray-700 space-y-4">
        {/* Search Bar */}
        <div className="relative">
          <div className="relative">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search packages... (Ctrl+F)"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              onFocus={() => setShowSearchSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSearchSuggestions(false), 200)}
              onKeyDown={(e) => e.key === "Enter" && handleSearchSubmit()}
              className="w-full bg-gray-700/50 border-2 border-gray-600 rounded-xl pl-12 pr-12 py-3 text-white placeholder-gray-400 text-base focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 transition-all"
            />
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(""); setActivePreset("all"); }}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-1 rounded-full hover:bg-gray-600 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Search Suggestions Dropdown */}
          {showSearchSuggestions && (searchSuggestions.length > 0 || recentSearches.length > 0) && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-gray-800 border border-gray-600 rounded-xl shadow-xl z-50 overflow-hidden">
              {recentSearches.length > 0 && !searchQuery && (
                <div className="p-2 border-b border-gray-700">
                  <p className="text-xs text-gray-500 px-2 mb-1">Recent Searches</p>
                  {recentSearches.map((search, i) => (
                    <button
                      key={i}
                      onClick={() => { handleSearch(search); setShowSearchSuggestions(false); }}
                      className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 rounded-lg flex items-center gap-2"
                    >
                      <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {search}
                    </button>
                  ))}
                </div>
              )}
              {searchSuggestions.length > 0 && (
                <div className="p-2">
                  <p className="text-xs text-gray-500 px-2 mb-1">Suggestions</p>
                  {searchSuggestions.map((suggestion, i) => (
                    <button
                      key={i}
                      onClick={() => { handleSearch(suggestion.name); handleSearchSubmit(); }}
                      className="w-full text-left px-3 py-2 hover:bg-gray-700 rounded-lg"
                    >
                      <p className="font-mono text-sm text-white truncate">{suggestion.name}</p>
                      {suggestion.description && (
                        <p className="text-xs text-gray-400 truncate">{suggestion.description}</p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Quick Filter Presets */}
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
          {FILTER_PRESETS.map((preset, index) => (
            <button
              key={preset.id}
              onClick={() => applyPreset(preset)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                activePreset === preset.id
                  ? "bg-primary-600 text-white shadow-lg shadow-primary-500/30"
                  : "bg-gray-700/50 text-gray-300 hover:bg-gray-700 hover:text-white"
              }`}
              title={`Press ${index + 1} to activate`}
            >
              <span>{preset.icon}</span>
              <span>{preset.name}</span>
              {preset.id === "bloatware" && <span className="bg-red-500/30 text-red-300 px-1.5 py-0.5 rounded text-xs">{packages.filter((pkg) => pkg.category?.toUpperCase() === "BLOATWARE" && resolvePackageType(pkg) === "system").length}</span>}
              {preset.id === "user-bloatware" && <span className="bg-cyan-500/30 text-cyan-200 px-1.5 py-0.5 rounded text-xs">{packages.filter((pkg) => pkg.category?.toUpperCase() === "BLOATWARE" && resolvePackageType(pkg) === "user").length}</span>}
              {preset.id === "safe-remove" && <span className="bg-green-500/30 text-green-300 px-1.5 py-0.5 rounded text-xs">{packageCounts.recommended}</span>}
              {preset.id === "removed-bloatware" && <span className="bg-amber-500/30 text-amber-200 px-1.5 py-0.5 rounded text-xs">{packages.filter((pkg) => pkg.category?.toUpperCase() === "BLOATWARE" && (pkg.state === "uninstalled" || pkg.state === "disabled")).length}</span>}
            </button>
          ))}
          {customPresets.map((preset) => (
            <div key={preset.id} className="flex items-center">
              <button
                onClick={() => applyCustomPreset(preset)}
                className={`flex items-center gap-2 px-4 py-2 rounded-l-xl text-sm font-medium whitespace-nowrap transition-all ${
                  activePreset === preset.id
                    ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/30"
                    : "bg-gray-700/50 text-gray-300 hover:bg-gray-700 hover:text-white"
                }`}
              >
                <span>⭐</span>
                <span>{preset.name}</span>
              </button>
              <button
                onClick={() => removeCustomPreset(preset.id)}
                className="px-2 py-2 rounded-r-xl bg-gray-700/50 hover:bg-red-600/60 text-gray-300 hover:text-white"
                title="Delete preset"
              >
                ×
              </button>
            </div>
          ))}
          <button
            onClick={saveCurrentPreset}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30"
          >
            <span>+</span>
            <span>Save Preset</span>
          </button>
        </div>

        {/* Active Filters & View Controls */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Active filter chips */}
            {activeFiltersCount > 0 && (
              <>
                {searchQuery && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-primary-500/20 text-primary-300 rounded-full text-sm">
                    Search: "{searchQuery}"
                    <button onClick={() => setSearchQuery("")} className="ml-1 hover:text-white">×</button>
                  </span>
                )}
                {filterStates.length !== DEFAULT_STATES.length && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-500/20 text-blue-300 rounded-full text-sm">
                    State: {filterStates.join(", ")}
                    <button onClick={() => setFilterStates(DEFAULT_STATES)} className="ml-1 hover:text-white">×</button>
                  </span>
                )}
                {filterCategories.length !== DEFAULT_CATEGORIES.length && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-purple-500/20 text-purple-300 rounded-full text-sm">
                    Category: {filterCategories.join(", ")}
                    <button onClick={() => setFilterCategories(DEFAULT_CATEGORIES)} className="ml-1 hover:text-white">×</button>
                  </span>
                )}
                {filterRemovals.length !== DEFAULT_REMOVALS.length && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-orange-500/20 text-orange-300 rounded-full text-sm">
                    Safety: {filterRemovals.join(", ")}
                    <button onClick={() => setFilterRemovals(DEFAULT_REMOVALS)} className="ml-1 hover:text-white">×</button>
                  </span>
                )}
                {deepLinkModelLabels && deepLinkModelLabels.length > 0 && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-indigo-500/20 text-indigo-300 rounded-full text-sm">
                    AI Label: {deepLinkModelLabels.join(", ")}
                    <button onClick={() => setDeepLinkModelLabels(null)} className="ml-1 hover:text-white">×</button>
                  </span>
                )}
                {filterModelConfidence !== "all" && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-primary-500/20 text-primary-300 rounded-full text-sm">
                    Model: {filterModelConfidence}
                    <button onClick={() => setFilterModelConfidence("all")} className="ml-1 hover:text-white">×</button>
                  </span>
                )}
                {packageTypeFilter.length !== DEFAULT_PACKAGE_TYPES.length && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-cyan-500/20 text-cyan-300 rounded-full text-sm">
                    Type: {packageTypeFilter.join(", ")}
                    <button onClick={() => setPackageTypeFilter(DEFAULT_PACKAGE_TYPES)} className="ml-1 hover:text-white">×</button>
                  </span>
                )}
                <button
                  onClick={clearAllFilters}
                  className="text-xs text-gray-400 hover:text-white underline"
                >
                  Clear all
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Advanced Filters Toggle */}
            <button
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className={`p-2 rounded-lg transition-colors ${showAdvancedFilters ? "bg-primary-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
              title="Advanced filters"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
            </button>

            {/* View Mode Toggle */}
            <div className="flex bg-gray-700 rounded-lg p-1">
              <button
                onClick={() => setViewMode("list")}
                className={`p-2 rounded ${viewMode === "list" ? "bg-gray-600 text-white" : "text-gray-400 hover:text-white"}`}
                title="List view"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <button
                onClick={() => setViewMode("compact")}
                className={`p-2 rounded ${viewMode === "compact" ? "bg-gray-600 text-white" : "text-gray-400 hover:text-white"}`}
                title="Compact view"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
              </button>
              <button
                onClick={() => setViewMode("grid")}
                className={`p-2 rounded ${viewMode === "grid" ? "bg-gray-600 text-white" : "text-gray-400 hover:text-white"}`}
                title="Grid view"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Advanced Filters Panel */}
        {showAdvancedFilters && (
          <div className="grid grid-cols-4 gap-3 p-4 bg-gray-700/30 rounded-xl border border-gray-600/50">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">State (multi-select)</label>
              <div className="space-y-1">
                {DEFAULT_STATES.map((state) => (
                  <label key={state} className="flex items-center gap-2 text-sm text-gray-300">
                    <input
                      type="checkbox"
                      checked={filterStates.includes(state)}
                      onChange={() => {
                        toggleMultiFilter(state, filterStates, setFilterStates);
                        setActivePreset("all");
                      }}
                    />
                    <span className="capitalize">{state}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Category (multi-select)</label>
              <div className="space-y-1">
                {DEFAULT_CATEGORIES.map((category) => (
                  <label key={category} className="flex items-center gap-2 text-sm text-gray-300">
                    <input
                      type="checkbox"
                      checked={filterCategories.includes(category)}
                      onChange={() => {
                        toggleMultiFilter(category, filterCategories, setFilterCategories);
                        setActivePreset("all");
                      }}
                    />
                    <span>{category}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Package Type (multi-select)</label>
              <div className="space-y-1">
                {DEFAULT_PACKAGE_TYPES.map((type) => (
                  <label key={type} className="flex items-center gap-2 text-sm text-gray-300">
                    <input
                      type="checkbox"
                      checked={packageTypeFilter.includes(type)}
                      onChange={() => {
                        toggleMultiFilter(type, packageTypeFilter, setPackageTypeFilter);
                        setActivePreset("all");
                      }}
                    />
                    <span>{type === "system" ? "System apps" : "User apps"}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Removal Safety (multi-select)</label>
              <div className="space-y-1">
                {DEFAULT_REMOVALS.map((removal) => (
                  <label key={removal} className="flex items-center gap-2 text-sm text-gray-300">
                    <input
                      type="checkbox"
                      checked={filterRemovals.includes(removal)}
                      onChange={() => {
                        toggleMultiFilter(removal, filterRemovals, setFilterRemovals);
                        setActivePreset("all");
                      }}
                    />
                    <span>
                      {removal}
                      {removal === "ADVANCED" ? " (review needed)" : ""}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Sort By</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value="name-asc">Name A-Z</option>
                <option value="name-desc">Name Z-A</option>
                <option value="state">By State</option>
                <option value="category">By Category</option>
                <option value="removal">By Removal Type</option>
                <option value="vendor">By Vendor</option>
                <option value="confidence">By ML Confidence</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Model Confidence</label>
              <select
                value={filterModelConfidence}
                onChange={(e) => setFilterModelConfidence(e.target.value as typeof filterModelConfidence)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value="all">All</option>
                <option value="high">High (≥ 80%)</option>
                <option value="medium">Medium (60-79%)</option>
                <option value="low">Low (&lt; 60%)</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Group By</label>
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value="none">No Grouping</option>
                <option value="category">Category</option>
                <option value="vendor">Vendor</option>
                <option value="state">State</option>
                <option value="removal">Removal Type</option>
              </select>
            </div>
            <div className="col-span-4 text-xs text-gray-400 bg-gray-800/50 border border-gray-600/50 rounded-lg p-2">
              <strong className="text-white">Removal levels:</strong> RECOMMENDED = usually safe, ADVANCED = needs review, EXPERT = risky/feature break possible, UNSAFE = do not remove.
            </div>
          </div>
        )}

        {/* Selection Actions Bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={handleSelectFiltered}
              className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
            >
              Select Filtered
            </button>
            <button
              onClick={() => selectAllByCategory("BLOATWARE")}
              className="px-3 py-1.5 text-sm bg-red-600/30 hover:bg-red-600/50 text-red-300 rounded-lg transition-colors"
            >
              Select Bloatware
            </button>
            <button
              onClick={() => clearSelection()}
              className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
            >
              Clear
            </button>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-gray-400">
              <span className="text-white font-medium">{selectedCount}</span> selected
            </span>
            <span className="text-gray-600">|</span>
            <span className="text-gray-400">
              <span className="text-white font-medium">{filteredAndSortedPackages.length}</span> / {packages.length} packages
            </span>
            <span className="text-gray-600">|</span>
            <span className="text-gray-400">
              Page <span className="text-white font-medium">{currentPage}</span> of {totalPages}
            </span>
          </div>
        </div>

        {filteredAndSortedPackages.length > 0 && (
          <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-700/60">
            <div className="text-sm text-gray-400">
              Showing <span className="text-white font-medium">{(currentPage - 1) * itemsPerPage + 1}</span>
              -
              <span className="text-white font-medium">{Math.min(currentPage * itemsPerPage, filteredAndSortedPackages.length)}</span> of {filteredAndSortedPackages.length}
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400" htmlFor="items-per-page">Per page</label>
              <select
                id="items-per-page"
                value={itemsPerPage}
                onChange={(e) => setItemsPerPage(parseInt(e.target.value, 10))}
                className="bg-gray-700 border border-gray-600 rounded-lg px-2 py-1 text-sm text-white"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>

              <button
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                Prev
              </button>

              {visiblePageNumbers[0] && visiblePageNumbers[0] > 1 && (
                <>
                  <button
                    onClick={() => setCurrentPage(1)}
                    className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
                  >
                    1
                  </button>
                  {visiblePageNumbers[0] > 2 && <span className="text-gray-500 px-1">...</span>}
                </>
              )}

              {visiblePageNumbers.map((page) => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    currentPage === page
                      ? "bg-primary-600 text-white"
                      : "bg-gray-700 hover:bg-gray-600 text-gray-200"
                  }`}
                >
                  {page}
                </button>
              ))}

              {visiblePageNumbers[visiblePageNumbers.length - 1] && visiblePageNumbers[visiblePageNumbers.length - 1] < totalPages && (
                <>
                  {visiblePageNumbers[visiblePageNumbers.length - 1] < totalPages - 1 && <span className="text-gray-500 px-1">...</span>}
                  <button
                    onClick={() => setCurrentPage(totalPages)}
                    className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
                  >
                    {totalPages}
                  </button>
                </>
              )}

              <button
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Package List (Virtualized) */}
      <div ref={parentRef} className="flex-1 overflow-auto p-2">
        {flattenedItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <svg className="w-16 h-16 mb-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <p className="text-lg font-medium">No packages found</p>
            <p className="text-sm text-gray-500 mt-1">Try adjusting your search or filters</p>
            {activeFiltersCount > 0 && (
              <button
                onClick={clearAllFilters}
                className="mt-4 px-4 py-2 bg-primary-600 hover:bg-primary-500 rounded-lg text-white text-sm transition-colors"
              >
                Clear all filters
              </button>
            )}
          </div>
        ) : viewMode === "grid" ? (
          // Grid view - not virtualized for simplicity
          <div className="grid grid-cols-3 gap-2">
            {paginatedPackages.map((pkg) => (
              <div key={pkg.name}>
                {renderPackageItem(pkg, {})}
              </div>
            ))}
          </div>
        ) : (
          // List/Compact view - virtualized
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const item = flattenedItems[virtualRow.index];
              
              if (item.type === "header") {
                const groupPackages = groupedPackages.find(g => g.group === item.group)?.packages || [];
                const isCollapsed = collapsedGroups.has(item.group!);
                
                return (
                  <div
                    key={`header-${item.group}`}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <button
                      onClick={() => toggleGroupCollapse(item.group!)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-gray-700/50 hover:bg-gray-700 rounded-lg border border-gray-600/30 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <svg
                          className={`w-4 h-4 text-gray-400 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <span className="font-medium text-white">{item.group}</span>
                        <span className="text-sm text-gray-400">({groupPackages.length} packages)</span>
                      </div>
                      {!isCollapsed && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            groupPackages.forEach(pkg => {
                              if (!pkg.selected) togglePackageSelection(pkg.name);
                            });
                          }}
                          className="text-xs px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded text-gray-300"
                        >
                          Select group
                        </button>
                      )}
                    </button>
                  </div>
                );
              }

              return (
                <div
                  key={item.package!.name}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                    padding: "2px 0",
                  }}
                >
                  {renderPackageItem(item.package!, { height: "100%" })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom Action Bar */}
      {selectedCount > 0 && (
        <div className="p-4 border-t border-gray-700 bg-gray-800/80 backdrop-blur">
          {hasEssentialPackages && (
            <div className="mb-3 p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-300 text-sm flex items-center gap-2">
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>Warning: Some selected packages are marked as <strong>ESSENTIAL</strong>. Removing them may break your device.</span>
            </div>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleActionClick("uninstall")}
              disabled={isLoading || actionableCounts.uninstall === 0}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors font-medium"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Uninstall
            </button>
            <button
              onClick={() => handleActionClick("restore")}
              disabled={isLoading || actionableCounts.restore === 0}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors font-medium"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Restore
            </button>
            <button
              onClick={() => handleActionClick("disable")}
              disabled={isLoading || actionableCounts.disable === 0}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors font-medium"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Disable
            </button>
            <button
              onClick={() => handleActionClick("enable")}
              disabled={isLoading || actionableCounts.enable === 0}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors font-medium"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Enable
            </button>
            <button
              onClick={() => handleActionClick("restrict-background")}
              disabled={isLoading || actionableCounts.restrictBackground === 0}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors font-medium"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c1.657 0 3-1.567 3-3.5S13.657 4 12 4s-3 1.567-3 3.5 1.343 3.5 3 3.5z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 20v-1a7 7 0 0114 0v1" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4l16 16" />
              </svg>
              Restrict BG
            </button>
            <button
              onClick={() => handleActionClick("relax-background")}
              disabled={isLoading || actionableCounts.relaxBackground === 0}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors font-medium"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c1.657 0 3-1.567 3-3.5S13.657 4 12 4s-3 1.567-3 3.5 1.343 3.5 3 3.5z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 20v-1a7 7 0 0114 0v1" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l2 2 3-3" />
              </svg>
              Relax BG
            </button>
          </div>
        </div>
      )}

      {/* Warning Dialog */}
      {showWarningDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 max-w-md mx-4 shadow-2xl">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-14 h-14 bg-red-500/20 rounded-full flex items-center justify-center">
                <svg className="w-7 h-7 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-xl font-bold text-red-400">Warning: Essential Packages</h3>
                <p className="text-sm text-gray-400">This action may break your device</p>
              </div>
            </div>
            <p className="text-gray-300 mb-6">
              You are about to <strong>{pendingAction?.action}</strong> essential system packages. This may cause your device to malfunction, lose functionality, or become unusable. Are you absolutely sure you want to continue?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { setShowWarningDialog(false); setPendingAction(null); }}
                className="flex-1 px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={confirmWarningAction}
                className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-500 rounded-xl transition-colors font-medium"
              >
                I understand, proceed
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alternatives Modal */}
      {showAlternativesModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 max-w-lg mx-4 max-h-[80vh] overflow-auto shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold">Alternative Apps</h3>
              <button
                onClick={() => { setShowAlternativesModal(false); setSelectedPackageForAlternatives(null); }}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="text-sm text-gray-400 mb-4">
              Open-source alternatives for <span className="font-mono text-white bg-gray-700 px-2 py-1 rounded">{selectedPackageForAlternatives}</span>
            </p>
            {selectedPackageAlternatives.length === 0 ? (
              <p className="text-gray-400 text-center py-8">No alternatives found for this package.</p>
            ) : (
              <div className="space-y-3">
                {selectedPackageAlternatives.map((alt) => (
                  <div key={alt.id} className="bg-gray-700/50 border border-gray-600 rounded-xl p-4 hover:border-gray-500 transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold text-white">{alt.name}</h4>
                      <span className="text-xs bg-blue-600/30 text-blue-300 px-2 py-1 rounded-full">{alt.source}</span>
                    </div>
                    <p className="text-sm text-gray-400 mb-3">{alt.description}</p>
                    <div className="flex gap-2">
                      <a
                        href={alt.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm px-4 py-2 bg-green-600/30 hover:bg-green-600/50 text-green-300 rounded-lg transition-colors"
                      >
                        Get from {alt.source}
                      </a>
                      <a
                        href={alt.githubUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm px-4 py-2 bg-gray-600/50 hover:bg-gray-600/70 text-gray-300 rounded-lg transition-colors"
                      >
                        Source Code
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Package Details Modal */}
      {selectedDevice && (
        <PackageDetailsModal
          isOpen={showDetailsModal}
          onClose={() => { setShowDetailsModal(false); setSelectedPackageForDetails(null); }}
          packageName={selectedPackageForDetails || ""}
          deviceId={selectedDevice.adb_id}
        />
      )}
    </div>
  );
}
