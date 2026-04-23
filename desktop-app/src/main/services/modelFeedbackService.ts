/**
 * Model Feedback Service
 * Uploads anonymised action outcomes to the local model API for retraining signals.
 */
import { app } from "electron";
import { DatabaseManager } from "../database";
import { SettingsService } from "./settingsService";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FeedbackAction =
  | "UNINSTALL"
  | "DISABLE"
  | "RESTORE"
  | "ENABLE"
  | "UNDO";

export interface ActionFeedbackInput {
  packageName: string;
  action: FeedbackAction;
  success: boolean;
  modelLabel?: string;
  modelConfidence?: number;
  deviceBrand?: string;
  notes?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MODEL_API_URL = "http://127.0.0.1:8000";
const REQUEST_TIMEOUT_MS = 3000;

// ─── Class ────────────────────────────────────────────────────────────────────

export class ModelFeedbackService {
  constructor(private readonly settings: SettingsService) {}

  /**
   * Upload an action feedback event to the model API.
   * Silently does nothing when feedback uploads are disabled or the package name is empty.
   */
  uploadActionFeedback(input: ActionFeedbackInput): void {
    if (!this.isEnabled()) return;

    const packageId = input.packageName.trim().toLowerCase();
    if (!packageId) return;

    void this.postEvent({
      package_id: packageId,
      action: input.action,
      outcome: input.success ? "SUCCESS" : "FAILURE",
      model_label: input.modelLabel,
      model_confidence:
        typeof input.modelConfidence === "number"
          ? input.modelConfidence
          : undefined,
      device_brand: input.deviceBrand,
      app_version: app.getVersion(),
      notes: input.notes,
    });
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private resolveApiUrl(): string {
    const raw = process.env.DEDROID_MODEL_API_URL?.trim();
    if (!raw) return DEFAULT_MODEL_API_URL;
    return raw.replace(/\/+$/, "");
  }

  private isEnabled(): boolean {
    return this.settings.getBoolean("telemetry_opt_in", false);
  }

  private async postEvent(payload: Record<string, unknown>): Promise<void> {
    if (typeof fetch !== "function") {
      console.warn(
        "[ModelFeedback] Global fetch is unavailable in this runtime",
      );
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(
        `${this.resolveApiUrl()}/api/feedback/events`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        console.warn(
          `[ModelFeedback] Upload failed (${response.status}): ${
            body || "no response body"
          }`,
        );
      }
    } catch (error) {
      console.warn("[ModelFeedback] Upload skipped:", error);
    } finally {
      clearTimeout(timeout);
    }
  }
}

// ─── Lazy singleton for backward-compat delegates ─────────────────────────────

let _defaultInstance: ModelFeedbackService | null = null;

function _getDefault(): ModelFeedbackService {
  if (!_defaultInstance) {
    const db = DatabaseManager.getInstance();
    const settings = new SettingsService(db);
    _defaultInstance = new ModelFeedbackService(settings);
  }
  return _defaultInstance;
}

// ─── Backward-compat named exports ───────────────────────────────────────────

/**
 * Upload an action feedback event to the model API.
 * @deprecated Prefer `new ModelFeedbackService(settings).uploadActionFeedback(input)` or `ServiceContainer`.
 */
export function uploadActionFeedback(input: ActionFeedbackInput): void {
  return _getDefault().uploadActionFeedback(input);
}
