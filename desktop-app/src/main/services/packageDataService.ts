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
    cachedData = JSON.parse(content);

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
  isKnown: boolean;
}> {
  const data = loadDebloatData();
  const packageMap = new Map(data.packages.map((p) => [p.id, p]));

  return packages.map((pkg) => {
    const info = packageMap.get(pkg.name);

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
