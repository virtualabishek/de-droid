# De-Droid

De-Droid is a desktop app that helps you remove Android bloatware safely on non-rooted devices.

It uses local ADB commands for real actions, and an optional ML safety model for smarter guidance.

## What it can do

- Connect to Android phones over USB or wireless ADB.
- Scan installed packages and show current state.
- Uninstall, disable, enable, and restore packages.
- Show package safety labels with confidence (`RECOMMENDED`, `ADVANCED`, `EXPERT`, `UNSAFE`).
- Block dangerous removals with safety gates.
- Save backup snapshots and compare before/after changes.
- Keep history and telemetry logs locally.
- Show open-source alternatives for many apps.
- Show device health and package permission details.

## New architecture (model-first, local execution)

De-Droid follows a local-first architecture:

- **Local execution (Electron main process):** runs ADB commands directly on your machine.
- **Optional intelligence layer (FastAPI):** provides model-based safety scoring and explanations.
- **Local data layer (JSON + SQLite):** stores package metadata, predictions, backups, history, and settings.

Full details are in `ARCHITECTURE.md`.

## Repository structure

```text
de-droid/
  desktop-app/          # Electron + React + TypeScript app
  model-api/            # ML training pipeline + FastAPI service
  ARCHITECTURE.md       # High-level system architecture
  LICENSE               # Open-source license
  README.md
```

## Quick start

### Requirements

- Node.js 18+
- pnpm
- Python 3.11+
- ADB in PATH

### Run desktop app

```bash
cd desktop-app
pnpm install
pnpm run dev
```

### Run model API (optional)

```bash
python -m venv model-api/env
source model-api/env/bin/activate
pip install -r model-api/requirements.txt
uvicorn main:app --app-dir model-api/model-api --host 0.0.0.0 --port 8000 --reload
```

### Train and export model predictions (optional)

```bash
python model-api/scripts/build_training_dataset.py
python model-api/scripts/train_safety_model.py --predictions-out-desktop desktop-app/src/data/safety_predictions.json
```

## Safety labels

- `RECOMMENDED`: usually safe to remove for most users.
- `ADVANCED`: can be removed, but check your use case first.
- `EXPERT`: can affect system features; remove only if you understand the impact.
- `UNSAFE`: do not remove.

## Model API endpoints

- `GET /health`
- `POST /api/check-packages`
- `POST /api/check-single`
- `GET /api/stats`
- `GET /api/critical-packages`
- `GET /api/search/{query}`

## License

This project is licensed under the MIT License. See `LICENSE`.
