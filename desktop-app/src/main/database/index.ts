/**
 * SQLite Database Module for De-Droid
 * Local-first data storage for action history, backups, and settings
 */
import Database from "better-sqlite3";
import { app } from "electron";
import * as path from "path";
import * as fs from "fs";

// ─────────────────────────────────────────────────────────────────────────────
// DatabaseManager — singleton class
// ─────────────────────────────────────────────────────────────────────────────

export class DatabaseManager {
  private static _instance: DatabaseManager | null = null;
  private _db: Database.Database | null = null;

  private constructor() {}

  static getInstance(): DatabaseManager {
    if (!DatabaseManager._instance) {
      DatabaseManager._instance = new DatabaseManager();
    }
    return DatabaseManager._instance;
  }

  /** Initialise the database (idempotent — safe to call multiple times). */
  init(): void {
    if (this._db) return;

    const dbPath = this.getDatabasePath();
    console.log("[DB] Initializing database at:", dbPath);

    // Ensure the directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this._db = new Database(dbPath);

    // Enable WAL for better performance
    this._db.pragma("journal_mode = WAL");
    this.migrate(this._db);
    console.log("[DB] Database initialized successfully");
  }

  /** Return the live Database instance, initialising if necessary. */
  get(): Database.Database {
    if (!this._db) {
      this.init();
    }
    return this._db!;
  }

  /** Close the database connection and release the handle. */
  close(): void {
    if (this._db) {
      this._db.close();
      this._db = null;
      console.log("[DB] Database closed");
    }
  }

  // ── private helpers ────────────────────────────────────────────────────────

  private getDatabasePath(): string {
    const userDataPath = app.getPath("userData");
    return path.join(userDataPath, "dedroid.db");
  }

  private migrate(db: Database.Database): void {
    // Create migrations table if it doesn't exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const migrations: { name: string; sql: string }[] = [
      {
        name: "001_create_action_history",
        sql: `
          CREATE TABLE IF NOT EXISTS action_history (
            id TEXT PRIMARY KEY,
            device_id TEXT NOT NULL,
            device_model TEXT,
            device_brand TEXT,
            package_name TEXT NOT NULL,
            action TEXT NOT NULL CHECK (action IN ('UNINSTALL', 'DISABLE', 'RESTORE', 'ENABLE')),
            android_user INTEGER DEFAULT 0,
            success INTEGER NOT NULL DEFAULT 1,
            error_message TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            is_undone INTEGER DEFAULT 0
          );
          CREATE INDEX IF NOT EXISTS idx_history_device ON action_history(device_id);
          CREATE INDEX IF NOT EXISTS idx_history_package ON action_history(package_name);
          CREATE INDEX IF NOT EXISTS idx_history_created ON action_history(created_at DESC);
        `,
      },
      {
        name: "002_create_saved_backups",
        sql: `
          CREATE TABLE IF NOT EXISTS saved_backups (
            id TEXT PRIMARY KEY,
            device_id TEXT NOT NULL,
            device_model TEXT,
            device_brand TEXT,
            name TEXT NOT NULL,
            packages TEXT NOT NULL,
            total_packages INTEGER NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_backups_device ON saved_backups(device_id);
          CREATE INDEX IF NOT EXISTS idx_backups_created ON saved_backups(created_at DESC);
        `,
      },
      {
        name: "003_create_settings",
        sql: `
          CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
          );
          -- Insert default settings
          INSERT OR IGNORE INTO settings (key, value) VALUES ('show_system_apps', 'true');
          INSERT OR IGNORE INTO settings (key, value) VALUES ('confirm_actions', 'true');
          INSERT OR IGNORE INTO settings (key, value) VALUES ('backup_before_action', 'false');
          INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', 'dark');
          INSERT OR IGNORE INTO settings (key, value) VALUES ('telemetry_opt_in', 'false');
          INSERT OR IGNORE INTO settings (key, value) VALUES ('telemetry_salt', '');
        `,
      },
      {
        name: "004_create_package_notes",
        sql: `
          CREATE TABLE IF NOT EXISTS package_notes (
            id TEXT PRIMARY KEY,
            package_name TEXT NOT NULL UNIQUE,
            note TEXT,
            is_favorite INTEGER DEFAULT 0,
            custom_category TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_notes_package ON package_notes(package_name);
        `,
      },
      {
        name: "005_create_users",
        sql: `
          CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            name TEXT,
            is_verified INTEGER DEFAULT 0,
            otp_code TEXT,
            otp_expires_at TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        `,
      },
      {
        name: "006_create_user_devices",
        sql: `
          CREATE TABLE IF NOT EXISTS user_devices (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            device_model TEXT,
            device_brand TEXT,
            nickname TEXT,
            last_connected_at TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(user_id, device_id)
          );
          CREATE INDEX IF NOT EXISTS idx_user_devices_user ON user_devices(user_id);
        `,
      },
      {
        name: "007_create_user_settings",
        sql: `
          CREATE TABLE IF NOT EXISTS user_settings (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(user_id, key)
          );
          CREATE INDEX IF NOT EXISTS idx_user_settings ON user_settings(user_id, key);
        `,
      },
      {
        name: "008_create_telemetry_events",
        sql: `
          CREATE TABLE IF NOT EXISTS telemetry_events (
            id TEXT PRIMARY KEY,
            event_type TEXT NOT NULL,
            action TEXT,
            success INTEGER NOT NULL DEFAULT 1,
            error_bucket TEXT,
            package_hash TEXT,
            device_id_hash TEXT,
            device_brand TEXT,
            device_model TEXT,
            android_sdk INTEGER,
            model_label TEXT,
            model_confidence REAL,
            model_gate_applied INTEGER DEFAULT 0,
            removal_type TEXT,
            category TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_telemetry_created ON telemetry_events(created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_telemetry_action ON telemetry_events(action);
          CREATE INDEX IF NOT EXISTS idx_telemetry_success ON telemetry_events(success);
        `,
      },
      {
        name: "009_add_telemetry_settings_defaults",
        sql: `
          INSERT OR IGNORE INTO settings (key, value) VALUES ('telemetry_opt_in', 'false');
          INSERT OR IGNORE INTO settings (key, value) VALUES ('telemetry_salt', '');
        `,
      },
    ];

