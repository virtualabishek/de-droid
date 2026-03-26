# OEM Bloatware Collection Playbook (Universal)

Use this process for Samsung, Xiaomi/Redmi, OnePlus, Huawei, Oppo, Vivo, etc.

## 1) Folder layout
Create one folder per OEM under `model-api/raw-data/`:

- `samsung/`
- `redmi/`
- `oneplus/`
- `huawei/`
- `oppo/`
- `vivo/`

Inside each folder, keep raw source files (`.txt`, `.tsv`, `.csv`, `.list`, `.sh`).

## 2) Evidence-first labeling technique
Do **not** label only from one random list. Use 3 evidence levels:

- **Level A (High trust):** multiple independent sources + practical disable test on real device.
- **Level B (Medium trust):** multiple sources but no practical test yet.
- **Level C (Low trust):** single source or unclear notes.

Suggested mapping policy:
- `UNSAFE`: bootloop risk, security core, package installer, updater, find-device, lockscreen/account critical.
- `EXPERT`: core namespace (`com.android.*`) or uncertain system impact.
- `ADVANCED`: likely removable but feature impact possible.
- `RECOMMENDED`: clear bloat/ads/analytics and verified safe by multiple sources.

## 3) Source normalization checklist
For each package candidate:
- Normalize package id (lowercase, exact id).
- Remove duplicates.
- Keep source link/name in your notes.
- Keep reason notes (what breaks if removed).
- Track confidence (`A/B/C`) in collection notes.

## 4) Build OEM variants JSON
Example for Xiaomi/Redmi:

```bash
python3 model-api/scripts/build_variant_dataset.py \
  --oem XIAOMI \
  --input-dir model-api/raw-data/redmi \
  --out model-api/raw-data/variants_redmi.json
```

## 5) Merge variants into training set

```bash
python3 model-api/scripts/build_training_dataset.py \
  --variants model-api/raw-data/variants_samsung.json model-api/raw-data/variants_redmi.json
```

## 6) Train model

```bash
python3 model-api/scripts/train_safety_model.py \
  --dataset model-api/processed/training_dataset.json
```

## 7) Validation before shipping
Check:
- `model-api/models/safety_baseline_report.json`
- `model-api/processed/oem_expansion_playbook.json`

Release gate suggestion:
- High `UNSAFE` recall
- Low false-safe rate (unsafe predicted as safe)
- Good confidence coverage on your target OEM

## 8) Runtime safety rule (mandatory)
Model must be assisted by hard guardrails:
- Block uninstall for known critical packages.
- Show explicit warnings for `EXPERT` and `UNSAFE`.
- Keep rollback/restore path visible.

## 9) Continuous improvement loop
Collect anonymized outcomes from real use:
- uninstall success/failure
- rollback actions
- user overrides

Use these to update labels and retrain periodically.
