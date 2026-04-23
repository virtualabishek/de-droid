"""
De-Droid Model API — Bloatware Detection Intelligence Layer.

FastAPI server that accepts package lists from ADB and returns safety
classifications with confidence scores and explanations.

Architecture (post-OOP refactor)
---------------------------------
The application is split into four focused class modules:

* ``oem_registry.OEMRegistry``      — OEM brand namespaces, critical packages,
                                       and heuristic helpers.
* ``model_store.ModelStore``         — Loads/caches the ML artifact and the
                                       precomputed prediction JSON.
* ``package_classifier.PackageClassifier``
                                    — Combines model predictions, OEM heuristics,
                                       and graph risk scoring into final labels.
* ``feedback_manager.FeedbackManager``
                                    — Persists feedback events, builds retraining
                                       proposals, and exports variant datasets.

This file is intentionally thin: it owns the Pydantic schema, the path
constants, a handful of stateless utility helpers, and the FastAPI route
definitions.  All business logic lives in the four class modules above.
"""

from __future__ import annotations

import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

# ---------------------------------------------------------------------------
# Ensure the current directory is on sys.path so sibling modules are importable
# when the server is started with `uvicorn main:app --app-dir model-api/model-api`.
# ---------------------------------------------------------------------------
CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.append(str(CURRENT_DIR))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

try:  # Package context
    from .feedback_manager import FeedbackManager
    from .model_store import ModelStore
    from .oem_registry import OEMRegistry
    from .package_classifier import PackageClassifier
    from .risk_graph import DependencyRiskScorer
except ImportError:  # app-dir/main:app context
    from feedback_manager import FeedbackManager
    from model_store import ModelStore
    from oem_registry import OEMRegistry
    from package_classifier import PackageClassifier
    from risk_graph import DependencyRiskScorer

# ─────────────────────────────────────────────────────────────────────────────
# FastAPI application
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
# Path constants
# ─────────────────────────────────────────────────────────────────────────────

MODEL_DIR = Path(__file__).resolve().parent / "models"
PREDICTIONS_PATH = MODEL_DIR / "safety_predictions.json"
MODEL_PATH = MODEL_DIR / "safety_baseline.joblib"

PROJECT_MODEL_API_DIR = Path(__file__).resolve().parent.parent
FEEDBACK_DIR = PROJECT_MODEL_API_DIR / "feedback"
FEEDBACK_EVENTS_PATH = FEEDBACK_DIR / "events.jsonl"
FEEDBACK_VARIANTS_PATH = (
    PROJECT_MODEL_API_DIR / "raw-data" / "variants_user_feedback.json"
)
TRAINING_DATASET_PATH = PROJECT_MODEL_API_DIR / "processed" / "training_dataset.json"
COOCCURRENCE_STATE_PATH = (
    PROJECT_MODEL_API_DIR / "processed" / "cooccurrence_graph_state.json"
)

# Fallback: check one directory level up for model files (development layout)
if not MODEL_PATH.exists():
    MODEL_PATH = (
        Path(__file__).resolve().parent.parent / "models" / "safety_baseline.joblib"
    )
if not PREDICTIONS_PATH.exists():
    PREDICTIONS_PATH = (
        Path(__file__).resolve().parent.parent / "models" / "safety_predictions.json"
    )

# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

PACKAGE_ID_PATTERN = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$")

CANONICAL_LABELS = ("RECOMMENDED", "ADVANCED", "EXPERT", "UNSAFE")

RISK_ORDER: dict[str, int] = {
    "RECOMMENDED": 0,
    "ADVANCED": 1,
    "EXPERT": 2,
    "UNSAFE": 3,
}

# ─────────────────────────────────────────────────────────────────────────────
# Global application state
# All instances are created / populated during the ``startup`` event.
# ─────────────────────────────────────────────────────────────────────────────

_oem_registry: OEMRegistry = OEMRegistry()
_model_store: ModelStore | None = None
_classifier: PackageClassifier | None = None
_feedback_manager: FeedbackManager | None = None
_risk_scorer: DependencyRiskScorer | None = None

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
    graph_risk_score: float | None = Field(default=None, ge=0.0, le=1.0)
    graph_risk_reasons: list[str] | None = None


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
    graph_enabled: bool
    graph_observed_pairs: int


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


