"""
De-Droid Feedback Manager — Manages user action feedback events for model improvement.

This module provides the FeedbackManager class which handles the full lifecycle of
user-generated telemetry events:

1. **Ingestion** — appending new ``FeedbackRecord`` entries to a JSONL event log.
2. **Loading** — reading the log back with optional time-window filtering.
3. **Summarisation** — computing aggregate statistics for the ``/api/feedback/summary``
   endpoint.
4. **Proposal generation** — building ranked label-change proposals from aggregated
   feedback signals for the ``/api/retrain/signals`` endpoint.
5. **Variant export** — serialising proposals as a variant dataset JSON file that can
   be consumed by the offline training pipeline.

The class is deliberately side-effect-free at construction time.  All I/O happens
in named methods so the instance can be created synchronously during the FastAPI
startup event.

Usage::

    from pathlib import Path
    from feedback_manager import FeedbackManager

    manager = FeedbackManager(
        events_path=Path("feedback/events.jsonl"),
        variants_path=Path("raw-data/variants_user_feedback.json"),
    )

    # Wire up the graph scorer so feedback events trigger a re-index.
    manager.set_risk_scorer(risk_scorer)

    # Append a new event (called from the /api/feedback/events endpoint).
    manager.append_event(record)

    # Summarise recent activity.
    summary = manager.get_summary(days=30, top_k=20)

    # Build label-change proposals.
    proposals = manager.build_proposals(
        window_days=90,
        min_events=3,
        include_same=False,
        current_label_lookup=get_current_label,
        critical_packages=oem_registry.CRITICAL_SYSTEM_PACKAGES,
    )

    # Export proposals as a variant file.
    count = manager.export_variants(proposals, out_path, oem_registry.detect_cohort)
"""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable

if TYPE_CHECKING:
    from .main import FeedbackRecord, FeedbackSummaryResponse, LabelProposal
    from .risk_graph import DependencyRiskScorer


CANONICAL_LABELS = ("RECOMMENDED", "ADVANCED", "EXPERT", "UNSAFE")
RISK_ORDER: dict[str, int] = {
    "RECOMMENDED": 0,
    "ADVANCED": 1,
    "EXPERT": 2,
    "UNSAFE": 3,
}


