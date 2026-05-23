/**
 * Package Data Service — Local package metadata management.
 * Class-based design with multi-brand OEM support, brand-aware heuristics,
 * and source-confidence awareness for community-sourced OEM data.
 *
 * @module packageDataService
 */
import * as fs from "fs";
import * as path from "path";
import { app } from "electron";

// ─────────────────────────────────────────────────────────────────────────────
// Interfaces & Types (all exports kept unchanged for backward-compat)
// ─────────────────────────────────────────────────────────────────────────────

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
  iconUrl?: string;
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

/**
 * Shape of a single entry returned by {@link PackageDataService.enrichPackages}.
 */
export interface EnrichedPackage {
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
  sizeBytes?: number;
  modelLabel?: string;
  modelConfidence?: number;
  modelVersion?: string;
  modelTopFactors?: string[];
  oemOverrideApplied?: boolean;
  oemOverrideReason?: string;
  isKnown: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level constants
// ─────────────────────────────────────────────────────────────────────────────

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

/**
 * OEM package-ID prefix table.
 *
 * Ordering matters — first match wins when iterating `Object.entries`.
 * More-specific brands (REDMI, REALME) are listed *before* the broader
 * parent brand (XIAOMI, OPPO) so that e.g. `com.redmi.*` is never
 * accidentally bucketed into XIAOMI.
 */
const OEM_PREFIXES: Record<string, string[]> = {
  SAMSUNG: ["com.samsung.", "com.sec.", "com.osp.", "com.wssyncmldm"],
  REDMI: ["com.redmi."],
  XIAOMI: ["com.xiaomi.", "com.miui.", "com.mi."],
  ONEPLUS: ["com.oneplus.", "net.oneplus.", "cn.oneplus."],
  HUAWEI: ["com.huawei.", "com.hicloud.", "com.hisi.", "com.honor."],
  REALME: ["com.realme.", "com.nearme."],
  OPPO: ["com.oppo.", "com.coloros.", "com.heytap.", "com.oplus."],
  VIVO: ["com.vivo.", "com.bbk.", "com.iqoo."],
  INFINIX: ["com.infinix.", "com.transsion.", "com.xos.", "com.xclub."],
  TECNO: ["com.tecno.", "com.hios."],
  ITEL: ["com.itel.", "com.palmstore."],
  NOKIA: ["com.nokia.", "com.hmd."],
  MOTOROLA: ["com.motorola.", "com.moto."],
  LGE: ["com.lge.", "com.lg."],
  GOOGLE: ["com.google."],
  ANDROID: ["com.android."],
};

/**
 * Samsung packages that are safety-critical — removing any of these risks
 * bootloop, call failure, or device lockout.
 */
const SAMSUNG_CRITICAL = new Set<string>([
  "com.samsung.android.dialer",
  "com.samsung.android.incallui",
  "com.samsung.android.messaging",
  "com.sec.android.app.launcher",
  "com.samsung.android.providers.contacts",
  "com.samsung.android.telecom",
  "com.samsung.android.app.telephonyprovider",
  "com.samsung.android.knox",
]);

/**
 * MIUI / Xiaomi packages that are safety-critical — removing any of these
 * can cause the device to fail to boot or lose network/security functionality.
 */
const MIUI_CRITICAL = new Set<string>([
  "com.miui.home",
  "com.miui.securitycenter",
  "com.xiaomi.finddevice",
  "com.miui.packageinstaller",
  "com.miui.system",
  "com.miui.aod",
]);

// ─────────────────────────────────────────────────────────────────────────────
// PackageDataService class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages loading, normalising, and enriching Android package metadata
 * from local debloat lists, OEM override files, and ML model prediction files.
 *
 * Typical usage — use the module-level backward-compat helpers at the bottom
 * of this file (they delegate to a shared singleton).  For isolated contexts
 * (tests, multi-device scenarios) create a fresh instance:
 *
 * ```typescript
 * const svc = new PackageDataService();
 * const enriched = svc.enrichPackages(rawList, "SAMSUNG");
 * ```
 */
export class PackageDataService {
  private cache: DebloatData | null = null;

  // ── Low-level value normalisation ─────────────────────────────────────────

