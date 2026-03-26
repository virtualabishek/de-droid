## Plan: Trustworthy Android Debloat Safety Model

Build a pure-ML-first package safety system, but keep hard safety guardrails (critical-package blocklist + dependency checks) so early model errors cannot brick devices. Start with Samsung and Xiaomi curated validation cohorts, train on structured features from UAD + enriched metadata, and continuously improve with opt-in anonymized outcomes.

**Steps**
1. Phase 1 — Data Contract & Label Harmonization
   - Define canonical label space: `RECOMMENDED`, `ADVANCED`, `EXPERT`, `UNSAFE` (uppercase, strict enum).
   - Build deterministic mapping from UAD `Recommended/Advanced/Expert` into canonical labels and define policy for generating `UNSAFE` (critical-system rules + evidence).
   - Add dataset schema versioning and required metadata fields: `source`, `lastReviewedAt`, `reviewConfidence`, `evidenceUrls`, `oemScope`, `androidVersionScope`.
   - Dependency: blocks all later phases.
2. Phase 2 — Feature Engineering Dataset (ML-ready)
   - Generate structured features per package: text features from description, package-name token patterns, dependency graph features (`inDegree`, `outDegree`, centrality), OEM/list category features, and permission/risk indicators when available.
   - Create training tables with split strategy by OEM and Android version to avoid leakage.
   - Build a gold validation subset for Samsung and Xiaomi using manual review + reproducible evidence links.
   - Depends on 1.
3. Phase 3 — Model Baseline (Pure ML) + Safety Gates
   - Train a multiclass classifier (4 classes) with calibrated probabilities; retain top interpretable baseline first (gradient boosting / linear + TF-IDF) before larger models.
   - Add confidence thresholds: low-confidence predictions route to `ADVANCED` + manual review queue.
   - Enforce non-ML safety gates before final recommendation: critical-package denylist and dependency break-risk checks.
   - Depends on 2.
4. Phase 4 — Evaluation & Trust Metrics
   - Evaluate macro F1, per-class recall (especially `UNSAFE` recall), calibration error, and OEM-specific confusion matrices.
   - Define trust KPIs: false-safe rate (must be near-zero), rollback rate after uninstall, and model confidence coverage.
   - Create release criteria: model cannot ship unless `UNSAFE` recall and false-safe thresholds are met on Samsung/Xiaomi holdout sets.
   - Depends on 3.
5. Phase 5 — Integration into App Inference Path
   - Extend package metadata surface in main process with `modelLabel`, `modelConfidence`, `explanationTopFactors`, `evidenceCount`, `lastModelVersion`.
   - Update IPC safety response to return both rule/safety-gate result and ML output, with final decision rationale.
   - Update package list/details UI to show confidence and “why” factors, not just color/tier.
   - Depends on 4.
6. Phase 6 — Data Collection Loop (Opt-in)
   - Capture anonymized outcomes: uninstall success/failure, undo/restore events, device brand/model, Android version, and package id hash strategy/policy.
   - Build retraining cadence (e.g., monthly) with drift checks and rollback strategy for bad models.
   - Parallel with 5 after telemetry schema is approved.
7. Phase 7 — OEM Expansion Playbook
   - After Samsung/Xiaomi quality gates pass, onboard OnePlus/Huawei/Oppo/Vivo with same gold-set + OEM holdout evaluation protocol.
   - Maintain OEM-specific override tables for known edge-cases while model generalizes.
   - Depends on 4 and 6.

**Relevant files**
- `/home/virtualabishek/Projects/de-droid/model-api/raw-data/uad_lists.json` — raw source labels and descriptions; base ingestion.
- `/home/virtualabishek/Projects/de-droid/desktop-app/src/data/debloat_lists.json` — canonical app-facing dataset to align with model outputs.
- `/home/virtualabishek/Projects/de-droid/desktop-app/src/main/services/packageDataService.ts` — enrichment point for model prediction merge and safety gates.
- `/home/virtualabishek/Projects/de-droid/desktop-app/src/main/ipc/adb.ipc.ts` — safety-check contract exposed to renderer.
- `/home/virtualabishek/Projects/de-droid/desktop-app/src/renderer/components/PackageList.tsx` — confidence/rationale display in main list.
- `/home/virtualabishek/Projects/de-droid/desktop-app/src/renderer/components/PackageDetailsModal.tsx` — detailed explanation and evidence UI.
- `/home/virtualabishek/Projects/de-droid/desktop-app/src/renderer/store/deviceStore.ts` — client state for model fields and filters.

**Verification**
1. Data validation: schema validation passes for 100% rows; no unknown `removal` labels.
2. Training validation: cross-validation + OEM holdout metrics generated and archived.
3. Safety validation: dependency-gate tests prove critical packages are never recommended for removal even if model predicts safe.
4. Product validation: sampled Samsung/Xiaomi devices verify prediction, uninstall outcome, and rollback workflow.
5. Post-release validation: opt-in telemetry shows stable/declining rollback rate and near-zero false-safe incidents.

**Decisions**
- Chosen approach: Pure ML classifier as primary decision engine.
- Guardrail decision: keep deterministic safety gates to prevent catastrophic false-safe recommendations.
- Data policy: opt-in anonymized telemetry is allowed.
- Initial OEM scope: Samsung and Xiaomi/Redmi only.

**Further Considerations**
1. `UNSAFE` class imbalance will likely be severe; use class weighting + threshold tuning and prioritize recall over precision for this class.
2. If pure ML underperforms on minority OEMs, keep OEM override tables as temporary controls rather than forcing global model behavior.
3. Keep model outputs explainable from day one (top factors + evidence links) because trust is a product requirement, not only an ML metric.