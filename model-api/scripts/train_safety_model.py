from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from scipy.sparse import hstack
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import OneHotEncoder


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
    ),
    "VIVO": (
        "com.vivo.",
        "com.bbk.",
        "com.iqoo.",
    ),
}

BASELINE_OEMS = ["SAMSUNG", "XIAOMI"]
EXPANSION_OEMS = ["ONEPLUS", "HUAWEI", "OPPO", "VIVO"]



def load_rows(dataset_path: Path) -> list[dict]:
    with dataset_path.open("r", encoding="utf-8") as file:
        payload = json.load(file)
    return payload["rows"]



def build_features(rows: list[dict]):
    texts = [row.get("text", "") for row in rows]
    oem_lists = np.array([[row.get("oem_list", "UNKNOWN")] for row in rows])
    numeric = np.array(
        [
            [
                row.get("dep_count", 0),
                row.get("needed_by_count", 0),
                row.get("label_count", 0),
                row.get("has_alternatives", 0),
            ]
            for row in rows
        ],
        dtype=float,
    )
    labels = np.array([row["removal"] for row in rows])
    return texts, oem_lists, numeric, labels


def build_feature_names(
    text_vectorizer: TfidfVectorizer,
    oem_encoder: OneHotEncoder,
) -> list[str]:
    text_names = [f"text:{name}" for name in text_vectorizer.get_feature_names_out()]
    oem_names = [
        f"oem:{name}"
        for name in oem_encoder.get_feature_names_out(["oem_list"])
    ]
    numeric_names = [
        "num:dep_count",
        "num:needed_by_count",
        "num:label_count",
        "num:has_alternatives",
    ]
    return [*text_names, *oem_names, *numeric_names]


def humanize_factor(feature_name: str) -> str:
    if feature_name.startswith("text:"):
        token = feature_name.removeprefix("text:").replace("_", " ")
        return f"text contains '{token}'"

    if feature_name.startswith("oem:oem_list_"):
        oem = feature_name.removeprefix("oem:oem_list_")
        return f"OEM list '{oem}'"

    numeric_map = {
        "num:dep_count": "package has dependency links",
        "num:needed_by_count": "other packages depend on it",
        "num:label_count": "package has many labels/tags",
        "num:has_alternatives": "open-source alternative exists",
    }
    return numeric_map.get(feature_name, feature_name)


def top_factors_for_row(
    row_vector,
    class_index: int,
    coefficients: np.ndarray,
    feature_names: list[str],
    limit: int = 4,
) -> list[str]:
    row = row_vector.tocoo()
    contributions: list[tuple[float, str]] = []

    for feature_index, value in zip(row.col, row.data):
        score = float(value * coefficients[class_index, feature_index])
        if score > 0:
            contributions.append((score, feature_names[feature_index]))

    if not contributions:
        for feature_index, value in zip(row.col, row.data):
            score = abs(float(value * coefficients[class_index, feature_index]))
            contributions.append((score, feature_names[feature_index]))

    top = sorted(contributions, key=lambda item: item[0], reverse=True)[:limit]
    return [humanize_factor(name) for _, name in top]


def infer_oem_cohort(package_id: str) -> str | None:
    package = package_id.lower()

    for cohort, prefixes in COHORT_PREFIXES.items():
        if package.startswith(prefixes):
            return cohort
    return None


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


def train_and_predict(
    rows: list[dict],
    train_indices: np.ndarray,
    eval_indices: np.ndarray,
    max_features: int,
) -> tuple[np.ndarray, np.ndarray, list[str]]:
    texts, oem_lists, numeric, labels = build_features(rows)

    text_vectorizer = TfidfVectorizer(max_features=max_features, ngram_range=(1, 2))
    oem_encoder = OneHotEncoder(handle_unknown="ignore")

    X_text_train = text_vectorizer.fit_transform([texts[i] for i in train_indices])
    X_oem_train = oem_encoder.fit_transform(oem_lists[train_indices])
    X_num_train = numeric[train_indices]
    X_train = hstack([X_text_train, X_oem_train, X_num_train]).tocsr()

    X_text_eval = text_vectorizer.transform([texts[i] for i in eval_indices])
    X_oem_eval = oem_encoder.transform(oem_lists[eval_indices])
    X_num_eval = numeric[eval_indices]
    X_eval = hstack([X_text_eval, X_oem_eval, X_num_eval]).tocsr()

    y_train = labels[train_indices]
    y_eval = labels[eval_indices]

    model = LogisticRegression(max_iter=2000, class_weight="balanced")
    model.fit(X_train, y_train)

    y_pred = model.predict(X_eval)
    y_prob = model.predict_proba(X_eval)
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
            [i for i in all_indices if i not in eval_indices],
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



