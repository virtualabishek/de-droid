from __future__ import annotations

import argparse
import json
from collections import Counter
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

REMOVAL_MAP = {
    "RECOMMENDED": "RECOMMENDED",
    "ADVANCED": "ADVANCED",
    "EXPERT": "EXPERT",
    "UNSAFE": "UNSAFE",
    "SAFE": "RECOMMENDED",
    "DANGEROUS": "UNSAFE",
}

CATEGORY_MAP = {
    "BLOATWARE": "BLOATWARE",
    "OPTIONAL": "OPTIONAL",
    "ESSENTIAL": "ESSENTIAL",
    "CORE": "ESSENTIAL",
}

RISK_ORDER = {
    "RECOMMENDED": 0,
    "ADVANCED": 1,
    "EXPERT": 2,
    "UNSAFE": 3,
}


@dataclass
class TrainingRow:
    package_id: str
    oem_list: str
    removal: str
    category: str
    description: str
    labels: list[str]
    dependencies: list[str]
    needed_by: list[str]
    alternatives: list[str]
    source: str

    @property
    def text(self) -> str:
        return " ".join(
            [
                self.package_id,
                self.oem_list,
                self.description,
                " ".join(self.labels),
            ]
        ).strip()

def normalize_string(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""



def normalize_list(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    cleaned = [normalize_string(v) for v in values]
    return sorted({v for v in cleaned if v})



def normalize_removal(value: Any) -> str:
    raw = normalize_string(value).upper()
    return REMOVAL_MAP.get(raw, "ADVANCED")



def normalize_category(value: Any) -> str:
    raw = normalize_string(value).upper()
    return CATEGORY_MAP.get(raw, "OPTIONAL")



def build_row(entry: dict[str, Any], source: str) -> TrainingRow | None:
    package_id = normalize_string(entry.get("id"))
    if not package_id:
        return None

    return TrainingRow(
        package_id=package_id,
        oem_list=(normalize_string(entry.get("list")).upper() or "UNKNOWN"),
        removal=normalize_removal(entry.get("removal")),
        category=normalize_category(entry.get("category")),
        description=normalize_string(entry.get("description")),
        labels=normalize_list(entry.get("labels")),
        dependencies=normalize_list(entry.get("dependencies")),
        needed_by=normalize_list(entry.get("neededBy")),
        alternatives=normalize_list(entry.get("alternatives")),
        source=source,
    )



def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)



def merge_rows(
    uad_rows: list[TrainingRow],
    desktop_rows: list[TrainingRow],
) -> list[TrainingRow]:
    by_package: dict[str, TrainingRow] = {row.package_id: row for row in uad_rows}

    for row in desktop_rows:
        existing = by_package.get(row.package_id)

        if not existing:
            by_package[row.package_id] = row
            continue

        by_package[row.package_id] = TrainingRow(
            package_id=row.package_id,
            oem_list=row.oem_list if row.oem_list != "UNKNOWN" else existing.oem_list,
            removal=row.removal if row.removal else existing.removal,
            category=row.category if row.category else existing.category,
            description=row.description if row.description else existing.description,
            labels=row.labels or existing.labels,
            dependencies=row.dependencies or existing.dependencies,
            needed_by=row.needed_by or existing.needed_by,
            alternatives=row.alternatives or existing.alternatives,
            source="desktop+uad",
        )

    return list(by_package.values())


def safer_removal(current: str, incoming: str) -> str:
    if RISK_ORDER.get(incoming, 1) > RISK_ORDER.get(current, 1):
        return incoming
    return current


def apply_variant_rows(
    merged_rows: list[TrainingRow],
    variant_rows: list[TrainingRow],
) -> tuple[list[TrainingRow], int]:
    by_package: dict[str, TrainingRow] = {row.package_id: row for row in merged_rows}
    conflict_count = 0

    for row in variant_rows:
        existing = by_package.get(row.package_id)

        if not existing:
            by_package[row.package_id] = row
            continue

        if existing.removal != row.removal:
            conflict_count += 1

        merged_sources = sorted({*existing.source.split("+"), *row.source.split("+")})
        by_package[row.package_id] = TrainingRow(
            package_id=row.package_id,
            oem_list=row.oem_list if row.oem_list != "UNKNOWN" else existing.oem_list,
            removal=safer_removal(existing.removal, row.removal),
            category=row.category if row.category != "OPTIONAL" else existing.category,
            description=row.description if row.description else existing.description,
            labels=sorted({*existing.labels, *row.labels}),
            dependencies=sorted({*existing.dependencies, *row.dependencies}),
            needed_by=sorted({*existing.needed_by, *row.needed_by}),
            alternatives=sorted({*existing.alternatives, *row.alternatives}),
            source="+".join(merged_sources),
        )

    return list(by_package.values()), conflict_count


def source_confidence(source: str, removal: str) -> float:
    source_parts = set(source.split("+"))

    if "desktop" in source_parts and "uad" in source_parts:
        return 1.0
    if "uad" in source_parts:
        return 0.95
    if "desktop" in source_parts:
        return 0.9

    variant_only = all(part.startswith("variant:") for part in source_parts)
    if variant_only:
        if removal == "UNSAFE":
            return 0.8
        if removal == "EXPERT":
            return 0.65
        return 0.55

    return 0.75



def write_json(path: Path, data: Any) -> None:
    with path.open("w", encoding="utf-8") as file:
        json.dump(data, file, indent=2, ensure_ascii=False)



def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build canonical training dataset for debloat safety model",
    )
    parser.add_argument(
        "--uad",
        type=Path,
        default=Path("model-api/raw-data/uad_lists.json"),
        help="Path to UAD raw JSON file",
    )
    parser.add_argument(
        "--desktop",
        type=Path,
        default=Path("desktop-app/src/data/debloat_lists.json"),
        help="Path to desktop app debloat list JSON",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("model-api/processed/training_dataset.json"),
        help="Output canonical dataset path",
    )
    parser.add_argument(
        "--variants",
        type=Path,
        nargs="*",
        default=[],
        help="Optional variant JSON files (format: { packages: [...] } or list of package entries)",
    )

    args = parser.parse_args()

    uad_data = load_json(args.uad)
    desktop_data = load_json(args.desktop)

    uad_rows = [
        row
        for row in (build_row(item, "uad") for item in uad_data)
        if row is not None
    ]

    desktop_packages = desktop_data.get("packages", [])
    desktop_rows = [
        row
        for row in (build_row(item, "desktop") for item in desktop_packages)
        if row is not None
    ]

    variant_rows: list[TrainingRow] = []
    for variant_path in args.variants:
        variant_data = load_json(variant_path)
        variant_packages = (
            variant_data.get("packages", [])
            if isinstance(variant_data, dict)
            else (variant_data if isinstance(variant_data, list) else [])
        )

        variant_source_name = f"variant:{variant_path.stem}"
        variant_rows.extend(
            row
            for row in (build_row(item, variant_source_name) for item in variant_packages)
            if row is not None
        )

    merged = merge_rows(uad_rows, desktop_rows)
    label_conflict_count = 0
    if variant_rows:
        merged, label_conflict_count = apply_variant_rows(merged, variant_rows)

    args.out.parent.mkdir(parents=True, exist_ok=True)

    serializable_rows = []
    for row in merged:
        payload = asdict(row)
        payload["text"] = row.text
        payload["dep_count"] = len(row.dependencies)
        payload["needed_by_count"] = len(row.needed_by)
        payload["label_count"] = len(row.labels)
        payload["has_alternatives"] = 1 if row.alternatives else 0
        payload["source_confidence"] = source_confidence(row.source, row.removal)
        serializable_rows.append(payload)

    distribution = Counter(r["removal"] for r in serializable_rows)

    output = {
        "meta": {
            "count": len(serializable_rows),
            "label_distribution": distribution,
            "sources": {
                "uad_rows": len(uad_rows),
                "desktop_rows": len(desktop_rows),
                "variant_rows": len(variant_rows),
                "label_conflicts": label_conflict_count,
            },
        },
        "rows": serializable_rows,
    }

    write_json(args.out, output)
    print(f"Wrote {len(serializable_rows)} rows to {args.out}")
    print("Label distribution:")
    for label, count in sorted(distribution.items()):
        print(f"  {label}: {count}")


if __name__ == "__main__":
    main()
