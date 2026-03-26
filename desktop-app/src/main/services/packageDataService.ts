/**
 * Package Data Service - Local package metadata management
 * Loads debloat lists and provides package enrichment
 */
import * as fs from "fs";
import * as path from "path";
import { app } from "electron";

export interface DebloatPackage {
  id: string;
  list: string;
  description: string;
  removal: "RECOMMENDED" | "ADVANCED" | "EXPERT" | "UNSAFE";
  category: "BLOATWARE" | "OPTIONAL" | "ESSENTIAL";
  dependencies: string[];
  neededBy: string[];
  labels: string[];
  alternatives: string[];
  modelLabel?: "RECOMMENDED" | "ADVANCED" | "EXPERT" | "UNSAFE";
  modelConfidence?: number;
  modelVersion?: string;
  modelTopFactors?: string[];
  oemOverrideApplied?: boolean;
  oemOverrideReason?: string;
}

interface ModelPredictionEntry {
  label: DebloatPackage["removal"];
  confidence: number;
  top_factors?: string[];
}

interface ModelPredictionsFile {
  modelVersion?: string;
  predictions: Record<string, ModelPredictionEntry>;
}

interface OemOverrideEntry {
  packageId: string;
  oem?: string;
  removal?: DebloatPackage["removal"];
  category?: DebloatPackage["category"];
  reason?: string;
}

interface OemOverridesFile {
  overrides: OemOverrideEntry[];
}

export interface AlternativeApp {
  id: string;
  name: string;
  description: string;
  packageId: string;
  source: string;
  sourceUrl: string;
  githubUrl: string;
  icon: string;
}

export interface DebloatList {
  id: string;
  name: string;
  description: string;
}

export interface RemovalType {
  id: string;
  name: string;
  description: string;
  color: string;
}

export interface Category {
  id: string;
  name: string;
  description: string;
  color: string;
}

export interface DebloatData {
  packages: DebloatPackage[];
  alternatives: AlternativeApp[];
  lists: DebloatList[];
  removalTypes: RemovalType[];
  categories: Category[];
}

let cachedData: DebloatData | null = null;

const REMOVAL_ALIASES: Record<string, DebloatPackage["removal"]> = {
  RECOMMENDED: "RECOMMENDED",
  ADVANCED: "ADVANCED",
  EXPERT: "EXPERT",
  UNSAFE: "UNSAFE",
  SAFE: "RECOMMENDED",
  DANGEROUS: "UNSAFE",
};

const CATEGORY_ALIASES: Record<string, DebloatPackage["category"]> = {
  BLOATWARE: "BLOATWARE",
  OPTIONAL: "OPTIONAL",
  ESSENTIAL: "ESSENTIAL",
  CORE: "ESSENTIAL",
};

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return [...new Set(value.map(toStringValue).filter(Boolean))];
}

function normalizeRemoval(value: unknown): DebloatPackage["removal"] {
  const normalized = toStringValue(value).toUpperCase();
  return REMOVAL_ALIASES[normalized] ?? "ADVANCED";
}

function normalizeCategory(value: unknown): DebloatPackage["category"] {
  const normalized = toStringValue(value).toUpperCase();
  return CATEGORY_ALIASES[normalized] ?? "OPTIONAL";
}

function normalizeList(value: unknown): string {
  const normalized = toStringValue(value).toUpperCase();
  return normalized || "UNKNOWN";
}

function inferOemFromPackageId(packageId: string): string | null {
  const value = packageId.toLowerCase();

  if (
    value.startsWith("com.samsung.") ||
    value.startsWith("com.sec.") ||
    value.startsWith("com.osp.")
  ) {
    return "SAMSUNG";
  }

  if (
    value.startsWith("com.xiaomi.") ||
    value.startsWith("com.miui.") ||
    value.startsWith("com.mi.") ||
    value.startsWith("com.redmi.")
  ) {
    return "XIAOMI";
  }

  if (
    value.startsWith("com.oneplus.") ||
    value.startsWith("net.oneplus.") ||
    value.startsWith("cn.oneplus.")
  ) {
    return "ONEPLUS";
  }

  if (
    value.startsWith("com.huawei.") ||
    value.startsWith("com.hicloud.") ||
    value.startsWith("com.hisi.")
  ) {
    return "HUAWEI";
  }

  if (
    value.startsWith("com.oppo.") ||
    value.startsWith("com.coloros.") ||
    value.startsWith("com.heytap.")
  ) {
    return "OPPO";
  }

  if (
    value.startsWith("com.vivo.") ||
    value.startsWith("com.bbk.") ||
    value.startsWith("com.iqoo.")
  ) {
    return "VIVO";
  }

  return null;
}

