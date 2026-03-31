# De-Droid Architecture (New Model)

This document explains how De-Droid works with the new model-based safety system, in simple terms.

## 1) High-level design

De-Droid is a local-first desktop application.

```text
User
  |
  v
React UI (renderer)
  |
  v
Electron IPC
  |
  v
Electron main process
  |-------------------------------> Local SQLite (history, backups, settings, telemetry)
  |-------------------------------> Local JSON (debloat metadata, model predictions, OEM overrides)
  |
  v
Local ADB commands (child_process)
  |
  v
Android device (USB or wireless)

Optional component:
FastAPI model service (can run separately for API checks and debugging)
```

## 2) Core layers

### A) Desktop layer (`desktop-app/`)

- **Renderer (React + TypeScript):** UI pages for packages, health, settings, alternatives, and history.
- **Main process (Electron):** executes ADB commands, applies safety checks, writes logs, and manages backups.
- **IPC handlers:** bridge between UI actions and device/data operations.

Key files:

- `desktop-app/src/main/adb/index.ts`
- `desktop-app/src/main/ipc/adb.ipc.ts`
- `desktop-app/src/main/services/packageDataService.ts`
- `desktop-app/src/main/database/index.ts`

### B) Model and data layer (`model-api/`)

- **Training pipeline scripts:** build dataset, train safety model, and export predictions.
- **Model artifacts:** prediction/report outputs under `model-api/models/`.
- **FastAPI app:** optional API that exposes health and package safety endpoints.

Key files:

- `model-api/scripts/build_training_dataset.py`
- `model-api/scripts/build_variant_dataset.py`
- `model-api/scripts/train_safety_model.py`
- `model-api/model-api/main.py`

## 3) Runtime safety flow

When a user tries to remove a package:

1. App gets package state from local ADB.
2. App enriches package info with local metadata and model predictions.
3. Safety gates are applied (critical denylist, core namespace protection, low-confidence handling).
4. UI shows risk level and warning/blocked state.
5. If action is allowed, ADB command executes locally.
6. Result is saved to local history and telemetry tables.

No internet is required for normal debloat operations.

## 4) New model behavior

The model uses four labels:

- `RECOMMENDED`
- `ADVANCED`
- `EXPERT`
- `UNSAFE`

Important protections:

- Critical system packages are always treated as `UNSAFE`.
- Low-confidence predictions are pushed to a safer level.
- OEM-specific package patterns are recognized.
- Unknown packages use conservative fallback logic.

## 5) Data used by the app

- `desktop-app/src/data/debloat_lists.json` - curated package metadata.
- `desktop-app/src/data/safety_predictions.json` - model output used at runtime.
- `desktop-app/src/data/oem_overrides.json` - OEM-specific safety overrides.
- Local SQLite database (`dedroid.db`) - action history, backups, settings, and telemetry events.

## 6) Optional FastAPI service

The API service can run independently and expose:

- `GET /health`
- `POST /api/check-packages`
- `POST /api/check-single`
- `GET /api/stats`
- `GET /api/critical-packages`
- `GET /api/search/{query}`

This is useful for testing and external integration, but the desktop app can work in local-only mode.

## 7) Why this architecture

- **Fast local actions:** direct ADB execution with no server round-trip.
- **Safer decisions:** model predictions + deterministic safety gates.
- **Better reliability:** local storage keeps history and backups always available.
- **Privacy-friendly:** no mandatory cloud dependency.
