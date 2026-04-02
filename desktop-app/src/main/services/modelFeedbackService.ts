import { app } from "electron";
import { getBooleanSetting } from "./settingsService";

export type FeedbackAction =
  | "UNINSTALL"
  | "DISABLE"
  | "RESTORE"
  | "ENABLE"
  | "UNDO";

interface ActionFeedbackInput {
  packageName: string;
  action: FeedbackAction;
  success: boolean;
  modelLabel?: string;
  modelConfidence?: number;
  deviceBrand?: string;
  notes?: string;
}

const DEFAULT_MODEL_API_URL = "http://127.0.0.1:8000";
const REQUEST_TIMEOUT_MS = 3000;

function resolveModelApiBaseUrl(): string {
  const raw = process.env.DEDROID_MODEL_API_URL?.trim();
  if (!raw) return DEFAULT_MODEL_API_URL;
  return raw.replace(/\/+$/, "");
}

function isFeedbackUploadEnabled(): boolean {
  return getBooleanSetting("telemetry_opt_in", false);
}

async function postFeedbackEvent(payload: {
  package_id: string;
  action: FeedbackAction;
  outcome: "SUCCESS" | "FAILURE";
  model_label?: string;
  model_confidence?: number;
  device_brand?: string;
  app_version?: string;
  notes?: string;
}) {
  if (typeof fetch !== "function") {
    console.warn("[ModelFeedback] Global fetch is unavailable in this runtime");
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${resolveModelApiBaseUrl()}/api/feedback/events`,
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
        `[ModelFeedback] Upload failed (${response.status}): ${body || "no response body"}`,
      );
    }
  } catch (error) {
    console.warn("[ModelFeedback] Upload skipped:", error);
  } finally {
    clearTimeout(timeout);
  }
}

export function uploadActionFeedback(input: ActionFeedbackInput): void {
  if (!isFeedbackUploadEnabled()) return;

  const packageId = input.packageName.trim().toLowerCase();
  if (!packageId) return;

  void postFeedbackEvent({
    package_id: packageId,
    action: input.action,
    outcome: input.success ? "SUCCESS" : "FAILURE",
    model_label: input.modelLabel,
    model_confidence:
      typeof input.modelConfidence === "number" ? input.modelConfidence : undefined,
    device_brand: input.deviceBrand,
    app_version: app.getVersion(),
    notes: input.notes,
  });
}
