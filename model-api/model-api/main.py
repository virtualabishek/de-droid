"""
De-Droid Model API — Bloatware Detection Intelligence Layer.

FastAPI server that accepts package lists from ADB and returns
safety classifications with confidence scores and explanations.
"""
from __future__ import annotations

import json
import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

import joblib
import numpy as np
from scipy.sparse import hstack

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ─────────────────────────────────────────────────────────────────────────────
# App setup
# ─────────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="De-Droid Safety API",
    description="Bloatware detection intelligence layer for Android packages",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────────────────────────────────────
# Paths and globals
# ─────────────────────────────────────────────────────────────────────────────

MODEL_DIR = Path(__file__).resolve().parent / "models"
PREDICTIONS_PATH = MODEL_DIR / "safety_predictions.json"
MODEL_PATH = MODEL_DIR / "safety_baseline.joblib"
PROJECT_MODEL_API_DIR = Path(__file__).resolve().parent.parent
FEEDBACK_DIR = PROJECT_MODEL_API_DIR / "feedback"
FEEDBACK_EVENTS_PATH = FEEDBACK_DIR / "events.jsonl"
FEEDBACK_VARIANTS_PATH = PROJECT_MODEL_API_DIR / "raw-data" / "variants_user_feedback.json"
PACKAGE_ID_PATTERN = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$")

# Fallback to parent model-api dir
if not MODEL_PATH.exists():
    MODEL_PATH = Path(__file__).resolve().parent.parent / "models" / "safety_baseline.joblib"
if not PREDICTIONS_PATH.exists():
    PREDICTIONS_PATH = Path(__file__).resolve().parent.parent / "models" / "safety_predictions.json"

# Precomputed predictions (loaded at startup)
_predictions_cache: dict[str, Any] = {}
_model_artifact: dict[str, Any] | None = None
_model_version: str = "unknown"


# ─────────────────────────────────────────────────────────────────────────────
# Critical-package safety denylist
# ─────────────────────────────────────────────────────────────────────────────

CRITICAL_SYSTEM_PACKAGES = frozenset([
    "com.android.systemui",
    "com.android.settings",
    "com.android.phone",
    "com.android.server.telecom",
    "com.android.providers.contacts",
    "com.android.providers.telephony",
    "com.android.providers.settings",
    "com.android.providers.media",
    "com.android.launcher",
    "com.android.launcher3",
    "com.android.inputmethod.latin",
    "com.android.packageinstaller",
    "com.android.vending",
    "com.android.providers.downloads",
    "com.android.bluetooth",
    "com.android.nfc",
    "com.android.wifi",
    "com.android.networkstack",
    "com.android.permissioncontroller",
    "com.android.se",
    "android",
    "com.android.keychain",
    "com.android.certinstaller",
    "com.android.shell",
    "com.android.providers.userdictionary",
    "com.android.location.fused",
    "com.google.android.gms",
    "com.google.android.gsf",
    "com.google.android.gsf.login",
    "com.google.android.ext.services",
    "com.google.android.ext.shared",
    "com.google.android.packageinstaller",
    "com.google.android.webview",
    "com.google.android.tts",
    "com.samsung.android.incallui",
    "com.samsung.android.dialer",
    "com.samsung.android.messaging",
    "com.samsung.android.providers.contacts",
    "com.samsung.android.telecom",
    "com.sec.android.app.launcher",
    "com.sec.android.inputmethod",
    "com.samsung.android.app.telephonyprovider",
    "com.miui.securitycenter",
    "com.miui.home",
    "com.xiaomi.finddevice",
    "com.miui.system",
    "com.miui.packageinstaller",
])