class FeedbackManager:
    """Manages user action feedback events for model improvement and retraining signals.

    Persists events as newline-delimited JSON (JSONL) so the log can be appended to
    without loading the entire file, and can be streamed line-by-line when reading.

    When a :class:`~risk_graph.DependencyRiskScorer` is injected via
    :meth:`set_risk_scorer`, it is refreshed automatically every time a new event
    is appended so the graph scorer's breakage-rate statistics stay up to date.

    Args:
        events_path: Path to the JSONL feedback event log.
        variants_path: Default output path for :meth:`export_variants`.

    Attributes:
        _events_path: Resolved path to the JSONL log file.
        _variants_path: Default path for variant JSON exports.
        _risk_scorer: Optional injected graph risk scorer.
    """

    def __init__(self, events_path: Path, variants_path: Path) -> None:
        self._events_path: Path = events_path
        self._variants_path: Path = variants_path
        self._risk_scorer: "DependencyRiskScorer | None" = None

    # ──────────────────────────────────────────────────────────────────────────
    # Dependency injection
    # ──────────────────────────────────────────────────────────────────────────

    def set_risk_scorer(self, scorer: "DependencyRiskScorer") -> None:
        """Inject the graph risk scorer so it is refreshed on each new event.

        The scorer's :meth:`~risk_graph.DependencyRiskScorer.refresh_feedback`
        method is called with ``force=True`` every time :meth:`append_event` is
        invoked, keeping the in-memory breakage-rate table in sync with the log.

        Args:
            scorer: A fully-initialised :class:`~risk_graph.DependencyRiskScorer`.
        """
        self._risk_scorer = scorer

    # ──────────────────────────────────────────────────────────────────────────
    # Event log helpers
    # ──────────────────────────────────────────────────────────────────────────

    def ensure_dir(self) -> None:
        """Create the parent directory of the event log if it does not exist.

        This is called automatically by :meth:`append_event` before writing.
        It is exposed publicly so callers can pre-create the directory during
        application startup if desired.
        """
        self._events_path.parent.mkdir(parents=True, exist_ok=True)

    def append_event(self, record: "FeedbackRecord") -> None:
        """Append a single feedback event to the JSONL log file.

        The record is serialised with :meth:`~pydantic.BaseModel.model_dump` and
        written as a single JSON line followed by a newline.  After writing, the
        injected graph scorer (if any) is refreshed so its breakage-rate
        statistics reflect the new event immediately.

        Args:
            record: A validated :class:`~main.FeedbackRecord` to persist.
        """
        self.ensure_dir()
        with self._events_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record.model_dump(), ensure_ascii=False) + "\n")

        if self._risk_scorer is not None:
            self._risk_scorer.refresh_feedback(force=True)

    def load_events(
        self,
        window_days: int | None = None,
    ) -> "list[FeedbackRecord]":
        """Read and deserialise feedback events from the JSONL log.

        Lines that cannot be parsed (malformed JSON or failed Pydantic
        validation) are silently skipped so a single corrupt entry does not
        break the entire read.

        Args:
            window_days: When provided, only events whose ``created_at``
                timestamp falls within this many days before *now* are
                returned.  Clamped to ``[1, 3650]``.

        Returns:
            A list of :class:`~main.FeedbackRecord` instances, oldest first.
        """
        try:
            from .main import FeedbackRecord
        except ImportError:
            from main import FeedbackRecord

        if not self._events_path.exists():
            return []

        cutoff: datetime | None = None
        if window_days is not None:
            safe_days = max(1, min(window_days, 3650))
            cutoff = datetime.now(timezone.utc) - timedelta(days=safe_days)

        records: list[FeedbackRecord] = []
        with self._events_path.open("r", encoding="utf-8") as fh:
            for raw_line in fh:
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    payload = json.loads(line)
                    event = FeedbackRecord.model_validate(payload)
                except Exception:
                    continue

                if cutoff is not None:
                    created_at = self._parse_dt(event.created_at)
                    if created_at is None or created_at < cutoff:
                        continue

                records.append(event)

        return records

    # ──────────────────────────────────────────────────────────────────────────
    # Summarisation
    # ──────────────────────────────────────────────────────────────────────────

    def get_summary(self, days: int, top_k: int) -> "FeedbackSummaryResponse":
        """Compute aggregate statistics for feedback events within a time window.

        Counts are broken down by action type (UNINSTALL, DISABLE, …) and by
        outcome (SUCCESS, FAILURE).  The *top_k* most-active packages are also
        returned.

        Args:
            days: Number of past days to include.  Clamped to ``[1, 3650]``.
            top_k: Maximum number of top packages to return.  Clamped to
                ``[1, 200]``.

        Returns:
            A :class:`~main.FeedbackSummaryResponse` instance.
        """
        try:
            from .main import FeedbackSummaryResponse
        except ImportError:
            from main import FeedbackSummaryResponse

        window_days = max(1, min(days, 3650))
        top_k = max(1, min(top_k, 200))

        records = self.load_events(window_days=window_days)
        by_action: Counter[str] = Counter(r.action for r in records)
        by_outcome: Counter[str] = Counter(r.outcome for r in records)
        by_package: Counter[str] = Counter(r.package_id for r in records)

        top_packages = [
            {"package_id": pid, "events": count}
            for pid, count in by_package.most_common(top_k)
        ]

        return FeedbackSummaryResponse(
            total_events=len(records),
            window_days=window_days,
            by_action=dict(by_action),
            by_outcome=dict(by_outcome),
            top_packages=top_packages,
        )

    # ──────────────────────────────────────────────────────────────────────────
    # Proposal generation
    # ──────────────────────────────────────────────────────────────────────────

    def build_proposals(
        self,
        *,
        window_days: int,
        min_events: int,
        include_same: bool,
        current_label_lookup: Callable[[str], str | None],
        critical_packages: frozenset[str],
    ) -> "list[LabelProposal]":
        """Build ranked label-change proposals from aggregated feedback signals.

        For each package that appears in the event log within the time window,
        the safe / unsafe signal counts are aggregated and fed into
        :meth:`_infer_label` to derive a proposed label.  Packages with fewer
        than *min_events* events are skipped.

        Critical packages always receive an UNSAFE proposal regardless of the
        signal distribution.

        When *include_same* is ``False`` (the default), proposals whose
        *proposed_label* equals the current model label are omitted to keep
        the output focused on genuinely actionable changes.

        Results are sorted by descending confidence, then by descending sample
        size, then lexicographically by package ID.

        Args:
            window_days: Look-back window in days.  Clamped to ``[1, 3650]``.
            min_events: Minimum event count to include a package.  Clamped to
                ``[1, 200]``.
            include_same: When ``True``, proposals where the suggested label
                matches the current model label are included.
            current_label_lookup: Callable that takes a package ID and returns
                the current model label string (or ``None`` when unknown).
            critical_packages: Set of package IDs that must always be UNSAFE.

        Returns:
            A list of :class:`~main.LabelProposal` instances sorted by
            ``(-confidence, -sample_size, package_id)``.
        """
        try:
            from .main import LabelProposal
        except ImportError:
            from main import LabelProposal

        safe_days = max(1, min(window_days, 3650))
        safe_min = max(1, min(min_events, 200))

        records = self.load_events(window_days=safe_days)

        # Aggregate per-package signal counts
        aggregates: dict[str, dict[str, Any]] = {}
        for event in records:
            agg = aggregates.setdefault(
                event.package_id,
                {
                    "events": 0,
                    "safe": 0.0,
                    "unsafe": 0.0,
                    "actions": Counter(),
                    "outcomes": Counter(),
                },
            )
            safe_signal, unsafe_signal = self._feedback_signal(
                event.action, event.outcome
            )
            agg["events"] += 1
            agg["safe"] += safe_signal
            agg["unsafe"] += unsafe_signal
            agg["actions"][event.action] += 1
            agg["outcomes"][event.outcome] += 1

        proposals: list[LabelProposal] = []

        for package_id, agg in aggregates.items():
            if int(agg["events"]) < safe_min:
                continue

            proposed_label, confidence, reasons = self._infer_label(
                float(agg["safe"]),
                float(agg["unsafe"]),
                int(agg["events"]),
            )

            # Critical packages are always UNSAFE regardless of signal distribution
            if package_id in critical_packages:
                proposed_label = "UNSAFE"
                confidence = 1.0
                reasons = ["critical_system_denylist", *reasons]

            current_label = current_label_lookup(package_id)
            if not include_same and current_label == proposed_label:
                continue

            top_action_entry = agg["actions"].most_common(1)
            top_action_value = top_action_entry[0][0] if top_action_entry else "UNKNOWN"
            sample = int(agg["events"])

            reasons = [
                f"events={sample}",
                f"safe_signals={int(agg['safe'])}",
                f"unsafe_signals={int(agg['unsafe'])}",
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
                    sample_size=sample,
                )
            )

        proposals.sort(key=lambda p: (-p.confidence, -p.sample_size, p.package_id))
        return proposals

    # ──────────────────────────────────────────────────────────────────────────
    # Variant export
    # ──────────────────────────────────────────────────────────────────────────

    def export_variants(
        self,
        proposals: "list[LabelProposal]",
        out_path: Path,
        oem_detect: Callable[[str], str | None],
    ) -> int:
        """Serialise label proposals as a variant dataset JSON file.

        The output format is compatible with the ``build_training_dataset.py``
        script's ``--variants`` flag, allowing feedback-driven proposals to be
        merged into the next training run without manual editing.

        Each proposal is converted to a row with the following keys:

        * ``id`` — the package identifier.
        * ``list`` — the detected OEM cohort (or ``"UNKNOWN"``).
        * ``description`` — a fixed human-readable note.
        * ``removal`` — the proposed safety label.
        * ``category`` — ``"ESSENTIAL"`` / ``"BLOATWARE"`` / ``"OPTIONAL"``
          derived from the proposed label.
        * ``dependencies``, ``neededBy``, ``alternatives`` — empty lists.
        * ``labels`` — metadata tags including the proposed label and sample size.
        * ``source`` — always ``"variant:user_feedback"``.

        The parent directory of *out_path* is created automatically if it does
        not exist.

        Args:
            proposals: List of :class:`~main.LabelProposal` instances to export.
            out_path: Destination file path.
            oem_detect: Callable that maps a package ID to an OEM cohort string.

        Returns:
            The number of rows written to the output file.
        """
        try:
            from .main import utc_now_iso
        except ImportError:
            from main import utc_now_iso

        rows: list[dict[str, Any]] = []
        for p in proposals:
            oem = oem_detect(p.package_id) or "UNKNOWN"

            if p.proposed_label == "UNSAFE":
                category = "ESSENTIAL"
            elif p.proposed_label in ("RECOMMENDED", "ADVANCED"):
                category = "BLOATWARE"
            else:
                category = "OPTIONAL"

            rows.append(
                {
                    "id": p.package_id,
                    "list": oem,
                    "description": "Learned from De-Droid user action feedback",
                    "removal": p.proposed_label,
                    "category": category,
                    "dependencies": [],
                    "neededBy": [],
                    "labels": [
                        "user-feedback",
                        f"proposed:{p.proposed_label.lower()}",
                        f"sample-size:{p.sample_size}",
                    ],
                    "alternatives": [],
                    "source": "variant:user_feedback",
                }
            )

        payload: dict[str, Any] = {
            "meta": {
                "source": "user_feedback",
                "generated_at": utc_now_iso(),
                "count": len(rows),
            },
            "packages": rows,
        }

        out_path.parent.mkdir(parents=True, exist_ok=True)
        with out_path.open("w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2, ensure_ascii=False)

        return len(rows)

    # ──────────────────────────────────────────────────────────────────────────
    # Private helpers
    # ──────────────────────────────────────────────────────────────────────────

    def _parse_dt(self, value: str) -> datetime | None:
        """Parse an ISO-8601 datetime string into a timezone-aware UTC datetime.

        Handles the common ``Z`` suffix by replacing it with ``+00:00`` before
        parsing.  Naive datetimes (no tzinfo) are assumed to be UTC.

        Args:
            value: ISO-8601 datetime string.

        Returns:
            A timezone-aware :class:`~datetime.datetime` in UTC, or ``None``
            when parsing fails.
        """
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except ValueError:
            return None

    def _feedback_signal(self, action: str, outcome: str) -> tuple[float, float]:
        """Convert a (action, outcome) pair into (safe_signal, unsafe_signal) floats.

        Signal semantics:

        * **UNINSTALL / DISABLE + SUCCESS** → ``safe_signal += 1.0``
          (user successfully removed the package — it was probably safe to do so).
        * **UNINSTALL / DISABLE + FAILURE** → ``unsafe_signal += 1.0``
          (removal failed — the package may be essential).
        * **RESTORE / ENABLE / UNDO + SUCCESS** → ``unsafe_signal += 1.0``
          (user had to restore the package — it was probably needed).

        Args:
            action: One of ``UNINSTALL``, ``DISABLE``, ``RESTORE``, ``ENABLE``,
                ``UNDO`` (case-insensitive).
            outcome: One of ``SUCCESS``, ``FAILURE`` (case-insensitive).

        Returns:
            A 2-tuple ``(safe_signal, unsafe_signal)`` where each value is
            either ``0.0`` or ``1.0``.
        """
        action = action.strip().upper()
        outcome = outcome.strip().upper()
        safe, unsafe = 0.0, 0.0

        if action in ("UNINSTALL", "DISABLE"):
            if outcome == "SUCCESS":
                safe += 1.0
            else:
                unsafe += 1.0
        elif action in ("RESTORE", "ENABLE", "UNDO"):
            if outcome == "SUCCESS":
                unsafe += 1.0

        return safe, unsafe

    def _infer_label(
        self,
        safe: float,
        unsafe: float,
        sample_size: int,
    ) -> tuple[str, float, list[str]]:
        """Infer a proposed safety label from aggregated signal counts.

        Uses fixed rate thresholds to map the safe/unsafe signal distribution
        to one of the four canonical labels.  Confidence grows with the
        magnitude of the dominant signal rate.

        Thresholds:

        * ``unsafe_rate >= 0.70`` → UNSAFE
          (rollback/failed-removal events dominate)
        * ``safe_rate >= 0.85`` and ``sample_size >= 5`` → RECOMMENDED
          (clean successful removals dominate)
        * ``safe_rate >= 0.60`` → ADVANCED
          (mixed but safe-leaning)
        * otherwise → EXPERT
          (uncertain or weak signal)

        Args:
            safe: Accumulated safe-signal count.
            unsafe: Accumulated unsafe-signal count.
            sample_size: Total number of feedback events for this package.

        Returns:
            A 3-tuple ``(label, confidence, reasons)`` where *reasons* is a
            list of human-readable explanation strings.
        """
        total = safe + unsafe
        if total <= 0:
            return "ADVANCED", 0.5, ["insufficient_direct_signals"]

        safe_rate = safe / total
        unsafe_rate = unsafe / total
        reasons = [
            f"safe_signal_rate={safe_rate:.2f}",
            f"unsafe_signal_rate={unsafe_rate:.2f}",
        ]

        if unsafe_rate >= 0.70:
            confidence = min(0.98, 0.55 + unsafe_rate * 0.4)
            return (
                "UNSAFE",
                confidence,
                [*reasons, "rollback_or_failed_removal_dominant"],
            )

        if safe_rate >= 0.85 and sample_size >= 5:
            confidence = min(0.97, 0.5 + safe_rate * 0.4)
            return (
                "RECOMMENDED",
                confidence,
                [*reasons, "successful_removal_dominant"],
            )

        if safe_rate >= 0.60:
            confidence = min(0.90, 0.45 + safe_rate * 0.35)
            return (
                "ADVANCED",
                confidence,
                [*reasons, "mixed_feedback_but_safe_leaning"],
            )

        confidence = min(0.88, 0.45 + unsafe_rate * 0.25)
        return (
            "EXPERT",
            confidence,
            [*reasons, "mixed_or_uncertain_feedback"],
        )
