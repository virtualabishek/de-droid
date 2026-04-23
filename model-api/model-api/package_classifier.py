"""
De-Droid Package Classifier — Classifies Android packages for safety/bloatware risk.

This module provides the PackageClassifier class which orchestrates three complementary
classification strategies:

1. **Model predictions** — fast lookup against the precomputed ``safety_predictions.json``
   cache built by the offline training pipeline.
2. **OEM registry heuristics** — brand-aware keyword and prefix matching via
   :class:`~oem_registry.OEMRegistry` for packages not present in the training data.
3. **Graph-based risk scoring** — dependency co-occurrence and breakage-history signals
   from :class:`~risk_graph.DependencyRiskScorer` layered on top of either strategy.

All three strategies feed into a deterministic safety-gate layer that can upgrade a
classification to a stricter label (e.g. ADVANCED → EXPERT) when hard rules are triggered.

Usage::

    from model_store import ModelStore
    from oem_registry import OEMRegistry
    from risk_graph import DependencyRiskScorer
    from package_classifier import PackageClassifier

    classifier = PackageClassifier(model_store, oem_registry, risk_scorer)
    result = classifier.classify("com.example.bloat")
    batch  = classifier.classify_batch(["com.example.bloat", "com.android.systemui"])
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .main import PackageCheckResponse, PackageSafety
    from .risk_graph import DependencyRiskScorer

try:  # Package context
    from .model_store import ModelStore
    from .oem_registry import OEMRegistry
except ImportError:  # app-dir/main:app context
    from model_store import ModelStore
    from oem_registry import OEMRegistry

# Risk label ordering — higher index means higher removal risk.
RISK_ORDER: dict[str, int] = {
    "RECOMMENDED": 0,
    "ADVANCED": 1,
    "EXPERT": 2,
    "UNSAFE": 3,
}


class PackageClassifier:
    """Classifies Android packages for safety and bloatware risk.

    Combines three complementary signals:

    * **Precomputed model predictions** from :class:`~model_store.ModelStore`.
    * **OEM-aware heuristics** from :class:`~oem_registry.OEMRegistry` (used as
      fallback when a package is absent from the training corpus).
    * **Graph-based risk scores** from :class:`~risk_graph.DependencyRiskScorer`
      (optional; enabled when a scorer instance is injected).

    Deterministic safety gates are applied on top of every prediction to ensure
    that critical system packages can never escape an UNSAFE classification.

    Args:
        model_store: Loaded :class:`~model_store.ModelStore` instance.
        oem_registry: Shared :class:`~oem_registry.OEMRegistry` instance.
        risk_scorer: Optional graph scorer.  Can be injected later via
            :meth:`set_risk_scorer`.

    Attributes:
        _model_store: Reference to the loaded model store.
        _oem_registry: Reference to the OEM registry.
        _risk_scorer: Optional graph-based risk scorer (may be ``None``).
    """

    def __init__(
        self,
        model_store: ModelStore,
        oem_registry: OEMRegistry,
        risk_scorer: "DependencyRiskScorer | None" = None,
    ) -> None:
        self._model_store: ModelStore = model_store
        self._oem_registry: OEMRegistry = oem_registry
        self._risk_scorer: "DependencyRiskScorer | None" = risk_scorer

    def set_risk_scorer(self, scorer: "DependencyRiskScorer") -> None:
        """Inject or replace the graph-based risk scorer.

        This allows the scorer to be wired in after the classifier is
        constructed (e.g. once the dependency graph has finished loading during
        the startup event).

        Args:
            scorer: A fully-initialized :class:`~risk_graph.DependencyRiskScorer`.
        """
        self._risk_scorer = scorer

    # ──────────────────────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────────────────────

    def classify(
        self,
        package_id: str,
        installed_packages: set[str] | None = None,
    ) -> "PackageSafety":
        """Classify a single package.  Never raises.

        Attempts a full classification via :meth:`_classify_inner`.  On any
        unexpected exception falls back to a conservative ADVANCED label so
        the API always returns a usable response.

        Args:
            package_id: The Android package identifier to classify.
            installed_packages: Optional set of all packages currently installed
                on the device.  Used by the graph scorer when present.

        Returns:
            A populated :class:`~main.PackageSafety` instance.
        """
        try:
            from .main import PackageSafety
        except ImportError:
            from main import PackageSafety

        try:
            return self._classify_inner(package_id, installed_packages or set())
        except Exception:
            oem = self._oem_registry.detect_cohort(package_id)
            return PackageSafety(
                package_id=package_id,
                label="ADVANCED",
                confidence=0.4,
                description="Classification error — defaulting to ADVANCED",
                oem_cohort=oem,
            )

    def classify_unknown(self, package_id: str) -> "PackageSafety":
        """Classify a package that is absent from the training database.

        Uses brand-aware keyword heuristics provided by
        :class:`~oem_registry.OEMRegistry` to produce a best-effort label.
        Safety gates for globally-critical and OEM-critical packages are still
        applied so this path can never classify a critical package as safe.

        Classification priority (highest to lowest):

        1. Global critical denylist → UNSAFE / confidence 1.0
        2. OEM-specific critical patterns → UNSAFE / confidence 0.95
        3. Core Android package with system keywords → EXPERT
        4. Multiple system keywords → EXPERT
        5. Multiple bloatware keywords → RECOMMENDED
        6. Single bloatware keyword → ADVANCED
        7. Core Android or Google package → EXPERT (proceed with caution)
        8. Resource overlay (``.overlay`` / ``.res.``) → EXPERT
        9. Known OEM prefix but not in database → ADVANCED
        10. Completely unknown → ADVANCED / low confidence

        Args:
            package_id: The Android package identifier to classify.

        Returns:
            A :class:`~main.PackageSafety` instance populated from heuristics.
        """
        try:
            from .main import PackageSafety
        except ImportError:
            from main import PackageSafety

        pkg = package_id.lower().strip()
        oem = self._oem_registry.detect_cohort(package_id)

        # ── Gate 1: Global critical denylist ──────────────────────────────────
        if self._oem_registry.is_critical(package_id):
            return PackageSafety(
                package_id=package_id,
                label="UNSAFE",
                confidence=1.0,
                description="Critical system package — do not remove",
                top_factors=["on global critical denylist"],
                safety_gate=["critical_system_denylist"],
                oem_cohort=oem,
                is_bloatware=False,
            )

        # ── Gate 2: OEM-specific critical patterns ────────────────────────────
        if oem and self._oem_registry.is_oem_critical(package_id, oem):
            return PackageSafety(
                package_id=package_id,
                label="UNSAFE",
                confidence=0.95,
                description=f"Critical {oem} system package — do not remove",
                top_factors=[f"{oem} critical package pattern"],
                safety_gate=[f"oem_critical_{oem.lower()}"],
                oem_cohort=oem,
                is_bloatware=False,
            )

        # ── Keyword scoring ───────────────────────────────────────────────────
        system_kw_count = sum(
            1 for kw in self._oem_registry.SYSTEM_KEYWORDS if kw in pkg
        )
        bloat_kw_count = sum(
            1 for kw in self._oem_registry.BLOATWARE_KEYWORDS if kw in pkg
        )
        bloatware = self._oem_registry.is_bloatware(package_id)
        factors: list[str] = []

        if pkg.startswith("com.android.") and system_kw_count > 0:
            label, confidence = "EXPERT", 0.70
            factors.append("core Android package with system keywords")

        elif system_kw_count >= 2:
            label, confidence = "EXPERT", 0.65
            factors.append("multiple system-critical keywords detected")

        elif bloat_kw_count >= 2:
            label, confidence = "RECOMMENDED", 0.75
            factors.append("multiple bloatware keywords detected")
            bloatware = True

        elif bloat_kw_count == 1:
            label, confidence = "ADVANCED", 0.55
            factors.append("bloatware keyword detected")
            bloatware = True

        elif pkg.startswith("com.android.") or pkg.startswith("com.google."):
            label, confidence = "EXPERT", 0.60
            factors.append("core Android/Google package — proceed with caution")

        elif ".overlay" in pkg or ".res." in pkg:
            label, confidence = "EXPERT", 0.55
            factors.append("resource overlay package")

        elif oem:
            # OEM packages from community sources carry lower confidence.
            # SAMSUNG / REDMI community data is historically noisier.
            base_confidence = 0.50
            if oem in ("SAMSUNG", "REDMI"):
                base_confidence = 0.48
            label, confidence = "ADVANCED", base_confidence
            factors.append(f"{oem} OEM package — not in database")

        else:
            label, confidence = "ADVANCED", 0.40
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

    def classify_batch(
        self,
        packages: list[str],
        device_brand: str | None = None,
    ) -> "PackageCheckResponse":
        """Classify a list of packages and return a sorted, summarised response.

        The input list is expected to be pre-cleaned and deduplicated by the
        caller (e.g. the ``/api/check-packages`` endpoint).  When the list is
        empty an HTTP 400 is raised immediately.

        Processing order for each package:

        1. Look up precomputed prediction via :meth:`~model_store.ModelStore.get_prediction`.
        2. Apply deterministic safety gates (:meth:`_apply_safety_gates`).
        3. If a graph scorer is available, compute the graph risk score and
           apply graph-based risk gates (:meth:`_apply_graph_risk_gate`).
        4. Accumulate label counts into a summary dict.

        Results are sorted: UNSAFE first → EXPERT → ADVANCED → RECOMMENDED,
        with descending confidence as the secondary sort key.

        Args:
            packages: Pre-cleaned list of Android package identifiers.
            device_brand: Optional device brand string (reserved for future
                brand-specific overrides; not yet applied in this method).

        Returns:
            A :class:`~main.PackageCheckResponse` with all classified packages.

        Raises:
            fastapi.HTTPException: 400 when *packages* is empty.
        """
        from fastapi import HTTPException
        try:
            from .main import PackageCheckResponse, PackageSafety
        except ImportError:
            from main import PackageCheckResponse, PackageSafety

        if not packages:
            raise HTTPException(
                status_code=400,
                detail="No valid package IDs provided",
            )

        package_set = set(packages)

        # Feed snapshot into the graph scorer so co-occurrence statistics are
        # updated incrementally with each real-world device scan.
        if self._risk_scorer is not None:
            self._risk_scorer.ingest_snapshot(packages)

        results: list[PackageSafety] = []
        summary: dict[str, int] = {
            "RECOMMENDED": 0,
            "ADVANCED": 0,
            "EXPERT": 0,
            "UNSAFE": 0,
        }

        for pkg_id in packages:
            # ── Step 1 & 2: model prediction + safety gates ───────────────────
            entry = self._classify_inner(pkg_id, package_set)

            # ── Step 3: graph risk augmentation ──────────────────────────────
            if self._risk_scorer is not None:

                def _label_lookup(pkg: str) -> str | None:
                    pred = self._model_store.get_prediction(pkg)
                    return pred.get("label") if pred else None

                graph_score, graph_reasons = self._risk_scorer.score(
                    pkg_id,
                    package_set,
                    predicted_label=entry.label,
                    label_lookup=_label_lookup,
                )
                entry.graph_risk_score = graph_score

                if graph_reasons:
                    entry.graph_risk_reasons = graph_reasons
                    # Merge up to 2 graph reasons into top_factors (cap at 6 total)
                    entry.top_factors = [
                        *(entry.top_factors or []),
                        *graph_reasons[:2],
                    ][:6]

                g_label, g_conf, g_gates = self._apply_graph_risk_gate(
                    entry.label,
                    entry.confidence,
                    graph_score,
                )
                if g_gates:
                    entry.label = g_label
                    entry.confidence = g_conf
                    merged = [*(entry.safety_gate or []), *g_gates]
                    # Deduplicate while preserving order
                    entry.safety_gate = list(dict.fromkeys(merged))

            # ── Step 4: accumulate summary ────────────────────────────────────
            summary[entry.label] = summary.get(entry.label, 0) + 1
            results.append(entry)

        # Sort: UNSAFE first, then EXPERT → ADVANCED → RECOMMENDED;
        # secondary sort by confidence descending.
        label_order = {"UNSAFE": 0, "EXPERT": 1, "ADVANCED": 2, "RECOMMENDED": 3}
        results.sort(key=lambda x: (label_order.get(x.label, 99), -x.confidence))

        return PackageCheckResponse(
            model_version=self._model_store.version,
            total_packages=len(results),
            summary=summary,
            packages=results,
        )

    # ──────────────────────────────────────────────────────────────────────────
    # Private helpers
    # ──────────────────────────────────────────────────────────────────────────

    def _classify_inner(
        self,
        package_id: str,
        package_set: set[str],
    ) -> "PackageSafety":
        """Core classification dispatcher for a single package.

        Checks the model prediction cache first.  When the package is found its
        cached label and confidence are run through the safety gates.  When the
        package is absent the :meth:`classify_unknown` heuristic path is used.

        Args:
            package_id: The Android package identifier to classify.
            package_set: Full set of packages from the current device scan.

        Returns:
            A :class:`~main.PackageSafety` instance (never raises).
        """
        try:
            from .main import PackageSafety
        except ImportError:
            from main import PackageSafety

        cached = self._model_store.get_prediction(package_id)
        if cached:
            final_label, final_conf, gate_reasons = self._apply_safety_gates(
                package_id,
                cached.get("label", "ADVANCED"),
                cached.get("confidence", 0.5),
            )
            oem = self._oem_registry.detect_cohort(package_id)
            return PackageSafety(
                package_id=package_id,
                label=final_label,
                confidence=final_conf,
                top_factors=cached.get("top_factors", []),
                safety_gate=gate_reasons if gate_reasons else cached.get("safety_gate"),
                oem_cohort=oem,
                is_bloatware=self._oem_registry.is_bloatware(package_id),
            )

        # Package not in training corpus — fall back to heuristics.
        return self.classify_unknown(package_id)

    def _apply_safety_gates(
        self,
        package_id: str,
        predicted_label: str,
        confidence: float,
    ) -> tuple[str, float, list[str]]:
        """Apply deterministic safety gates to a model-predicted label.

        Gates are evaluated in priority order and the first gate that fires
        overrides the model prediction.  Multiple gates can fire for different
        reasons, but only the first matching gate changes the label.

        Gate priority:

        1. **Critical system denylist** — always UNSAFE / confidence 1.0.
        2. **Core Android system keyword** — upgrades RECOMMENDED/ADVANCED to
           EXPERT when the package ID starts with ``com.android.`` and contains
           a system keyword.
        3. **Low confidence safety upgrade** — promotes a low-confidence
           RECOMMENDED to ADVANCED to avoid false positives.

        Args:
            package_id: The Android package identifier.
            predicted_label: Raw label from the model prediction cache.
            confidence: Raw confidence from the model prediction cache.

        Returns:
            A 3-tuple of ``(final_label, final_confidence, gate_reasons)``.
            *gate_reasons* is an empty list when no gate fired.
        """
        gate_reasons: list[str] = []

        # Gate 1: global critical denylist
        if self._oem_registry.is_critical(package_id):
            gate_reasons.append("critical_system_denylist")
            return "UNSAFE", 1.0, gate_reasons

        pkg = package_id.lower()

        # Gate 2: core Android package with system keyword fingerprint
        if pkg.startswith("com.android.") and self._oem_registry.is_system_package(
            package_id
        ):
            if predicted_label in ("RECOMMENDED", "ADVANCED"):
                gate_reasons.append("android_core_system_keyword")
                return "EXPERT", max(confidence, 0.85), gate_reasons

        # Gate 3: low-confidence RECOMMENDED upgrade
        if confidence < 0.45 and predicted_label == "RECOMMENDED":
            gate_reasons.append("low_confidence_safety_upgrade")
            return "ADVANCED", confidence, gate_reasons

        return predicted_label, confidence, gate_reasons

    def _apply_graph_risk_gate(
        self,
        current_label: str,
        current_confidence: float,
        graph_risk_score: float,
    ) -> tuple[str, float, list[str]]:
        """Upgrade the risk label when graph evidence suggests removal breakage risk.

        The graph risk score from :class:`~risk_graph.DependencyRiskScorer` is
        mapped to a target label via fixed thresholds.  The gate only fires when
        the target label is strictly *riskier* than the current label (i.e. it
        can only upgrade, never downgrade).

        Thresholds:

        * ``>= 0.88`` → UNSAFE  (``graph_breakage_cluster_high``)
        * ``>= 0.72`` → EXPERT  (``graph_dependency_risk_high``)
        * ``>= 0.55`` → ADVANCED (``graph_cooccurrence_risk``)
        * ``< 0.55``  → no change

        Args:
            current_label: The classification label before graph adjustment.
            current_confidence: The confidence score before graph adjustment.
            graph_risk_score: The combined graph risk score in ``[0, 1]``.

        Returns:
            A 3-tuple of ``(final_label, final_confidence, gate_reasons)``.
            *gate_reasons* is an empty list when the gate did not fire.
        """
        if graph_risk_score >= 0.88:
            target_label, gate_reason = "UNSAFE", "graph_breakage_cluster_high"
        elif graph_risk_score >= 0.72:
            target_label, gate_reason = "EXPERT", "graph_dependency_risk_high"
        elif graph_risk_score >= 0.55:
            target_label, gate_reason = "ADVANCED", "graph_cooccurrence_risk"
        else:
            return current_label, current_confidence, []

        # Only upgrade — never downgrade a stricter classification
        if RISK_ORDER.get(target_label, 0) <= RISK_ORDER.get(current_label, 0):
            return current_label, current_confidence, []

        upgraded_confidence = max(current_confidence, min(0.99, graph_risk_score))
        return target_label, upgraded_confidence, [gate_reason]
