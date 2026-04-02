from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from scipy.sparse import hstack, csr_matrix
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.ensemble import (
    GradientBoostingClassifier,
    HistGradientBoostingClassifier,
    VotingClassifier,
)
from sklearn.linear_model import LogisticRegression, SGDClassifier
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import train_test_split, StratifiedKFold
from sklearn.preprocessing import OneHotEncoder, LabelEncoder
from sklearn.calibration import CalibratedClassifierCV


# ─────────────────────────────────────────────────────────────────────────────
# OEM cohort detection
# ─────────────────────────────────────────────────────────────────────────────

COHORT_PREFIXES: dict[str, tuple[str, ...]] = {
    "SAMSUNG": (
        "com.samsung.",
        "com.sec.",
        "com.osp.",
        "com.wssyncmldm",
    ),
    "XIAOMI": (
        "com.xiaomi.",
        "com.miui.",
        "com.mi.",
        "com.redmi.",
    ),
    "ONEPLUS": (
        "com.oneplus.",
        "net.oneplus.",
        "cn.oneplus.",
    ),
    "HUAWEI": (
        "com.huawei.",
        "com.hicloud.",
        "com.hisi.",
    ),
    "OPPO": (
        "com.oppo.",
        "com.coloros.",
        "com.heytap.",
        "com.oplus.",
        "com.nearme.",
    ),
    "REALME": (
        "com.realme.",
        "com.oplus.",
        "com.nearme.",
        "com.heytap.",
        "com.coloros.",
    ),
    "VIVO": (
        "com.vivo.",
        "com.bbk.",
        "com.iqoo.",
    ),
    "INFINIX": (
        "com.infinix.",
        "com.transsion.",
        "com.xos.",
        "com.xclub.",
    ),
    "TECNO": (
        "com.tecno.",
        "com.transsion.",
        "com.hios.",
    ),
    "ITEL": (
        "com.itel.",
        "com.transsion.",
        "com.palmstore.",
    ),
}

BASELINE_OEMS = ["SAMSUNG", "XIAOMI"]
EXPANSION_OEMS = ["ONEPLUS", "HUAWEI", "OPPO", "REALME", "VIVO", "INFINIX", "TECNO", "ITEL"]


# ─────────────────────────────────────────────────────────────────────────────
# Critical-package safety denylist  (Phase 3 safety gates)
# Packages here are ALWAYS labelled UNSAFE regardless of model prediction.
# ─────────────────────────────────────────────────────────────────────────────

CRITICAL_SYSTEM_PACKAGES = frozenset([
    # Core Android system
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
    # Google core services
    "com.google.android.gms",
    "com.google.android.gsf",
    "com.google.android.gsf.login",
    "com.google.android.ext.services",
    "com.google.android.ext.shared",
    "com.google.android.packageinstaller",
    "com.google.android.webview",
    "com.google.android.tts",
    # Samsung critical
    "com.samsung.android.incallui",
    "com.samsung.android.dialer",
    "com.samsung.android.messaging",
    "com.samsung.android.providers.contacts",
    "com.samsung.android.telecom",
    "com.sec.android.app.launcher",
    "com.sec.android.inputmethod",
    "com.samsung.android.app.telephonyprovider",
    # Xiaomi critical
    "com.miui.securitycenter",
    "com.miui.home",
    "com.xiaomi.finddevice",
    "com.miui.system",
    "com.miui.packageinstaller",
])


# Bloatware keyword patterns — strongly suggest safe-to-remove
BLOATWARE_KEYWORDS = frozenset([
    "facebook", "netflix", "spotify", "tiktok", "candy", "game",
    "promotion", "promo", "marketing", "ads", "adservice", "ad",
    "analytics", "tracking", "tracker", "telemetry", "diagnostic",
    "demo", "retail", "trial", "tips", "getstarted", "weather",
    "news", "magazine", "music", "video", "shopping", "store",
    "wallet", "pay", "insurance", "health", "fitness",
    "social", "chat", "browser", "cleanmaster", "clean",
    "booster", "antivirus", "vpn", "lounge", "entertainment",
])

# System-critical keyword patterns — suggest unsafe-to-remove
SYSTEM_KEYWORDS = frozenset([
    "systemui", "telecom", "telephony", "provider", "inputmethod",
    "launcher", "permission", "security", "keychain", "cert",
    "networkstack", "bluetooth", "wifi", "nfc", "shell",
    "packageinstaller", "contacts", "phone", "dialer", "incallui",
    "fused", "location", "settings", "drm",
])


# ─────────────────────────────────────────────────────────────────────────────
# Feature engineering
# ─────────────────────────────────────────────────────────────────────────────

