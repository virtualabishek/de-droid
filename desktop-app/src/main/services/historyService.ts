/**
 * History Service - Local SQLite-based action history
 */
import { v4 as uuidv4 } from "uuid";
import { getDatabase, ActionHistoryRecord } from "../database";

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

/**
 * Create a new action history record
 */
export function createHistoryRecord(
  input: CreateHistoryInput,
): ActionHistoryRecord {
  const db = getDatabase();
  const id = uuidv4();

  const stmt = db.prepare(`
    INSERT INTO action_history (id, device_id, device_model, device_brand, package_name, action, android_user, success, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
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

  return getHistoryById(id)!;
}

/**
 * Get a history record by ID
 */
export function getHistoryById(id: string): ActionHistoryRecord | null {
  const db = getDatabase();
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
 * Get all action history records
 */
export function getAllHistory(limit = 100): ActionHistoryRecord[] {
  const db = getDatabase();
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
 * Get history for a specific device
 */
export function getDeviceHistory(
  deviceId: string,
  limit = 100,
): ActionHistoryRecord[] {
  const db = getDatabase();
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
 * Get undoable actions for a device (successful uninstalls/disables that haven't been undone)
 */
export function getUndoableActions(deviceId: string): ActionHistoryRecord[] {
  const db = getDatabase();
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
 * Mark an action as undone
 */
export function markActionUndone(id: string): boolean {
  const db = getDatabase();
  const result = db
    .prepare("UPDATE action_history SET is_undone = 1 WHERE id = ?")
    .run(id);
  return result.changes > 0;
}

/**
 * Get history statistics
 */
export function getHistoryStats(): HistoryStats {
  const db = getDatabase();

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
 * Delete old history records (keep last N days)
 */
export function cleanupOldHistory(daysToKeep = 90): number {
  const db = getDatabase();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

  const result = db
    .prepare("DELETE FROM action_history WHERE created_at < ?")
    .run(cutoffDate.toISOString());

  return result.changes;
}
