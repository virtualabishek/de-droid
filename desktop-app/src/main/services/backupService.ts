/**
 * Backup Service - Local SQLite-based backup storage
 */
import { v4 as uuidv4 } from "uuid";
import { DatabaseManager, SavedBackup } from "../database";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateBackupInput {
  deviceId: string;
  deviceModel?: string;
  deviceBrand?: string;
  name: string;
  packages: Array<{ name: string; state: string }>;
}

// ─── Class ───────────────────────────────────────────────────────────────────

export class BackupService {
  constructor(private readonly db: DatabaseManager) {}

  /**
   * Create a new saved backup
   */
  create(input: CreateBackupInput): SavedBackup {
    const db = this.db.get();
    const id = uuidv4();

    db.prepare(
      `
      INSERT INTO saved_backups (id, device_id, device_model, device_brand, name, packages, total_packages)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      input.deviceId,
      input.deviceModel || null,
      input.deviceBrand || null,
      input.name,
      JSON.stringify(input.packages),
      input.packages.length,
    );

    return this.getById(id)!;
  }

  /**
   * Get a backup by ID
   */
  getById(id: string): SavedBackup | null {
    const db = this.db.get();
    const row = db
      .prepare("SELECT * FROM saved_backups WHERE id = ?")
      .get(id) as any;

    if (!row) return null;

    return {
      ...row,
      packages: JSON.parse(row.packages),
    };
  }

  /**
   * Get all saved backups
   */
  getAll(): SavedBackup[] {
    const db = this.db.get();
    const rows = db
      .prepare("SELECT * FROM saved_backups ORDER BY created_at DESC")
      .all() as any[];

    return rows.map((row) => ({
      ...row,
      packages: JSON.parse(row.packages),
    }));
  }

  /**
   * Get backups for a specific device
   */
  getForDevice(deviceId: string): SavedBackup[] {
    const db = this.db.get();
    const rows = db
      .prepare(
        "SELECT * FROM saved_backups WHERE device_id = ? ORDER BY created_at DESC",
      )
      .all(deviceId) as any[];

    return rows.map((row) => ({
      ...row,
      packages: JSON.parse(row.packages),
    }));
  }

  /**
   * Delete a backup
   */
  delete(id: string): boolean {
    const db = this.db.get();
    const result = db.prepare("DELETE FROM saved_backups WHERE id = ?").run(id);
    return result.changes > 0;
  }

  /**
   * Update a backup's name
   */
  updateName(id: string, name: string): SavedBackup | null {
    const db = this.db.get();
    const result = db
      .prepare("UPDATE saved_backups SET name = ? WHERE id = ?")
      .run(name, id);

    if (result.changes === 0) return null;

    return this.getById(id);
  }

  /**
   * Clear backups for all devices or one specific device
   */
  clear(deviceId?: string): number {
    const db = this.db.get();

    if (deviceId) {
      const result = db
        .prepare("DELETE FROM saved_backups WHERE device_id = ?")
        .run(deviceId);
      return result.changes;
    }

    const result = db.prepare("DELETE FROM saved_backups").run();
    return result.changes;
  }

  /**
   * Compare a backup with current package states
   */
  compare(
    backupPackages: Array<{ name: string; state: string }>,
    currentPackages: Array<{ name: string; state: string }>,
  ): {
    missing_packages: string[];
    new_packages: string[];
    state_changes: Array<{
      name: string;
      backup_state: string;
      current_state: string;
    }>;
    unchanged: number;
  } {
    const backupMap = new Map(backupPackages.map((p) => [p.name, p.state]));
    const currentMap = new Map(currentPackages.map((p) => [p.name, p.state]));

    const missingPackages: string[] = [];
    const newPackages: string[] = [];
    const stateChanges: Array<{
      name: string;
      backup_state: string;
      current_state: string;
    }> = [];
    let unchanged = 0;

    // Check for missing and state changes
    for (const [name, backupState] of backupMap) {
      const currentState = currentMap.get(name);
      if (!currentState) {
        missingPackages.push(name);
      } else if (currentState !== backupState) {
        stateChanges.push({
          name,
          backup_state: backupState,
          current_state: currentState,
        });
      } else {
        unchanged++;
      }
    }

    // Check for new packages
    for (const name of currentMap.keys()) {
      if (!backupMap.has(name)) {
        newPackages.push(name);
      }
    }

    return {
      missing_packages: missingPackages,
      new_packages: newPackages,
      state_changes: stateChanges,
      unchanged,
    };
  }
}

// ─── Lazy singleton for backward-compat delegates ─────────────────────────────

let _defaultInstance: BackupService | null = null;

function _getDefault(): BackupService {
  if (!_defaultInstance) {
    _defaultInstance = new BackupService(DatabaseManager.getInstance());
  }
  return _defaultInstance;
}

// ─── Backward-compat named exports ───────────────────────────────────────────

/**
 * Create a new saved backup
 */
export function createBackup(input: CreateBackupInput): SavedBackup {
  return _getDefault().create(input);
}

/**
 * Get a backup by ID
 */
export function getBackupById(id: string): SavedBackup | null {
  return _getDefault().getById(id);
}

/**
 * Get all saved backups
 */
export function getAllBackups(): SavedBackup[] {
  return _getDefault().getAll();
}

/**
 * Get backups for a specific device
 */
export function getDeviceBackups(deviceId: string): SavedBackup[] {
  return _getDefault().getForDevice(deviceId);
}

/**
 * Delete a backup
 */
export function deleteBackup(id: string): boolean {
  return _getDefault().delete(id);
}

/**
 * Update a backup's name
 */
export function updateBackupName(id: string, name: string): SavedBackup | null {
  return _getDefault().updateName(id, name);
}

/**
 * Clear backups for all devices or one specific device
 */
export function clearBackups(deviceId?: string): number {
  return _getDefault().clear(deviceId);
}

/**
 * Compare a backup with current package states
 */
export function compareBackupWithCurrent(
  backupPackages: Array<{ name: string; state: string }>,
  currentPackages: Array<{ name: string; state: string }>,
): {
  missing_packages: string[];
  new_packages: string[];
  state_changes: Array<{
    name: string;
    backup_state: string;
    current_state: string;
  }>;
  unchanged: number;
} {
  return _getDefault().compare(backupPackages, currentPackages);
}