function normalizePackage(rawPkg: unknown): DebloatPackage | null {
  if (!rawPkg || typeof rawPkg !== "object") return null;

  const pkg = rawPkg as Record<string, unknown>;
  const id = toStringValue(pkg.id);
  if (!id) return null;

  return {
    id,
    list: normalizeList(pkg.list),
    description: toStringValue(pkg.description),
    removal: normalizeRemoval(pkg.removal),
    category: normalizeCategory(pkg.category),
    dependencies: toStringArray(pkg.dependencies),
    neededBy: toStringArray(pkg.neededBy),
    labels: toStringArray(pkg.labels),
    alternatives: toStringArray(pkg.alternatives),
    modelLabel: pkg.modelLabel ? normalizeRemoval(pkg.modelLabel) : undefined,
    modelConfidence:
      typeof pkg.modelConfidence === "number" ? pkg.modelConfidence : undefined,
    modelVersion: toStringValue(pkg.modelVersion) || undefined,
    modelTopFactors: toStringArray(pkg.modelTopFactors),
    oemOverrideApplied: Boolean(pkg.oemOverrideApplied),
    oemOverrideReason: toStringValue(pkg.oemOverrideReason) || undefined,
  };
}

function getOverridesPath(): string | null {
  const possiblePaths = [
    path.join(__dirname, "../../../src/data/oem_overrides.json"),
    path.join(__dirname, "../../data/oem_overrides.json"),
    path.join(process.resourcesPath || "", "data", "oem_overrides.json"),
    path.join(app.getAppPath(), "data", "oem_overrides.json"),
    path.join(app.getAppPath(), "src", "data", "oem_overrides.json"),
  ];

  for (const currentPath of possiblePaths) {
    if (fs.existsSync(currentPath)) {
      return currentPath;
    }
  }

  return null;
}

function loadOemOverrides(): OemOverrideEntry[] {
  const overridePath = getOverridesPath();
  if (!overridePath) return [];

  try {
    const content = fs.readFileSync(overridePath, "utf-8");
    const payload = JSON.parse(content) as Partial<OemOverridesFile>;
    if (!payload || !Array.isArray(payload.overrides)) return [];

    return payload.overrides
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const raw = item as unknown as Record<string, unknown>;
        const packageId = toStringValue(raw.packageId);
        if (!packageId) return null;

        return {
          packageId,
          oem: toStringValue(raw.oem).toUpperCase() || undefined,
          removal: raw.removal ? normalizeRemoval(raw.removal) : undefined,
          category: raw.category ? normalizeCategory(raw.category) : undefined,
          reason: toStringValue(raw.reason) || undefined,
        } as OemOverrideEntry;
      })
      .filter((item): item is OemOverrideEntry => item !== null);
  } catch (error) {
    console.warn("[PackageData] Failed to load OEM overrides:", error);
    return [];
  }
}

function applyOemOverrides(data: DebloatData): DebloatData {
  const overrides = loadOemOverrides();
  if (!overrides.length) return data;

  const overrideMap = new Map<string, OemOverrideEntry[]>();
  for (const entry of overrides) {
    const existing = overrideMap.get(entry.packageId) ?? [];
    existing.push(entry);
    overrideMap.set(entry.packageId, existing);
  }

  const packages = data.packages.map((pkg) => {
    const candidates = overrideMap.get(pkg.id);
    if (!candidates || candidates.length === 0) return pkg;

    const matching = candidates.find((entry) => {
      if (!entry.oem) return true;
      const inferredOem = inferOemFromPackageId(pkg.id);
      return entry.oem === pkg.list.toUpperCase() || entry.oem === inferredOem;
    });
    if (!matching) return pkg;

    return {
      ...pkg,
      removal: matching.removal ?? pkg.removal,
      category: matching.category ?? pkg.category,
      oemOverrideApplied: true,
      oemOverrideReason: matching.reason ?? pkg.oemOverrideReason,
    };
  });

  return {
    ...data,
    packages,
  };
}

