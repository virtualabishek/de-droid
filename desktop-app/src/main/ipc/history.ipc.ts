/**
 * History IPC Handlers - Fully Local SQLite Implementation
 */
import { ipcMain } from "electron";
import { ServiceContainer } from "../services/ServiceContainer";

const HISTORY_IPC_CHANNELS = [
  "history:get-all",
  "history:clear",
  "history:delete-selected",
  "history:get-stats",
  "history:get-device",
  "history:get-undoable",
  "history:create",
  "history:mark-undone",
  "telemetry:get-summary",
  "telemetry:get-retraining-signals",
  "backups:get-all",
  "backups:clear",
  "backups:get",
  "backups:get-device",
  "backups:create",
  "backups:update-name",
  "backups:delete",
  "settings:get-all",
  "settings:get",
  "settings:set",
  "settings:reset",
] as const;

function clearHistoryHandlers(): void {
  for (const channel of HISTORY_IPC_CHANNELS) {
    ipcMain.removeHandler(channel);
  }
}

export class HistoryIpcRegistrar {
  private static _instance: HistoryIpcRegistrar | null = null;
  private _registered = false;

  private constructor() {}

  static getInstance(): HistoryIpcRegistrar {
    if (!HistoryIpcRegistrar._instance) {
      HistoryIpcRegistrar._instance = new HistoryIpcRegistrar();
    }
    return HistoryIpcRegistrar._instance;
  }

  registerHandlers(): void {
    if (this._registered) {
      return;
    }

    clearHistoryHandlers();
    const services = ServiceContainer.getInstance();

  // Get action history
  ipcMain.handle("history:get-all", async (_, limit?: number) => {
    try {
      return services.history.getAll(limit || 100);
    } catch (error) {
      console.error("Failed to get history:", error);
      throw error;
    }
  });

  ipcMain.handle("history:clear", async (_, deviceId?: string) => {
    try {
      const deleted = services.history.clear(deviceId);
      return { success: true, deleted };
    } catch (error) {
      console.error("Failed to clear history:", error);
      throw error;
    }
  });

  ipcMain.handle("history:delete-selected", async (_, ids: string[]) => {
    try {
      const safeIds = Array.isArray(ids)
        ? ids.filter((id) => typeof id === "string" && id.trim().length > 0)
        : [];
      const deleted = services.history.deleteByIds(safeIds);
      return { success: true, deleted };
    } catch (error) {
      console.error("Failed to delete selected history rows:", error);
      throw error;
    }
  });

  // Get action stats
  ipcMain.handle("history:get-stats", async () => {
    try {
      return services.history.getStats();
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
        return services.history.getForDevice(deviceId, limit || 100);
      } catch (error) {
        console.error("Failed to get device history:", error);
        throw error;
      }
    },
  );

  // Get undoable actions for a device
  ipcMain.handle("history:get-undoable", async (_, deviceId: string) => {
    try {
      return services.history.getUndoable(deviceId);
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
        return services.history.createRecord({
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
      const success = services.history.markUndone(actionId);

      if (success) {
        const action = services.history.getById(actionId);
        if (action) {
          services.telemetry.recordActionOutcome({
            deviceId: action.device_id,
            deviceBrand: action.device_brand || undefined,
            deviceModel: action.device_model || undefined,
            packageName: action.package_name,
            action: "UNDO",
            success: true,
          });

          services.modelFeedback.uploadActionFeedback({
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
      return services.telemetry.getSummary(days || 30);
    } catch (error) {
      console.error("Failed to get telemetry summary:", error);
      throw error;
    }
  });

  ipcMain.handle("telemetry:get-retraining-signals", async (_, days?: number) => {
    try {
      return services.telemetry.getRetrainingSignals(days || 30);
    } catch (error) {
      console.error("Failed to get telemetry retraining signals:", error);
      throw error;
    }
  });

  // ============ SAVED BACKUPS HANDLERS (LOCAL SQLITE) ============

  // Get all saved backups
  ipcMain.handle("backups:get-all", async () => {
    try {
      return services.backup.getAll();
    } catch (error) {
      console.error("Failed to get backups:", error);
      throw error;
    }
  });

  ipcMain.handle("backups:clear", async (_, deviceId?: string) => {
    try {
      const deleted = services.backup.clear(deviceId);
      return { success: true, deleted };
    } catch (error) {
      console.error("Failed to clear backups:", error);
      throw error;
    }
  });

  // Get a specific backup
  ipcMain.handle("backups:get", async (_, id: string) => {
    try {
      return services.backup.getById(id);
    } catch (error) {
      console.error("Failed to get backup:", error);
      throw error;
    }
  });

  // Get device backups
  ipcMain.handle("backups:get-device", async (_, deviceId: string) => {
    try {
      return services.backup.getForDevice(deviceId);
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
        return services.backup.create({
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
      return services.backup.updateName(id, name);
    } catch (error) {
      console.error("Failed to update backup name:", error);
      throw error;
    }
  });

  // Delete a backup
  ipcMain.handle("backups:delete", async (_, id: string) => {
    try {
      return services.backup.delete(id);
    } catch (error) {
      console.error("Failed to delete backup:", error);
      throw error;
    }
  });

  // ============ SETTINGS HANDLERS (LOCAL SQLITE) ============

  // Get all settings
  ipcMain.handle("settings:get-all", async () => {
    try {
      return services.settings.getAll();
    } catch (error) {
      console.error("Failed to get settings:", error);
      throw error;
    }
  });

  // Get a specific setting
  ipcMain.handle("settings:get", async (_, key: string) => {
    try {
      return services.settings.get(key as any);
    } catch (error) {
      console.error("Failed to get setting:", error);
      throw error;
    }
  });

  // Set a setting
  ipcMain.handle("settings:set", async (_, key: string, value: string) => {
    try {
      services.settings.set(key as any, value);
      return { success: true };
    } catch (error) {
      console.error("Failed to set setting:", error);
      throw error;
    }
  });

  // Reset all settings
  ipcMain.handle("settings:reset", async () => {
    try {
      services.settings.reset();
      return { success: true };
    } catch (error) {
      console.error("Failed to reset settings:", error);
      throw error;
    }
  });
    this._registered = true;
  }

  unregisterHandlers(): void {
    clearHistoryHandlers();
    this._registered = false;
  }
}

export function registerHistoryHandlers() {
  HistoryIpcRegistrar.getInstance().registerHandlers();
}
