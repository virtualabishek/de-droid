/**
 * Settings Service - Local SQLite-based settings storage
 */
import { getDatabase, Setting } from "../database";

export type SettingKey =
  | "show_system_apps"
  | "confirm_actions"
  | "backup_before_action"
  | "theme"
  | "default_user"
  | "adb_path";

/**
 * Get a setting value
 */
export function getSetting(key: SettingKey): string | null {
  const db = getDatabase();
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/**
 * Get a setting value with a default
 */
export function getSettingWithDefault(
  key: SettingKey,
  defaultValue: string,
): string {
  return getSetting(key) ?? defaultValue;
}

/**
 * Get a boolean setting
 */
export function getBooleanSetting(
  key: SettingKey,
  defaultValue = false,
): boolean {
  const value = getSetting(key);
  if (value === null) return defaultValue;
  return value === "true" || value === "1";
}

/**
 * Set a setting value
 */
export function setSetting(key: SettingKey, value: string): void {
  const db = getDatabase();
  db.prepare(
    `
    INSERT INTO settings (key, value, updated_at) 
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
  `,
  ).run(key, value, value);
}

/**
 * Set a boolean setting
 */
export function setBooleanSetting(key: SettingKey, value: boolean): void {
  setSetting(key, value ? "true" : "false");
}

/**
 * Get all settings
 */
export function getAllSettings(): Record<string, string> {
  const db = getDatabase();
  const rows = db.prepare("SELECT key, value FROM settings").all() as Setting[];

  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

/**
 * Delete a setting
 */
export function deleteSetting(key: SettingKey): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  return result.changes > 0;
}

/**
 * Reset all settings to defaults
 */
export function resetSettings(): void {
  const db = getDatabase();
  db.exec(`
    DELETE FROM settings;
    INSERT INTO settings (key, value) VALUES ('show_system_apps', 'true');
    INSERT INTO settings (key, value) VALUES ('confirm_actions', 'true');
    INSERT INTO settings (key, value) VALUES ('backup_before_action', 'false');
    INSERT INTO settings (key, value) VALUES ('theme', 'dark');
  `);
}