# Bloatware detection patterns
BLOATWARE_KEYWORDS = frozenset([
    "facebook", "netflix", "spotify", "tiktok", "candy", "game",
    "promotion", "promo", "marketing", "ads", "adservice", "analytics",
    "tracking", "tracker", "telemetry", "diagnostic", "demo", "retail",
    "trial", "tips", "getstarted", "weather", "news", "magazine",
    "music", "video", "shopping", "store", "wallet", "pay",
    "insurance", "health", "fitness", "social", "chat", "browser",
    "cleanmaster", "clean", "booster", "antivirus", "vpn",
    "lounge", "entertainment",
])

SYSTEM_KEYWORDS = frozenset([
    "systemui", "telecom", "telephony", "provider", "inputmethod",
    "launcher", "permission", "security", "keychain", "cert",
    "networkstack", "bluetooth", "wifi", "nfc", "shell",
    "packageinstaller", "contacts", "phone", "dialer", "incallui",
    "fused", "location", "settings", "drm",
])


# OEM prefix detection
COHORT_PREFIXES: dict[str, tuple[str, ...]] = {
    "SAMSUNG": ("com.samsung.", "com.sec.", "com.osp.", "com.wssyncmldm"),
    "XIAOMI": ("com.xiaomi.", "com.miui.", "com.mi.", "com.redmi."),
    "ONEPLUS": ("com.oneplus.", "net.oneplus.", "cn.oneplus."),
    "HUAWEI": ("com.huawei.", "com.hicloud.", "com.hisi."),
    "OPPO": ("com.oppo.", "com.coloros.", "com.heytap."),
    "VIVO": ("com.vivo.", "com.bbk.", "com.iqoo."),
    "GOOGLE": ("com.google.",),
    "ANDROID": ("com.android.",),
}

CANONICAL_LABELS = ("RECOMMENDED", "ADVANCED", "EXPERT", "UNSAFE")
RISK_ORDER = {
    "RECOMMENDED": 0,
    "ADVANCED": 1,
    "EXPERT": 2,
    "UNSAFE": 3,
}


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

class PackageCheckRequest(BaseModel):
    packages: list[str] = Field(
        ...,
        description="List of Android package IDs (e.g., from `adb shell pm list packages`)",
        min_length=1,
    )
    device_brand: str | None = Field(
        None,
        description="Optional device brand (Samsung, Xiaomi, etc.)",
    )


class PackageSafety(BaseModel):
    package_id: str
    label: str = Field(description="RECOMMENDED, ADVANCED, EXPERT, or UNSAFE")
    confidence: float = Field(ge=0.0, le=1.0)
    description: str = ""
    top_factors: list[str] = []
    safety_gate: list[str] | None = None
    oem_cohort: str | None = None
    is_bloatware: bool = False


class PackageCheckResponse(BaseModel):
    model_version: str
    total_packages: int
    summary: dict[str, int]
    packages: list[PackageSafety]


class HealthResponse(BaseModel):
    status: str
    model_version: str
    predictions_loaded: int
    model_loaded: bool


FeedbackAction = Literal["UNINSTALL", "DISABLE", "RESTORE", "ENABLE", "UNDO"]
FeedbackOutcome = Literal["SUCCESS", "FAILURE"]


class FeedbackEventIn(BaseModel):
    package_id: str = Field(
        ...,
        description="Android package ID",
        min_length=3,
        max_length=255,
    )
    action: FeedbackAction = Field(
        ...,
        description="User action done in app",
    )
    outcome: FeedbackOutcome = Field(
        ...,
        description="Result of that action",
    )
    model_label: str | None = Field(
        None,
        description="Model label shown when action was made",
    )
    model_confidence: float | None = Field(
        None,
        ge=0.0,
        le=1.0,
        description="Model confidence shown when action was made",
    )
    device_brand: str | None = Field(
        None,
        max_length=64,
        description="Optional device brand",
    )
    app_version: str | None = Field(
        None,
        max_length=64,
        description="Optional app version for traceability",
    )
    notes: str | None = Field(
        None,
        max_length=300,
        description="Optional short notes",
    )