# Resolve forward references that may arise from lazy cross-module imports.
for _model in (
    PackageSafety,
    PackageCheckResponse,
    FeedbackSummaryResponse,
    LabelProposal,
    RetrainSignalsResponse,
    RetrainExportResponse,
):
    _model.model_rebuild()


# ─────────────────────────────────────────────────────────────────────────────
# Module-level utility helpers
# These are deliberately kept here (not in the class modules) because they are
# either trivially small, depend on module-level constants, or are imported by
# other modules (e.g. feedback_manager imports utc_now_iso).
# ─────────────────────────────────────────────────────────────────────────────


def utc_now_iso() -> str:
    """Return the current UTC time as an ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()


def normalize_package_id(value: str) -> str:
    """Strip ``package:`` prefix, lowercase, and validate an Android package ID.

    Args:
        value: Raw package ID string, optionally prefixed with ``package:``.

    Returns:
        A normalized, lowercased package ID.

    Raises:
        fastapi.HTTPException: 422 when the ID is empty or does not match the
            expected ``com.vendor.app`` pattern.
    """
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
    """Upper-case and validate a label string against CANONICAL_LABELS.

    Args:
        value: Raw label string or ``None``.

    Returns:
        The uppercased label when it is a member of ``CANONICAL_LABELS``,
        otherwise ``None``.
    """
    if value is None:
        return None
    normalized = value.strip().upper()
    return normalized if normalized in CANONICAL_LABELS else None


def get_current_label(package_id: str) -> str | None:
    """Look up the current model label for a package from the loaded predictions.

    Delegates to ``_model_store.get_prediction`` so callers do not need a
    direct reference to the store.  Returns ``None`` when the store is not yet
    loaded or the package is absent from the predictions cache.

    Args:
        package_id: Exact Android package identifier.

    Returns:
        A validated label string such as ``"RECOMMENDED"``, or ``None``.
    """
    if _model_store is None:
        return None
    pred = _model_store.get_prediction(package_id)
    if not pred:
        return None
    raw = pred.get("label")
    if not isinstance(raw, str):
        return None
    return normalize_label(raw)


def resolve_feedback_export_path(out_path: str | None) -> Path:
    """Resolve and validate a user-supplied export file path.

    When *out_path* is ``None`` the default ``FEEDBACK_VARIANTS_PATH`` is
    returned.  Absolute paths are used as-is; relative paths are resolved
    relative to the repository root (parent of ``PROJECT_MODEL_API_DIR``).

    The resolved path must fall inside ``PROJECT_MODEL_API_DIR`` to prevent
    path-traversal writes outside the project.

    Args:
        out_path: Optional string path supplied by the caller.

    Returns:
        A resolved, validated :class:`~pathlib.Path`.

    Raises:
        fastapi.HTTPException: 400 when the resolved path escapes the allowed
            root directory.
    """
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
# Instance accessor helpers
# These narrow the Optional types so endpoints get a typed reference and a
# proper HTTP 503 when the startup event has not yet completed.
# ─────────────────────────────────────────────────────────────────────────────


def _require_classifier() -> PackageClassifier:
    """Return the active ``PackageClassifier``, or raise HTTP 503."""
    if _classifier is None:
        raise HTTPException(status_code=503, detail="Service not yet initialized")
    return _classifier


def _require_feedback_manager() -> FeedbackManager:
    """Return the active ``FeedbackManager``, or raise HTTP 503."""
    if _feedback_manager is None:
        raise HTTPException(status_code=503, detail="Service not yet initialized")
    return _feedback_manager


# ─────────────────────────────────────────────────────────────────────────────
# Startup event — wire up all class instances
# ─────────────────────────────────────────────────────────────────────────────


@app.on_event("startup")
async def load_models() -> None:
    """Initialise all class instances and load data from disk.

    Execution order:

    1. Create and load ``ModelStore`` (predictions JSON + joblib artifact).
    2. Create ``FeedbackManager``.
    3. Attempt to build ``DependencyRiskScorer`` from the training dataset.
       Wire the scorer into ``FeedbackManager`` so feedback events trigger a
       scorer refresh.
    4. Create ``PackageClassifier`` with references to the store, registry,
       and optional scorer.

    All steps are guarded so a missing file degrades gracefully rather than
    preventing the API from starting.
    """
    global _model_store, _classifier, _feedback_manager, _risk_scorer

    # ── Step 1: Model store ──────────────────────────────────────────────────
    _model_store = ModelStore(MODEL_PATH.parent, PREDICTIONS_PATH)
    _model_store.load()
    print(
        f"✅ Loaded {_model_store.predictions_count} precomputed predictions "
        f"(v: {_model_store.version})"
    )
    if not _model_store.is_model_loaded:
        print(f"⚠️  No model artifact found at {MODEL_PATH}")

    # ── Step 2: Feedback manager ─────────────────────────────────────────────
    _feedback_manager = FeedbackManager(FEEDBACK_EVENTS_PATH, FEEDBACK_VARIANTS_PATH)

    # ── Step 3: Dependency risk scorer ──────────────────────────────────────
    if TRAINING_DATASET_PATH.exists():
        try:
            _risk_scorer = DependencyRiskScorer(
                dataset_path=TRAINING_DATASET_PATH,
                state_path=COOCCURRENCE_STATE_PATH,
                feedback_events_path=FEEDBACK_EVENTS_PATH,
                critical_packages=_oem_registry.CRITICAL_SYSTEM_PACKAGES,
            )
            _risk_scorer.initialize()
            _feedback_manager.set_risk_scorer(_risk_scorer)
            graph_stats = _risk_scorer.stats()
            print(
                "✅ Loaded dependency risk scorer "
                f"(nodes={graph_stats['known_packages']}, "
                f"pairs={graph_stats['observed_pairs']})"
            )
        except Exception as exc:
            _risk_scorer = None
            print(f"⚠️  Could not initialize dependency risk scorer: {exc}")
    else:
        print(
            f"⚠️  No training dataset found for dependency graph at "
            f"{TRAINING_DATASET_PATH}"
        )

    # ── Step 4: Package classifier ───────────────────────────────────────────
    _classifier = PackageClassifier(_model_store, _oem_registry, _risk_scorer)


# ─────────────────────────────────────────────────────────────────────────────
# API Endpoints
# ─────────────────────────────────────────────────────────────────────────────


@app.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Health check endpoint.

    Returns a summary of loaded components: model version, prediction count,
    model artifact status, and graph scorer stats.
    """
    graph_stats = (
        _risk_scorer.stats() if _risk_scorer is not None else {"observed_pairs": 0}
    )
    return HealthResponse(
        status="ok",
        model_version=_model_store.version if _model_store else "unknown",
        predictions_loaded=_model_store.predictions_count if _model_store else 0,
        model_loaded=_model_store.is_model_loaded if _model_store else False,
        graph_enabled=_risk_scorer is not None,
        graph_observed_pairs=int(graph_stats.get("observed_pairs", 0)),
    )


