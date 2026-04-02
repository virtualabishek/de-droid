from __future__ import annotations

import json
from collections import defaultdict
from heapq import nlargest
from itertools import combinations
from pathlib import Path
from typing import Callable

RISK_ORDER = {
    "RECOMMENDED": 0,
    "ADVANCED": 1,
    "EXPERT": 2,
    "UNSAFE": 3,
}

RISK_PRIOR_BY_LABEL = {
    "RECOMMENDED": 0.10,
    "ADVANCED": 0.25,
    "EXPERT": 0.60,
    "UNSAFE": 0.92,
}


class DependencyRiskScorer:
    """Graph-based risk scorer using dependencies, co-occurrence, and feedback history."""

    def __init__(
        self,
        *,
        dataset_path: Path,
        state_path: Path,
        feedback_events_path: Path,
        critical_packages: set[str] | frozenset[str],
        max_pairs: int = 250000,
    ) -> None:
        self.dataset_path = dataset_path
        self.state_path = state_path
        self.feedback_events_path = feedback_events_path
        self.critical_packages = set(critical_packages)
        self.max_pairs = max(1000, max_pairs)

        self.package_labels: dict[str, str] = {}
        self.dependents_by_package: dict[str, set[str]] = defaultdict(set)

        self.node_counts: dict[str, int] = {}
        self.pair_counts: dict[str, int] = {}

        self.feedback_breakage_rate: dict[str, float] = {}
        self.feedback_sample_size: dict[str, int] = {}
        self._feedback_mtime: float | None = None

        self._updates_since_save = 0

    @staticmethod
    def _normalize_package(value: str | None) -> str | None:
        if not isinstance(value, str):
            return None
        cleaned = value.strip().lower()
        return cleaned or None

    @staticmethod
    def _pair_key(a: str, b: str) -> str:
        if a < b:
            return f"{a}|{b}"
        return f"{b}|{a}"

    @staticmethod
    def _normalize_label(value: str | None) -> str | None:
        if not isinstance(value, str):
            return None
        label = value.strip().upper()
        return label if label in RISK_ORDER else None

    @staticmethod
    def _feedback_signal(action: str, outcome: str) -> tuple[float, float]:
        action = action.strip().upper()
        outcome = outcome.strip().upper()

        safe_signal = 0.0
        unsafe_signal = 0.0

        if action in ("UNINSTALL", "DISABLE"):
            if outcome == "SUCCESS":
                safe_signal += 1.0
            else:
                unsafe_signal += 1.0
        elif action in ("RESTORE", "ENABLE", "UNDO"):
            if outcome == "SUCCESS":
                unsafe_signal += 1.0

        return safe_signal, unsafe_signal

    def initialize(self) -> None:
        self._load_dependency_graph()
        self._load_cooccurrence_state()
        self.refresh_feedback(force=True)

    def _load_dependency_graph(self) -> None:
        if not self.dataset_path.exists():
            return

        try:
            with self.dataset_path.open("r", encoding="utf-8") as file:
                payload = json.load(file)
        except Exception:
            return

        rows = payload.get("rows") if isinstance(payload, dict) else None
        if not isinstance(rows, list):
            return

        label_map: dict[str, str] = {}
        dependents_map: dict[str, set[str]] = defaultdict(set)

        for row in rows:
            if not isinstance(row, dict):
                continue

            package_id = self._normalize_package(row.get("package_id"))
            if not package_id:
                continue

            removal = self._normalize_label(row.get("removal")) or "ADVANCED"
            current = label_map.get(package_id)
            if current is None or RISK_ORDER[removal] > RISK_ORDER[current]:
                label_map[package_id] = removal

            needed_by_raw = row.get("needed_by")
            needed_by = needed_by_raw if isinstance(needed_by_raw, list) else []
            legacy_needed_by = row.get("neededBy")
            if isinstance(legacy_needed_by, list):
                needed_by = [*needed_by, *legacy_needed_by]

            dependencies_raw = row.get("dependencies")
            dependencies = dependencies_raw if isinstance(dependencies_raw, list) else []

            for dependent in needed_by:
                dependent_pkg = self._normalize_package(dependent)
                if dependent_pkg:
                    dependents_map[package_id].add(dependent_pkg)

            # If package A depends on B, removing B can break A.
            for dependency in dependencies:
                dependency_pkg = self._normalize_package(dependency)
                if dependency_pkg:
                    dependents_map[dependency_pkg].add(package_id)

        self.package_labels = label_map
        self.dependents_by_package = dependents_map

    def _load_cooccurrence_state(self) -> None:
        if not self.state_path.exists():
            return

        try:
            with self.state_path.open("r", encoding="utf-8") as file:
                payload = json.load(file)
        except Exception:
            return

        node_counts = payload.get("node_counts") if isinstance(payload, dict) else None
        pair_counts = payload.get("pair_counts") if isinstance(payload, dict) else None

        if isinstance(node_counts, dict):
            self.node_counts = {
                k: int(v)
                for k, v in node_counts.items()
                if isinstance(k, str) and isinstance(v, (int, float)) and v > 0
            }

        if isinstance(pair_counts, dict):
            self.pair_counts = {
                k: int(v)
                for k, v in pair_counts.items()
                if isinstance(k, str) and isinstance(v, (int, float)) and v > 0
            }

        if len(self.pair_counts) > self.max_pairs:
            self._prune_pairs()

    def _save_cooccurrence_state(self) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "meta": {
                "version": 1,
                "observed_packages": len(self.node_counts),
                "observed_pairs": len(self.pair_counts),
            },
            "node_counts": self.node_counts,
            "pair_counts": self.pair_counts,
        }

        with self.state_path.open("w", encoding="utf-8") as file:
            json.dump(payload, file, ensure_ascii=False)

    def _prune_pairs(self) -> None:
        if len(self.pair_counts) <= self.max_pairs:
            return

        top = nlargest(
            self.max_pairs,
            self.pair_counts.items(),
            key=lambda item: item[1],
        )
        self.pair_counts = dict(top)

    def refresh_feedback(self, force: bool = False) -> None:
        if not self.feedback_events_path.exists():
            self.feedback_breakage_rate = {}
            self.feedback_sample_size = {}
            self._feedback_mtime = None
            return

        current_mtime = self.feedback_events_path.stat().st_mtime
        if not force and self._feedback_mtime == current_mtime:
            return

        safe_signal_by_package: dict[str, float] = defaultdict(float)
        unsafe_signal_by_package: dict[str, float] = defaultdict(float)
        sample_size_by_package: dict[str, int] = defaultdict(int)

        with self.feedback_events_path.open("r", encoding="utf-8") as file:
            for raw_line in file:
                line = raw_line.strip()
                if not line:
                    continue

                try:
                    payload = json.loads(line)
                except Exception:
                    continue

                if not isinstance(payload, dict):
                    continue

                package_id = self._normalize_package(payload.get("package_id"))
                action = payload.get("action")
                outcome = payload.get("outcome")

                if not package_id or not isinstance(action, str) or not isinstance(outcome, str):
                    continue

                safe_signal, unsafe_signal = self._feedback_signal(action, outcome)
                safe_signal_by_package[package_id] += safe_signal
                unsafe_signal_by_package[package_id] += unsafe_signal
                sample_size_by_package[package_id] += 1

        breakage_rate: dict[str, float] = {}
        for package_id in sample_size_by_package:
            total_signal = safe_signal_by_package[package_id] + unsafe_signal_by_package[package_id]
            if total_signal <= 0:
                continue
            breakage_rate[package_id] = float(unsafe_signal_by_package[package_id] / total_signal)

        self.feedback_breakage_rate = breakage_rate
        self.feedback_sample_size = dict(sample_size_by_package)
        self._feedback_mtime = current_mtime

    def ingest_snapshot(self, packages: list[str]) -> None:
        normalized = []
        for package in packages:
            package_id = self._normalize_package(package)
            if package_id:
                normalized.append(package_id)

        unique_packages = sorted(set(normalized))
        if len(unique_packages) < 2:
            return

        for package_id in unique_packages:
            self.node_counts[package_id] = self.node_counts.get(package_id, 0) + 1

        for left, right in combinations(unique_packages, 2):
            key = self._pair_key(left, right)
            self.pair_counts[key] = self.pair_counts.get(key, 0) + 1

        self._updates_since_save += 1

        if len(self.pair_counts) > self.max_pairs:
            self._prune_pairs()

        if self._updates_since_save >= 5:
            self._save_cooccurrence_state()
            self._updates_since_save = 0

    def _label_prior(self, label: str | None) -> float:
        normalized = self._normalize_label(label) or "ADVANCED"
        return RISK_PRIOR_BY_LABEL[normalized]

    def _package_prior(
        self,
        package_id: str,
        *,
        fallback_label: str,
        label_lookup: Callable[[str], str | None] | None,
    ) -> float:
        if package_id in self.critical_packages:
            return 1.0

        feedback_rate = self.feedback_breakage_rate.get(package_id)
        feedback_samples = self.feedback_sample_size.get(package_id, 0)
        if feedback_rate is not None and feedback_samples >= 3:
            return max(feedback_rate, self._label_prior(self.package_labels.get(package_id)))

        known_label = self.package_labels.get(package_id)
        if known_label:
            return self._label_prior(known_label)

        if label_lookup is not None:
            looked_up = label_lookup(package_id)
            if looked_up:
                return self._label_prior(looked_up)

        return self._label_prior(fallback_label)

    def score(
        self,
        package_id: str,
        installed_packages: set[str],
        *,
        predicted_label: str,
        label_lookup: Callable[[str], str | None] | None = None,
    ) -> tuple[float, list[str]]:
        normalized_package = self._normalize_package(package_id) or package_id.lower().strip()

        normalized_installed = {
            p
            for p in (
                self._normalize_package(item)
                for item in installed_packages
            )
            if p
        }
        normalized_installed.add(normalized_package)

        self.refresh_feedback()

        base_prior = self._package_prior(
            normalized_package,
            fallback_label=predicted_label,
            label_lookup=label_lookup,
        )

        reasons: list[str] = []

        dependents_present = sorted(
            normalized_installed.intersection(self.dependents_by_package.get(normalized_package, set()))
        )
        dependency_score = min(1.0, 0.22 * len(dependents_present))
        if dependents_present:
            reasons.append(f"dependency_dependents={len(dependents_present)}")
            reasons.append(f"dependency_sample={','.join(dependents_present[:3])}")

        feedback_rate = self.feedback_breakage_rate.get(normalized_package)
        feedback_samples = self.feedback_sample_size.get(normalized_package, 0)
        feedback_score = 0.0
        if feedback_rate is not None and feedback_samples >= 3:
            feedback_score = feedback_rate
            reasons.append(f"breakage_history_rate={feedback_rate:.2f}")
        elif feedback_rate is not None:
            feedback_score = feedback_rate * 0.5

        node_count = self.node_counts.get(normalized_package, 0)
        cooccurrence_score = 0.0
        if node_count > 0:
            contributions: list[tuple[float, str, float, int]] = []

            for neighbor in normalized_installed:
                if neighbor == normalized_package:
                    continue

                pair_count = self.pair_counts.get(self._pair_key(normalized_package, neighbor), 0)
                if pair_count <= 0:
                    continue

                support = pair_count / max(1, node_count)
                neighbor_prior = self._package_prior(
                    neighbor,
                    fallback_label="ADVANCED",
                    label_lookup=label_lookup,
                )
                if neighbor_prior < 0.5:
                    continue

                score = support * neighbor_prior
                contributions.append((score, neighbor, support, pair_count))

            if contributions:
                contributions.sort(key=lambda item: item[0], reverse=True)
                top = contributions[:4]
                cooccurrence_score = min(1.0, sum(item[0] for item in top))

                strongest = top[0]
                reasons.append(
                    "co_occurs_with_risky="
                    f"{strongest[1]}"
                    f"(support={strongest[2]:.2f},count={strongest[3]})"
                )

        dynamic_score = max(dependency_score, feedback_score, cooccurrence_score)
        combined_score = max(base_prior, min(1.0, base_prior * 0.5 + dynamic_score * 0.75))

        return round(combined_score, 6), reasons

    def stats(self) -> dict[str, int]:
        dependency_edge_count = sum(len(values) for values in self.dependents_by_package.values())
        return {
            "known_packages": len(self.package_labels),
            "dependency_edges": dependency_edge_count,
            "observed_packages": len(self.node_counts),
            "observed_pairs": len(self.pair_counts),
            "feedback_packages": len(self.feedback_breakage_rate),
        }