def extract_package_features(package_id: str) -> list[float]:
    """Extract structural features from a package name."""
    pkg = package_id.lower()
    segments = pkg.split(".")
    
    features = [
        len(segments),                                     # num segments
        len(pkg),                                          # total length
        1.0 if pkg.startswith("com.android.") else 0.0,    # is_android_core
        1.0 if pkg.startswith("com.google.") else 0.0,     # is_google
        1.0 if any(pkg.startswith(p) for p in COHORT_PREFIXES.get("SAMSUNG", ())) else 0.0,
        1.0 if any(pkg.startswith(p) for p in COHORT_PREFIXES.get("XIAOMI", ())) else 0.0,
        1.0 if any(pkg.startswith(p) for p in COHORT_PREFIXES.get("HUAWEI", ())) else 0.0,
        1.0 if any(pkg.startswith(p) for p in COHORT_PREFIXES.get("OPPO", ())) else 0.0,
        1.0 if any(pkg.startswith(p) for p in COHORT_PREFIXES.get("REALME", ())) else 0.0,
        1.0 if any(pkg.startswith(p) for p in COHORT_PREFIXES.get("VIVO", ())) else 0.0,
        1.0 if any(pkg.startswith(p) for p in COHORT_PREFIXES.get("ONEPLUS", ())) else 0.0,
        1.0 if any(pkg.startswith(p) for p in COHORT_PREFIXES.get("INFINIX", ())) else 0.0,
        1.0 if any(pkg.startswith(p) for p in COHORT_PREFIXES.get("TECNO", ())) else 0.0,
        1.0 if any(pkg.startswith(p) for p in COHORT_PREFIXES.get("ITEL", ())) else 0.0,
        # Carrier indicators
        1.0 if any(t in pkg for t in ["carrier", "sprint", "verizon", "tmobile", "att"]) else 0.0,
        # Bloatware keyword match count
        sum(1.0 for kw in BLOATWARE_KEYWORDS if kw in pkg),
        # System keyword match count
        sum(1.0 for kw in SYSTEM_KEYWORDS if kw in pkg),
        # Has "overlay" in name (usually themes/cosmetic → safe)
        1.0 if "overlay" in pkg else 0.0,
        # Has "res." segment (resource overlay → usually expert)
        1.0 if ".res." in pkg else 0.0,
        # Has "service" in name
        1.0 if "service" in pkg else 0.0,
        # Has "provider" in name
        1.0 if "provider" in pkg else 0.0,
        # Is on critical denylist
        1.0 if package_id in CRITICAL_SYSTEM_PACKAGES else 0.0,
    ]
    return features


PACKAGE_FEATURE_NAMES = [
    "pkg:segment_count",
    "pkg:length",
    "pkg:is_android_core",
    "pkg:is_google",
    "pkg:is_samsung",
    "pkg:is_xiaomi",
    "pkg:is_huawei",
    "pkg:is_oppo",
    "pkg:is_realme",
    "pkg:is_vivo",
    "pkg:is_oneplus",
    "pkg:is_infinix",
    "pkg:is_tecno",
    "pkg:is_itel",
    "pkg:is_carrier",
    "pkg:bloatware_kw_count",
    "pkg:system_kw_count",
    "pkg:has_overlay",
    "pkg:has_res",
    "pkg:has_service",
    "pkg:has_provider",
    "pkg:is_critical_denylist",
]


def load_rows(dataset_path: Path) -> list[dict]:
    with dataset_path.open("r", encoding="utf-8") as file:
        payload = json.load(file)
    return payload["rows"]


def build_enriched_text(row: dict) -> str:
    """Build richer text feature by combining multiple fields."""
    parts = [
        row.get("package_id", ""),
        row.get("oem_list", ""),
        row.get("description", ""),
        " ".join(row.get("labels", [])),
        row.get("category", ""),
    ]
    # Add separated package name tokens
    pkg = row.get("package_id", "")
    parts.append(" ".join(pkg.split(".")))
    return " ".join(parts).strip()


def build_features(rows: list[dict]):
    texts = [build_enriched_text(row) for row in rows]
    oem_lists = np.array([[row.get("oem_list", "UNKNOWN")] for row in rows])
    
    # Extended numeric features
    numeric = np.array(
        [
            [
                row.get("dep_count", 0),
                row.get("needed_by_count", 0),
                row.get("label_count", 0),
                row.get("has_alternatives", 0),
                len(row.get("description", "")),               # desc_length
                1.0 if row.get("description", "").strip() else 0.0,  # has_description
            ]
            for row in rows
        ],
        dtype=float,
    )
    
    # Package structural features
    pkg_features = np.array(
        [extract_package_features(row.get("package_id", "")) for row in rows],
        dtype=float,
    )
    
    labels = np.array([row["removal"] for row in rows])
    return texts, oem_lists, numeric, pkg_features, labels