@app.post("/api/check-packages", response_model=PackageCheckResponse)
async def check_packages(request: PackageCheckRequest) -> PackageCheckResponse:
    """Check safety of Android packages.

    Accepts a list of package IDs (as returned by ``adb shell pm list packages``)
    and returns safety classifications for each.

    Package IDs are normalised before classification:

    * Whitespace is stripped.
    * The ``package:`` prefix (from raw ADB output) is removed.
    * The ID is lowercased.
    * Duplicates are removed while preserving first-seen order.

    Classification is delegated to :class:`~package_classifier.PackageClassifier`
    which applies model predictions, safety gates, and optional graph risk scoring.

    Args:
        request: A :class:`PackageCheckRequest` with a list of package IDs and
            an optional device brand hint.

    Returns:
        A :class:`PackageCheckResponse` sorted by risk (UNSAFE first) then
        confidence descending.
    """
    cleaned: list[str] = []
    seen: set[str] = set()

    for pkg in request.packages:
        clean = pkg.strip()
        if clean.startswith("package:"):
            clean = clean[8:]
        clean = clean.lower()
        if clean and clean not in seen:
            seen.add(clean)
            cleaned.append(clean)

    return _require_classifier().classify_batch(cleaned, request.device_brand)


@app.post("/api/check-single")
async def check_single_package(package_id: str) -> PackageSafety:
    """Quick classification for a single package ID.

    Internally delegates to ``/api/check-packages`` so all safety gates and
    graph scoring are applied identically.

    Args:
        package_id: The Android package identifier to classify.

    Returns:
        A single :class:`PackageSafety` instance.

    Raises:
        fastapi.HTTPException: 404 when no result is returned (should not occur
            in practice; included as a defensive guard).
    """
    response = await check_packages(PackageCheckRequest(packages=[package_id]))
    if response.packages:
        return response.packages[0]
    raise HTTPException(status_code=404, detail="Package not found")


