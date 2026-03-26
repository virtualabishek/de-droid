# Redmi / Xiaomi Variant Data Collection

Put all Redmi/Xiaomi source files in this folder.

## Accepted source file types
- `.txt`, `.tsv`, `.csv`, `.list`, `.md`, `.sh`

## Recommended raw files
- `redmi-bloatware-list.txt` -> one package per line
- `redmi-data-table.tsv` -> columns: `App Name`, `Package Name`, `Extra Information`, `Safe To Disable?`

## Labeling behavior used by parser
- Lines under `safe_to_remove` -> `ADVANCED`
- Lines under `use_with_caution` -> `EXPERT`
- Lines under `do_not_remove` / `do not uninstall` / `bootloop` sections -> `UNSAFE`
- Table rows with `Safe To Disable = Yes` -> `ADVANCED`
- Table rows with `Safe To Disable = No/Not Recommended` -> `UNSAFE`

## Build variants file for Redmi/Xiaomi

Run from repo root:

```bash
python3 model-api/scripts/build_variant_dataset.py \
  --oem XIAOMI \
  --input-dir model-api/raw-data/redmi \
  --out model-api/raw-data/variants_redmi.json
```

## Rebuild dataset + retrain (Samsung + Redmi)

```bash
python3 model-api/scripts/build_training_dataset.py \
  --variants model-api/raw-data/variants_samsung.json model-api/raw-data/variants_redmi.json

python3 model-api/scripts/train_safety_model.py \
  --dataset model-api/processed/training_dataset.json
```