class FeedbackRecord(BaseModel):
    id: str
    package_id: str
    action: FeedbackAction
    outcome: FeedbackOutcome
    model_label: str | None = None
    model_confidence: float | None = None
    device_brand: str | None = None
    app_version: str | None = None
    notes: str | None = None
    created_at: str


class FeedbackSummaryResponse(BaseModel):
    total_events: int
    window_days: int
    by_action: dict[str, int]
    by_outcome: dict[str, int]
    top_packages: list[dict[str, Any]]


class LabelProposal(BaseModel):
    package_id: str
    current_label: str | None = None
    proposed_label: str
    confidence: float = Field(ge=0.0, le=1.0)
    reasons: list[str]
    sample_size: int
    source: str = "user_feedback"


class RetrainSignalsResponse(BaseModel):
    generated_at: str
    min_events: int
    proposed_rows_count: int
    proposals: list[LabelProposal]


class RetrainExportResponse(BaseModel):
    generated_at: str
    output_path: str
    package_count: int


# ─────────────────────────────────────────────────────────────────────────────
# Inference helpers
# ─────────────────────────────────────────────────────────────────────────────

def detect_oem_cohort(package_id: str) -> str | None:
    pkg = package_id.lower()
    for cohort, prefixes in COHORT_PREFIXES.items():
        if any(pkg.startswith(p) for p in prefixes):
            return cohort
    return None


def apply_safety_gates(
    package_id: str,
    predicted_label: str,
    confidence: float,
) -> tuple[str, float, list[str]]:
    """Apply deterministic safety gates."""
    gate_reasons = []

    # Gate 1: Critical system denylist
    if package_id in CRITICAL_SYSTEM_PACKAGES:
        gate_reasons.append("critical_system_denylist")
        return "UNSAFE", 1.0, gate_reasons

    pkg = package_id.lower()

    # Gate 2: Core Android system package
    if pkg.startswith("com.android.") and any(kw in pkg for kw in SYSTEM_KEYWORDS):
        if predicted_label in ("RECOMMENDED", "ADVANCED"):
            gate_reasons.append("android_core_system_keyword")
            return "EXPERT", max(confidence, 0.85), gate_reasons

    # Gate 3: Low confidence upgrades
    if confidence < 0.45 and predicted_label == "RECOMMENDED":
        gate_reasons.append("low_confidence_safety_upgrade")
        return "ADVANCED", confidence, gate_reasons

    return predicted_label, confidence, gate_reasons


def is_likely_bloatware(package_id: str) -> bool:
    """Heuristic check if a package is likely bloatware."""
    pkg = package_id.lower()
    
    # Known bloatware patterns
    if any(kw in pkg for kw in BLOATWARE_KEYWORDS):
        return True
    
    # Carrier bloatware
    carrier_prefixes = [
        "com.att.", "com.sprint.", "com.tmobile.", "com.verizon.",
        "com.vzw.", "com.metropcs.",
    ]
    if any(pkg.startswith(p) for p in carrier_prefixes):
        return True
    
    return False