  private toStringValue(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  private toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [
      ...new Set(value.map((v) => this.toStringValue(v)).filter(Boolean)),
    ];
  }

  private normalizeRemoval(value: unknown): DebloatPackage["removal"] {
    const normalized = this.toStringValue(value).toUpperCase();
    return REMOVAL_ALIASES[normalized] ?? "ADVANCED";
  }

  private normalizeCategory(value: unknown): DebloatPackage["category"] {
    const normalized = this.toStringValue(value).toUpperCase();
    return CATEGORY_ALIASES[normalized] ?? "OPTIONAL";
  }

  private normalizeList(value: unknown): string {
    const normalized = this.toStringValue(value).toUpperCase();
    return normalized || "UNKNOWN";
  }

  // ── OEM detection ──────────────────────────────────────────────────────────

  /**
   * Infers the device OEM brand from a package ID using the {@link OEM_PREFIXES}
   * table.  Returns a normalised brand key such as `"SAMSUNG"` or `"REDMI"`,
   * or `null` when no prefix matches.
   *
   * Exposed as `public` so IPC handlers can access it directly when they hold
   * a reference to a service instance.
   */
  public inferOemFromPackageId(packageId: string): string | null {
    const lower = packageId.toLowerCase();
    for (const [oem, prefixes] of Object.entries(OEM_PREFIXES)) {
      for (const prefix of prefixes) {
        if (lower.startsWith(prefix.toLowerCase())) {
          return oem;
        }
      }
    }
    return null;
  }

  // ── Package normalisation ──────────────────────────────────────────────────

  private normalizePackage(rawPkg: unknown): DebloatPackage | null {
    if (!rawPkg || typeof rawPkg !== "object") return null;

    const pkg = rawPkg as Record<string, unknown>;
    const id = this.toStringValue(pkg.id);
    if (!id) return null;

    return {
      id,
      list: this.normalizeList(pkg.list),
      description: this.toStringValue(pkg.description),
      removal: this.normalizeRemoval(pkg.removal),
      category: this.normalizeCategory(pkg.category),
      dependencies: this.toStringArray(pkg.dependencies),
      neededBy: this.toStringArray(pkg.neededBy),
      labels: this.toStringArray(pkg.labels),
      alternatives: this.toStringArray(pkg.alternatives),
      modelLabel: pkg.modelLabel
        ? this.normalizeRemoval(pkg.modelLabel)
        : undefined,
      modelConfidence:
        typeof pkg.modelConfidence === "number"
          ? pkg.modelConfidence
          : undefined,
      modelVersion: this.toStringValue(pkg.modelVersion) || undefined,
      modelTopFactors: this.toStringArray(pkg.modelTopFactors),
      oemOverrideApplied: Boolean(pkg.oemOverrideApplied),
      oemOverrideReason: this.toStringValue(pkg.oemOverrideReason) || undefined,
    };
  }

  private normalizeAlternative(rawAlt: unknown): AlternativeApp | null {
    if (!rawAlt || typeof rawAlt !== "object") return null;

    const alt = rawAlt as Record<string, unknown>;
    const id = this.toStringValue(alt.id);
    if (!id) return null;

    return {
      id,
      name: this.toStringValue(alt.name),
      description: this.toStringValue(alt.description),
      packageId: this.toStringValue(alt.packageId),
      source: this.toStringValue(alt.source),
      sourceUrl: this.toStringValue(alt.sourceUrl),
      githubUrl: this.toStringValue(alt.githubUrl),
      icon: this.toStringValue(alt.icon),
      iconUrl: this.toStringValue(alt.iconUrl) || undefined,
    };
  }