function getPredictionsPath(): string | null {
  const possiblePaths = [
    path.join(__dirname, "../../../src/data/safety_predictions.json"),
    path.join(__dirname, "../../data/safety_predictions.json"),
    path.join(process.resourcesPath || "", "data", "safety_predictions.json"),
    path.join(app.getAppPath(), "data", "safety_predictions.json"),
    path.join(app.getAppPath(), "src", "data", "safety_predictions.json"),
    path.resolve(__dirname, "../../../../model-api/models/safety_predictions.json"),
  ];

  for (const currentPath of possiblePaths) {
    if (fs.existsSync(currentPath)) {
      return currentPath;
    }
  }

  return null;
}

function loadModelPredictions(): ModelPredictionsFile | null {
  const predictionsPath = getPredictionsPath();
  if (!predictionsPath) return null;

  try {
    const content = fs.readFileSync(predictionsPath, "utf-8");
    const payload = JSON.parse(content) as Partial<ModelPredictionsFile>;

    if (!payload || typeof payload !== "object" || !payload.predictions) {
      return null;
    }

    const normalizedPredictions: Record<string, ModelPredictionEntry> = {};

    for (const [packageId, prediction] of Object.entries(payload.predictions)) {
      if (!prediction || typeof prediction !== "object") continue;

      const label = normalizeRemoval((prediction as unknown as Record<string, unknown>).label);
      const confidenceRaw = (prediction as unknown as Record<string, unknown>).confidence;
      const topFactorsRaw = (prediction as unknown as Record<string, unknown>).top_factors;
      const confidence =
        typeof confidenceRaw === "number"
          ? Math.max(0, Math.min(1, confidenceRaw))
          : 0;

      normalizedPredictions[packageId] = {
        label,
        confidence,
        top_factors: toStringArray(topFactorsRaw),
      };
    }

    console.log(
      `[PackageData] Loaded model predictions for ${Object.keys(normalizedPredictions).length} packages from ${predictionsPath}`,
    );

    return {
      modelVersion: toStringValue(payload.modelVersion) || "safety-model",
      predictions: normalizedPredictions,
    };
  } catch (error) {
    console.warn("[PackageData] Failed to load model predictions:", error);
    return null;
  }
}

function applyModelPredictions(data: DebloatData): DebloatData {
  const predictionFile = loadModelPredictions();
  if (!predictionFile) return data;

  const packages = data.packages.map((pkg) => {
    const prediction = predictionFile.predictions[pkg.id];
    if (!prediction) return pkg;

    return {
      ...pkg,
      modelLabel: prediction.label,
      modelConfidence: prediction.confidence,
      modelVersion: predictionFile.modelVersion,
      modelTopFactors: toStringArray(prediction.top_factors),
    };
  });

  return {
    ...data,
    packages,
  };
}

function fallbackConfidenceFromRemoval(
  removal: DebloatPackage["removal"],
): number {
  switch (removal) {
    case "RECOMMENDED":
      return 0.78;
    case "ADVANCED":
      return 0.66;
    case "EXPERT":
      return 0.64;
    case "UNSAFE":
      return 0.86;
    default:
      return 0.6;
  }
}