def classify_unknown_package(package_id: str) -> PackageSafety:
    """
    Classify a package we've never seen before using heuristics.
    This handles packages from ADB that aren't in our training data.
    """
    pkg = package_id.lower()
    oem = detect_oem_cohort(package_id)
    bloatware = is_likely_bloatware(package_id)
    factors = []
    
    # Check critical denylist first
    if package_id in CRITICAL_SYSTEM_PACKAGES:
        return PackageSafety(
            package_id=package_id,
            label="UNSAFE",
            confidence=1.0,
            description="Critical system package — do not remove",
            top_factors=["on critical system denylist"],
            safety_gate=["critical_system_denylist"],
            oem_cohort=oem,
            is_bloatware=False,
        )
    
    # System-critical keywords
    system_kw_count = sum(1 for kw in SYSTEM_KEYWORDS if kw in pkg)
    bloat_kw_count = sum(1 for kw in BLOATWARE_KEYWORDS if kw in pkg)
    
    if pkg.startswith("com.android.") and system_kw_count > 0:
        label = "EXPERT"
        confidence = 0.7
        factors.append("core Android package with system keywords")
    elif system_kw_count >= 2:
        label = "EXPERT"
        confidence = 0.65
        factors.append("multiple system-critical keywords detected")
    elif bloat_kw_count >= 2:
        label = "RECOMMENDED"
        confidence = 0.75
        factors.append("multiple bloatware keywords detected")
        bloatware = True
    elif bloat_kw_count == 1:
        label = "ADVANCED"
        confidence = 0.55
        factors.append("bloatware keyword detected")
        bloatware = True
    elif pkg.startswith("com.android.") or pkg.startswith("com.google."):
        label = "EXPERT"
        confidence = 0.6
        factors.append("core Android/Google package — proceed with caution")
    elif ".overlay" in pkg or ".res." in pkg:
        label = "EXPERT"
        confidence = 0.55
        factors.append("resource overlay package")
    elif oem:
        # OEM package not in training data
        label = "ADVANCED"
        confidence = 0.5
        factors.append(f"{oem} OEM package — not in database")
    else:
        label = "ADVANCED"
        confidence = 0.4
        factors.append("unknown package — not in safety database")
    
    return PackageSafety(
        package_id=package_id,
        label=label,
        confidence=confidence,
        description="Package not in training database — classified by heuristics",
        top_factors=factors,
        oem_cohort=oem,
        is_bloatware=bloatware,
    )


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_package_id(value: str) -> str:
    package_id = value.strip()
    if package_id.startswith("package:"):
        package_id = package_id[8:]
    package_id = package_id.lower().strip()

    if not package_id:
        raise HTTPException(status_code=422, detail="package_id must not be empty")

    if not PACKAGE_ID_PATTERN.match(package_id):
        raise HTTPException(
            status_code=422,
            detail=(
                "Invalid package_id format. Expected Android package ID "
                "like 'com.vendor.app'."
            ),
        )

    return package_id


def normalize_label(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().upper()
    return normalized if normalized in CANONICAL_LABELS else None


def parse_iso_datetime(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)

    return parsed.astimezone(timezone.utc)


def ensure_feedback_dir() -> None:
    FEEDBACK_DIR.mkdir(parents=True, exist_ok=True)


def append_feedback_record(record: FeedbackRecord) -> None:
    ensure_feedback_dir()
    with FEEDBACK_EVENTS_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record.model_dump(), ensure_ascii=False) + "\n")


def load_feedback_records(window_days: int | None = None) -> list[FeedbackRecord]:
    if not FEEDBACK_EVENTS_PATH.exists():
        return []

    cutoff: datetime | None = None
    if window_days is not None:
        safe_days = max(1, min(window_days, 3650))
        cutoff = datetime.now(timezone.utc) - timedelta(days=safe_days)

    records: list[FeedbackRecord] = []

    with FEEDBACK_EVENTS_PATH.open("r", encoding="utf-8") as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line:
                continue

            try:
                payload = json.loads(line)
                event = FeedbackRecord.model_validate(payload)
            except Exception:
                continue

            if cutoff is not None:
                created_at = parse_iso_datetime(event.created_at)
                if created_at is None or created_at < cutoff:
                    continue

            records.append(event)

    return records


def feedback_signal(event: FeedbackRecord) -> tuple[float, float]:
    safe_signal = 0.0
    unsafe_signal = 0.0

    if event.action in ("UNINSTALL", "DISABLE"):
        if event.outcome == "SUCCESS":
            safe_signal += 1.0
        else:
            unsafe_signal += 1.0
    elif event.action in ("RESTORE", "ENABLE", "UNDO"):
        if event.outcome == "SUCCESS":
            unsafe_signal += 1.0

    return safe_signal, unsafe_signal