    const applied = new Set(
      db
        .prepare("SELECT name FROM migrations")
        .all()
        .map((row: any) => row.name),
    );

    for (const migration of migrations) {
      if (!applied.has(migration.name)) {
        console.log(`[DB] Applying migration: ${migration.name}`);
        db.exec(migration.sql);
        db.prepare("INSERT INTO migrations (name) VALUES (?)").run(
          migration.name,
        );
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Backward-compat function exports — delegate to the singleton
// All callers that used the old module-level functions continue to work.
// ─────────────────────────────────────────────────────────────────────────────

export function initDatabase(): Database.Database {
  DatabaseManager.getInstance().init();
  return DatabaseManager.getInstance().get();
}

export function getDatabase(): Database.Database {
  return DatabaseManager.getInstance().get();
}

export function closeDatabase(): void {
  DatabaseManager.getInstance().close();
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared type / interface exports (unchanged — kept for backward compat)
// ─────────────────────────────────────────────────────────────────────────────

export interface ActionHistoryRecord {
  id: string;
  device_id: string;
  device_model: string | null;
  device_brand: string | null;
  package_name: string;
  action: "UNINSTALL" | "DISABLE" | "RESTORE" | "ENABLE";
  android_user: number;
  success: boolean;
  error_message: string | null;
  created_at: string;
  is_undone: boolean;
}

export interface SavedBackup {
  id: string;
  device_id: string;
  device_model: string | null;
  device_brand: string | null;
  name: string;
  packages: Array<{ name: string; state: string }>;
  total_packages: number;
  created_at: string;
}

export interface Setting {
  key: string;
  value: string;
  updated_at: string;
}

export interface PackageNote {
  id: string;
  package_name: string;
  note: string | null;
  is_favorite: boolean;
  custom_category: string | null;
  updated_at: string;
}

export interface User {
  id: string;
  email: string;
  password_hash: string;
  name: string | null;
  is_verified: boolean;
  otp_code: string | null;
  otp_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserDevice {
  id: string;
  user_id: string;
  device_id: string;
  device_model: string | null;
  device_brand: string | null;
  nickname: string | null;
  last_connected_at: string | null;
  created_at: string;
}

export interface UserSetting {
  id: string;
  user_id: string;
  key: string;
  value: string;
  updated_at: string;
}