def build_sample_weights(rows: list[dict]) -> np.ndarray:
    weights: list[float] = []
    for row in rows:
        confidence = float(row.get("source_confidence", 0.75))
        label = str(row.get("removal", "ADVANCED"))

        if label == "UNSAFE":
            confidence = min(1.0, confidence + 0.1)
        elif label == "RECOMMENDED":
            confidence = max(0.45, confidence - 0.05)

        weights.append(max(0.35, min(1.2, confidence)))

    return np.array(weights, dtype=float)


def build_feature_names(
    text_vectorizer: TfidfVectorizer,
    char_vectorizer: TfidfVectorizer,
    oem_encoder: OneHotEncoder,
) -> list[str]:
    text_names = [f"text:{name}" for name in text_vectorizer.get_feature_names_out()]
    char_names = [f"char:{name}" for name in char_vectorizer.get_feature_names_out()]
    oem_names = [
        f"oem:{name}"
        for name in oem_encoder.get_feature_names_out(["oem_list"])
    ]
    numeric_names = [
        "num:dep_count",
        "num:needed_by_count",
        "num:label_count",
        "num:has_alternatives",
        "num:desc_length",
        "num:has_description",
    ]
    return [*text_names, *char_names, *oem_names, *numeric_names, *PACKAGE_FEATURE_NAMES]


def humanize_factor(feature_name: str) -> str:
    if feature_name.startswith("text:"):
        token = feature_name.removeprefix("text:").replace("_", " ")
        return f"text contains '{token}'"

    if feature_name.startswith("char:"):
        token = feature_name.removeprefix("char:").replace("_", " ")
        return f"char pattern '{token}'"

    if feature_name.startswith("oem:oem_list_"):
        oem = feature_name.removeprefix("oem:oem_list_")
        return f"OEM list '{oem}'"

    if feature_name.startswith("pkg:"):
        pkg_map = {
            "pkg:segment_count": "package name has many segments",
            "pkg:length": "package name is long",
            "pkg:is_android_core": "core Android package",
            "pkg:is_google": "Google package",
            "pkg:is_samsung": "Samsung package",
            "pkg:is_xiaomi": "Xiaomi package",
            "pkg:is_huawei": "Huawei package",
            "pkg:is_oppo": "OPPO package",
            "pkg:is_realme": "Realme package",
            "pkg:is_vivo": "Vivo package",
            "pkg:is_oneplus": "OnePlus package",
            "pkg:is_infinix": "Infinix package",
            "pkg:is_tecno": "Tecno package",
            "pkg:is_itel": "Itel package",
            "pkg:is_carrier": "carrier-installed package",
            "pkg:bloatware_kw_count": "matches bloatware keywords",
            "pkg:system_kw_count": "matches system-critical keywords",
            "pkg:has_overlay": "is an overlay/theme package",
            "pkg:has_res": "is a resource overlay",
            "pkg:has_service": "is a service component",
            "pkg:has_provider": "is a content provider",
            "pkg:is_critical_denylist": "on critical system denylist",
        }
        return pkg_map.get(feature_name, feature_name)

    numeric_map = {
        "num:dep_count": "package has dependency links",
        "num:needed_by_count": "other packages depend on it",
        "num:label_count": "package has many labels/tags",
        "num:has_alternatives": "open-source alternative exists",
        "num:desc_length": "description is detailed",
        "num:has_description": "has a description",
    }
    return numeric_map.get(feature_name, feature_name)


def top_factors_for_row(
    row_vector,
    predicted_label: str,
    model,
    feature_names: list[str],
    limit: int = 4,
) -> list[str]:
    """Extract top contributing factors for a prediction."""
    try:
        # For models with coef_ (linear)
        if hasattr(model, "coef_"):
            classes = list(model.classes_)
            class_index = classes.index(predicted_label)
            coefficients = model.coef_
            
            if hasattr(row_vector, 'toarray'):
                row_dense = row_vector.toarray().flatten()
            else:
                row_dense = np.asarray(row_vector).flatten()
            
            contributions = []
            for i, value in enumerate(row_dense):
                if value != 0 and i < coefficients.shape[1]:
                    score = float(value * coefficients[class_index, i])
                    if score > 0:
                        contributions.append((score, feature_names[i]))
            
            if not contributions:
                for i, value in enumerate(row_dense):
                    if value != 0 and i < coefficients.shape[1]:
                        score = abs(float(value * coefficients[class_index, i]))
                        contributions.append((score, feature_names[i]))
            
            top = sorted(contributions, key=lambda item: item[0], reverse=True)[:limit]
            return [humanize_factor(name) for _, name in top]
        
        # For tree-based models with feature_importances_
        elif hasattr(model, "feature_importances_"):
            importances = model.feature_importances_
            
            if hasattr(row_vector, 'toarray'):
                row_dense = row_vector.toarray().flatten()
            else:
                row_dense = np.asarray(row_vector).flatten()
            
            contributions = []
            for i, value in enumerate(row_dense):
                if value != 0 and i < len(importances):
                    score = float(abs(value) * importances[i])
                    contributions.append((score, feature_names[i]))
            
            top = sorted(contributions, key=lambda item: item[0], reverse=True)[:limit]
            return [humanize_factor(name) for _, name in top]
        
        # Fallback for ensemble/voting models
        else:
            return ["ensemble prediction"]
    
    except Exception:
        return ["model prediction"]