@app.get("/api/stats")
async def model_stats() -> dict[str, Any]:
    """Return model statistics and package-coverage information.

    Breaks down the predictions cache by safety label and by OEM cohort.
    Returns a ``status: no_data`` response when no predictions have been loaded.
    """
    if _model_store is None or _model_store.predictions_count == 0:
        return {
            "status": "no_data",
            "message": "No predictions loaded. Train the model first.",
        }

    label_counts: dict[str, int] = {}
    oem_counts: dict[str, int] = {}

    for pkg_id, pred in _model_store.get_all_predictions().items():
        label = pred.get("label", "UNKNOWN")
        label_counts[label] = label_counts.get(label, 0) + 1

        oem = _oem_registry.detect_cohort(pkg_id) or "OTHER"
        oem_counts[oem] = oem_counts.get(oem, 0) + 1

    return {
        "model_version": _model_store.version,
        "total_packages": _model_store.predictions_count,
        "label_distribution": label_counts,
        "oem_distribution": oem_counts,
        "critical_packages_count": len(_oem_registry.CRITICAL_SYSTEM_PACKAGES),
    }


@app.get("/api/graph/stats")
async def dependency_graph_stats() -> dict[str, Any]:
    """Return dependency / co-occurrence graph health and size metrics.

    Returns a ``status: disabled`` response when the risk scorer is not
    initialised (e.g. training dataset not present).
    """
    if _risk_scorer is None:
        return {
            "status": "disabled",
            "message": "Dependency risk scorer is not initialized.",
        }
    return {"status": "ok", **_risk_scorer.stats()}


@app.get("/api/critical-packages")
async def get_critical_packages() -> dict[str, Any]:
    """Return the list of critical system packages that should never be removed.

    These packages are hardcoded in :class:`~oem_registry.OEMRegistry` and will
    always receive an UNSAFE classification with ``confidence=1.0``.
    """
    return {
        "count": len(_oem_registry.CRITICAL_SYSTEM_PACKAGES),
        "packages": sorted(_oem_registry.CRITICAL_SYSTEM_PACKAGES),
        "description": (
            "These packages are critical to device operation and will always "
            "be marked UNSAFE."
        ),
    }


@app.get("/api/search/{query}")
async def search_packages(query: str) -> dict[str, Any]:
    """Search for packages whose ID contains the given query substring.

    Searches the loaded predictions cache and returns up to 100 matches sorted
    alphabetically by package ID.

    Args:
        query: A substring to look for in package identifiers.

    Returns:
        A dict with ``query``, ``total_matches``, and a ``results`` list capped
        at 100 entries.
    """
    if _model_store is None:
        return {"query": query, "total_matches": 0, "results": []}

    query_lower = query.lower()
    matches: list[dict[str, Any]] = []

    for pkg_id, pred in _model_store.get_all_predictions().items():
        if query_lower in pkg_id.lower():
            matches.append(
                {
                    "package_id": pkg_id,
                    "label": pred.get("label"),
                    "confidence": pred.get("confidence"),
                    "top_factors": pred.get("top_factors", []),
                    "oem_cohort": _oem_registry.detect_cohort(pkg_id),
                }
            )

    matches.sort(key=lambda x: x["package_id"])
    return {
        "query": query,
        "total_matches": len(matches),
        "results": matches[:100],
    }