  private normalizeDebloatData(rawData: unknown): DebloatData {
    const fallback: DebloatData = {
      packages: [],
      alternatives: [],
      lists: [],
      removalTypes: [],
      categories: [],
    };

    if (!rawData || typeof rawData !== "object") return fallback;

    const data = rawData as Record<string, unknown>;

    const normalizedPackages = Array.isArray(data.packages)
      ? data.packages
          .map((p) => this.normalizePackage(p))
          .filter((p): p is DebloatPackage => p !== null)
      : [];

    const normalizedAlternatives = Array.isArray(data.alternatives)
      ? data.alternatives
          .map((a) => this.normalizeAlternative(a))
          .filter((a): a is AlternativeApp => a !== null)
      : [];

    const normalizedLists: DebloatList[] = Array.isArray(data.lists)
      ? data.lists
          .filter((list): list is Record<string, unknown> => {
            if (!list || typeof list !== "object") return false;
            const item = list as Record<string, unknown>;
            return Boolean(this.toStringValue(item.id));
          })
          .map((list) => ({
            id: this.normalizeList(list.id),
            name: this.toStringValue(list.name),
            description: this.toStringValue(list.description),
          }))
      : [];

    const normalizedRemovalTypes: RemovalType[] = Array.isArray(
      data.removalTypes,
    )
      ? data.removalTypes
          .filter((removal): removal is Record<string, unknown> => {
            if (!removal || typeof removal !== "object") return false;
            const item = removal as Record<string, unknown>;
            return Boolean(this.toStringValue(item.id));
          })
          .map((removal) => ({
            id: this.normalizeRemoval(removal.id),
            name: this.toStringValue(removal.name),
            description: this.toStringValue(removal.description),
            color: this.toStringValue(removal.color),
          }))
      : [];

    const normalizedCategories: Category[] = Array.isArray(data.categories)
      ? data.categories
          .filter((category): category is Record<string, unknown> => {
            if (!category || typeof category !== "object") return false;
            const item = category as Record<string, unknown>;
            return Boolean(this.toStringValue(item.id));
          })
          .map((category) => ({
            id: this.normalizeCategory(category.id),
            name: this.toStringValue(category.name),
            description: this.toStringValue(category.description),
            color: this.toStringValue(category.color),
          }))
      : [];

    return {
      packages: normalizedPackages,
      alternatives: normalizedAlternatives,
      lists: normalizedLists,
      removalTypes: normalizedRemovalTypes,
      categories: normalizedCategories,
    };
  }

  // ── File-path resolution ───────────────────────────────────────────────────

  private getDataPath(): string {
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

    // Default fallback — will likely fail but provides a clear error path
    console.log(
      "[PackageData] Could not find data file, tried:",
      possiblePaths,
    );
    return possiblePaths[0];
  }

  private getOverridesPath(): string | null {
    const possiblePaths = [
      path.join(__dirname, "../../../src/data/oem_overrides.json"),
      path.join(__dirname, "../../data/oem_overrides.json"),
      path.join(process.resourcesPath || "", "data", "oem_overrides.json"),
      path.join(app.getAppPath(), "data", "oem_overrides.json"),
      path.join(app.getAppPath(), "src", "data", "oem_overrides.json"),
    ];

    for (const currentPath of possiblePaths) {
      if (fs.existsSync(currentPath)) return currentPath;
    }
    return null;
  }

  private getPredictionsPath(): string | null {
    const possiblePaths = [
      path.join(__dirname, "../../../src/data/safety_predictions.json"),
      path.join(__dirname, "../../data/safety_predictions.json"),
      path.join(process.resourcesPath || "", "data", "safety_predictions.json"),
      path.join(app.getAppPath(), "data", "safety_predictions.json"),
      path.join(app.getAppPath(), "src", "data", "safety_predictions.json"),
      path.resolve(
        __dirname,
        "../../../../model-api/models/safety_predictions.json",
      ),
    ];

    for (const currentPath of possiblePaths) {
      if (fs.existsSync(currentPath)) return currentPath;
    }
    return null;
  }

  // ── OEM overrides ──────────────────────────────────────────────────────────

