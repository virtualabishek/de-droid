/**
 * ServiceContainer
 * Central dependency-injection root that wires every service together.
 * Obtain the singleton via `ServiceContainer.getInstance()`.
 */
import { DatabaseManager } from "../database";
import { HistoryService } from "./historyService";
import { BackupService } from "./backupService";
import { SettingsService } from "./settingsService";
import { AuthService } from "./authService";
import { TelemetryService } from "./telemetryService";
import { ModelFeedbackService } from "./modelFeedbackService";
// TODO: import { PackageDataService } from "./packageDataService";
//       and expose it as `this.packageData` once that service is converted.

export class ServiceContainer {
  private static _instance: ServiceContainer | null = null;

  readonly db: DatabaseManager;
  readonly settings: SettingsService;
  readonly history: HistoryService;
  readonly backup: BackupService;
  readonly auth: AuthService;
  readonly telemetry: TelemetryService;
  readonly modelFeedback: ModelFeedbackService;

  private constructor() {
    // 1. Database — must be initialised before any service touches it
    this.db = DatabaseManager.getInstance();
    this.db.init();

    // 2. Settings is a low-level dependency for several services
    this.settings = new SettingsService(this.db);

    // 3. Services that only depend on the database
    this.history = new HistoryService(this.db);
    this.backup = new BackupService(this.db);
    this.auth = new AuthService(this.db);

    // 4. Services that depend on both db and settings
    this.telemetry = new TelemetryService(this.db, this.settings);

    // 5. Services that only depend on settings
    this.modelFeedback = new ModelFeedbackService(this.settings);
  }

  /**
   * Return (and lazily create) the process-wide ServiceContainer singleton.
   */
  static getInstance(): ServiceContainer {
    if (!ServiceContainer._instance) {
      ServiceContainer._instance = new ServiceContainer();
    }
    return ServiceContainer._instance;
  }

  /**
   * Tear down the current singleton, releasing the database connection.
   * The next call to `getInstance()` will create a fresh container.
   * Primarily useful in tests or during app shutdown.
   */
  static reset(): void {
    ServiceContainer._instance = null;
  }

  /**
   * Gracefully close all resources held by this container.
   * Call this during the `before-quit` / `will-quit` Electron lifecycle event.
   */
  close(): void {
    this.db.close();
  }
}
