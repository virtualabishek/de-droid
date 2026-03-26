from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

PACKAGE_PATTERN = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$")
PACKAGE_EXTRACT_PATTERN = re.compile(r"[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+")

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


def extract_packages(raw_line: str) -> list[str]:
    candidates = PACKAGE_EXTRACT_PATTERN.findall(raw_line)
    normalized: list[str] = []
    for candidate in candidates:
        package_id = normalize_package(candidate)
        if package_id:
            normalized.append(package_id)
    return sorted(set(normalized))


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

    section = "unknown"

    for raw_line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line_lower = raw_line.strip().lower()

        if "safe_to_remove" in line_lower or "safe to remove" in line_lower:
            section = "safe"
        elif "use_with_caution" in line_lower or "use with caution" in line_lower:
            section = "caution"
        elif (
            "do_not_remove" in line_lower
            or "do not remove" in line_lower
            or "do not uninstall" in line_lower
            or "bootloop" in line_lower
        ):
            section = "unsafe"
        elif line_lower.strip() == ")":
            section = "unknown"

        package_ids = extract_packages(raw_line)
        if not package_ids:
            continue

        for package_id in package_ids:
            entry = ensure_entry(entries, package_id, oem_list)
            entry["labels"] = sorted(
                set([
                    *entry.get("labels", []),
                    oem_list.lower(),
                    "list-import",
                    f"source:{path.stem}",
                    f"section:{section}",
                ])
            )

            if section == "safe":
                incoming_label = "ADVANCED"
            elif section == "caution":
                incoming_label = "EXPERT"
            elif section == "unsafe":
                incoming_label = "UNSAFE"
            else:
                incoming_label = "ADVANCED"

            entry["removal"] = safer_removal(entry.get("removal", "ADVANCED"), incoming_label)
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

        package_id = None
        for value in columns:
            extracted = extract_packages(value)
            if extracted:
                package_id = extracted[0]
                break

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


def parse_input_directory(path: Path, oem_list: str, entries: dict[str, dict[str, Any]]) -> dict[str, int]:
    stats = {"list_rows_parsed": 0, "table_rows_parsed": 0, "files_parsed": 0}
    if not path.exists() or not path.is_dir():
        return stats

    candidate_files = sorted(
        file
        for file in path.iterdir()
        if file.is_file() and file.suffix.lower() in {".txt", ".tsv", ".csv", ".list", ".sh"}
    )

    for file in candidate_files:
        content_preview = file.read_text(encoding="utf-8", errors="ignore").splitlines()[:30]
        looks_like_table = any("\t" in line for line in content_preview) or any(
            "safe to disable" in line.lower() for line in content_preview
        )

        if looks_like_table:
            stats["table_rows_parsed"] += parse_table_file(file, oem_list, entries)
        else:
            stats["list_rows_parsed"] += parse_list_file(file, oem_list, entries)
        stats["files_parsed"] += 1

    return stats


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
    parser.add_argument(
        "--input-dir",
        type=Path,
        default=None,
        help="Optional directory containing raw variant files (txt/tsv/csv/list/md/sh)",
    )

    args = parser.parse_args()
    oem_list = args.oem.strip().upper() or "UNKNOWN"

    entries: dict[str, dict[str, Any]] = {}
    list_count = 0
    table_count = 0
    files_parsed = 0

    if args.input_dir:
        stats = parse_input_directory(args.input_dir, oem_list, entries)
        list_count += stats["list_rows_parsed"]
        table_count += stats["table_rows_parsed"]
        files_parsed += stats["files_parsed"]
    else:
        list_count += parse_list_file(args.list_file, oem_list, entries)
        table_count += parse_table_file(args.table_file, oem_list, entries)
        files_parsed = int(args.list_file.exists()) + int(args.table_file.exists())

    output = {
        "meta": {
            "oem": oem_list,
            "count": len(entries),
            "sources": {
                "input_dir": str(args.input_dir) if args.input_dir else None,
                "list_file": str(args.list_file) if not args.input_dir else None,
                "table_file": str(args.table_file) if not args.input_dir else None,
                "list_rows_parsed": list_count,
                "table_rows_parsed": table_count,
                "files_parsed": files_parsed,
            },
        },
        "packages": sorted(entries.values(), key=lambda item: item["id"]),
    }

    write_json(args.out, output)
    print(f"Wrote {len(entries)} normalized variant rows to {args.out}")


if __name__ == "__main__":
    main()