def infer_feedback_label(
    safe_signal: float,
    unsafe_signal: float,
    sample_size: int,
) -> tuple[str, float, list[str]]:
    total_signal = safe_signal + unsafe_signal
    if total_signal <= 0:
        return "ADVANCED", 0.5, ["insufficient_direct_signals"]

    safe_rate = safe_signal / total_signal
    unsafe_rate = unsafe_signal / total_signal

    reasons = [
        f"safe_signal_rate={safe_rate:.2f}",
        f"unsafe_signal_rate={unsafe_rate:.2f}",
    ]

    if unsafe_rate >= 0.70:
        confidence = min(0.98, 0.55 + unsafe_rate * 0.4)
        reasons.append("rollback_or_failed_removal_dominant")
        return "UNSAFE", confidence, reasons

    if safe_rate >= 0.85 and sample_size >= 5:
        confidence = min(0.97, 0.5 + safe_rate * 0.4)
        reasons.append("successful_removal_dominant")
        return "RECOMMENDED", confidence, reasons

    if safe_rate >= 0.60:
        confidence = min(0.90, 0.45 + safe_rate * 0.35)
        reasons.append("mixed_feedback_but_safe_leaning")
        return "ADVANCED", confidence, reasons

    confidence = min(0.88, 0.45 + unsafe_rate * 0.25)
    reasons.append("mixed_or_uncertain_feedback")
    return "EXPERT", confidence, reasons


def get_current_label(package_id: str) -> str | None:
    raw = (_predictions_cache.get(package_id) or {}).get("label")
    if not isinstance(raw, str):
        return None
    return normalize_label(raw)


def build_feedback_proposals(
    *,
    window_days: int,
    min_events: int,
    include_same: bool,
) -> list[LabelProposal]:
    safe_days = max(1, min(window_days, 3650))
    safe_min_events = max(1, min(min_events, 200))

    records = load_feedback_records(window_days=safe_days)
    aggregates: dict[str, dict[str, Any]] = {}

    for event in records:
        package_id = event.package_id
        aggregate = aggregates.setdefault(
            package_id,
            {
                "events": 0,
                "safe_signal": 0.0,
                "unsafe_signal": 0.0,
                "actions": Counter(),
                "outcomes": Counter(),
            },
        )

        safe_signal, unsafe_signal = feedback_signal(event)
        aggregate["events"] += 1
        aggregate["safe_signal"] += safe_signal
        aggregate["unsafe_signal"] += unsafe_signal
        aggregate["actions"][event.action] += 1
        aggregate["outcomes"][event.outcome] += 1

    proposals: list[LabelProposal] = []

    for package_id, aggregate in aggregates.items():
        sample_size = int(aggregate["events"])
        if sample_size < safe_min_events:
            continue

        proposed_label, confidence, reasons = infer_feedback_label(
            safe_signal=float(aggregate["safe_signal"]),
            unsafe_signal=float(aggregate["unsafe_signal"]),
            sample_size=sample_size,
        )

        if package_id in CRITICAL_SYSTEM_PACKAGES:
            proposed_label = "UNSAFE"
            confidence = 1.0
            reasons = [
                "critical_system_denylist",
                *reasons,
            ]

        current_label = get_current_label(package_id)
        if not include_same and current_label == proposed_label:
            continue

        top_action = aggregate["actions"].most_common(1)
        top_action_value = top_action[0][0] if top_action else "UNKNOWN"

        reasons = [
            f"events={sample_size}",
            f"safe_signals={int(aggregate['safe_signal'])}",
            f"unsafe_signals={int(aggregate['unsafe_signal'])}",
            f"top_action={top_action_value}",
            *reasons,
        ]

        proposals.append(
            LabelProposal(
                package_id=package_id,
                current_label=current_label,
                proposed_label=proposed_label,
                confidence=round(confidence, 6),
                reasons=reasons,
                sample_size=sample_size,
            )
        )

    proposals.sort(
        key=lambda p: (-p.confidence, -p.sample_size, p.package_id),
    )
    return proposals