function inferHeuristicModelForUnknown(packageName: string): {
  label: DebloatPackage["removal"];
  confidence: number;
  topFactors: string[];
} {
  const name = packageName.toLowerCase();

  const criticalSignals = [
    "securitycenter",
    "finddevice",
    "packageinstaller",
    "updater",
    "managedprovisioning",
    "knox",
    "lbe.security",
  ];

  if (criticalSignals.some((signal) => name.includes(signal))) {
    return {
      label: "UNSAFE",
      confidence: 0.9,
      topFactors: [
        "critical system/security package pattern",
        "high bootloop or lockout risk if removed",
      ],
    };
  }

  const bloatSignals = [
    "analytics",
    "msa",
    "ads",
    "facebook",
    "netflix",
    "booking",
    "linkedin",
    "appmanager",
    "mipicks",
  ];

  if (bloatSignals.some((signal) => name.includes(signal))) {
    return {
      label: "RECOMMENDED",
      confidence: 0.74,
      topFactors: [
        "common ad/analytics or preloaded bloat pattern",
        "usually safe to remove for most users",
      ],
    };
  }

  if (name.startsWith("com.android.")) {
    return {
      label: "EXPERT",
      confidence: 0.62,
      topFactors: [
        "android core namespace detected",
        "manual review advised before removal",
      ],
    };
  }

  if (
    name.startsWith("com.miui.") ||
    name.startsWith("com.xiaomi.") ||
    name.startsWith("com.samsung.") ||
    name.startsWith("com.sec.") ||
    name.startsWith("com.huawei.") ||
    name.startsWith("com.oppo.") ||
    name.startsWith("com.vivo.")
  ) {
    return {
      label: "ADVANCED",
      confidence: 0.59,
      topFactors: [
        "OEM system package pattern",
        "feature impact unknown without device-specific testing",
      ],
    };
  }

  return {
    label: "ADVANCED",
    confidence: 0.52,
    topFactors: [
      "limited metadata available",
      "default conservative score for unknown package",
    ],
  };
}

function resolveModelSignals(
  packageName: string,
  info: DebloatPackage | undefined,
): {
  modelLabel: DebloatPackage["removal"];
  modelConfidence: number;
  modelVersion: string;
  modelTopFactors: string[];
} {
  if (info && info.modelLabel && typeof info.modelConfidence === "number") {
    return {
      modelLabel: info.modelLabel,
      modelConfidence: info.modelConfidence,
      modelVersion: info.modelVersion || "safety-model",
      modelTopFactors: toStringArray(info.modelTopFactors),
    };
  }

  if (info) {
    return {
      modelLabel: info.removal,
      modelConfidence: fallbackConfidenceFromRemoval(info.removal),
      modelVersion: "fallback-rule-v1",
      modelTopFactors: [
        "no direct model prediction for this package",
        "fallback from curated removal category",
      ],
    };
  }

  const heuristic = inferHeuristicModelForUnknown(packageName);
  return {
    modelLabel: heuristic.label,
    modelConfidence: heuristic.confidence,
    modelVersion: "fallback-heuristic-v1",
    modelTopFactors: heuristic.topFactors,
  };
}

function normalizeAlternative(rawAlt: unknown): AlternativeApp | null {
  if (!rawAlt || typeof rawAlt !== "object") return null;

  const alt = rawAlt as Record<string, unknown>;
  const id = toStringValue(alt.id);
  if (!id) return null;

  return {
    id,
    name: toStringValue(alt.name),
    description: toStringValue(alt.description),
    packageId: toStringValue(alt.packageId),
    source: toStringValue(alt.source),
    sourceUrl: toStringValue(alt.sourceUrl),
    githubUrl: toStringValue(alt.githubUrl),
    icon: toStringValue(alt.icon),
  };
}

