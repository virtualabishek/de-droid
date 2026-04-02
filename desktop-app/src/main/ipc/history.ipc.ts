/**
 * History IPC Handlers - Fully Local SQLite Implementation
 */
import { ipcMain } from "electron";
import * as historyService from "../services/historyService";
import * as backupService from "../services/backupService";
import * as settingsService from "../services/settingsService";
import * as telemetryService from "../services/telemetryService";
import * as modelFeedbackService from "../services/modelFeedbackService";

export function registerHistoryHandlers() {
  // ============ HISTORY HANDLERS (LOCAL SQLITE) ============

  // Get action history
  ipcMain.handle("history:get-all", async (_, limit?: number) => {
    try {
      return historyService.getAllHistory(limit || 100);
    } catch (error) {
      console.error("Failed to get history:", error);
      throw error;
    }
  });

  // Get action stats
  ipcMain.handle("history:get-stats", async () => {
    try {
      return historyService.getHistoryStats();
    } catch (error) {
      console.error("Failed to get history stats:", error);
      throw error;
    }
  });

  // Get device history
  ipcMain.handle(
    "history:get-device",
    async (_, deviceId: string, limit?: number) => {
      try {
        return historyService.getDeviceHistory(deviceId, limit || 100);
      } catch (error) {
        console.error("Failed to get device history:", error);
        throw error;
      }
    },
  );

  // Get undoable actions for a device
  ipcMain.handle("history:get-undoable", async (_, deviceId: string) => {
    try {
      return historyService.getUndoableActions(deviceId);
    } catch (error) {
      console.error("Failed to get undoable actions:", error);
      throw error;
    }
  });

  // Create action record (manually, in case needed)
  ipcMain.handle(
    "history:create",
    async (
      _,
      action: {
        deviceId: string;
        deviceModel?: string;
        deviceBrand?: string;
        packageName: string;
        action: "UNINSTALL" | "DISABLE" | "RESTORE" | "ENABLE";
        androidUser: number;
        success: boolean;
        errorMessage?: string;
      },
    ) => {
      try {
        return historyService.createHistoryRecord({
          deviceId: action.deviceId,
          deviceModel: action.deviceModel,
          deviceBrand: action.deviceBrand,
          packageName: action.packageName,
          action: action.action,
          androidUser: action.androidUser,
          success: action.success,
          errorMessage: action.errorMessage,
        });
      } catch (error) {
        console.error("Failed to create history record:", error);
        throw error;
      }
    },
  );

  // Mark action as undone
  ipcMain.handle("history:mark-undone", async (_, actionId: string) => {
    try {
      const success = historyService.markActionUndone(actionId);

      if (success) {
        const action = historyService.getHistoryById(actionId);
        if (action) {
          telemetryService.recordActionOutcome({
            deviceId: action.device_id,
            deviceBrand: action.device_brand || undefined,
            deviceModel: action.device_model || undefined,
            packageName: action.package_name,
            action: "UNDO",
            success: true,
          });

          modelFeedbackService.uploadActionFeedback({
            packageName: action.package_name,
            action: "UNDO",
            success: true,
            deviceBrand: action.device_brand || undefined,
          });
        }
      }

      return success;
    } catch (error) {
      console.error("Failed to mark action as undone:", error);
      throw error;
    }
  });

  // ============ TELEMETRY HANDLERS (OPT-IN) ============

  ipcMain.handle("telemetry:get-summary", async (_, days?: number) => {
    try {
      return telemetryService.getTelemetrySummary(days || 30);
    } catch (error) {
      console.error("Failed to get telemetry summary:", error);
      throw error;
    }
  });

  ipcMain.handle("telemetry:get-retraining-signals", async (_, days?: number) => {
    try {
      return telemetryService.getRetrainingSignals(days || 30);
    } catch (error) {
      console.error("Failed to get telemetry retraining signals:", error);
      throw error;
    }
  });

  // ============ SAVED BACKUPS HANDLERS (LOCAL SQLITE) ============

  // Get all saved backups
  ipcMain.handle("backups:get-all", async () => {
    try {
      return backupService.getAllBackups();
    } catch (error) {
      console.error("Failed to get backups:", error);
      throw error;
    }
  });

  // Get a specific backup
  ipcMain.handle("backups:get", async (_, id: string) => {
    try {
      return backupService.getBackupById(id);
    } catch (error) {
      console.error("Failed to get backup:", error);
      throw error;
    }
  });

  // Get device backups
  ipcMain.handle("backups:get-device", async (_, deviceId: string) => {
    try {
      return backupService.getDeviceBackups(deviceId);
    } catch (error) {
      console.error("Failed to get device backups:", error);
      throw error;
    }
  });

  // Create/save backup to database
  ipcMain.handle(
    "backups:create",
    async (
      _,
      backup: {
        deviceId: string;
        deviceModel?: string;
        deviceBrand?: string;
        name: string;
        packages: Array<{ name: string; state: string }>;
      },
    ) => {
      try {
        return backupService.createBackup({
          deviceId: backup.deviceId,
          deviceModel: backup.deviceModel,
          deviceBrand: backup.deviceBrand,
          name: backup.name,
          packages: backup.packages,
        });
      } catch (error) {
        console.error("Failed to create backup:", error);
        throw error;
      }
    },
  );

  // Update backup name
  ipcMain.handle("backups:update-name", async (_, id: string, name: string) => {
    try {
      return backupService.updateBackupName(id, name);
    } catch (error) {
      console.error("Failed to update backup name:", error);
      throw error;
    }
  });

  // Delete a backup
  ipcMain.handle("backups:delete", async (_, id: string) => {
    try {
      return backupService.deleteBackup(id);
    } catch (error) {
      console.error("Failed to delete backup:", error);
      throw error;
    }
  });

  // ============ SETTINGS HANDLERS (LOCAL SQLITE) ============

  // Get all settings
  ipcMain.handle("settings:get-all", async () => {
    try {
      return settingsService.getAllSettings();
    } catch (error) {
      console.error("Failed to get settings:", error);
      throw error;
    }
  });

  // Get a specific setting
  ipcMain.handle("settings:get", async (_, key: string) => {
    try {
      return settingsService.getSetting(key as any);
    } catch (error) {
      console.error("Failed to get setting:", error);
      throw error;
    }
  });

  // Set a setting
  ipcMain.handle("settings:set", async (_, key: string, value: string) => {
    try {
      settingsService.setSetting(key as any, value);
      return { success: true };
    } catch (error) {
      console.error("Failed to set setting:", error);
      throw error;
    }
  });

  // Reset all settings
  ipcMain.handle("settings:reset", async () => {
    try {
      settingsService.resetSettings();
      return { success: true };
    } catch (error) {
      console.error("Failed to reset settings:", error);
      throw error;
    }
  });
}