def feedback_proposal_to_variant_row(proposal: LabelProposal) -> dict[str, Any]:
    oem = detect_oem_cohort(proposal.package_id) or "UNKNOWN"

    if proposal.proposed_label in ("RECOMMENDED", "ADVANCED"):
        category = "BLOATWARE"
    elif proposal.proposed_label == "UNSAFE":
        category = "ESSENTIAL"
    else:
        category = "OPTIONAL"

    labels = [
        "user-feedback",
        f"proposed:{proposal.proposed_label.lower()}",
        f"sample-size:{proposal.sample_size}",
    ]

    return {
        "id": proposal.package_id,
        "list": oem,
        "description": "Learned from De-Droid user action feedback",
        "removal": proposal.proposed_label,
        "category": category,
        "dependencies": [],
        "neededBy": [],
        "labels": labels,
        "alternatives": [],
        "source": "variant:user_feedback",
    }


def resolve_feedback_export_path(out_path: str | None) -> Path:
    if not out_path:
        return FEEDBACK_VARIANTS_PATH

    requested = Path(out_path)
    resolved = (
        requested.resolve()
        if requested.is_absolute()
        else (PROJECT_MODEL_API_DIR.parent / requested).resolve()
    )

    allowed_root = PROJECT_MODEL_API_DIR.resolve()
    if not (resolved == allowed_root or allowed_root in resolved.parents):
        raise HTTPException(
            status_code=400,
            detail=f"out_path must be inside {allowed_root}",
        )

    return resolved


# ─────────────────────────────────────────────────────────────────────────────
# Startup
# ─────────────────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def load_models():
    global _predictions_cache, _model_artifact, _model_version
    
    # Load precomputed predictions
    if PREDICTIONS_PATH.exists():
        with PREDICTIONS_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
        _predictions_cache = data.get("predictions", {})
        _model_version = data.get("modelVersion", "unknown")
        print(f"✅ Loaded {len(_predictions_cache)} precomputed predictions (v: {_model_version})")
    else:
        print(f"⚠️ No predictions file found at {PREDICTIONS_PATH}")
    
    # Load model artifacts if available (for live inference)
    if MODEL_PATH.exists():
        try:
            _model_artifact = joblib.load(MODEL_PATH)
            print(f"✅ Loaded model artifact from {MODEL_PATH}")
        except Exception as e:
            print(f"⚠️ Could not load model: {e}")
    else:
        print(f"⚠️ No model file found at {MODEL_PATH}")


# ─────────────────────────────────────────────────────────────────────────────
# API Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="ok",
        model_version=_model_version,
        predictions_loaded=len(_predictions_cache),
        model_loaded=_model_artifact is not None,
    )


@app.post("/api/check-packages", response_model=PackageCheckResponse)
async def check_packages(request: PackageCheckRequest):
    """
    Check safety of Android packages.
    
    Accepts a list of package IDs (as returned by `adb shell pm list packages`)
    and returns safety classifications for each.
    """
    # Clean package IDs (strip "package:" prefix if present)
    cleaned = []
    for pkg in request.packages:
        clean = pkg.strip()
        if clean.startswith("package:"):
            clean = clean[8:]
        if clean:
            cleaned.append(clean)
    
    if not cleaned:
        raise HTTPException(status_code=400, detail="No valid package IDs provided")
    
    results: list[PackageSafety] = []
    summary: dict[str, int] = {
        "RECOMMENDED": 0,
        "ADVANCED": 0,
        "EXPERT": 0,
        "UNSAFE": 0,
    }
    
    for pkg_id in cleaned:
        # Check precomputed predictions first
        if pkg_id in _predictions_cache:
            cached = _predictions_cache[pkg_id]
            
            # Apply safety gates on top of cached predictions
            final_label, final_conf, gate_reasons = apply_safety_gates(
                pkg_id,
                cached.get("label", "ADVANCED"),
                cached.get("confidence", 0.5),
            )
            
            oem = detect_oem_cohort(pkg_id)
            bloatware = is_likely_bloatware(pkg_id)
            
            entry = PackageSafety(
                package_id=pkg_id,
                label=final_label,
                confidence=final_conf,
                top_factors=cached.get("top_factors", []),
                safety_gate=gate_reasons if gate_reasons else cached.get("safety_gate"),
                oem_cohort=oem,
                is_bloatware=bloatware,
            )
        else:
            # Unknown package → use heuristic classifier
            entry = classify_unknown_package(pkg_id)
        
        summary[entry.label] = summary.get(entry.label, 0) + 1
        results.append(entry)
    
    # Sort: UNSAFE first, then EXPERT, ADVANCED, RECOMMENDED
    label_order = {"UNSAFE": 0, "EXPERT": 1, "ADVANCED": 2, "RECOMMENDED": 3}
    results.sort(key=lambda x: (label_order.get(x.label, 99), -x.confidence))
    
    return PackageCheckResponse(
        model_version=_model_version,
        total_packages=len(results),
        summary=summary,
        packages=results,
    )


