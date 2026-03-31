from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen

PACKAGE_PATTERN = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$")

DEFAULT_UAD_URLS = [
    "https://raw.githubusercontent.com/Universal-Debloater-Alliance/universal-android-debloater-next-generation/main/resources/assets/uad_lists.json",
    "https://raw.githubusercontent.com/0x192/universal-android-debloater/main/resources/assets/uad_lists.json",
]

RISK_ORDER = {
    "RECOMMENDED": 0,
    "ADVANCED": 1,
    "EXPERT": 2,
    "UNSAFE": 3,
}


@dataclass(frozen=True)
class OemProfile:
    name: str
    keywords: tuple[str, ...]
    prefixes: tuple[str, ...]


OEM_PROFILES: dict[str, OemProfile] = {
    "OPPO": OemProfile(
        name="OPPO",
        keywords=("oppo", "coloros", "heytap", "nearme", "oplus"),
        prefixes=("com.oppo.", "com.coloros.", "com.heytap.", "com.nearme.", "com.oplus."),
    ),
    "REALME": OemProfile(
        name="REALME",
        keywords=("realme", "realme ui", "coloros", "heytap", "oplus", "nearme"),
        prefixes=("com.realme.", "com.heytap.", "com.coloros.", "com.nearme.", "com.oplus."),
    ),
    "INFINIX": OemProfile(
        name="INFINIX",
        keywords=("infinix", "xos", "transsion", "xclub", "xcafe"),
        prefixes=("com.infinix.", "com.transsion.", "com.xos.", "com.xclub."),
    ),
    "TECNO": OemProfile(
        name="TECNO",
        keywords=("tecno", "hios", "transsion", "phonemaster"),
        prefixes=("com.tecno.", "com.transsion.", "com.hios."),
    ),
    "ITEL": OemProfile(
        name="ITEL",
        keywords=("itel", "transsion", "palmstore"),
        prefixes=("com.itel.", "com.transsion.", "com.palmstore."),
    ),
    "ONEPLUS": OemProfile(
        name="ONEPLUS",
        keywords=("oneplus", "oxygenos", "oplus"),
        prefixes=("com.oneplus.", "net.oneplus.", "cn.oneplus.", "com.oplus."),
    ),
    "VIVO": OemProfile(
        name="VIVO",
        keywords=("vivo", "bbk", "iqoo", "originos", "funtouch"),
        prefixes=("com.vivo.", "com.bbk.", "com.iqoo."),
    ),
    "XIAOMI": OemProfile(
        name="XIAOMI",
        keywords=("xiaomi", "miui", "redmi", "poco"),
        prefixes=("com.xiaomi.", "com.miui.", "com.mi.", "com.redmi.", "com.poco."),
    ),
    "SAMSUNG": OemProfile(
        name="SAMSUNG",
        keywords=("samsung", "galaxy", "one ui", "knox"),
        prefixes=("com.samsung.", "com.sec.", "com.osp.", "com.wssyncmldm"),
    ),
    "HUAWEI": OemProfile(
        name="HUAWEI",
        keywords=("huawei", "honor", "emui", "hmos", "harmonyos"),
        prefixes=("com.huawei.", "com.honor.", "com.hicloud.", "com.hisi."),
    ),
}