  private loadOemOverrides(): OemOverrideEntry[] {
    const overridePath = this.getOverridesPath();
    if (!overridePath) return [];

    try {
      const content = fs.readFileSync(overridePath, "utf-8");
      const payload = JSON.parse(content) as Partial<OemOverridesFile>;
      if (!payload || !Array.isArray(payload.overrides)) return [];

      return payload.overrides
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const raw = item as unknown as Record<string, unknown>;
          const packageId = this.toStringValue(raw.packageId);
          if (!packageId) return null;

          return {
            packageId,
            oem: this.toStringValue(raw.oem).toUpperCase() || undefined,
            removal: raw.removal
              ? this.normalizeRemoval(raw.removal)
              : undefined,
            category: raw.category
              ? this.normalizeCategory(raw.category)
              : undefined,
            reason: this.toStringValue(raw.reason) || undefined,
          } as OemOverrideEntry;
        })
        .filter((item): item is OemOverrideEntry => item !== null);
    } catch (error) {
      console.warn("[PackageData] Failed to load OEM overrides:", error);
      return [];
    }
  }

  private applyOemOverrides(data: DebloatData): DebloatData {
    const overrides = this.loadOemOverrides();
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
        const inferredOem = this.inferOemFromPackageId(pkg.id);
        return (
          entry.oem === pkg.list.toUpperCase() || entry.oem === inferredOem
        );
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

    return { ...data, packages };
  }

  // ── ML model predictions ───────────────────────────────────────────────────

  private loadModelPredictions(): ModelPredictionsFile | null {
    const predictionsPath = this.getPredictionsPath();
    if (!predictionsPath) return null;

    try {
      const content = fs.readFileSync(predictionsPath, "utf-8");
      const payload = JSON.parse(content) as Partial<ModelPredictionsFile>;

      if (!payload || typeof payload !== "object" || !payload.predictions)
        return null;

      const normalizedPredictions: Record<string, ModelPredictionEntry> = {};

      for (const [packageId, prediction] of Object.entries(
        payload.predictions,
      )) {
        if (!prediction || typeof prediction !== "object") continue;

        const raw = prediction as unknown as Record<string, unknown>;
        const label = this.normalizeRemoval(raw.label);
        const confidenceRaw = raw.confidence;
        const topFactorsRaw = raw.top_factors;
        const confidence =
          typeof confidenceRaw === "number"
            ? Math.max(0, Math.min(1, confidenceRaw))
            : 0;

        normalizedPredictions[packageId] = {
          label,
          confidence,
          top_factors: this.toStringArray(topFactorsRaw),
        };
      }

      console.log(
        `[PackageData] Loaded model predictions for ${Object.keys(normalizedPredictions).length} packages from ${predictionsPath}`,
      );

      return {
        modelVersion:
          this.toStringValue(payload.modelVersion) || "safety-model",
        predictions: normalizedPredictions,
      };
    } catch (error) {
      console.warn("[PackageData] Failed to load model predictions:", error);
      return null;
    }
  }

  private applyModelPredictions(data: DebloatData): DebloatData {
    const predictionFile = this.loadModelPredictions();
    if (!predictionFile) return data;

    const packages = data.packages.map((pkg) => {
      const prediction = predictionFile.predictions[pkg.id];
      if (!prediction) return pkg;

      return {
        ...pkg,
        modelLabel: prediction.label,
        modelConfidence: prediction.confidence,
        modelVersion: predictionFile.modelVersion,
        modelTopFactors: this.toStringArray(prediction.top_factors),
      };
    });

    return { ...data, packages };
  }

  // ── Confidence helpers ─────────────────────────────────────────────────────

  private fallbackConfidence(removal: DebloatPackage["removal"]): number {
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

  /**
   * Applies a confidence penalty for community-sourced OEM data.
   *
   * When a package belongs to a known community-curated OEM list (currently
   * SAMSUNG and REDMI) **and** its model version indicates a fallback or
   * variant source rather than a trained ML prediction, the raw confidence is
   * reduced by 0.10 to reflect lower data reliability.
   *
   * The result is clamped to `[0, 1]`.
   */
  private applySourceConfidence(
    pkg: DebloatPackage,
    confidence: number,
  ): number {
    const isCommunityOem = pkg.list === "SAMSUNG" || pkg.list === "REDMI";
    const isVariantSource =
      !pkg.modelVersion ||
      pkg.modelVersion.includes("variant") ||
      pkg.modelVersion.startsWith("fallback");

    if (isCommunityOem && isVariantSource) {
      return Math.max(0, confidence - 0.1);
    }
    return confidence;
  }

  /**
   * Brand-aware heuristic safety estimate for packages **not** found in the
   * curated debloat dataset.
   *
   * Scoring ladder (first match wins):
   * 1. Brand-specific critical sets  → UNSAFE  0.91–0.92
   * 2. Generic critical signals       → UNSAFE  0.90
   * 3. Samsung-specific bloatware     → RECOMMENDED 0.76
   * 4. MIUI / Redmi bloatware         → RECOMMENDED 0.74
   * 5. Generic bloat signals          → RECOMMENDED 0.74
   * 6. `com.android.*`               → EXPERT  0.62
   * 7. `com.google.*`                → EXPERT  0.60
   * 8. Any OEM prefix (non-critical)  → ADVANCED 0.57
   * 9. Unknown                        → ADVANCED 0.48
   *
   * Never throws — empty or malformed package names return ADVANCED 0.45.
   *
   * @param packageName  Full package ID (e.g. `com.samsung.android.email`).
   * @param deviceBrand  Optional OEM key (e.g. `"SAMSUNG"`) for brand-specific
   *                     critical-set checks.
   */
  private inferHeuristicModelForUnknown(
    packageName: string,
    deviceBrand?: string,
  ): {
    label: DebloatPackage["removal"];
    confidence: number;
    topFactors: string[];
  } {
    // Guard: handle empty / non-string names without throwing
    if (!packageName || typeof packageName !== "string") {
      return {
        label: "ADVANCED",
        confidence: 0.45,
        topFactors: [
          "empty or invalid package name",
          "default conservative score applied",
        ],
      };
    }

    const name = packageName.toLowerCase();
    const brand = (deviceBrand ?? "").toUpperCase();

    // ── 1. Brand-specific critical sets ───────────────────────────────────────
    if (
      SAMSUNG_CRITICAL.has(packageName) ||
      (brand === "SAMSUNG" && SAMSUNG_CRITICAL.has(packageName))
    ) {
      return {
        label: "UNSAFE",
        confidence: 0.92,
        topFactors: [
          "Samsung-specific critical system package",
          "high bootloop or device-lockout risk if removed",
        ],
      };
    }

    if (
      MIUI_CRITICAL.has(packageName) ||
      ((brand === "XIAOMI" || brand === "REDMI") &&
        MIUI_CRITICAL.has(packageName))
    ) {
      return {
        label: "UNSAFE",
        confidence: 0.91,
        topFactors: [
          "MIUI / Xiaomi critical system package",
          "device may fail to boot if removed",
        ],
      };
    }

    // ── 2. Generic critical signals ────────────────────────────────────────────
    const criticalSignals = [
      "securitycenter",
      "finddevice",
      "packageinstaller",
      "updater",
      "managedprovisioning",
      "knox",
      "lbe.security",
    ];
    if (criticalSignals.some((s) => name.includes(s))) {
      return {
        label: "UNSAFE",
        confidence: 0.9,
        topFactors: [
          "critical system / security package pattern",
          "high bootloop or lockout risk if removed",
        ],
      };
    }

    // ── 3. Samsung-specific bloatware patterns ─────────────────────────────────
    if (name.startsWith("com.samsung.") || name.startsWith("com.sec.")) {
      const samsungBloatSignals = [
        "bixby",
        "email.provider",
        "game",
        "tips",
        "sticker",
        "kidsinstaller",
        "social",
        "beauty",
        "livedrawing",
        "applock",
        "easysetup",
      ];
      if (samsungBloatSignals.some((s) => name.includes(s))) {
        return {
          label: "RECOMMENDED",
          confidence: 0.76,
          topFactors: [
            "Samsung-specific bloatware pattern",
            "usually safe to remove on most Samsung devices",
          ],
        };
      }
    }

    // ── 4. MIUI / Redmi bloatware patterns ────────────────────────────────────
    if (
      name.startsWith("com.miui.") ||
      name.startsWith("com.xiaomi.") ||
      name.startsWith("com.redmi.")
    ) {
      const miuiBloatSignals = [
        "analytics",
        "msa",
        "mipicks",
        "mishare",
        "bugreport",
        "player",
        "notes",
        "videoeditor",
        "market",
        "joyose",
      ];
      if (miuiBloatSignals.some((s) => name.includes(s))) {
        return {
          label: "RECOMMENDED",
          confidence: 0.74,
          topFactors: [
            "MIUI / Redmi-specific bloatware pattern",
            "generally safe to remove on Xiaomi / Redmi devices",
          ],
        };
      }
    }

    // ── 5. Generic bloat signals ───────────────────────────────────────────────
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
    if (bloatSignals.some((s) => name.includes(s))) {
      return {
        label: "RECOMMENDED",
        confidence: 0.74,
        topFactors: [
          "common ad / analytics or preloaded-bloat pattern",
          "usually safe to remove for most users",
        ],
      };
    }

    // ── 6. Android core namespace ──────────────────────────────────────────────
    if (name.startsWith("com.android.")) {
      return {
        label: "EXPERT",
        confidence: 0.62,
        topFactors: [
          "Android core namespace detected",
          "manual review advised before removal",
        ],
      };
    }

    // ── 7. Google namespace ────────────────────────────────────────────────────
    if (name.startsWith("com.google.")) {
      return {
        label: "EXPERT",
        confidence: 0.6,
        topFactors: [
          "Google namespace detected",
          "manual review advised before removal",
        ],
      };
    }

    // ── 8. Any other OEM prefix (non-critical, non-bloat) ─────────────────────
    const inferredOem = this.inferOemFromPackageId(packageName);
    if (inferredOem) {
      return {
        label: "ADVANCED",
        confidence: 0.57,
        topFactors: [
          `OEM system package pattern (${inferredOem})`,
          "feature impact unknown without device-specific testing",
        ],
      };
    }

    // ── 9. Unknown / no match ──────────────────────────────────────────────────
    return {
      label: "ADVANCED",
      confidence: 0.48,
      topFactors: [
        "limited metadata available",
        "default conservative score for unknown package",
      ],
    };
  }

  /**
   * Resolves the best available model signals for a package.
   *
   * Priority order:
   * 1. Existing ML prediction stored on the `DebloatPackage` record.
   * 2. Fallback derived from the curated removal category.
   * 3. Heuristic estimate via {@link inferHeuristicModelForUnknown}.
   *
   * A source-confidence penalty is applied for steps 1 and 2 via
   * {@link applySourceConfidence}.
   *
   * @param packageName  Package ID string.
   * @param info         Curated {@link DebloatPackage} record, or `undefined`
   *                     for unknown packages.
   * @param deviceBrand  Optional OEM brand key forwarded to the heuristic.
   */
  private resolveModelSignals(
    packageName: string,
    info: DebloatPackage | undefined,
    deviceBrand?: string,
  ): {
    modelLabel: DebloatPackage["removal"];
    modelConfidence: number;
    modelVersion: string;
    modelTopFactors: string[];
  } {
    // Step 1 — use stored ML prediction
    if (info && info.modelLabel && typeof info.modelConfidence === "number") {
      const confidence = this.applySourceConfidence(info, info.modelConfidence);
      return {
        modelLabel: info.modelLabel,
        modelConfidence: confidence,
        modelVersion: info.modelVersion || "safety-model",
        modelTopFactors: this.toStringArray(info.modelTopFactors),
      };
    }

    // Step 2 — fall back to curated removal category
    if (info) {
      const rawConfidence = this.fallbackConfidence(info.removal);
      const confidence = this.applySourceConfidence(info, rawConfidence);
      return {
        modelLabel: info.removal,
        modelConfidence: confidence,
        modelVersion: "fallback-rule-v1",
        modelTopFactors: [
          "no direct model prediction for this package",
          "fallback from curated removal category",
        ],
      };
    }

    // Step 3 — heuristic estimate for unknown packages
    const heuristic = this.inferHeuristicModelForUnknown(
      packageName,
      deviceBrand,
    );
    return {
      modelLabel: heuristic.label,
      modelConfidence: heuristic.confidence,
      modelVersion: "fallback-heuristic-v1",
      modelTopFactors: heuristic.topFactors,
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Loads (or returns a cached copy of) the debloat dataset, applying OEM
   * overrides and ML model predictions on the first call.
   */
  loadData(): DebloatData {
    if (this.cache) return this.cache;

    try {
      const dataPath = this.getDataPath();
      console.log("[PackageData] Loading data from:", dataPath);

      const content = fs.readFileSync(dataPath, "utf-8");
      const normalized = this.normalizeDebloatData(JSON.parse(content));
      this.cache = this.applyOemOverrides(
        this.applyModelPredictions(normalized),
      );

      console.log(
        `[PackageData] Loaded ${this.cache!.packages.length} packages, ` +
          `${this.cache!.alternatives.length} alternatives`,
      );

      return this.cache!;
    } catch (error) {
      console.error("[PackageData] Failed to load debloat data:", error);
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
   * Clears the in-memory data cache so the next call to {@link loadData}
   * re-reads from disk.
   */
  clearCache(): void {
    this.cache = null;
  }

  /**
   * Returns the {@link DebloatPackage} record for the given package ID,
   * or `null` if not found in the dataset.
   */
  getPackageInfo(packageId: string): DebloatPackage | null {
    return this.loadData().packages.find((p) => p.id === packageId) ?? null;
  }

  /** Returns every package in the loaded dataset. */
  getAllPackages(): DebloatPackage[] {
    return this.loadData().packages;
  }

  /**
   * Returns packages whose `category` matches the given string
   * (case-insensitive).
   */
  getByCategory(category: string): DebloatPackage[] {
    return this.loadData().packages.filter(
      (p) => p.category.toUpperCase() === category.toUpperCase(),
    );
  }

  /**
   * Returns packages whose `list` (OEM tag) matches the given string
   * (case-insensitive).
   */
  getByList(list: string): DebloatPackage[] {
    return this.loadData().packages.filter(
      (p) => p.list.toUpperCase() === list.toUpperCase(),
    );
  }

  /** Returns all registered alternative app entries. */
  getAllAlternatives(): AlternativeApp[] {
    return this.loadData().alternatives;
  }

  /**
   * Returns the alternative app whose `id` matches, or `null`.
   */
  getAlternativeById(altId: string): AlternativeApp | null {
    return this.loadData().alternatives.find((a) => a.id === altId) ?? null;
  }

  /**
   * Returns the alternative app whose `packageId` field matches, or `null`.
   */
  getAlternativeByPackageId(packageId: string): AlternativeApp | null {
    return (
      this.loadData().alternatives.find((a) => a.packageId === packageId) ??
      null
    );
  }

  /**
   * Returns all alternative apps linked via the `alternatives` array of the
   * given package.
   */
  getAlternativesForPackage(packageId: string): AlternativeApp[] {
    const data = this.loadData();
    const pkg = data.packages.find((p) => p.id === packageId);
    if (!pkg || !pkg.alternatives.length) return [];

    return pkg.alternatives
      .map((altId) => data.alternatives.find((a) => a.id === altId))
      .filter((a): a is AlternativeApp => a !== undefined);
  }

  /** Returns all registered debloat lists. */
  getLists(): DebloatList[] {
    return this.loadData().lists;
  }

  /** Returns all removal type definitions. */
  getRemovalTypes(): RemovalType[] {
    return this.loadData().removalTypes;
  }

  /** Returns all category definitions. */
  getCategories(): Category[] {
    return this.loadData().categories;
  }

  /**
   * Enriches a raw device package list with debloat metadata and model signals.
   *
   * For packages present in the dataset the full curated record is merged in.
   * For unknown packages a heuristic estimate is produced.  Either way every
   * returned object carries `modelLabel`, `modelConfidence`, `modelVersion`,
   * and `modelTopFactors`.
   *
   * @param packages     Raw list of `{ name, state }` objects from ADB.
   * @param deviceBrand  Optional OEM brand (e.g. `"SAMSUNG"`, `"REDMI"`)
   *                     used to improve heuristic accuracy for unknown packages.
   */
  enrichPackages(
    packages: Array<{ name: string; state: string }>,
    deviceBrand?: string,
  ): Array<EnrichedPackage> {
    const data = this.loadData();
    const packageMap = new Map(data.packages.map((p) => [p.id, p]));

    return packages.map((pkg) => {
      const info = packageMap.get(pkg.name);
      const modelSignals = this.resolveModelSignals(
        pkg.name,
        info,
        deviceBrand,
      );

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

      // Unknown package — provide safe defaults
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
   * Full-text search across package IDs, descriptions, and labels.
   *
   * @param query  Case-insensitive search string.
   */
  searchPackages(query: string): DebloatPackage[] {
    const data = this.loadData();
    const lowerQuery = query.toLowerCase();

    return data.packages.filter(
      (p) =>
        p.id.toLowerCase().includes(lowerQuery) ||
        p.description.toLowerCase().includes(lowerQuery) ||
        p.labels.some((l) => l.toLowerCase().includes(lowerQuery)),
    );
  }

  /**
   * Maps a removal-type string to a UI colour token.
   *
   * | Removal      | Colour   |
   * |------------- |--------- |
   * | RECOMMENDED  | green    |
   * | ADVANCED     | yellow   |
   * | EXPERT       | orange   |
   * | UNSAFE       | red      |
   */
  getSafetyColor(removal: string): "green" | "yellow" | "orange" | "red" {
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Backward-compatible singleton + function exports
// (existing IPC handlers and callers continue to work without changes)
// ─────────────────────────────────────────────────────────────────────────────

let _defaultInstance: PackageDataService | null = null;

function getDefaultInstance(): PackageDataService {
  if (!_defaultInstance) _defaultInstance = new PackageDataService();
  return _defaultInstance;
}

/** @see {@link PackageDataService.loadData} */
export function loadDebloatData(): DebloatData {
  return getDefaultInstance().loadData();
}

/** @see {@link PackageDataService.getPackageInfo} */
export function getPackageInfo(packageId: string): DebloatPackage | null {
  return getDefaultInstance().getPackageInfo(packageId);
}

/** @see {@link PackageDataService.getAllPackages} */
export function getAllPackages(): DebloatPackage[] {
  return getDefaultInstance().getAllPackages();
}

/** @see {@link PackageDataService.getByCategory} */
export function getPackagesByCategory(category: string): DebloatPackage[] {
  return getDefaultInstance().getByCategory(category);
}

/** @see {@link PackageDataService.getByList} */
export function getPackagesByList(list: string): DebloatPackage[] {
  return getDefaultInstance().getByList(list);
}

/** @see {@link PackageDataService.getAllAlternatives} */
export function getAllAlternatives(): AlternativeApp[] {
  return getDefaultInstance().getAllAlternatives();
}

/** @see {@link PackageDataService.getAlternativeById} */
export function getAlternativeById(altId: string): AlternativeApp | null {
  return getDefaultInstance().getAlternativeById(altId);
}

/** @see {@link PackageDataService.getAlternativeByPackageId} */
export function getAlternativeByPackageId(
  packageId: string,
): AlternativeApp | null {
  return getDefaultInstance().getAlternativeByPackageId(packageId);
}

/** @see {@link PackageDataService.getAlternativesForPackage} */
export function getAlternativesForPackage(packageId: string): AlternativeApp[] {
  return getDefaultInstance().getAlternativesForPackage(packageId);
}

/** @see {@link PackageDataService.getLists} */
export function getLists(): DebloatList[] {
  return getDefaultInstance().getLists();
}

/** @see {@link PackageDataService.getRemovalTypes} */
export function getRemovalTypes(): RemovalType[] {
  return getDefaultInstance().getRemovalTypes();
}

/** @see {@link PackageDataService.getCategories} */
export function getCategories(): Category[] {
  return getDefaultInstance().getCategories();
}

/**
 * Backward-compat wrapper for {@link PackageDataService.enrichPackages}.
 * The optional `deviceBrand` parameter is forwarded transparently, so any
 * existing call-site that passes only `packages` continues to compile.
 *
 * @see {@link PackageDataService.enrichPackages}
 */
export function enrichPackages(
  packages: Array<{ name: string; state: string }>,
  deviceBrand?: string,
): Array<EnrichedPackage> {
  return getDefaultInstance().enrichPackages(packages, deviceBrand);
}

/** @see {@link PackageDataService.searchPackages} */
export function searchPackages(query: string): DebloatPackage[] {
  return getDefaultInstance().searchPackages(query);
}

/** @see {@link PackageDataService.getSafetyColor} */
export function getSafetyColor(
  removal: string,
): "green" | "yellow" | "orange" | "red" {
  return getDefaultInstance().getSafetyColor(removal);
}

/**
 * Clears the shared singleton's data cache **and** destroys the singleton
 * so the next call creates a fresh instance.
 *
 * @see {@link PackageDataService.clearCache}
 */
export function clearCache(): void {
  getDefaultInstance().clearCache();
  _defaultInstance = null;
}
