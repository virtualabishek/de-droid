from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

PACKAGE_PATTERN = re.compile(r"^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+$")

RISK_ORDER = {
    "RECOMMENDED": 0,
    "ADVANCED": 1,
    "EXPERT": 2,
    "UNSAFE": 3,
}


def normalize_package(candidate: str) -> str | None:
    value = candidate.strip().lower()
    if not value:
        return None

    value = value.replace("\ufeff", "")
    value = value.split("|", 1)[0].strip()
    value = value.split("-", 1)[0].strip() if " - " in value else value

    if PACKAGE_PATTERN.match(value):
        return value
    return None


def safer_removal(current: str, incoming: str) -> str:
    if RISK_ORDER.get(incoming, 1) > RISK_ORDER.get(current, 1):
        return incoming
    return current


def ensure_entry(entries: dict[str, dict[str, Any]], package_id: str, oem_list: str) -> dict[str, Any]:
    if package_id not in entries:
        entries[package_id] = {
            "id": package_id,
            "list": oem_list,
            "description": "Community OEM variant candidate",
            "removal": "ADVANCED",
            "category": "BLOATWARE",
            "dependencies": [],
            "neededBy": [],
            "labels": ["variant", "community"],
            "alternatives": [],
            "source": "variant",
        }
    return entries[package_id]


def parse_list_file(path: Path, oem_list: str, entries: dict[str, dict[str, Any]]) -> int:
    count = 0
    if not path.exists():
        return count

    for raw_line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        package_id = normalize_package(raw_line)
        if not package_id:
            continue

        entry = ensure_entry(entries, package_id, oem_list)
        entry["labels"] = sorted(set([*entry.get("labels", []), oem_list.lower(), "list-import"]))
        count += 1

    return count


def parse_table_file(path: Path, oem_list: str, entries: dict[str, dict[str, Any]]) -> int:
    count = 0
    if not path.exists():
        return count

    lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue

        if "Package Name" in line and "Safe To Disable" in line:
            continue

        columns = [part.strip() for part in line.split("\t")]
        if len(columns) < 2:
            package_id = normalize_package(line)
            if not package_id:
                continue
            columns = ["", package_id, "", "Yes"]

        package_id = normalize_package(columns[1]) or normalize_package(columns[0])
        if not package_id:
            continue

        notes = columns[2] if len(columns) > 2 else ""
        safe_to_disable = columns[3].strip().upper() if len(columns) > 3 else "YES"

        entry = ensure_entry(entries, package_id, oem_list)
        entry["labels"] = sorted(
            set([
                *entry.get("labels", []),
                oem_list.lower(),
                "table-import",
                "safe-to-disable" if safe_to_disable in {"YES", "Y", "TRUE"} else "not-recommended",
            ])
        )

        if notes:
            current_desc = entry.get("description", "")
            if not current_desc or len(notes) > len(current_desc):
                entry["description"] = notes

        incoming_label = "ADVANCED" if safe_to_disable in {"YES", "Y", "TRUE"} else "UNSAFE"
        entry["removal"] = safer_removal(entry.get("removal", "ADVANCED"), incoming_label)
        count += 1

    return count


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(data, file, indent=2, ensure_ascii=False)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build OEM variant dataset JSON from community text/table lists",
    )
    parser.add_argument(
        "--oem",
        type=str,
        default="SAMSUNG",
        help="OEM list name to stamp into dataset rows",
    )
    parser.add_argument(
        "--list-file",
        type=Path,
        default=Path("model-api/raw-data/samsung-bloatware-list.txt"),
        help="Plain-text package list path",
    )
    parser.add_argument(
        "--table-file",
        type=Path,
        default=Path("model-api/raw-data/samsung-data-table.txt"),
        help="Tabular package list path",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("model-api/raw-data/variants_samsung.json"),
        help="Output JSON path",
    )

    args = parser.parse_args()
    oem_list = args.oem.strip().upper() or "UNKNOWN"

    entries: dict[str, dict[str, Any]] = {}
    list_count = parse_list_file(args.list_file, oem_list, entries)
    table_count = parse_table_file(args.table_file, oem_list, entries)

    output = {
        "meta": {
            "oem": oem_list,
            "count": len(entries),
            "sources": {
                "list_file": str(args.list_file),
                "table_file": str(args.table_file),
                "list_rows_parsed": list_count,
                "table_rows_parsed": table_count,
            },
        },
        "packages": sorted(entries.values(), key=lambda item: item["id"]),
    }

    write_json(args.out, output)
    print(f"Wrote {len(entries)} normalized variant rows to {args.out}")


if __name__ == "__main__":
    main()