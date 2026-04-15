/**
 * Settings Service - Local SQLite-based settings storage
 */
import { DatabaseManager, Setting } from "../database";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SettingKey =
  | "show_system_apps"
  | "confirm_actions"
  | "backup_before_action"
  | "theme"
  | "default_user"
  | "adb_path"
  | "telemetry_opt_in"
  | "telemetry_salt";

// ─── Class ────────────────────────────────────────────────────────────────────

export class SettingsService {
  constructor(private readonly db: DatabaseManager) {}

  /**
   * Get a setting value by key. Returns null if not set.
   */
  get(key: SettingKey): string | null {
    const db = this.db.get();
    const row = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  /**
   * Get a setting value, falling back to the provided default if not set.
   */
  getWithDefault(key: SettingKey, defaultValue: string): string {
    return this.get(key) ?? defaultValue;
  }

  /**
   * Get a boolean setting value.
   */
  getBoolean(key: SettingKey, defaultValue = false): boolean {
    const value = this.get(key);
    if (value === null) return defaultValue;
    return value === "true" || value === "1";
  }

  /**
   * Set a setting value.
   */
  set(key: SettingKey, value: string): void {
    const db = this.db.get();
    db.prepare(
      `
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
    `,
    ).run(key, value, value);
  }

  /**
   * Set a boolean setting value.
   */
  setBoolean(key: SettingKey, value: boolean): void {
    this.set(key, value ? "true" : "false");
  }

  /**
   * Get all settings as a key-value record.
   */
  getAll(): Record<string, string> {
    const db = this.db.get();
    const rows = db
      .prepare("SELECT key, value FROM settings")
      .all() as Setting[];

    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    return settings;
  }

  /**
   * Delete a setting by key. Returns true if a row was deleted.
   */
  delete(key: SettingKey): boolean {
    const db = this.db.get();
    const result = db.prepare("DELETE FROM settings WHERE key = ?").run(key);
    return result.changes > 0;
  }

  /**
   * Reset all settings to their default values.
   */
  reset(): void {
    const db = this.db.get();
    db.exec(`
      DELETE FROM settings;
      INSERT INTO settings (key, value) VALUES ('show_system_apps', 'true');
      INSERT INTO settings (key, value) VALUES ('confirm_actions', 'true');
      INSERT INTO settings (key, value) VALUES ('backup_before_action', 'false');
      INSERT INTO settings (key, value) VALUES ('theme', 'dark');
      INSERT INTO settings (key, value) VALUES ('telemetry_opt_in', 'false');
      INSERT INTO settings (key, value) VALUES ('telemetry_salt', '');
    `);
  }
}

// ─── Lazy singleton for backward-compat delegates ─────────────────────────────

let _defaultInstance: SettingsService | null = null;

function _getDefault(): SettingsService {
  if (!_defaultInstance) {
    _defaultInstance = new SettingsService(DatabaseManager.getInstance());
  }
  return _defaultInstance;
}

// ─── Backward-compat named exports ───────────────────────────────────────────

/**
 * Get a setting value.
 * @deprecated Prefer `new SettingsService(db).get(key)` or `ServiceContainer`.
 */
export function getSetting(key: SettingKey): string | null {
  return _getDefault().get(key);
}

/**
 * Get a setting value with a default fallback.
 * @deprecated Prefer `new SettingsService(db).getWithDefault(key, defaultValue)` or `ServiceContainer`.
 */
export function getSettingWithDefault(
  key: SettingKey,
  defaultValue: string,
): string {
  return _getDefault().getWithDefault(key, defaultValue);
}

/**
 * Get a boolean setting.
 * @deprecated Prefer `new SettingsService(db).getBoolean(key, defaultValue)` or `ServiceContainer`.
 */
export function getBooleanSetting(
  key: SettingKey,
  defaultValue = false,
): boolean {
  return _getDefault().getBoolean(key, defaultValue);
}

/**
 * Set a setting value.
 * @deprecated Prefer `new SettingsService(db).set(key, value)` or `ServiceContainer`.
 */
export function setSetting(key: SettingKey, value: string): void {
  _getDefault().set(key, value);
}

/**
 * Set a boolean setting.
 * @deprecated Prefer `new SettingsService(db).setBoolean(key, value)` or `ServiceContainer`.
 */
export function setBooleanSetting(key: SettingKey, value: boolean): void {
  _getDefault().setBoolean(key, value);
}

/**
 * Get all settings as a key-value record.
 * @deprecated Prefer `new SettingsService(db).getAll()` or `ServiceContainer`.
 */
export function getAllSettings(): Record<string, string> {
  return _getDefault().getAll();
}

/**
 * Delete a setting by key.
 * @deprecated Prefer `new SettingsService(db).delete(key)` or `ServiceContainer`.
 */
export function deleteSetting(key: SettingKey): boolean {
  return _getDefault().delete(key);
}

/**
 * Reset all settings to defaults.
 * @deprecated Prefer `new SettingsService(db).reset()` or `ServiceContainer`.
 */
export function resetSettings(): void {
  _getDefault().reset();
}