function normalizeDebloatData(rawData: unknown): DebloatData {
  const fallback: DebloatData = {
    packages: [],
    alternatives: [],
    lists: [],
    removalTypes: [],
    categories: [],
  };

  if (!rawData || typeof rawData !== "object") {
    return fallback;
  }

  const data = rawData as Record<string, unknown>;

  const normalizedPackages = Array.isArray(data.packages)
    ? data.packages.map(normalizePackage).filter((p): p is DebloatPackage => p !== null)
    : [];

  const normalizedAlternatives = Array.isArray(data.alternatives)
    ? data.alternatives
        .map(normalizeAlternative)
        .filter((a): a is AlternativeApp => a !== null)
    : [];

  const normalizedLists = Array.isArray(data.lists)
    ? data.lists
        .filter((list): list is DebloatList => {
          if (!list || typeof list !== "object") return false;
          const item = list as unknown as Record<string, unknown>;
          return Boolean(toStringValue(item.id));
        })
        .map((list) => {
          const item = list as unknown as Record<string, unknown>;
          return {
            id: normalizeList(item.id),
            name: toStringValue(item.name),
            description: toStringValue(item.description),
          };
        })
    : [];

  const normalizedRemovalTypes = Array.isArray(data.removalTypes)
    ? data.removalTypes
        .filter((removal): removal is RemovalType => {
          if (!removal || typeof removal !== "object") return false;
          const item = removal as unknown as Record<string, unknown>;
          return Boolean(toStringValue(item.id));
        })
        .map((removal) => {
          const item = removal as unknown as Record<string, unknown>;
          return {
            id: normalizeRemoval(item.id),
            name: toStringValue(item.name),
            description: toStringValue(item.description),
            color: toStringValue(item.color),
          };
        })
    : [];

  const normalizedCategories = Array.isArray(data.categories)
    ? data.categories
        .filter((category): category is Category => {
          if (!category || typeof category !== "object") return false;
          const item = category as unknown as Record<string, unknown>;
          return Boolean(toStringValue(item.id));
        })
        .map((category) => {
          const item = category as unknown as Record<string, unknown>;
          return {
            id: normalizeCategory(item.id),
            name: toStringValue(item.name),
            description: toStringValue(item.description),
            color: toStringValue(item.color),
          };
        })
    : [];

  return {
    packages: normalizedPackages,
    alternatives: normalizedAlternatives,
    lists: normalizedLists,
    removalTypes: normalizedRemovalTypes,
    categories: normalizedCategories,
  };
}

/**
 * Get the path to the debloat lists JSON file
 */
function getDataPath(): string {
  // Try multiple possible locations for the data file
  const possiblePaths = [
    // Development: relative to project root from dist/main/services
    path.join(__dirname, "../../../src/data/debloat_lists.json"),
    // Development alternative: from dist folder
    path.join(__dirname, "../../data/debloat_lists.json"),
    // Production: extraResources folder
    path.join(process.resourcesPath || "", "data", "debloat_lists.json"),
    // Production alternative: app path
    path.join(app.getAppPath(), "data", "debloat_lists.json"),
    // Fallback: relative to app path src folder
    path.join(app.getAppPath(), "src", "data", "debloat_lists.json"),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      console.log("[PackageData] Found data file at:", p);
      return p;
    }
  }

  // Default fallback (will likely fail but provides clear error)
  console.log("[PackageData] Could not find data file, tried:", possiblePaths);
  return possiblePaths[0];
}

/**
 * Load debloat data from JSON file
 */
export function loadDebloatData(): DebloatData {
  if (cachedData) return cachedData;

  try {
    const dataPath = getDataPath();
    console.log("[PackageData] Loading data from:", dataPath);

    const content = fs.readFileSync(dataPath, "utf-8");
    const normalizedData = normalizeDebloatData(JSON.parse(content));
    cachedData = applyOemOverrides(applyModelPredictions(normalizedData));

    console.log(
      `[PackageData] Loaded ${cachedData!.packages.length} packages, ${cachedData!.alternatives.length} alternatives`,
    );

    return cachedData!;
  } catch (error) {
    console.error("[PackageData] Failed to load debloat data:", error);
    // Return empty data structure if file not found
    return {
      packages: [],
      alternatives: [],
      lists: [],
      removalTypes: [],
      categories: [],
    };
  }
}

/**
 * Get package info by package ID
 */
export function getPackageInfo(packageId: string): DebloatPackage | null {
  const data = loadDebloatData();
  return data.packages.find((p) => p.id === packageId) || null;
}

/**
 * Get all packages
 */
export function getAllPackages(): DebloatPackage[] {
  return loadDebloatData().packages;
}

/**
 * Get packages by category
 */
export function getPackagesByCategory(category: string): DebloatPackage[] {
  const data = loadDebloatData();
  return data.packages.filter(
    (p) => p.category.toUpperCase() === category.toUpperCase(),
  );
}

/**
 * Get packages by list (GOOGLE, SAMSUNG, XIAOMI, etc.)
 */
export function getPackagesByList(list: string): DebloatPackage[] {
  const data = loadDebloatData();
  return data.packages.filter(
    (p) => p.list.toUpperCase() === list.toUpperCase(),
  );
}

