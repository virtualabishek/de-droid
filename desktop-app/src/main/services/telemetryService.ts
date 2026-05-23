import { createHash, randomUUID } from "crypto";
import { DatabaseManager } from "../database";
import { SettingsService } from "./settingsService";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TelemetryAction =
  | "UNINSTALL"
  | "DISABLE"
  | "RESTORE"
  | "ENABLE"
  | "UNDO";

export interface TelemetryActionInput {
  deviceId: string;
  deviceBrand?: string;
  deviceModel?: string;
  androidSdk?: number;
  packageName: string;
  action: TelemetryAction;
  success: boolean;
  errorMessage?: string;
  modelLabel?: string;
  modelConfidence?: number;
  modelGateApplied?: boolean;
  removalType?: string;
  category?: string;
}

export interface TelemetrySummary {
  enabled: boolean;
  total_events: number;
  success_rate: number;
  rollback_rate: number | null;
  avg_model_confidence: number | null;
  by_action: Record<string, number>;
}

// ─── Class ────────────────────────────────────────────────────────────────────

export class TelemetryService {
  constructor(
    private readonly db: DatabaseManager,
    private readonly settings: SettingsService,
  ) {}

  // ── Private helpers ──────────────────────────────────────────────────────────

  private getSalt(): string {
    const existing = this.settings.get("telemetry_salt");
    if (existing && existing.trim().length > 0) return existing;

    const generated = randomUUID();
    this.settings.set("telemetry_salt", generated);
    return generated;
  }

  private hashPackage(packageName: string): string {
    const salt = this.getSalt();
    return createHash("sha256")
      .update(`${salt}:${packageName.toLowerCase()}`)
      .digest("hex");
  }