def normalize_package_id(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    package_id = value.strip().lower()
    if not package_id:
        return None
    if PACKAGE_PATTERN.match(package_id):
        return package_id
    return None


def normalize_removal(value: Any) -> str:
    raw = str(value or "").strip().upper()
    if raw in RISK_ORDER:
        return raw
    return "ADVANCED"


def normalize_text_blob(*chunks: Any) -> str:
    cleaned = []
    for chunk in chunks:
        if isinstance(chunk, str):
            cleaned.append(chunk.lower())
        elif isinstance(chunk, list):
            cleaned.extend(str(item).lower() for item in chunk)
    return " ".join(cleaned)


def fetch_json_from_url(url: str, timeout: int = 30) -> Any:
    request = Request(url, headers={"User-Agent": "de-droid-oem-builder/1.0"})
    with urlopen(request, timeout=timeout) as response:
        payload = response.read().decode("utf-8")
    return json.loads(payload)


def read_json_from_file(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def choose_uad_payload(urls: list[str], local_file: Path | None) -> tuple[list[dict[str, Any]], str]:
    if local_file is not None:
        payload = read_json_from_file(local_file)
        if not isinstance(payload, list):
            raise ValueError(f"Expected list JSON in local file: {local_file}")
        return payload, f"file://{local_file}"

    last_error: str | None = None
    for url in urls:
        try:
            payload = fetch_json_from_url(url)
            if isinstance(payload, list):
                return payload, url
            last_error = f"URL returned non-list JSON: {url}"
        except (URLError, TimeoutError, json.JSONDecodeError, ValueError) as exc:
            last_error = f"{url} -> {exc}"

    raise RuntimeError(f"Unable to fetch UAD payload from all URLs. Last error: {last_error}")


def score_membership(entry: dict[str, Any], profile: OemProfile) -> float:
    package_id = normalize_package_id(entry.get("id")) or ""
    if not package_id:
        return 0.0

    score = 0.0
    if any(package_id.startswith(prefix) for prefix in profile.prefixes):
        score += 0.75

    text_blob = normalize_text_blob(
        entry.get("description"),
        entry.get("list"),
        entry.get("labels"),
    )
    for keyword in profile.keywords:
        if keyword in text_blob:
            score += 0.2

    if "oem" in text_blob:
        score += 0.1

    return min(1.0, score)


def safer_removal(current: str, incoming: str) -> str:
    if RISK_ORDER.get(incoming, 1) > RISK_ORDER.get(current, 1):
        return incoming
    return current


def build_variant_for_oem(
    rows: list[dict[str, Any]],
    profile: OemProfile,
    min_score: float,
    min_desc_len: int,
) -> dict[str, Any]:
    selected: dict[str, dict[str, Any]] = {}
    evidence_buckets: defaultdict[str, int] = defaultdict(int)

    for row in rows:
        package_id = normalize_package_id(row.get("id"))
        if not package_id:
            continue

        score = score_membership(row, profile)
        if score < min_score:
            continue

        description = str(row.get("description") or "").strip()
        removal = normalize_removal(row.get("removal"))
        list_name = str(row.get("list") or "").strip() or "OEM"
        labels = row.get("labels") if isinstance(row.get("labels"), list) else []

        if len(description) < min_desc_len:
            description = f"Community OEM candidate for {profile.name}"

        evidence = []
        if any(package_id.startswith(prefix) for prefix in profile.prefixes):
            evidence.append("prefix-match")
        text_blob = normalize_text_blob(row.get("description"), labels, list_name)
        for keyword in profile.keywords:
            if keyword in text_blob:
                evidence.append(f"keyword:{keyword}")

        if not evidence:
            evidence.append("weak-match")

        existing = selected.get(package_id)
        if existing is None:
            selected[package_id] = {
                "id": package_id,
                "list": profile.name,
                "description": description,
                "removal": removal,
                "category": "BLOATWARE",
                "dependencies": row.get("dependencies") if isinstance(row.get("dependencies"), list) else [],
                "neededBy": row.get("neededBy") if isinstance(row.get("neededBy"), list) else [],
                "labels": sorted({
                    *[str(item) for item in labels if isinstance(item, str)],
                    profile.name.lower(),
                    "uad-online",
                    *evidence,
                }),
                "alternatives": row.get("alternatives") if isinstance(row.get("alternatives"), list) else [],
                "source": "variant:uad-online",
                "matchScore": round(score, 4),
            }
        else:
            existing["removal"] = safer_removal(str(existing.get("removal", "ADVANCED")), removal)
            existing["labels"] = sorted({
                *existing.get("labels", []),
                *[str(item) for item in labels if isinstance(item, str)],
                *evidence,
            })
            existing["matchScore"] = max(float(existing.get("matchScore", 0.0)), round(score, 4))

        for item in evidence:
            evidence_buckets[item] += 1

    return {
        "meta": {
            "oem": profile.name,
            "count": len(selected),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "source": "uad-online",
            "threshold": min_score,
            "evidence_summary": dict(sorted(evidence_buckets.items())),
        },
        "packages": sorted(selected.values(), key=lambda item: item["id"]),
    }


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(payload, file, indent=2, ensure_ascii=False)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build OEM variant files from online UAD list sources",
    )
    parser.add_argument(
        "--oems",
        nargs="+",
        default=["OPPO", "REALME", "INFINIX", "TECNO", "ITEL", "ONEPLUS", "VIVO", "HUAWEI"],
        help="OEM names to generate (e.g., OPPO REALME)",
    )
    parser.add_argument(
        "--uad-url",
        action="append",
        default=[],
        help="Optional UAD source URL, can be provided multiple times",
    )
    parser.add_argument(
        "--local-uad",
        type=Path,
        default=None,
        help="Optional local UAD JSON file path (offline mode)",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("model-api/raw-data"),
        help="Output directory for variants_*.json files",
    )
    parser.add_argument(
        "--min-score",
        type=float,
        default=0.7,
        help="Minimum OEM membership score (0..1)",
    )
    parser.add_argument(
        "--min-desc-len",
        type=int,
        default=12,
        help="Minimum description length before fallback text is used",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    oems = [item.strip().upper() for item in args.oems if item.strip()]
    unknown = [name for name in oems if name not in OEM_PROFILES]
    if unknown:
        raise ValueError(f"Unknown OEM names: {', '.join(unknown)}. Valid: {', '.join(sorted(OEM_PROFILES))}")

    urls = args.uad_url or DEFAULT_UAD_URLS
    rows, source_ref = choose_uad_payload(urls=urls, local_file=args.local_uad)

    generated_files: list[Path] = []
    for oem_name in oems:
        profile = OEM_PROFILES[oem_name]
        payload = build_variant_for_oem(
            rows=rows,
            profile=profile,
            min_score=max(0.0, min(1.0, args.min_score)),
            min_desc_len=max(0, args.min_desc_len),
        )
        payload["meta"]["source_ref"] = source_ref

        out_path = args.out_dir / f"variants_{oem_name.lower()}.json"
        write_json(out_path, payload)
        generated_files.append(out_path)

        print(f"[{oem_name}] wrote {payload['meta']['count']} packages -> {out_path}")

    print("Generated files:")
    for file_path in generated_files:
        print(f"  - {file_path}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
