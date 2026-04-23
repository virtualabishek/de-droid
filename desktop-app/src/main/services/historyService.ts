/**
 * History Service - Local SQLite-based action history
 */
import { v4 as uuidv4 } from "uuid";
import { DatabaseManager, ActionHistoryRecord } from "../database";

const HISTORY_DEDUP_WINDOW_SECONDS = 5;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateHistoryInput {
  deviceId: string;
  deviceModel?: string;
  deviceBrand?: string;
  packageName: string;
  action: "UNINSTALL" | "DISABLE" | "RESTORE" | "ENABLE";
  androidUser?: number;
  success: boolean;
  errorMessage?: string;
}

export interface HistoryStats {
  total_actions: number;
  successful_actions: number;
  failed_actions: number;
  uninstall_count: number;
  restore_count: number;
  disable_count: number;
  enable_count: number;
  devices_count: number;
  packages_count: number;
}

// ─── Class ────────────────────────────────────────────────────────────────────

export class HistoryService {
  constructor(private readonly db: DatabaseManager) {}

  /**
   * Create a new action history record.
   * Deduplicates identical records within the dedup window.
   */
  createRecord(input: CreateHistoryInput): ActionHistoryRecord {
    const db = this.db.get();

    const recentDuplicate = db
      .prepare(
        `
        SELECT *, ((julianday('now') - julianday(created_at)) * 86400.0) AS age_seconds
        FROM action_history
        WHERE device_id = ?
          AND package_name = ?
          AND action = ?
          AND android_user = ?
          AND success = ?
        ORDER BY created_at DESC
        LIMIT 1
      `,
      )
      .get(
        input.deviceId,
        input.packageName,
        input.action,
        input.androidUser || 0,
        input.success ? 1 : 0,
      ) as (ActionHistoryRecord & { age_seconds?: number }) | undefined;

    if (
      recentDuplicate &&
      typeof recentDuplicate.age_seconds === "number" &&
      recentDuplicate.age_seconds >= 0 &&
      recentDuplicate.age_seconds <= HISTORY_DEDUP_WINDOW_SECONDS
    ) {
      return {
        ...recentDuplicate,
        success: Boolean(recentDuplicate.success),
        is_undone: Boolean(recentDuplicate.is_undone),
      };
    }

    const id = uuidv4();

    db.prepare(
      `
      INSERT INTO action_history (id, device_id, device_model, device_brand, package_name, action, android_user, success, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      input.deviceId,
      input.deviceModel || null,
      input.deviceBrand || null,
      input.packageName,
      input.action,
      input.androidUser || 0,
      input.success ? 1 : 0,
      input.errorMessage || null,
    );

    return this.getById(id)!;
  }

  /**
   * Get a history record by ID.
   */
  getById(id: string): ActionHistoryRecord | null {
    const db = this.db.get();
    const row = db
      .prepare("SELECT * FROM action_history WHERE id = ?")
      .get(id) as any;

    if (!row) return null;

    return {
      ...row,
      success: Boolean(row.success),
      is_undone: Boolean(row.is_undone),
    };
  }

  /**
   * Get all action history records.
   */
  getAll(limit = 100): ActionHistoryRecord[] {
    const db = this.db.get();
    const rows = db
      .prepare("SELECT * FROM action_history ORDER BY created_at DESC LIMIT ?")
      .all(limit) as any[];

    return rows.map((row) => ({
      ...row,
      success: Boolean(row.success),
      is_undone: Boolean(row.is_undone),
    }));
  }

  /**
   * Get history for a specific device.
   */
  getForDevice(deviceId: string, limit = 100): ActionHistoryRecord[] {
    const db = this.db.get();
    const rows = db
      .prepare(
        "SELECT * FROM action_history WHERE device_id = ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(deviceId, limit) as any[];

    return rows.map((row) => ({
      ...row,
      success: Boolean(row.success),
      is_undone: Boolean(row.is_undone),
    }));
  }

  /**
   * Get undoable actions for a device (successful uninstalls/disables that haven't been undone).
   */
  getUndoable(deviceId: string): ActionHistoryRecord[] {
    const db = this.db.get();
    const rows = db
      .prepare(
        `
        SELECT * FROM action_history
        WHERE device_id = ?
          AND success = 1
          AND is_undone = 0
          AND action IN ('UNINSTALL', 'DISABLE')
        ORDER BY created_at DESC
      `,
      )
      .all(deviceId) as any[];

    return rows.map((row) => ({
      ...row,
      success: Boolean(row.success),
      is_undone: Boolean(row.is_undone),
    }));
  }

  /**
   * Mark an action as undone.
   */
  markUndone(id: string): boolean {
    const db = this.db.get();
    const result = db
      .prepare("UPDATE action_history SET is_undone = 1 WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  /**
   * Get history statistics.
   */
  getStats(): HistoryStats {
    const db = this.db.get();

    const stats = db
      .prepare(
        `
        SELECT
          COUNT(*) as total_actions,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_actions,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed_actions,
          SUM(CASE WHEN action = 'UNINSTALL' THEN 1 ELSE 0 END) as uninstall_count,
          SUM(CASE WHEN action = 'RESTORE' THEN 1 ELSE 0 END) as restore_count,
          SUM(CASE WHEN action = 'DISABLE' THEN 1 ELSE 0 END) as disable_count,
          SUM(CASE WHEN action = 'ENABLE' THEN 1 ELSE 0 END) as enable_count,
          COUNT(DISTINCT device_id) as devices_count,
          COUNT(DISTINCT package_name) as packages_count
        FROM action_history
      `,
      )
      .get() as any;

    return {
      total_actions: stats.total_actions || 0,
      successful_actions: stats.successful_actions || 0,
      failed_actions: stats.failed_actions || 0,
      uninstall_count: stats.uninstall_count || 0,
      restore_count: stats.restore_count || 0,
      disable_count: stats.disable_count || 0,
      enable_count: stats.enable_count || 0,
      devices_count: stats.devices_count || 0,
      packages_count: stats.packages_count || 0,
    };
  }

  /**
   * Delete old history records (keep last N days).
   */
  cleanupOld(daysToKeep = 90): number {
    const db = this.db.get();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = db
      .prepare("DELETE FROM action_history WHERE created_at < ?")
      .run(cutoffDate.toISOString());

    return result.changes;
  }

  /**
   * Delete specific history rows by IDs.
   */
  deleteByIds(ids: string[]): number {
    if (ids.length === 0) return 0;

    const db = this.db.get();
    const placeholders = ids.map(() => "?").join(",");
    const result = db
      .prepare(`DELETE FROM action_history WHERE id IN (${placeholders})`)
      .run(...ids);

    return result.changes;
  }

  /**
   * Clear history for all devices or one specific device.
   */
  clear(deviceId?: string): number {
    const db = this.db.get();

    if (deviceId) {
      const result = db
        .prepare("DELETE FROM action_history WHERE device_id = ?")
        .run(deviceId);
      return result.changes;
    }

    const result = db.prepare("DELETE FROM action_history").run();
    return result.changes;
  }
}

// ─── Backward-compat lazy singleton ──────────────────────────────────────────

let _defaultInstance: HistoryService | null = null;

function _getDefault(): HistoryService {
  if (!_defaultInstance) {
    _defaultInstance = new HistoryService(DatabaseManager.getInstance());
  }
  return _defaultInstance;
}

// ─── Backward-compat named exports ───────────────────────────────────────────

/**
 * Create a new action history record.
 * @deprecated Prefer `new HistoryService(db).createRecord(input)` or `ServiceContainer`.
 */
export function createHistoryRecord(
  input: CreateHistoryInput,
): ActionHistoryRecord {
  return _getDefault().createRecord(input);
}

/**
 * Get a history record by ID.
 * @deprecated Prefer `new HistoryService(db).getById(id)` or `ServiceContainer`.
 */
export function getHistoryById(id: string): ActionHistoryRecord | null {
  return _getDefault().getById(id);
}

/**
 * Get all action history records.
 * @deprecated Prefer `new HistoryService(db).getAll(limit)` or `ServiceContainer`.
 */
export function getAllHistory(limit = 100): ActionHistoryRecord[] {
  return _getDefault().getAll(limit);
}

/**
 * Get history for a specific device.
 * @deprecated Prefer `new HistoryService(db).getForDevice(deviceId, limit)` or `ServiceContainer`.
 */
export function getDeviceHistory(
  deviceId: string,
  limit = 100,
): ActionHistoryRecord[] {
  return _getDefault().getForDevice(deviceId, limit);
}

/**
 * Get undoable actions for a device.
 * @deprecated Prefer `new HistoryService(db).getUndoable(deviceId)` or `ServiceContainer`.
 */
export function getUndoableActions(deviceId: string): ActionHistoryRecord[] {
  return _getDefault().getUndoable(deviceId);
}

/**
 * Mark an action as undone.
 * @deprecated Prefer `new HistoryService(db).markUndone(id)` or `ServiceContainer`.
 */
export function markActionUndone(id: string): boolean {
  return _getDefault().markUndone(id);
}

/**
 * Get history statistics.
 * @deprecated Prefer `new HistoryService(db).getStats()` or `ServiceContainer`.
 */
export function getHistoryStats(): HistoryStats {
  return _getDefault().getStats();
}

/**
 * Delete old history records (keep last N days).
 * @deprecated Prefer `new HistoryService(db).cleanupOld(daysToKeep)` or `ServiceContainer`.
 */
export function cleanupOldHistory(daysToKeep = 90): number {
  return _getDefault().cleanupOld(daysToKeep);
}

/**
 * Delete specific history rows by IDs.
 * @deprecated Prefer `new HistoryService(db).deleteByIds(ids)` or `ServiceContainer`.
 */
export function deleteHistoryByIds(ids: string[]): number {
  return _getDefault().deleteByIds(ids);
}

/**
 * Clear history for all devices or one specific device.
 * @deprecated Prefer `new HistoryService(db).clear(deviceId)` or `ServiceContainer`.
 */
export function clearHistory(deviceId?: string): number {
  return _getDefault().clear(deviceId);
}