  private bucketError(errorMessage?: string): string | null {
    if (!errorMessage) return null;

    const value = errorMessage.toLowerCase();
    if (value.includes("permission") || value.includes("denied"))
      return "permission";
    if (value.includes("not found") || value.includes("unknown package"))
      return "not_found";
    if (value.includes("timeout") || value.includes("timed out"))
      return "timeout";
    if (
      value.includes("offline") ||
      value.includes("unauthorized") ||
      value.includes("no devices")
    )
      return "device_connection";
    return "other";
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Returns true when the user has opted into telemetry.
   */
  isEnabled(): boolean {
    return this.settings.getBoolean("telemetry_opt_in", false);
  }

  /**
   * Record a single action outcome event.
   * Returns false (without throwing) when telemetry is disabled or the insert fails.
   */
  recordActionOutcome(input: TelemetryActionInput): boolean {
    if (!this.isEnabled()) return false;

    try {
      const db = this.db.get();

      const deviceIdHash = createHash("sha256")
        .update(`${this.getSalt()}:${input.deviceId}`)
        .digest("hex");

      db.prepare(
        `
        INSERT INTO telemetry_events (
          id,
          event_type,
          action,
          success,
          error_bucket,
          package_hash,
          device_id_hash,
          device_brand,
          device_model,
          android_sdk,
          model_label,
          model_confidence,
          model_gate_applied,
          removal_type,
          category,
          created_at
        ) VALUES (
          ?,
          'ACTION_OUTCOME',
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          CURRENT_TIMESTAMP
        )
      `,
      ).run(
        randomUUID(),
        input.action,
        input.success ? 1 : 0,
        this.bucketError(input.errorMessage),
        this.hashPackage(input.packageName),
        deviceIdHash,
        input.deviceBrand || null,
        input.deviceModel || null,
        input.androidSdk ?? null,
        input.modelLabel || null,
        typeof input.modelConfidence === "number"
          ? input.modelConfidence
          : null,
        input.modelGateApplied ? 1 : 0,
        input.removalType || null,
        input.category || null,
      );

      return true;
    } catch (error) {
      console.warn("[Telemetry] Failed to record action outcome:", error);
      return false;
    }
  }

  /**
   * Return an aggregate summary of telemetry data for the last `days` days.
   */
  getSummary(days = 30): TelemetrySummary {
    const enabled = this.isEnabled();
    if (!enabled) {
      return {
        enabled,
        total_events: 0,
        success_rate: 0,
        rollback_rate: null,
        avg_model_confidence: null,
        by_action: {},
      };
    }

    const db = this.db.get();
    const interval = `-${Math.max(days, 1)} days`;

    const aggregate = db
      .prepare(
        `
        SELECT
          COUNT(*) as total_events,
          AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) as success_rate,
          AVG(model_confidence) as avg_model_confidence
        FROM telemetry_events
        WHERE created_at >= datetime('now', ?)
          AND event_type = 'ACTION_OUTCOME'
      `,
      )
      .get(interval) as { total_events: number; success_rate: number | null; avg_model_confidence: number | null } | undefined;

    const actionRows = db
      .prepare(
        `
        SELECT action, COUNT(*) as count
        FROM telemetry_events
        WHERE created_at >= datetime('now', ?)
          AND event_type = 'ACTION_OUTCOME'
        GROUP BY action
      `,
      )
      .all(interval) as Array<{ action: string; count: number }>;

    const rollback = db
      .prepare(
        `
        SELECT
          SUM(CASE WHEN action = 'UNDO' AND success = 1 THEN 1 ELSE 0 END) as undo_success,
          SUM(CASE WHEN action IN ('UNINSTALL', 'DISABLE') AND success = 1 THEN 1 ELSE 0 END) as destructive_success
        FROM telemetry_events
        WHERE created_at >= datetime('now', ?)
          AND event_type = 'ACTION_OUTCOME'
      `,
      )
      .get(interval) as { undo_success: number | null; destructive_success: number | null } | undefined;

    const byAction: Record<string, number> = {};
    for (const row of actionRows) {
      byAction[row.action] = row.count;
    }

    const destructiveSuccess = Number(rollback?.destructive_success || 0);
    const undoSuccess = Number(rollback?.undo_success || 0);

    return {
      enabled,
      total_events: Number(aggregate?.total_events || 0),
      success_rate: Number(aggregate?.success_rate || 0),
      rollback_rate:
        destructiveSuccess > 0 ? undoSuccess / destructiveSuccess : null,
      avg_model_confidence:
        aggregate?.avg_model_confidence === undefined || aggregate?.avg_model_confidence === null
          ? null
          : Number(aggregate.avg_model_confidence),
      by_action: byAction,
    };
  }

  /**
   * Return signals useful for model retraining from the last `days` days.
   */
  getRetrainingSignals(days = 30): {
    enabled: boolean;
    low_confidence_rate: number | null;
    unsafe_false_safe_proxy: number | null;
    sample_size: number;
  } {
    const enabled = this.isEnabled();
    if (!enabled) {
      return {
        enabled,
        low_confidence_rate: null,
        unsafe_false_safe_proxy: null,
        sample_size: 0,
      };
    }

    const db = this.db.get();
    const interval = `-${Math.max(days, 1)} days`;

    const stats = db
      .prepare(
        `
        SELECT
          COUNT(*) as sample_size,
          AVG(CASE WHEN model_confidence IS NOT NULL AND model_confidence < 0.6 THEN 1.0 ELSE 0.0 END) as low_confidence_rate,
          AVG(CASE WHEN model_label = 'UNSAFE' AND success = 1 THEN 1.0 ELSE 0.0 END) as unsafe_false_safe_proxy
        FROM telemetry_events
        WHERE created_at >= datetime('now', ?)
          AND event_type = 'ACTION_OUTCOME'
          AND action IN ('UNINSTALL', 'DISABLE')
      `,
      )
      .get(interval) as { sample_size: number; low_confidence_rate: number | null; unsafe_false_safe_proxy: number | null } | undefined;

    return {
      enabled,
      low_confidence_rate:
        stats?.low_confidence_rate === undefined || stats?.low_confidence_rate === null
          ? null
          : Number(stats.low_confidence_rate),
      unsafe_false_safe_proxy:
        stats?.unsafe_false_safe_proxy === undefined || stats?.unsafe_false_safe_proxy === null
          ? null
          : Number(stats.unsafe_false_safe_proxy),
      sample_size: Number(stats?.sample_size || 0),
    };
  }
}

// ─── Lazy singleton for backward-compat delegates ─────────────────────────────

let _defaultInstance: TelemetryService | null = null;

function _getDefault(): TelemetryService {
  if (!_defaultInstance) {
    const dbManager = DatabaseManager.getInstance();
    const settings = new SettingsService(dbManager);
    _defaultInstance = new TelemetryService(dbManager, settings);
  }
  return _defaultInstance;
}

// ─── Backward-compat named exports ───────────────────────────────────────────

/**
 * @deprecated Prefer `new TelemetryService(db, settings).isEnabled()` or `ServiceContainer`.
 */
export function isTelemetryEnabled(): boolean {
  return _getDefault().isEnabled();
}

/**
 * @deprecated Prefer `new TelemetryService(db, settings).recordActionOutcome(input)` or `ServiceContainer`.
 */
export function recordActionOutcome(input: TelemetryActionInput): boolean {
  return _getDefault().recordActionOutcome(input);
}

/**
 * @deprecated Prefer `new TelemetryService(db, settings).getSummary(days)` or `ServiceContainer`.
 */
export function getTelemetrySummary(days = 30): TelemetrySummary {
  return _getDefault().getSummary(days);
}

/**
 * @deprecated Prefer `new TelemetryService(db, settings).getRetrainingSignals(days)` or `ServiceContainer`.
 */
export function getRetrainingSignals(days = 30): {
  enabled: boolean;
  low_confidence_rate: number | null;
  unsafe_false_safe_proxy: number | null;
  sample_size: number;
} {
  return _getDefault().getRetrainingSignals(days);
}