def infer_oem_cohort(package_id: str) -> str | None:
    package = package_id.lower()
    for cohort, prefixes in COHORT_PREFIXES.items():
        if package.startswith(prefixes):
            return cohort
    return None


def apply_safety_gates(
    package_id: str,
    predicted_label: str,
    confidence: float,
) -> tuple[str, float, list[str]]:
    """
    Apply deterministic safety gates.
    Returns: (final_label, final_confidence, gate_reasons)
    """
    gate_reasons = []
    
    # Gate 1: Critical denylist
    if package_id in CRITICAL_SYSTEM_PACKAGES:
        gate_reasons.append("critical_system_denylist")
        return "UNSAFE", 1.0, gate_reasons
    
    # Gate 2: Core Android system package keyword check
    pkg = package_id.lower()
    if pkg.startswith("com.android.") and any(kw in pkg for kw in SYSTEM_KEYWORDS):
        if predicted_label in ("RECOMMENDED", "ADVANCED"):
            gate_reasons.append("android_core_system_keyword")
            return "EXPERT", max(confidence, 0.85), gate_reasons
    
    # Gate 3: Low confidence → route to ADVANCED
    if confidence < 0.45 and predicted_label == "RECOMMENDED":
        gate_reasons.append("low_confidence_safety_upgrade")
        return "ADVANCED", confidence, gate_reasons
    
    return predicted_label, confidence, gate_reasons


# ─────────────────────────────────────────────────────────────────────────────
# Evaluation metrics
# ─────────────────────────────────────────────────────────────────────────────

def expected_calibration_error(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    y_prob: np.ndarray,
    bins: int = 10,
) -> float:
    if len(y_true) == 0:
        return 0.0

    confidences = np.max(y_prob, axis=1)
    correctness = (y_true == y_pred).astype(float)
    edges = np.linspace(0.0, 1.0, bins + 1)
    ece = 0.0

    for i in range(bins):
        lower = edges[i]
        upper = edges[i + 1]
        in_bin = (confidences > lower) & (confidences <= upper)
        count = int(np.sum(in_bin))
        if count == 0:
            continue

        avg_confidence = float(np.mean(confidences[in_bin]))
        avg_accuracy = float(np.mean(correctness[in_bin]))
        ece += (count / len(y_true)) * abs(avg_accuracy - avg_confidence)

    return float(ece)


