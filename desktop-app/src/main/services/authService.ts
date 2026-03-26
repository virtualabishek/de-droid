/**
 * Authentication Service
 * Handles local user authentication with SQLite
 */
import { getDatabase, User, UserDevice, UserSetting } from "../database";
import { v4 as uuidv4 } from "uuid";
import * as crypto from "crypto";

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .pbkdf2Sync(password, salt, 10000, 64, "sha512")
    .toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(":");
  const verifyHash = crypto
    .pbkdf2Sync(password, salt, 10000, 64, "sha512")
    .toString("hex");
  return hash === verifyHash;
}

export interface AuthResult {
  success: boolean;
  message: string;
  user?: {
    id: string;
    email: string;
    name: string | null;
    isVerified: boolean;
  };
}

export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  isVerified: boolean;
}

/**
 * Register a new user
 */
export async function registerUser(
  email: string,
  password: string,
  name?: string,
): Promise<AuthResult> {
  const db = getDatabase();

  // Check if email already exists
  const existing = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(email);
  if (existing) {
    return { success: false, message: "Email already registered" };
  }

  // Validate password
  if (password.length < 6) {
    return {
      success: false,
      message: "Password must be at least 6 characters",
    };
  }

  const id = uuidv4();
  const passwordHash = hashPassword(password);

  db.prepare(
    `
    INSERT INTO users (id, email, password_hash, name, is_verified)
    VALUES (?, ?, ?, ?, 1)
  `,
  ).run(id, email.toLowerCase(), passwordHash, name || null);

  return {
    success: true,
    message: "Registration successful",
    user: {
      id,
      email: email.toLowerCase(),
      name: name || null,
      isVerified: true,
    },
  };
}

/**
 * Login user
 */
export async function loginUser(
  email: string,
  password: string,
): Promise<AuthResult> {
  const db = getDatabase();

  const user = db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email.toLowerCase()) as User | undefined;

  if (!user) {
    return { success: false, message: "Invalid email or password" };
  }

  if (!verifyPassword(password, user.password_hash)) {
    return { success: false, message: "Invalid email or password" };
  }

  if (!user.is_verified) {
    db.prepare(
      `
      UPDATE users SET is_verified = 1, otp_code = NULL, otp_expires_at = NULL, updated_at = ?
      WHERE id = ?
    `,
    ).run(new Date().toISOString(), user.id);
  }

  return {
    success: true,
    message: "Login successful",
    user: { id: user.id, email: user.email, name: user.name, isVerified: true },
  };
}

/**
 * Get user by ID
 */
export function getUserById(userId: string): PublicUser | null {
  const db = getDatabase();
  const user = db
    .prepare("SELECT id, email, name, is_verified FROM users WHERE id = ?")
    .get(userId) as any;

  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isVerified: !!user.is_verified,
  };
}

/**
 * Update user profile
 */
export function updateUserProfile(
  userId: string,
  data: { name?: string },
): AuthResult {
  const db = getDatabase();

  const user = getUserById(userId);
  if (!user) {
    return { success: false, message: "User not found" };
  }

  if (data.name !== undefined) {
    db.prepare("UPDATE users SET name = ?, updated_at = ? WHERE id = ?").run(
      data.name,
      new Date().toISOString(),
      userId,
    );
  }

  const updated = getUserById(userId);
  return {
    success: true,
    message: "Profile updated",
    user: updated || undefined,
  };
}

// ============ User Devices ============

/**
 * Get user's saved devices
 */
export function getUserDevices(userId: string): UserDevice[] {
  const db = getDatabase();
  return db
    .prepare(
      `
    SELECT * FROM user_devices 
    WHERE user_id = ? 
    ORDER BY last_connected_at DESC
  `,
    )
    .all(userId) as UserDevice[];
}

/**
 * Save/update a device for user
 */
export function saveUserDevice(
  userId: string,
  deviceId: string,
  deviceModel?: string,
  deviceBrand?: string,
  nickname?: string,
): UserDevice {
  const db = getDatabase();

  // Check if device exists for this user
  const existing = db
    .prepare("SELECT id FROM user_devices WHERE user_id = ? AND device_id = ?")
    .get(userId, deviceId) as { id: string } | undefined;

  const now = new Date().toISOString();

  if (existing) {
    // Update existing
    db.prepare(
      `
      UPDATE user_devices 
      SET device_model = COALESCE(?, device_model),
          device_brand = COALESCE(?, device_brand),
          nickname = COALESCE(?, nickname),
          last_connected_at = ?
      WHERE id = ?
    `,
    ).run(deviceModel, deviceBrand, nickname, now, existing.id);

    return db
      .prepare("SELECT * FROM user_devices WHERE id = ?")
      .get(existing.id) as UserDevice;
  } else {
    // Insert new
    const id = uuidv4();
    db.prepare(
      `
      INSERT INTO user_devices (id, user_id, device_id, device_model, device_brand, nickname, last_connected_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      userId,
      deviceId,
      deviceModel || null,
      deviceBrand || null,
      nickname || null,
      now,
    );

    return db
      .prepare("SELECT * FROM user_devices WHERE id = ?")
      .get(id) as UserDevice;
  }
}

/**
 * Remove a device from user's saved devices
 */
export function removeUserDevice(userId: string, deviceId: string): boolean {
  const db = getDatabase();
  const result = db
    .prepare("DELETE FROM user_devices WHERE user_id = ? AND device_id = ?")
    .run(userId, deviceId);
  return result.changes > 0;
}

/**
 * Update device nickname
 */
export function updateDeviceNickname(
  userId: string,
  deviceId: string,
  nickname: string,
): boolean {
  const db = getDatabase();
  const result = db
    .prepare(
      `
    UPDATE user_devices SET nickname = ?, last_connected_at = ? 
    WHERE user_id = ? AND device_id = ?
  `,
    )
    .run(nickname, new Date().toISOString(), userId, deviceId);
  return result.changes > 0;
}

// ============ User Settings ============

/**
 * Get user setting
 */
export function getUserSetting(userId: string, key: string): string | null {
  const db = getDatabase();
  const row = db
    .prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = ?")
    .get(userId, key) as { value: string } | undefined;
  return row?.value ?? null;
}

/**
 * Get all user settings
 */
export function getAllUserSettings(userId: string): Record<string, string> {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT key, value FROM user_settings WHERE user_id = ?")
    .all(userId) as Array<{ key: string; value: string }>;

  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

/**
 * Set user setting
 */
export function setUserSetting(
  userId: string,
  key: string,
  value: string,
): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  const existing = db
    .prepare("SELECT id FROM user_settings WHERE user_id = ? AND key = ?")
    .get(userId, key);

  if (existing) {
    db.prepare(
      "UPDATE user_settings SET value = ?, updated_at = ? WHERE user_id = ? AND key = ?",
    ).run(value, now, userId, key);
  } else {
    const id = uuidv4();
    db.prepare(
      "INSERT INTO user_settings (id, user_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, userId, key, value, now);
  }
}

/**
 * Delete user setting
 */
export function deleteUserSetting(userId: string, key: string): void {
  const db = getDatabase();
  db.prepare("DELETE FROM user_settings WHERE user_id = ? AND key = ?").run(
    userId,
    key,
  );
}