def main() -> None:
    parser = argparse.ArgumentParser(description="Train baseline package safety classifier")
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
        default=10000,
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

    rows = load_rows(args.dataset)
    if len(rows) < 20:
        raise ValueError("Not enough training rows. Build dataset first and ensure it has sufficient labels.")

    texts, oem_lists, numeric, labels = build_features(rows)

    train_idx, test_idx = train_test_split(
        np.arange(len(rows)),
        test_size=0.2,
        random_state=42,
        stratify=labels,
    )

    text_vectorizer = TfidfVectorizer(max_features=args.max_features, ngram_range=(1, 2))
    oem_encoder = OneHotEncoder(handle_unknown="ignore")

    X_text_train = text_vectorizer.fit_transform([texts[i] for i in train_idx])
    X_oem_train = oem_encoder.fit_transform(oem_lists[train_idx])
    X_num_train = numeric[train_idx]
    X_train = hstack([X_text_train, X_oem_train, X_num_train]).tocsr()

    X_text_test = text_vectorizer.transform([texts[i] for i in test_idx])
    X_oem_test = oem_encoder.transform(oem_lists[test_idx])
    X_num_test = numeric[test_idx]
    X_test = hstack([X_text_test, X_oem_test, X_num_test]).tocsr()

    y_train = labels[train_idx]
    y_test = labels[test_idx]

    model = LogisticRegression(
        max_iter=2000,
        class_weight="balanced",
    )
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    report = classification_report(y_test, y_pred, output_dict=True, zero_division=0)
    cm = confusion_matrix(y_test, y_pred, labels=sorted(set(labels)))

    args.model_out.parent.mkdir(parents=True, exist_ok=True)
    args.report_out.parent.mkdir(parents=True, exist_ok=True)

    artifact = {
        "model": model,
        "text_vectorizer": text_vectorizer,
        "oem_encoder": oem_encoder,
        "labels": sorted(set(labels)),
        "features": ["dep_count", "needed_by_count", "label_count", "has_alternatives"],
    }

    joblib.dump(artifact, args.model_out)

    test_probs = model.predict_proba(X_test)
    trust_metrics = compute_trust_metrics(y_test, y_pred, test_probs, sorted(set(labels)))
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
        "dataset_size": len(rows),
        "train_size": len(train_idx),
        "test_size": len(test_idx),
        "labels": sorted(set(labels)),
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

    # Full-dataset predictions for runtime use
    X_text_all = text_vectorizer.transform(texts)
    X_oem_all = oem_encoder.transform(oem_lists)
    X_num_all = numeric
    X_all = hstack([X_text_all, X_oem_all, X_num_all]).tocsr()

    all_pred_labels = model.predict(X_all)
    all_pred_probs = model.predict_proba(X_all)
    feature_names = build_feature_names(text_vectorizer, oem_encoder)

    predictions_payload = {
        "modelVersion": "safety-baseline-v1",
        "labels": list(model.classes_),
        "predictions": {},
    }

    for index, row in enumerate(rows):
        package_id = row["package_id"]
        probabilities = all_pred_probs[index]
        confidence = float(np.max(probabilities))
        predicted_class = str(all_pred_labels[index])
        class_index = int(np.where(model.classes_ == predicted_class)[0][0])
        top_factors = top_factors_for_row(
            X_all[index],
            class_index,
            model.coef_,
            feature_names,
        )
        predictions_payload["predictions"][package_id] = {
            "label": predicted_class,
            "confidence": round(confidence, 6),
            "top_factors": top_factors,
        }

    args.predictions_out.parent.mkdir(parents=True, exist_ok=True)
    with args.predictions_out.open("w", encoding="utf-8") as file:
        json.dump(predictions_payload, file, indent=2)

    args.predictions_out_desktop.parent.mkdir(parents=True, exist_ok=True)
    with args.predictions_out_desktop.open("w", encoding="utf-8") as file:
        json.dump(predictions_payload, file, indent=2)

    args.playbook_out.parent.mkdir(parents=True, exist_ok=True)
    with args.playbook_out.open("w", encoding="utf-8") as file:
        json.dump(phase7_playbook, file, indent=2)

    print(f"Saved model: {args.model_out}")
    print(f"Saved report: {args.report_out}")
    print(f"Saved predictions: {args.predictions_out}")
    print(f"Saved desktop predictions: {args.predictions_out_desktop}")
    print(f"Saved OEM playbook: {args.playbook_out}")


if __name__ == "__main__":
    main()