/**
 * Get all alternatives
 */
export function getAllAlternatives(): AlternativeApp[] {
  return loadDebloatData().alternatives;
}

/**
 * Get alternative by ID
 */
export function getAlternativeById(altId: string): AlternativeApp | null {
  const data = loadDebloatData();
  return data.alternatives.find((a) => a.id === altId) || null;
}

/**
 * Get alternative by package ID (e.g., org.schabi.newpipe)
 */
export function getAlternativeByPackageId(
  packageId: string
): AlternativeApp | null {
  const data = loadDebloatData();
  return data.alternatives.find((a) => a.packageId === packageId) || null;
}

/**
 * Get alternatives for a specific package
 */
export function getAlternativesForPackage(packageId: string): AlternativeApp[] {
  const data = loadDebloatData();
  const pkg = data.packages.find((p) => p.id === packageId);

  if (!pkg || !pkg.alternatives.length) return [];

  return pkg.alternatives
    .map((altId) => data.alternatives.find((a) => a.id === altId))
    .filter((a): a is AlternativeApp => a !== undefined);
}

/**
 * Get all debloat lists
 */
export function getLists(): DebloatList[] {
  return loadDebloatData().lists;
}

/**
 * Get all removal types
 */
export function getRemovalTypes(): RemovalType[] {
  return loadDebloatData().removalTypes;
}

/**
 * Get all categories
 */
export function getCategories(): Category[] {
  return loadDebloatData().categories;
}

/**
 * Enrich a package list with debloat metadata
 */
export function enrichPackages(
  packages: Array<{ name: string; state: string }>,
): Array<{
  name: string;
  state: string;
  description: string;
  removal: string;
  category: string;
  list: string;
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
  isKnown: boolean;
}> {
  const data = loadDebloatData();
  const packageMap = new Map(data.packages.map((p) => [p.id, p]));

  return packages.map((pkg) => {
    const info = packageMap.get(pkg.name);
    const modelSignals = resolveModelSignals(pkg.name, info);

    if (info) {
      return {
        name: pkg.name,
        state: pkg.state,
        description: info.description,
        removal: info.removal,
        category: info.category,
        list: info.list,
        dependencies: info.dependencies,
        neededBy: info.neededBy,
        labels: info.labels,
        alternatives: info.alternatives,
        modelLabel: modelSignals.modelLabel,
        modelConfidence: modelSignals.modelConfidence,
        modelVersion: modelSignals.modelVersion,
        modelTopFactors: modelSignals.modelTopFactors,
        oemOverrideApplied: info.oemOverrideApplied,
        oemOverrideReason: info.oemOverrideReason,
        isKnown: true,
      };
    }

    // Unknown package - provide defaults
    return {
      name: pkg.name,
      state: pkg.state,
      description: "",
      removal: "ADVANCED",
      category: "OPTIONAL",
      list: "UNKNOWN",
      dependencies: [],
      neededBy: [],
      labels: [],
      alternatives: [],
      modelLabel: modelSignals.modelLabel,
      modelConfidence: modelSignals.modelConfidence,
      modelVersion: modelSignals.modelVersion,
      modelTopFactors: modelSignals.modelTopFactors,
      isKnown: false,
    };
  });
}

/**
 * Search packages by query
 */
export function searchPackages(query: string): DebloatPackage[] {
  const data = loadDebloatData();
  const lowerQuery = query.toLowerCase();

  return data.packages.filter(
    (p) =>
      p.id.toLowerCase().includes(lowerQuery) ||
      p.description.toLowerCase().includes(lowerQuery) ||
      p.labels.some((l) => l.toLowerCase().includes(lowerQuery)),
  );
}

/**
 * Get safety color for a removal type
 */
export function getSafetyColor(
  removal: string,
): "green" | "yellow" | "orange" | "red" {
  switch (removal) {
    case "RECOMMENDED":
      return "green";
    case "ADVANCED":
      return "yellow";
    case "EXPERT":
      return "orange";
    case "UNSAFE":
      return "red";
    default:
      return "yellow";
  }
}

/**
 * Clear the cached data (useful for reloading)
 */
export function clearCache(): void {
  cachedData = null;
}
