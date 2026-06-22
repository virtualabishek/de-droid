import { useState, useEffect, useCallback } from "react";
import { useAuthStore } from "../store/authStore";
import { useThemeStore, type Theme } from "../store/themeStore";

interface UserSettings {
  theme: Theme;
  expertMode: boolean;
  multiUserMode: boolean;
  confirmActions: boolean;
  autoBackup: boolean;
  telemetryOptIn: boolean;
}

interface WirelessStatus {
  isConnecting: boolean;
  isPairing: boolean;
  error: string | null;
  success: string | null;
}

// Helper to extract only numeric characters from input
function sanitizeNumericInput(value: string): string {
  return value.replace(/\D/g, "");
}

function normalizeTheme(value: string | undefined): Theme {
  if (value === "dark" || value === "light" || value === "system") {
    return value;
  }
  return "dark";
}

export default function Settings() {
  const { user } = useAuthStore();
  const { setTheme } = useThemeStore();

  const [settings, setSettings] = useState<UserSettings>({
    theme: "dark",
    expertMode: false,
    multiUserMode: true,
    confirmActions: true,
    autoBackup: true,
    telemetryOptIn: false,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">(
    "idle",
  );

  // Wireless debugging state
  const [wirelessIp, setWirelessIp] = useState("");
  const [wirelessPort, setWirelessPort] = useState("5555");
  const [pairingIp, setPairingIp] = useState("");
  const [pairingPort, setPairingPort] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [wirelessStatus, setWirelessStatus] = useState<WirelessStatus>({
    isConnecting: false,
    isPairing: false,
    error: null,
    success: null,
  });

  const loadSettings = useCallback(async () => {
    if (!user?.id) return;

    try {
      // Load user-specific settings from SQLite
      const [allSettings, telemetrySetting] = await Promise.all([
        window.electronAPI.auth.getAllSettings(user.id),
        window.electronAPI.settings.get("telemetry_opt_in"),
      ]);
      const nextTheme = normalizeTheme(allSettings.theme);

      setSettings({
        theme: nextTheme,
        expertMode: allSettings.expertMode === "true",
        multiUserMode: allSettings.multiUserMode !== "false",
        confirmActions: allSettings.confirmActions !== "false",
        autoBackup: allSettings.autoBackup !== "false",
        telemetryOptIn: telemetrySetting === "true",
      });
      setTheme(nextTheme);
    } catch (error) {
      console.error("Failed to load settings:", error);
    }
  }, [user, setTheme]);

  useEffect(() => {
    if (user?.id) {
      void loadSettings();
    }
  }, [user, loadSettings]);

  const saveSettings = async () => {
    if (!user?.id) return;

    setIsSaving(true);
    setSaveStatus("idle");
    try {
      // Save user-specific settings
      await Promise.all([
        window.electronAPI.auth.setSetting(user.id, "theme", settings.theme),
        window.electronAPI.auth.setSetting(
          user.id,
          "expertMode",
          String(settings.expertMode),
        ),
        window.electronAPI.auth.setSetting(
          user.id,
          "multiUserMode",
          String(settings.multiUserMode),
        ),
        window.electronAPI.auth.setSetting(
          user.id,
          "confirmActions",
          String(settings.confirmActions),
        ),
        window.electronAPI.auth.setSetting(
          user.id,
          "autoBackup",
          String(settings.autoBackup),
        ),
        window.electronAPI.settings.set(
          "telemetry_opt_in",
          String(settings.telemetryOptIn),
        ),
      ]);
      setTheme(settings.theme);
      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (error) {
      console.error("Failed to save settings:", error);
      setSaveStatus("error");
    } finally {
      setIsSaving(false);
    }
  };

  const updateSetting = <K extends keyof UserSettings>(
    key: K,
    value: UserSettings[K],
  ) => {
    if (key === "theme") {
      setTheme(value as Theme);
    }
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const clearWirelessStatus = () => {
    setWirelessStatus({
      isConnecting: false,
      isPairing: false,
      error: null,
      success: null,
    });
  };

  const handleWirelessConnect = async () => {
    if (!wirelessIp) return;

    clearWirelessStatus();
    setWirelessStatus((prev) => ({ ...prev, isConnecting: true }));

    try {
      const api = window?.electronAPI?.adb?.wireless;
      if (!api) {
        throw new Error("Wireless ADB API unavailable");
      }

      const result = await api.connect(
        wirelessIp,
        parseInt(wirelessPort) || 5555,
      );

      if (result.success) {
        setWirelessStatus({
          isConnecting: false,
          isPairing: false,
          error: null,
          success: `Connected to ${wirelessIp}:${wirelessPort}`,
        });
        setWirelessIp("");
        setWirelessPort("5555");
      } else {
        setWirelessStatus({
          isConnecting: false,
          isPairing: false,
          error: result.message || "Connection failed",
          success: null,
        });
      }
    } catch (error) {
      setWirelessStatus({
        isConnecting: false,
        isPairing: false,
        error: error instanceof Error ? error.message : "Connection failed",
        success: null,
      });
    }
  };

  const handleWirelessDisconnect = async () => {
    if (!wirelessIp) return;

    clearWirelessStatus();
    setWirelessStatus((prev) => ({ ...prev, isConnecting: true }));

    try {
      const api = window?.electronAPI?.adb?.wireless;
      if (!api) {
        throw new Error("Wireless ADB API unavailable");
      }

      const result = await api.disconnect(
        wirelessIp,
        parseInt(wirelessPort) || 5555,
      );

      if (result.success) {
        setWirelessStatus({
          isConnecting: false,
          isPairing: false,
          error: null,
          success: `Disconnected from ${wirelessIp}:${wirelessPort}`,
        });
      } else {
        setWirelessStatus({
          isConnecting: false,
          isPairing: false,
          error: result.message || "Disconnect failed",
          success: null,
        });
      }
    } catch (error) {
      setWirelessStatus({
        isConnecting: false,
        isPairing: false,
        error: error instanceof Error ? error.message : "Disconnect failed",
        success: null,
      });
    }
  };

  const handleWirelessPair = async () => {
    if (!pairingIp || !pairingPort || !pairingCode) return;

    clearWirelessStatus();
    setWirelessStatus((prev) => ({ ...prev, isPairing: true }));

    try {
      const api = window?.electronAPI?.adb?.wireless;
      if (!api) {
        throw new Error("Wireless ADB API unavailable");
      }

      const result = await api.pair(
        pairingIp,
        parseInt(pairingPort),
        pairingCode,
      );

      if (result.success) {
        setWirelessStatus({
          isConnecting: false,
          isPairing: false,
          error: null,
          success: `Paired with ${pairingIp}:${pairingPort}. You can now connect.`,
        });
        setPairingIp("");
        setPairingPort("");
        setPairingCode("");
      } else {
        setWirelessStatus({
          isConnecting: false,
          isPairing: false,
          error: result.message || "Pairing failed",
          success: null,
        });
      }
    } catch (error) {
      setWirelessStatus({
        isConnecting: false,
        isPairing: false,
        error: error instanceof Error ? error.message : "Pairing failed",
        success: null,
      });
    }
  };

  return (
    <div className="h-full overflow-auto">
      <header className="bg-gray-800 border-b border-gray-700 p-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-gray-400 mt-1">Configure your preferences</p>
      </header>

      <div className="p-6 max-w-3xl">
        {/* Wireless Debugging */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4">Wireless ADB Debugging</h2>
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 space-y-4">
            {/* Status messages */}
            {wirelessStatus.error && (
              <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 flex items-center justify-between">
                <span>{wirelessStatus.error}</span>
                <button
                  onClick={clearWirelessStatus}
                  className="text-red-300 hover:text-red-200"
                >
                  ×
                </button>
              </div>
            )}
            {wirelessStatus.success && (
              <div className="p-3 bg-green-500/20 border border-green-500/30 rounded-lg text-green-400 flex items-center justify-between">
                <span>{wirelessStatus.success}</span>
                <button
                  onClick={clearWirelessStatus}
                  className="text-green-300 hover:text-green-200"
                >
                  ×
                </button>
              </div>
            )}

            {/* Pairing Section (Android 11+) */}
            <div className="border-b border-gray-700 pb-4">
              <h3 className="font-medium mb-2">Pair Device (Android 11+)</h3>
              <p className="text-sm text-gray-400 mb-3">
                Enable &quot;Wireless debugging&quot; in Developer Options, tap
                &quot;Pair device with pairing code&quot;
              </p>
              <div className="grid grid-cols-3 gap-2 mb-2">
                <input
                  type="text"
                  placeholder="IP Address"
                  value={pairingIp}
                  onChange={(e) => setPairingIp(e.target.value)}
                  className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-400"
                />
                <input
                  type="text"
                  placeholder="Port"
                  value={pairingPort}
                  onChange={(e) =>
                    setPairingPort(sanitizeNumericInput(e.target.value))
                  }
                  className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-400"
                />
                <input
                  type="text"
                  placeholder="Pairing Code"
                  value={pairingCode}
                  onChange={(e) =>
                    setPairingCode(sanitizeNumericInput(e.target.value))
                  }
                  className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-400"
                />
              </div>
              <button
                onClick={handleWirelessPair}
                disabled={
                  wirelessStatus.isPairing ||
                  !pairingIp ||
                  !pairingPort ||
                  !pairingCode
                }
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
              >
                {wirelessStatus.isPairing ? "Pairing..." : "Pair Device"}
              </button>
            </div>

            {/* Connect Section */}
            <div>
              <h3 className="font-medium mb-2">Connect to Device</h3>
              <p className="text-sm text-gray-400 mb-3">
                After pairing, connect using the device IP and port shown in
                Wireless debugging settings
              </p>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  placeholder="IP Address (e.g., 192.168.1.100)"
                  value={wirelessIp}
                  onChange={(e) => setWirelessIp(e.target.value)}
                  className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-400"
                />
                <input
                  type="text"
                  placeholder="Port"
                  value={wirelessPort}
                  onChange={(e) =>
                    setWirelessPort(sanitizeNumericInput(e.target.value))
                  }
                  className="w-24 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-400"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleWirelessConnect}
                  disabled={wirelessStatus.isConnecting || !wirelessIp}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
                >
                  {wirelessStatus.isConnecting ? "Connecting..." : "Connect"}
                </button>
                <button
                  onClick={handleWirelessDisconnect}
                  disabled={wirelessStatus.isConnecting || !wirelessIp}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
                >
                  Disconnect
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Appearance */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4">Appearance</h2>
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Theme</p>
                <p className="text-sm text-gray-400">
                  Choose your preferred theme
                </p>
              </div>
              <select
                value={settings.theme}
                onChange={(e) =>
                  updateSetting("theme", normalizeTheme(e.target.value))
                }
                className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white"
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="system">System</option>
              </select>
            </div>
          </div>
        </section>

        {/* Behavior */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4">Behavior</h2>
          <div className="bg-gray-800 rounded-lg border border-gray-700 divide-y divide-gray-700">
            <div className="p-4 flex items-center justify-between">
              <div>
                <p className="font-medium">Expert Mode</p>
                <p className="text-sm text-gray-400">
                  Show all packages including unsafe ones
                </p>
              </div>
              <input
                type="checkbox"
                checked={settings.expertMode}
                onChange={(e) => updateSetting("expertMode", e.target.checked)}
                className="h-5 w-5 rounded border-gray-600 bg-gray-700 text-primary-600 focus:ring-primary-500 focus:ring-2"
              />
            </div>

            <div className="p-4 flex items-center justify-between">
              <div>
                <p className="font-medium">Multi-User Mode</p>
                <p className="text-sm text-gray-400">
                  Show user selector for devices with multiple users
                </p>
              </div>
              <input
                type="checkbox"
                checked={settings.multiUserMode}
                onChange={(e) =>
                  updateSetting("multiUserMode", e.target.checked)
                }
                className="h-5 w-5 rounded border-gray-600 bg-gray-700 text-primary-600 focus:ring-primary-500 focus:ring-2"
              />
            </div>

            <div className="p-4 flex items-center justify-between">
              <div>
                <p className="font-medium">Confirm Actions</p>
                <p className="text-sm text-gray-400">
                  Ask for confirmation before performing actions
                </p>
              </div>
              <input
                type="checkbox"
                checked={settings.confirmActions}
                onChange={(e) =>
                  updateSetting("confirmActions", e.target.checked)
                }
                className="h-5 w-5 rounded border-gray-600 bg-gray-700 text-primary-600 focus:ring-primary-500 focus:ring-2"
              />
            </div>

            <div className="p-4 flex items-center justify-between">
              <div>
                <p className="font-medium">Auto Backup</p>
                <p className="text-sm text-gray-400">
                  Automatically backup package states before changes
                </p>
              </div>
              <input
                type="checkbox"
                checked={settings.autoBackup}
                onChange={(e) => updateSetting("autoBackup", e.target.checked)}
                className="h-5 w-5 rounded border-gray-600 bg-gray-700 text-primary-600 focus:ring-primary-500 focus:ring-2"
              />
            </div>

            <div className="p-4 flex items-center justify-between">
              <div>
                <p className="font-medium">Anonymous Model Telemetry (Opt-in)</p>
                <p className="text-sm text-gray-400">
                  Share anonymized action outcomes to improve safety model retraining
                </p>
              </div>
              <input
                type="checkbox"
                checked={settings.telemetryOptIn}
                onChange={(e) =>
                  updateSetting("telemetryOptIn", e.target.checked)
                }
                className="h-5 w-5 rounded border-gray-600 bg-gray-700 text-primary-600 focus:ring-primary-500 focus:ring-2"
              />
            </div>
          </div>
        </section>

        {/* Save button */}
        <div className="flex items-center gap-4">
          <button
            onClick={saveSettings}
            disabled={isSaving}
            className="px-6 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
          >
            {isSaving ? "Saving..." : "Save Settings"}
          </button>
          {saveStatus === "success" && (
            <span className="text-green-400">Settings saved successfully!</span>
          )}
          {saveStatus === "error" && (
            <span className="text-red-400">Failed to save settings</span>
          )}
        </div>
      </div>
    </div>
  );
}