@app.post("/api/check-single")
async def check_single_package(package_id: str):
    """Quick check for a single package."""
    response = await check_packages(PackageCheckRequest(packages=[package_id]))
    if response.packages:
        return response.packages[0]
    raise HTTPException(status_code=404, detail="Package not found")


@app.get("/api/stats")
async def model_stats():
    """Return model statistics and coverage info."""
    if not _predictions_cache:
        return {
            "status": "no_data",
            "message": "No predictions loaded. Train the model first.",
        }
    
    label_counts: dict[str, int] = {}
    oem_counts: dict[str, int] = {}
    total = len(_predictions_cache)
    
    for pkg_id, pred in _predictions_cache.items():
        label = pred.get("label", "UNKNOWN")
        label_counts[label] = label_counts.get(label, 0) + 1
        
        oem = detect_oem_cohort(pkg_id) or "OTHER"
        oem_counts[oem] = oem_counts.get(oem, 0) + 1
    
    return {
        "model_version": _model_version,
        "total_packages": total,
        "label_distribution": label_counts,
        "oem_distribution": oem_counts,
        "critical_packages_count": len(CRITICAL_SYSTEM_PACKAGES),
    }


@app.get("/api/critical-packages")
async def get_critical_packages():
    """Return the list of critical system packages that should never be removed."""
    return {
        "count": len(CRITICAL_SYSTEM_PACKAGES),
        "packages": sorted(CRITICAL_SYSTEM_PACKAGES),
        "description": "These packages are critical to device operation and will always be marked UNSAFE.",
    }


@app.get("/api/search/{query}")
async def search_packages(query: str):
    """Search for packages matching a query string."""
    query_lower = query.lower()
    matches = []
    
    for pkg_id, pred in _predictions_cache.items():
        if query_lower in pkg_id.lower():
            oem = detect_oem_cohort(pkg_id)
            matches.append({
                "package_id": pkg_id,
                "label": pred.get("label"),
                "confidence": pred.get("confidence"),
                "top_factors": pred.get("top_factors", []),
                "oem_cohort": oem,
            })
    
    matches.sort(key=lambda x: x["package_id"])
    return {
        "query": query,
        "total_matches": len(matches),
        "results": matches[:100],  # Cap at 100
    }


@app.post("/api/feedback/events")
async def ingest_feedback_event(event: FeedbackEventIn):
    """
    Record a user action outcome for future model retraining.

    This endpoint is designed for app-side telemetry ingestion where
    package uninstall/disable/restore outcomes can be transformed into
    weak supervision signals.
    """
    normalized_package_id = normalize_package_id(event.package_id)
    normalized_label = normalize_label(event.model_label)

    record = FeedbackRecord(
        id=f"fbk_{uuid4().hex}",
        package_id=normalized_package_id,
        action=event.action,
        outcome=event.outcome,
        model_label=normalized_label,
        model_confidence=event.model_confidence,
        device_brand=event.device_brand.strip().upper() if event.device_brand else None,
        app_version=event.app_version,
        notes=event.notes,
        created_at=utc_now_iso(),
    )
    append_feedback_record(record)

    return {
        "status": "ok",
        "message": "feedback event recorded",
        "event_id": record.id,
        "recorded_at": record.created_at,
    }


