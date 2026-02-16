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