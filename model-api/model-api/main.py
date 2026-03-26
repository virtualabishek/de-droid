"""
De-Droid Model API — Bloatware Detection Intelligence Layer.

FastAPI server that accepts package lists from ADB and returns
safety classifications with confidence scores and explanations.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

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