@app.get("/api/feedback/summary", response_model=FeedbackSummaryResponse)
async def feedback_summary(days: int = 30, top: int = 20):
    """Return aggregate stats for feedback events."""
    window_days = max(1, min(days, 3650))
    top_k = max(1, min(top, 200))

    records = load_feedback_records(window_days=window_days)
    by_action = Counter(record.action for record in records)
    by_outcome = Counter(record.outcome for record in records)
    by_package = Counter(record.package_id for record in records)

    top_packages = [
        {"package_id": package_id, "events": count}
        for package_id, count in by_package.most_common(top_k)
    ]

    return FeedbackSummaryResponse(
        total_events=len(records),
        window_days=window_days,
        by_action=dict(by_action),
        by_outcome=dict(by_outcome),
        top_packages=top_packages,
    )


@app.get("/api/retrain/signals", response_model=RetrainSignalsResponse)
async def retrain_signals(
    days: int = 90,
    min_events: int = 3,
    include_same: bool = False,
    limit: int = 500,
):
    """
    Build candidate package-label updates from user feedback events.

    This does not retrain the model itself; it generates reviewable
    label proposals that can be merged into the dataset pipeline.
    """
    proposals = build_feedback_proposals(
        window_days=days,
        min_events=min_events,
        include_same=include_same,
    )
    safe_limit = max(1, min(limit, 5000))
    trimmed = proposals[:safe_limit]

    return RetrainSignalsResponse(
        generated_at=utc_now_iso(),
        min_events=max(1, min(min_events, 200)),
        proposed_rows_count=len(trimmed),
        proposals=trimmed,
    )


@app.post("/api/retrain/export-variant", response_model=RetrainExportResponse)
async def retrain_export_variant(
    days: int = 90,
    min_events: int = 3,
    include_same: bool = False,
    out_path: str | None = None,
):
    """
    Export feedback-driven proposals as a variant dataset JSON.

    Output can be consumed by:
      `build_training_dataset.py --variants <generated_file>`
    """
    proposals = build_feedback_proposals(
        window_days=days,
        min_events=min_events,
        include_same=include_same,
    )

    output_path = resolve_feedback_export_path(out_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    payload = {
        "meta": {
            "source": "user_feedback",
            "generated_at": utc_now_iso(),
            "window_days": max(1, min(days, 3650)),
            "min_events": max(1, min(min_events, 200)),
            "count": len(proposals),
        },
        "packages": [feedback_proposal_to_variant_row(proposal) for proposal in proposals],
    }

    with output_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    return RetrainExportResponse(
        generated_at=payload["meta"]["generated_at"],
        output_path=str(output_path),
        package_count=len(proposals),
    )


@app.get("/api/retrain/commands")
async def retrain_commands(
    variant_path: str | None = None,
):
    """Return helper shell commands for feedback-based retraining."""
    resolved_path = resolve_feedback_export_path(variant_path)
    rel_path = resolved_path.relative_to(PROJECT_MODEL_API_DIR.parent)

    return {
        "variant_file": str(rel_path),
        "commands": {
            "build_dataset": (
                "python3 model-api/scripts/build_training_dataset.py "
                f"--variants model-api/raw-data/variants_samsung.json model-api/raw-data/variants_redmi.json {rel_path}"
            ),
            "train_model": (
                "python3 model-api/scripts/train_safety_model.py "
                "--dataset model-api/processed/training_dataset.json"
            ),
            "run_api": (
                "python3 -m uvicorn main:app --app-dir model-api/model-api "
                "--host 0.0.0.0 --port 8000 --reload"
            ),
        },
        "note": "Run commands from repository root.",
    }