@app.post("/api/feedback/events")
async def ingest_feedback_event(event: FeedbackEventIn) -> dict[str, Any]:
    """Record a user action outcome for future model retraining.

    Designed for app-side telemetry ingestion where package
    uninstall/disable/restore outcomes are transformed into weak supervision
    signals.

    The event is validated, normalised, and persisted to the JSONL event log by
    :class:`~feedback_manager.FeedbackManager`.  The graph scorer is refreshed
    automatically via the manager's scorer hook.

    Args:
        event: Validated :class:`FeedbackEventIn` payload from the request body.

    Returns:
        A confirmation dict with ``status``, ``event_id``, and ``recorded_at``.
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
    _require_feedback_manager().append_event(record)

    return {
        "status": "ok",
        "message": "feedback event recorded",
        "event_id": record.id,
        "recorded_at": record.created_at,
    }


@app.get("/api/feedback/summary", response_model=FeedbackSummaryResponse)
async def feedback_summary(days: int = 30, top: int = 20) -> FeedbackSummaryResponse:
    """Return aggregate statistics for feedback events within a time window.

    Args:
        days: Look-back window in days (clamped to ``[1, 3650]``).
        top: Number of top packages to include (clamped to ``[1, 200]``).

    Returns:
        A :class:`FeedbackSummaryResponse` with totals, breakdowns by action
        and outcome, and the most-frequently-reported packages.
    """
    return _require_feedback_manager().get_summary(days, top)


@app.get("/api/retrain/signals", response_model=RetrainSignalsResponse)
async def retrain_signals(
    days: int = 90,
    min_events: int = 3,
    include_same: bool = False,
    limit: int = 500,
) -> RetrainSignalsResponse:
    """Build candidate package-label updates from user feedback events.

    This does not retrain the model itself; it generates reviewable label
    proposals that can be merged into the dataset pipeline after human review.

    Args:
        days: Look-back window for events (clamped to ``[1, 3650]``).
        min_events: Minimum event count per package to generate a proposal
            (clamped to ``[1, 200]``).
        include_same: When ``True``, proposals where the suggested label equals
            the current model label are included.
        limit: Maximum number of proposals to return (clamped to
            ``[1, 5000]``).

    Returns:
        A :class:`RetrainSignalsResponse` with the sorted proposal list.
    """
    proposals = _require_feedback_manager().build_proposals(
        window_days=days,
        min_events=min_events,
        include_same=include_same,
        current_label_lookup=get_current_label,
        critical_packages=_oem_registry.CRITICAL_SYSTEM_PACKAGES,
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
) -> RetrainExportResponse:
    """Export feedback-driven proposals as a variant dataset JSON file.

    The output is a JSON file compatible with the ``build_training_dataset.py``
    ``--variants`` flag.  It can be fed directly into the retraining pipeline::

        python3 model-api/scripts/build_training_dataset.py \\
            --variants model-api/raw-data/variants_user_feedback.json

    Args:
        days: Look-back window for events (clamped to ``[1, 3650]``).
        min_events: Minimum event count per package (clamped to ``[1, 200]``).
        include_same: Include proposals matching the current model label.
        out_path: Optional custom output path.  Must resolve inside
            ``PROJECT_MODEL_API_DIR``.  Defaults to
            ``raw-data/variants_user_feedback.json``.

    Returns:
        A :class:`RetrainExportResponse` with the output path and row count.
    """
    fb = _require_feedback_manager()
    proposals = fb.build_proposals(
        window_days=days,
        min_events=min_events,
        include_same=include_same,
        current_label_lookup=get_current_label,
        critical_packages=_oem_registry.CRITICAL_SYSTEM_PACKAGES,
    )

    output_path = resolve_feedback_export_path(out_path)
    generated_at = utc_now_iso()

    count = fb.export_variants(
        proposals,
        output_path,
        _oem_registry.detect_cohort,
    )

    return RetrainExportResponse(
        generated_at=generated_at,
        output_path=str(output_path),
        package_count=count,
    )


@app.get("/api/retrain/commands")
async def retrain_commands(variant_path: str | None = None) -> dict[str, Any]:
    """Return helper shell commands for feedback-based retraining.

    Resolves the variant file path (defaulting to
    ``raw-data/variants_user_feedback.json``) and formats the three commands
    needed to run a full retraining cycle:

    1. ``build_dataset`` — merge variant data into the training dataset.
    2. ``train_model`` — train a new classifier from the dataset.
    3. ``run_api`` — start the API server with the updated model.

    All commands are intended to be run from the repository root.

    Args:
        variant_path: Optional path override for the variant file.  Subject to
            the same path-traversal guard as :func:`resolve_feedback_export_path`.

    Returns:
        A dict with ``variant_file``, ``commands``, and a ``note``.
    """
    resolved_path = resolve_feedback_export_path(variant_path)
    rel_path = resolved_path.relative_to(PROJECT_MODEL_API_DIR.parent)

    return {
        "variant_file": str(rel_path),
        "commands": {
            "build_dataset": (
                "python3 model-api/scripts/build_training_dataset.py "
                "--variants model-api/raw-data/variants_samsung.json "
                f"model-api/raw-data/variants_redmi.json {rel_path}"
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
