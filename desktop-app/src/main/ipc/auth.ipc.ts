import { ipcMain } from "electron";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { getDatabase } from "../database/index.js";

interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  isVerified: boolean;
}

function toPublicUser(row: any): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name ?? null,
    isVerified: Boolean(row.is_verified),
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashPassword(password: string, salt?: string): string {
  const useSalt = salt ?? randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(`${useSalt}:${password}`).digest("hex");
  return `sha256$${useSalt}$${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "sha256") {
    return stored === password;
  }

  const [, salt, expected] = parts;
  const computed = createHash("sha256")
    .update(`${salt}:${password}`)
    .digest("hex");

  const expectedBuffer = Buffer.from(expected, "hex");
  const computedBuffer = Buffer.from(computed, "hex");
  if (expectedBuffer.length !== computedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, computedBuffer);
}

function nowIso(): string {
  return new Date().toISOString();
}

export function registerAuthIpcHandlers() {
  const db = getDatabase();

  ipcMain.handle("auth:register", async (_event, email: string, password: string, name?: string) => {
    try {
      const normalizedEmail = normalizeEmail(email);

      if (!normalizedEmail || !password) {
        return { success: false, message: "Email and password are required" };
      }

      if (password.length < 6) {
        return { success: false, message: "Password must be at least 6 characters" };
      }

      const existing = db
        .prepare("SELECT id FROM users WHERE email = ?")
        .get(normalizedEmail) as { id: string } | undefined;

      if (existing) {
        return { success: false, message: "Email already registered" };
      }

      const id = randomBytes(16).toString("hex");
      const passwordHash = hashPassword(password);
      const timestamp = nowIso();

      db.prepare(
        `INSERT INTO users (id, email, password_hash, name, is_verified, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`
      ).run(id, normalizedEmail, passwordHash, name?.trim() || null, timestamp, timestamp);

      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
      return {
        success: true,
        message: "Account created successfully",
        user: toPublicUser(user),
        requiresVerification: false,
      };
    } catch (error) {
      console.error("[Auth IPC] register error:", error);
      return { success: false, message: "Registration failed" };
    }
  });

  ipcMain.handle("auth:login", async (_event, email: string, password: string) => {
    try {
      const normalizedEmail = normalizeEmail(email);
      const user = db
        .prepare("SELECT * FROM users WHERE email = ?")
        .get(normalizedEmail) as any;

      if (!user) {
        return { success: false, message: "Invalid email or password" };
      }

      const ok = verifyPassword(password, user.password_hash);
      if (!ok) {
        return { success: false, message: "Invalid email or password" };
      }

      return {
        success: true,
        message: "Login successful",
        user: toPublicUser(user),
        requiresVerification: false,
      };
    } catch (error) {
      console.error("[Auth IPC] login error:", error);
      return { success: false, message: "Login failed" };
    }
  });

  ipcMain.handle("auth:verifyEmail", async (_event, email: string) => {
    try {
      const normalizedEmail = normalizeEmail(email);
      const user = db
        .prepare("SELECT * FROM users WHERE email = ?")
        .get(normalizedEmail) as any;

      if (!user) {
        return { success: false, message: "User not found" };
      }

      return {
        success: true,
        message: "Email verification is disabled in local mode",
        user: toPublicUser(user),
        requiresVerification: false,
      };
    } catch (error) {
      console.error("[Auth IPC] verifyEmail error:", error);
      return { success: false, message: "Verification failed" };
    }
  });

  ipcMain.handle("auth:resendOtp", async () => {
    return {
      success: true,
      message: "OTP is disabled in local mode",
      requiresVerification: false,
    };
  });

  ipcMain.handle("auth:getUser", async (_event, userId: string) => {
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any;
    if (!user) return null;
    return toPublicUser(user);
  });

  ipcMain.handle("auth:updateProfile", async (_event, userId: string, data: { name?: string }) => {
    try {
      db.prepare("UPDATE users SET name = ?, updated_at = ? WHERE id = ?").run(
        data?.name?.trim() || null,
        nowIso(),
        userId
      );

      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any;
      if (!user) return { success: false, message: "User not found" };

      return {
        success: true,
        message: "Profile updated",
        user: toPublicUser(user),
      };
    } catch (error) {
      console.error("[Auth IPC] updateProfile error:", error);
      return { success: false, message: "Failed to update profile" };
    }
  });

  ipcMain.handle("auth:getDevices", async (_event, userId: string) => {
    return db
      .prepare("SELECT * FROM user_devices WHERE user_id = ? ORDER BY created_at DESC")
      .all(userId);
  });

  ipcMain.handle(
    "auth:saveDevice",
    async (
      _event,
      userId: string,
      deviceId: string,
      deviceModel?: string,
      deviceBrand?: string,
      nickname?: string
    ) => {
      const existing = db
        .prepare("SELECT id FROM user_devices WHERE user_id = ? AND device_id = ?")
        .get(userId, deviceId) as { id: string } | undefined;

      if (existing) {
        db.prepare(
          `UPDATE user_devices
           SET device_model = ?, device_brand = ?, nickname = ?, last_connected_at = ?
           WHERE id = ?`
        ).run(deviceModel || null, deviceBrand || null, nickname || null, nowIso(), existing.id);
      } else {
        db.prepare(
          `INSERT INTO user_devices
           (id, user_id, device_id, device_model, device_brand, nickname, last_connected_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          randomBytes(16).toString("hex"),
          userId,
          deviceId,
          deviceModel || null,
          deviceBrand || null,
          nickname || null,
          nowIso(),
          nowIso()
        );
      }

      return db
        .prepare("SELECT * FROM user_devices WHERE user_id = ? AND device_id = ?")
        .get(userId, deviceId);
    }
  );

  ipcMain.handle("auth:removeDevice", async (_event, userId: string, deviceId: string) => {
    const result = db
      .prepare("DELETE FROM user_devices WHERE user_id = ? AND device_id = ?")
      .run(userId, deviceId);
    return result.changes > 0;
  });

  ipcMain.handle(
    "auth:updateDeviceNickname",
    async (_event, userId: string, deviceId: string, nickname: string) => {
      const result = db
        .prepare("UPDATE user_devices SET nickname = ? WHERE user_id = ? AND device_id = ?")
        .run(nickname, userId, deviceId);
      return result.changes > 0;
    }
  );

  ipcMain.handle("auth:getSetting", async (_event, userId: string, key: string) => {
    const row = db
      .prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = ?")
      .get(userId, key) as { value: string } | undefined;
    return row?.value ?? null;
  });

  ipcMain.handle("auth:getAllSettings", async (_event, userId: string) => {
    const rows = db
      .prepare("SELECT key, value FROM user_settings WHERE user_id = ?")
      .all(userId) as Array<{ key: string; value: string }>;

    return rows.reduce<Record<string, string>>((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});
  });

  ipcMain.handle("auth:setSetting", async (_event, userId: string, key: string, value: string) => {
    const existing = db
      .prepare("SELECT id FROM user_settings WHERE user_id = ? AND key = ?")
      .get(userId, key) as { id: string } | undefined;

    if (existing) {
      db.prepare("UPDATE user_settings SET value = ?, updated_at = ? WHERE id = ?").run(
        value,
        nowIso(),
        existing.id
      );
    } else {
      db.prepare(
        `INSERT INTO user_settings (id, user_id, key, value, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(randomBytes(16).toString("hex"), userId, key, value, nowIso());
    }

    return true;
  });

  console.log("[Auth IPC] Handlers registered");
}