def compute_trust_metrics(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    y_prob: np.ndarray,
    labels_sorted: list[str],
) -> dict[str, Any]:
    if len(y_true) == 0:
        return {
            "sample_size": 0,
            "accuracy": 0.0,
            "macro_f1": 0.0,
            "unsafe_recall": 0.0,
            "false_safe_rate": None,
            "confidence_coverage_ge_0_8": 0.0,
            "expected_calibration_error": 0.0,
            "confusion_matrix": [],
            "classification_report": {},
        }

    report = classification_report(y_true, y_pred, output_dict=True, zero_division=0)
    cm = confusion_matrix(y_true, y_pred, labels=labels_sorted).tolist()

    confidences = np.max(y_prob, axis=1)
    unsafe_mask = y_true == "UNSAFE"
    unsafe_count = int(np.sum(unsafe_mask))
    false_safe = int(np.sum((y_pred != "UNSAFE") & unsafe_mask))
    false_safe_rate = (false_safe / unsafe_count) if unsafe_count else None

    return {
        "sample_size": int(len(y_true)),
        "accuracy": float(np.mean(y_true == y_pred)),
        "macro_f1": float(report.get("macro avg", {}).get("f1-score", 0.0)),
        "unsafe_recall": float(report.get("UNSAFE", {}).get("recall", 0.0)),
        "false_safe_rate": false_safe_rate,
        "confidence_coverage_ge_0_8": float(np.mean(confidences >= 0.8)),
        "expected_calibration_error": expected_calibration_error(y_true, y_pred, y_prob),
        "confusion_matrix": cm,
        "classification_report": report,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Training pipeline
# ─────────────────────────────────────────────────────────────────────────────

def oversample_minority(rows: list[dict], target_label: str, factor: int = 3) -> list[dict]:
    """Simple oversampling for minority class."""
    minority = [r for r in rows if r["removal"] == target_label]
    if not minority:
        return rows
    oversampled = rows.copy()
    for _ in range(factor - 1):
        oversampled.extend(minority)
    return oversampled


def build_sparse_features(
    texts: list[str],
    oem_lists: np.ndarray,
    numeric: np.ndarray,
    pkg_features: np.ndarray,
    text_vectorizer: TfidfVectorizer,
    char_vectorizer: TfidfVectorizer,
    oem_encoder: OneHotEncoder,
    fit: bool = False,
) -> csr_matrix:
    """Combine all features into a single sparse matrix."""
    if fit:
        X_text = text_vectorizer.fit_transform(texts)
        X_char = char_vectorizer.fit_transform(texts)
        X_oem = oem_encoder.fit_transform(oem_lists)
    else:
        X_text = text_vectorizer.transform(texts)
        X_char = char_vectorizer.transform(texts)
        X_oem = oem_encoder.transform(oem_lists)
    
    return hstack([X_text, X_char, X_oem, numeric, pkg_features]).tocsr()


def train_and_predict(
    rows: list[dict],
    train_indices: np.ndarray,
    eval_indices: np.ndarray,
    max_features: int,
) -> tuple[np.ndarray, np.ndarray, list[str]]:
    texts, oem_lists, numeric, pkg_features, labels = build_features(rows)
    sample_weights = build_sample_weights(rows)

    text_vectorizer = TfidfVectorizer(
        max_features=max_features,
        ngram_range=(1, 2),
        sublinear_tf=True,
    )
    char_vectorizer = TfidfVectorizer(
        analyzer="char_wb",
        ngram_range=(3, 5),
        max_features=max_features // 2,
        sublinear_tf=True,
    )
    oem_encoder = OneHotEncoder(handle_unknown="ignore")

    X_train = build_sparse_features(
        [texts[i] for i in train_indices],
        oem_lists[train_indices],
        numeric[train_indices],
        pkg_features[train_indices],
        text_vectorizer, char_vectorizer, oem_encoder,
        fit=True,
    )
    X_eval = build_sparse_features(
        [texts[i] for i in eval_indices],
        oem_lists[eval_indices],
        numeric[eval_indices],
        pkg_features[eval_indices],
        text_vectorizer, char_vectorizer, oem_encoder,
        fit=False,
    )

    y_train = labels[train_indices]
    y_eval = labels[eval_indices]

    # Use calibrated SGD for speed with large sparse features
    model = CalibratedClassifierCV(
        SGDClassifier(
            loss="modified_huber",
            class_weight="balanced",
            max_iter=2000,
            random_state=42,
        ),
        cv=3,
    )
    model.fit(X_train, y_train, sample_weight=sample_weights[train_indices])

    y_pred = model.predict(X_eval)
    y_prob = model.predict_proba(X_eval)
    
    # Apply safety gates
    package_ids = [rows[i]["package_id"] for i in eval_indices]
    for idx, pkg_id in enumerate(package_ids):
        gated_label, gated_conf, reasons = apply_safety_gates(
            pkg_id, str(y_pred[idx]), float(np.max(y_prob[idx]))
        )
        if reasons:
            y_pred[idx] = gated_label
    
    labels_sorted = sorted(set(labels))
    return y_pred, y_prob, labels_sorted


def run_oem_holdout(
    rows: list[dict],
    cohorts_to_eval: list[str],
    max_features: int,
) -> dict[str, Any]:
    package_ids = [row["package_id"] for row in rows]
    cohorts = {
        cohort: np.array(
            [i for i, package_id in enumerate(package_ids) if infer_oem_cohort(package_id) == cohort],
            dtype=int,
        )
        for cohort in cohorts_to_eval
    }

    all_indices = np.arange(len(rows), dtype=int)
    labels = np.array([row["removal"] for row in rows])
    result: dict[str, Any] = {}

    for cohort_name, eval_indices in cohorts.items():
        train_indices = np.array(
            [i for i in all_indices if i not in set(eval_indices)],
            dtype=int,
        )

        if len(eval_indices) < 5 or len(train_indices) < 20:
            result[cohort_name] = {
                "status": "insufficient_data",
                "sample_size": int(len(eval_indices)),
            }
            continue

        if len(set(labels[train_indices])) < 2:
            result[cohort_name] = {
                "status": "insufficient_train_label_variety",
                "sample_size": int(len(eval_indices)),
            }
            continue

        y_pred, y_prob, labels_sorted = train_and_predict(
            rows,
            train_indices,
            eval_indices,
            max_features=max_features,
        )
        y_eval = labels[eval_indices]
        metrics = compute_trust_metrics(y_eval, y_pred, y_prob, labels_sorted)
        result[cohort_name] = {
            "status": "ok",
            **metrics,
        }

    return result


def evaluate_release_criteria(
    holdout_metrics: dict[str, Any],
    unsafe_recall_min: float,
    false_safe_rate_max: float,
) -> dict[str, Any]:
    criteria = {
        "unsafe_recall_min": unsafe_recall_min,
        "false_safe_rate_max": false_safe_rate_max,
        "per_oem": {},
    }

    for oem_name, payload in holdout_metrics.items():
        if payload.get("status") != "ok":
            criteria["per_oem"][oem_name] = {
                "status": payload.get("status"),
                "passes": False,
            }
            continue

        unsafe_recall = float(payload.get("unsafe_recall", 0.0))
        false_safe_rate = payload.get("false_safe_rate")
        false_safe_ok = (
            False
            if false_safe_rate is None
            else float(false_safe_rate) <= false_safe_rate_max
        )

        criteria["per_oem"][oem_name] = {
            "status": "ok",
            "passes": bool(unsafe_recall >= unsafe_recall_min and false_safe_ok),
            "unsafe_recall": unsafe_recall,
            "false_safe_rate": false_safe_rate,
        }

    return criteria


def build_phase7_playbook(
    expansion_holdout: dict[str, Any],
    release_criteria: dict[str, Any],
) -> dict[str, Any]:
    onboarding: dict[str, Any] = {}

    for oem_name in EXPANSION_OEMS:
        metrics = expansion_holdout.get(oem_name, {"status": "missing"})
        criteria_payload = release_criteria.get("per_oem", {}).get(oem_name, {})
        passes = bool(criteria_payload.get("passes", False))

        if metrics.get("status") != "ok":
            readiness = "not_ready"
        elif passes:
            readiness = "ready"
        else:
            readiness = "needs_improvement"

        onboarding[oem_name] = {
            "readiness": readiness,
            "metrics_status": metrics.get("status"),
            "release_check": criteria_payload,
            "next_actions": [
                "curate_gold_set",
                "review_oem_overrides",
                "validate_device_rollbacks",
            ],
        }

    return {
        "target_oems": EXPANSION_OEMS,
        "expansion_holdout": expansion_holdout,
        "release_criteria": release_criteria,
        "onboarding": onboarding,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Train improved package safety classifier v2")
    parser.add_argument(
        "--dataset",
        type=Path,
        default=Path("model-api/processed/training_dataset.json"),
        help="Path to canonical training dataset",
    )
    parser.add_argument(
        "--model-out",
        type=Path,
        default=Path("model-api/models/safety_baseline.joblib"),
        help="Path to save trained model artifact",
    )
    parser.add_argument(
        "--report-out",
        type=Path,
        default=Path("model-api/models/safety_baseline_report.json"),
        help="Path to save evaluation report",
    )
    parser.add_argument(
        "--max-features",
        type=int,
        default=12000,
        help="Maximum TF-IDF features",
    )
    parser.add_argument(
        "--predictions-out",
        type=Path,
        default=Path("model-api/models/safety_predictions.json"),
        help="Path to save package-level predictions for app integration",
    )
    parser.add_argument(
        "--predictions-out-desktop",
        type=Path,
        default=Path("desktop-app/src/data/safety_predictions.json"),
        help="Optional path to copy predictions into desktop-app data folder",
    )
    parser.add_argument(
        "--playbook-out",
        type=Path,
        default=Path("model-api/processed/oem_expansion_playbook.json"),
        help="Path to save Phase 7 OEM expansion playbook output",
    )

    args = parser.parse_args()

    # ── Load and oversample ──
    rows = load_rows(args.dataset)
    if len(rows) < 20:
        raise ValueError("Not enough training rows.")

    print(f"Loaded {len(rows)} rows")
    
    # Oversample UNSAFE class (minority) to improve recall
    rows_oversampled = oversample_minority(rows, "UNSAFE", factor=4)
    rows_oversampled = oversample_minority(rows_oversampled, "EXPERT", factor=2)
    print(f"After oversampling: {len(rows_oversampled)} rows")

    texts, oem_lists, numeric, pkg_features, labels = build_features(rows_oversampled)
    sample_weights = build_sample_weights(rows_oversampled)

    train_idx, test_idx = train_test_split(
        np.arange(len(rows_oversampled)),
        test_size=0.2,
        random_state=42,
        stratify=labels,
    )

    # ── Feature extraction ──
    text_vectorizer = TfidfVectorizer(
        max_features=args.max_features,
        ngram_range=(1, 2),
        sublinear_tf=True,
        min_df=2,
        max_df=0.95,
    )
    char_vectorizer = TfidfVectorizer(
        analyzer="char_wb",
        ngram_range=(3, 5),
        max_features=args.max_features // 2,
        sublinear_tf=True,
        min_df=2,
    )
    oem_encoder = OneHotEncoder(handle_unknown="ignore")

    X_train = build_sparse_features(
        [texts[i] for i in train_idx],
        oem_lists[train_idx],
        numeric[train_idx],
        pkg_features[train_idx],
        text_vectorizer, char_vectorizer, oem_encoder,
        fit=True,
    )
    X_test = build_sparse_features(
        [texts[i] for i in test_idx],
        oem_lists[test_idx],
        numeric[test_idx],
        pkg_features[test_idx],
        text_vectorizer, char_vectorizer, oem_encoder,
        fit=False,
    )

    y_train = labels[train_idx]
    y_test = labels[test_idx]

    print(f"Feature matrix shape: {X_train.shape}")
    print(f"Train: {len(train_idx)}, Test: {len(test_idx)}")

    # ── Model 1: Calibrated SGD (fast linear, good with sparse) ──
    print("Training SGD model...")
    sgd_model = CalibratedClassifierCV(
        SGDClassifier(
            loss="modified_huber",
            class_weight="balanced",
            max_iter=3000,
            random_state=42,
            alpha=1e-4,
        ),
        cv=3,
    )
    sgd_model.fit(X_train, y_train, sample_weight=sample_weights[train_idx])

    # Dedicated linear explainer model (fast coefficients for top factors)
    print("Training linear explainer model...")
    explainer_model = SGDClassifier(
        loss="log_loss",
        class_weight="balanced",
        max_iter=2000,
        random_state=42,
        alpha=1e-4,
    )
    explainer_model.fit(X_train, y_train, sample_weight=sample_weights[train_idx])

    # Calibrated SGD probabilities are used as final scores.
    all_classes = list(sgd_model.classes_)
    combined_prob = sgd_model.predict_proba(X_test)
    y_pred_raw = sgd_model.predict(X_test)

    # ── Apply safety gates ──
    y_pred = y_pred_raw.copy()
    test_packages = [rows_oversampled[i]["package_id"] for i in test_idx]
    gate_stats = {"overridden": 0, "total": len(test_packages)}
    
    for idx, pkg_id in enumerate(test_packages):
        gated_label, gated_conf, reasons = apply_safety_gates(
            pkg_id, str(y_pred[idx]), float(np.max(combined_prob[idx]))
        )
        if reasons:
            y_pred[idx] = gated_label
            gate_stats["overridden"] += 1

    print(f"Safety gates overrode {gate_stats['overridden']}/{gate_stats['total']} predictions")

    # ── Evaluation ──
    report = classification_report(y_test, y_pred, output_dict=True, zero_division=0)
    labels_sorted = sorted(set(labels))
    cm = confusion_matrix(y_test, y_pred, labels=labels_sorted)

    print("\n=== Classification Report ===")
    print(classification_report(y_test, y_pred, zero_division=0))

    # ── Save model artifacts ──
    args.model_out.parent.mkdir(parents=True, exist_ok=True)
    args.report_out.parent.mkdir(parents=True, exist_ok=True)

    artifact = {
        "model": sgd_model,
        "explainer_model": explainer_model,
        "sgd_model": sgd_model,
        "text_vectorizer": text_vectorizer,
        "char_vectorizer": char_vectorizer,
        "oem_encoder": oem_encoder,
        "labels": labels_sorted,
        "all_classes": all_classes,
        "features": [
            "dep_count", "needed_by_count", "label_count",
            "has_alternatives", "desc_length", "has_description",
        ],
        "package_features": PACKAGE_FEATURE_NAMES,
        "critical_packages": list(CRITICAL_SYSTEM_PACKAGES),
        "model_version": "safety-v2-ensemble",
    }

    joblib.dump(artifact, args.model_out)

    # ── Trust metrics ──
    trust_metrics = compute_trust_metrics(y_test, y_pred, combined_prob, labels_sorted)
    
    # OEM holdout — use original (non-oversampled) rows
    print("\nRunning OEM holdout evaluation (Samsung, Xiaomi)...")
    oem_holdout = run_oem_holdout(
        rows,
        cohorts_to_eval=BASELINE_OEMS,
        max_features=args.max_features,
    )
    release_criteria = evaluate_release_criteria(
        oem_holdout,
        unsafe_recall_min=0.9,
        false_safe_rate_max=0.02,
    )

    print("Running expansion OEM holdout evaluation...")
    expansion_holdout = run_oem_holdout(
        rows,
        cohorts_to_eval=EXPANSION_OEMS,
        max_features=args.max_features,
    )
    expansion_release_criteria = evaluate_release_criteria(
        expansion_holdout,
        unsafe_recall_min=0.9,
        false_safe_rate_max=0.02,
    )
    phase7_playbook = build_phase7_playbook(
        expansion_holdout,
        expansion_release_criteria,
    )

    output_report = {
        "model_version": "safety-v2-ensemble",
        "dataset_size": len(rows),
        "oversampled_size": len(rows_oversampled),
        "train_size": len(train_idx),
        "test_size": len(test_idx),
        "labels": labels_sorted,
        "safety_gates": {
            "critical_packages_count": len(CRITICAL_SYSTEM_PACKAGES),
            "predictions_overridden": gate_stats["overridden"],
        },
        "classification_report": report,
        "confusion_matrix": cm.tolist(),
        "phase4": {
            "trust_metrics": {
                "test_split": trust_metrics,
                "rollback_rate": None,
                "rollback_rate_note": "Requires runtime telemetry pipeline (Phase 6)",
            },
            "oem_holdout": oem_holdout,
            "release_criteria": release_criteria,
        },
        "phase7": phase7_playbook,
    }

    with args.report_out.open("w", encoding="utf-8") as file:
        json.dump(output_report, file, indent=2)

    # ── Full-dataset predictions for runtime use ──
    print("\nGenerating full-dataset predictions...")
    
    # Re-extract features from ORIGINAL (not oversampled) rows
    orig_texts, orig_oem_lists, orig_numeric, orig_pkg_features, orig_labels = build_features(rows)
    
    X_all = build_sparse_features(
        orig_texts, orig_oem_lists, orig_numeric, orig_pkg_features,
        text_vectorizer, char_vectorizer, oem_encoder,
        fit=False,
    )

    all_combined_prob = sgd_model.predict_proba(X_all)
    all_pred_labels = sgd_model.predict(X_all)

    feature_names = build_feature_names(text_vectorizer, char_vectorizer, oem_encoder)

    predictions_payload = {
        "modelVersion": "safety-v2-ensemble",
        "labels": all_classes,
        "criticalPackages": list(CRITICAL_SYSTEM_PACKAGES),
        "predictions": {},
    }

    for index, row in enumerate(rows):
        package_id = row["package_id"]
        probabilities = all_combined_prob[index]
        raw_confidence = float(np.max(probabilities))
        raw_label = str(all_pred_labels[index])
        
        # Apply safety gates
        final_label, final_confidence, gate_reasons = apply_safety_gates(
            package_id, raw_label, raw_confidence
        )
        
        top_factors = top_factors_for_row(
            X_all[index],
            final_label,
            explainer_model,
            feature_names,
        )
        
        entry = {
            "label": final_label,
            "confidence": round(final_confidence, 6),
            "top_factors": top_factors,
        }
        if gate_reasons:
            entry["safety_gate"] = gate_reasons
        
        predictions_payload["predictions"][package_id] = entry

    args.predictions_out.parent.mkdir(parents=True, exist_ok=True)
    with args.predictions_out.open("w", encoding="utf-8") as file:
        json.dump(predictions_payload, file, indent=2)

    args.predictions_out_desktop.parent.mkdir(parents=True, exist_ok=True)
    with args.predictions_out_desktop.open("w", encoding="utf-8") as file:
        json.dump(predictions_payload, file, indent=2)

    args.playbook_out.parent.mkdir(parents=True, exist_ok=True)
    with args.playbook_out.open("w", encoding="utf-8") as file:
        json.dump(phase7_playbook, file, indent=2)

    print(f"\n✅ Saved model: {args.model_out}")
    print(f"✅ Saved report: {args.report_out}")
    print(f"✅ Saved predictions: {args.predictions_out}")
    print(f"✅ Saved desktop predictions: {args.predictions_out_desktop}")
    print(f"✅ Saved OEM playbook: {args.playbook_out}")
    
    # Print summary
    print(f"\n{'='*60}")
    print(f"MODEL SUMMARY (v2 Ensemble)")
    print(f"{'='*60}")
    print(f"Accuracy: {trust_metrics['accuracy']:.4f}")
    print(f"Macro F1: {trust_metrics['macro_f1']:.4f}")
    print(f"UNSAFE Recall: {trust_metrics['unsafe_recall']:.4f}")
    print(f"False-Safe Rate: {trust_metrics['false_safe_rate']}")
    print(f"High-Confidence Coverage (≥0.8): {trust_metrics['confidence_coverage_ge_0_8']:.4f}")
    print(f"ECE: {trust_metrics['expected_calibration_error']:.4f}")
    print(f"Safety Gates Applied: {gate_stats['overridden']} overrides")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
