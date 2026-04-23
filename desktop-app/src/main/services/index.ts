/**
 * Services Index - Export all services for easy importing
 */

// ─── Class exports ────────────────────────────────────────────────────────────
export { DatabaseManager } from "../database";
export { HistoryService } from "./historyService";
export { BackupService } from "./backupService";
export { SettingsService } from "./settingsService";
export { AuthService } from "./authService";
export { TelemetryService } from "./telemetryService";
export { ModelFeedbackService } from "./modelFeedbackService";
export { ServiceContainer } from "./ServiceContainer";

// ─── Backward-compat namespace re-exports ─────────────────────────────────────
export * as historyService from "./historyService";
export * as backupService from "./backupService";
export * as settingsService from "./settingsService";

// packageDataService will be wired into ServiceContainer by another task
export * as packageDataService from "./packageDataService";
