/**
 * Auth IPC Handlers
 * Handle authentication-related IPC calls
 */
import { ipcMain } from "electron";
import { ServiceContainer } from "../services/ServiceContainer";

const AUTH_IPC_CHANNELS = [
  "auth:register",
  "auth:login",
  "auth:get-user",
  "auth:update-profile",
  "auth:get-devices",
  "auth:save-device",
  "auth:remove-device",
  "auth:update-device-nickname",
  "auth:get-setting",
  "auth:get-all-settings",
  "auth:set-setting",
] as const;

function clearAuthHandlers(): void {
  for (const channel of AUTH_IPC_CHANNELS) {
    ipcMain.removeHandler(channel);
  }
}

export class AuthIpcRegistrar {
  private static _instance: AuthIpcRegistrar | null = null;
  private _registered = false;

  private constructor() {}

  static getInstance(): AuthIpcRegistrar {
    if (!AuthIpcRegistrar._instance) {
      AuthIpcRegistrar._instance = new AuthIpcRegistrar();
    }
    return AuthIpcRegistrar._instance;
  }

  registerHandlers(): void {
    if (this._registered) {
      return;
    }

    clearAuthHandlers();
    const services = ServiceContainer.getInstance();

  // Register user
  ipcMain.handle(
    "auth:register",
    async (_event, email: string, password: string, name?: string) => {
      try {
        return services.auth.register(email, password, name);
      } catch (error) {
        console.error("[AUTH IPC] Register error:", error);
        return {
          success: false,
          message:
            error instanceof Error ? error.message : "Registration failed",
        };
      }
    },
  );

  // Login user
  ipcMain.handle(
    "auth:login",
    async (_event, email: string, password: string) => {
      try {
        return services.auth.login(email, password);
      } catch (error) {
        console.error("[AUTH IPC] Login error:", error);
        return {
          success: false,
          message: error instanceof Error ? error.message : "Login failed",
        };
      }
    },
  );

  // Get user by ID
  ipcMain.handle("auth:get-user", async (_event, userId: string) => {
    try {
      return services.auth.getUserById(userId);
    } catch (error) {
      console.error("[AUTH IPC] Get user error:", error);
      return null;
    }
  });

  // Update user profile
  ipcMain.handle(
    "auth:update-profile",
    async (_event, userId: string, data: { name?: string }) => {
      try {
        return services.auth.updateProfile(userId, data);
      } catch (error) {
        console.error("[AUTH IPC] Update profile error:", error);
        return {
          success: false,
          message: error instanceof Error ? error.message : "Update failed",
        };
      }
    },
  );

  // Get user devices
  ipcMain.handle("auth:get-devices", async (_event, userId: string) => {
    try {
      return services.auth.getDevices(userId);
    } catch (error) {
      console.error("[AUTH IPC] Get devices error:", error);
      return [];
    }
  });

  // Save user device
  ipcMain.handle(
    "auth:save-device",
    async (
      _event,
      userId: string,
      deviceId: string,
      deviceModel?: string,
      deviceBrand?: string,
      nickname?: string,
    ) => {
      try {
        return services.auth.saveDevice(
          userId,
          deviceId,
          deviceModel,
          deviceBrand,
          nickname,
        );
      } catch (error) {
        console.error("[AUTH IPC] Save device error:", error);
        return null;
      }
    },
  );

  // Remove user device
  ipcMain.handle(
    "auth:remove-device",
    async (_event, userId: string, deviceId: string) => {
      try {
        return services.auth.removeDevice(userId, deviceId);
      } catch (error) {
        console.error("[AUTH IPC] Remove device error:", error);
        return false;
      }
    },
  );

  // Update device nickname
  ipcMain.handle(
    "auth:update-device-nickname",
    async (_event, userId: string, deviceId: string, nickname: string) => {
      try {
        return services.auth.updateDeviceNickname(userId, deviceId, nickname);
      } catch (error) {
        console.error("[AUTH IPC] Update nickname error:", error);
        return false;
      }
    },
  );

  // Get user setting
  ipcMain.handle(
    "auth:get-setting",
    async (_event, userId: string, key: string) => {
      try {
        return services.auth.getUserSetting(userId, key);
      } catch (error) {
        console.error("[AUTH IPC] Get setting error:", error);
        return null;
      }
    },
  );

  // Get all user settings
  ipcMain.handle("auth:get-all-settings", async (_event, userId: string) => {
    try {
      return services.auth.getAllUserSettings(userId);
    } catch (error) {
      console.error("[AUTH IPC] Get all settings error:", error);
      return {};
    }
  });

  // Set user setting
  ipcMain.handle(
    "auth:set-setting",
    async (_event, userId: string, key: string, value: string) => {
      try {
        services.auth.setUserSetting(userId, key, value);
        return true;
      } catch (error) {
        console.error("[AUTH IPC] Set setting error:", error);
        return false;
      }
    },
  );

  console.log("[AUTH IPC] Auth handlers registered");
    this._registered = true;
  }

  unregisterHandlers(): void {
    clearAuthHandlers();
    this._registered = false;
  }
}

export function registerAuthHandlers(): void {
  AuthIpcRegistrar.getInstance().registerHandlers();
}
