"""
De-Droid OEM Registry — Central registry for OEM brand namespaces, critical packages, and heuristics.

This module provides the OEMRegistry class which encapsulates all knowledge about Android
OEM brands, their package namespaces, critical system packages that must never be removed,
bloatware detection heuristics, and confidence weighting for data sources.

Usage::

    registry = OEMRegistry()
    cohort = registry.detect_cohort("com.samsung.android.app")  # → "SAMSUNG"
    safe = registry.is_critical("com.android.systemui")         # → True
    bloat = registry.is_bloatware("com.facebook.katana")        # → True
"""

from __future__ import annotations

from typing import ClassVar


class OEMRegistry:
    """Central registry for OEM brand namespaces, critical packages, and heuristics.

    All data is stored as class-level constants so a single shared instance can be
    used across the entire application without any state mutation after construction.

    Attributes:
        COHORT_PREFIXES: Maps OEM brand name → tuple of package-ID prefixes.
        CRITICAL_SYSTEM_PACKAGES: Packages that should never be removed from any device.
        BLOATWARE_KEYWORDS: Substrings that indicate pre-installed bloatware.
        SYSTEM_KEYWORDS: Substrings that indicate a core system component.
        OEM_CRITICAL_PATTERNS: Per-OEM sets of absolutely critical packages.
        SOURCE_CONFIDENCE_WEIGHTS: Confidence multipliers keyed by data-source tag.
    """

    # ──────────────────────────────────────────────────────────────────────────
    # OEM brand → package-ID prefix table
    # REDMI is kept separate from XIAOMI because community variant data differs.
    # ──────────────────────────────────────────────────────────────────────────
    COHORT_PREFIXES: ClassVar[dict[str, tuple[str, ...]]] = {
        "SAMSUNG": ("com.samsung.", "com.sec.", "com.osp.", "com.wssyncmldm"),
        "XIAOMI": ("com.xiaomi.", "com.miui.", "com.mi."),
        "REDMI": ("com.redmi.",),  # separate from XIAOMI
        "ONEPLUS": ("com.oneplus.", "net.oneplus.", "cn.oneplus."),
        "HUAWEI": ("com.huawei.", "com.hicloud.", "com.hisi.", "com.honor."),
        "OPPO": ("com.oppo.", "com.coloros.", "com.heytap.", "com.oplus."),
        "REALME": ("com.realme.", "com.nearme."),
        "VIVO": ("com.vivo.", "com.bbk.", "com.iqoo."),
        "INFINIX": ("com.infinix.", "com.transsion.", "com.xos.", "com.xclub."),
        "TECNO": ("com.tecno.", "com.hios."),
        "ITEL": ("com.itel.", "com.palmstore."),
        "NOKIA": ("com.nokia.", "com.hmd."),
        "MOTOROLA": ("com.motorola.", "com.moto."),
        "GOOGLE": ("com.google.",),
        "ANDROID": ("com.android.",),
    }

    # ──────────────────────────────────────────────────────────────────────────
    # Global critical-package safety denylist
    # Packages here are ALWAYS classified UNSAFE regardless of model output.
    # ──────────────────────────────────────────────────────────────────────────
    CRITICAL_SYSTEM_PACKAGES: ClassVar[frozenset[str]] = frozenset(
        [
            # Core AOSP telephony / UI
            "com.android.systemui",
            "com.android.settings",
            "com.android.phone",
            "com.android.server.telecom",
            # Providers
            "com.android.providers.contacts",
            "com.android.providers.telephony",
            "com.android.providers.settings",
            "com.android.providers.media",
            "com.android.providers.downloads",
            "com.android.providers.userdictionary",
            # Launchers & input
            "com.android.launcher",
            "com.android.launcher3",
            "com.android.inputmethod.latin",
            # Package management & security
            "com.android.packageinstaller",
            "com.android.vending",
            "com.android.permissioncontroller",
            "com.android.keychain",
            "com.android.certinstaller",
            "com.android.se",
            # Connectivity
            "com.android.bluetooth",
            "com.android.nfc",
            "com.android.wifi",
            "com.android.networkstack",
            # Misc system
            "com.android.location.fused",
            "com.android.shell",
            "android",
            # Google Play Services & framework
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
            # Xiaomi / MIUI critical
            "com.miui.securitycenter",
            "com.miui.home",
            "com.xiaomi.finddevice",
            "com.miui.system",
            "com.miui.packageinstaller",
        ]
    )

    # ──────────────────────────────────────────────────────────────────────────
    # Bloatware keyword heuristics
    # If any of these substrings appear in the lowercased package ID the package
    # is considered likely pre-installed bloatware.
    # ──────────────────────────────────────────────────────────────────────────
    BLOATWARE_KEYWORDS: ClassVar[frozenset[str]] = frozenset(
        [
            "facebook",
            "netflix",
            "spotify",
            "tiktok",
            "candy",
            "game",
            "promotion",
            "promo",
            "marketing",
            "ads",
            "adservice",
            "analytics",
            "tracking",
            "tracker",
            "telemetry",
            "diagnostic",
            "demo",
            "retail",
            "trial",
            "tips",
            "getstarted",
            "weather",
            "news",
            "magazine",
            "music",
            "video",
            "shopping",
            "store",
            "wallet",
            "pay",
            "insurance",
            "health",
            "fitness",
            "social",
            "chat",
            "browser",
            "cleanmaster",
            "clean",
            "booster",
            "antivirus",
            "vpn",
            "lounge",
            "entertainment",
        ]
    )

    # ──────────────────────────────────────────────────────────────────────────
    # System-component keyword heuristics
    # If any of these appear in the lowercased package ID the package looks like
    # a core system component and should be treated with extra caution.
    # ──────────────────────────────────────────────────────────────────────────
    SYSTEM_KEYWORDS: ClassVar[frozenset[str]] = frozenset(
        [
            "systemui",
            "telecom",
            "telephony",
            "provider",
            "inputmethod",
            "launcher",
            "permission",
            "security",
            "keychain",
            "cert",
            "networkstack",
            "bluetooth",
            "wifi",
            "nfc",
            "shell",
            "packageinstaller",
            "contacts",
            "phone",
            "dialer",
            "incallui",
            "fused",
            "location",
            "settings",
            "drm",
        ]
    )

    # ──────────────────────────────────────────────────────────────────────────
    # Per-OEM additional critical package patterns
    # Packages here receive a near-certain UNSAFE classification when the device
    # brand matches the owning OEM key.
    # ──────────────────────────────────────────────────────────────────────────
    OEM_CRITICAL_PATTERNS: ClassVar[dict[str, frozenset[str]]] = {
        "SAMSUNG": frozenset(
            [
                "com.samsung.android.dialer",
                "com.samsung.android.incallui",
                "com.samsung.android.messaging",
                "com.samsung.android.providers.contacts",
                "com.sec.android.app.launcher",
                "com.samsung.android.telecom",
            ]
        ),
        "XIAOMI": frozenset(
            [
                "com.miui.home",
                "com.miui.securitycenter",
                "com.xiaomi.finddevice",
                "com.miui.packageinstaller",
                "com.miui.system",
            ]
        ),
        # REDMI shares MIUI stack with XIAOMI
        "REDMI": frozenset(
            [
                "com.miui.home",
                "com.miui.securitycenter",
                "com.xiaomi.finddevice",
                "com.miui.packageinstaller",
                "com.miui.system",
            ]
        ),
    }

    # ──────────────────────────────────────────────────────────────────────────
    # Source confidence weights
    # Community-sourced dataset variants are less reliable than the curated UAD
    # list, so we down-weight their contribution to predictions.
    # ──────────────────────────────────────────────────────────────────────────
    SOURCE_CONFIDENCE_WEIGHTS: ClassVar[dict[str, float]] = {
        "uad": 1.00,
        "desktop+uad": 1.00,
        "desktop": 0.90,
        "variant:samsung": 0.75,
        "variant:redmi": 0.75,
        "variant:user_feedback": 0.80,
        "variant": 0.70,
    }

    # Carrier-branded bloatware prefixes (treated identically to BLOATWARE_KEYWORDS)
    _CARRIER_PREFIXES: ClassVar[tuple[str, ...]] = (
        "com.att.",
        "com.sprint.",
        "com.tmobile.",
        "com.verizon.",
        "com.vzw.",
        "com.metropcs.",
    )

    # ──────────────────────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────────────────────

    def detect_cohort(self, package_id: str) -> str | None:
        """Detect OEM cohort from package prefix.

        Iterates ``COHORT_PREFIXES`` in insertion order and returns the first
        matching cohort name, or ``None`` when no OEM can be identified.

        Args:
            package_id: An Android package identifier (e.g. ``com.samsung.android.app``).

        Returns:
            Uppercase OEM cohort name such as ``"SAMSUNG"`` or ``None``.
        """
        pkg = package_id.lower()
        for cohort, prefixes in self.COHORT_PREFIXES.items():
            if any(pkg.startswith(p) for p in prefixes):
                return cohort
        return None

    def is_critical(self, package_id: str) -> bool:
        """Return ``True`` if *package_id* is on the global critical denylist.

        Packages on this list should never be uninstalled and will always
        receive an UNSAFE classification with ``confidence=1.0``.

        Args:
            package_id: Exact Android package identifier (case-sensitive).

        Returns:
            ``True`` when the package is globally critical.
        """
        return package_id in self.CRITICAL_SYSTEM_PACKAGES

    def is_oem_critical(self, package_id: str, oem: str | None) -> bool:
        """Return ``True`` if *package_id* is critical for the given OEM brand.

        Consults ``OEM_CRITICAL_PATTERNS`` for the uppercased *oem* key.  When
        *oem* is ``None`` or not found in the patterns table, always returns
        ``False``.

        Args:
            package_id: Exact Android package identifier.
            oem: OEM brand key (e.g. ``"SAMSUNG"``).  Case-insensitive.

        Returns:
            ``True`` when the package is in the OEM-specific critical set.
        """
        if not oem:
            return False
        patterns = self.OEM_CRITICAL_PATTERNS.get(oem.upper(), frozenset())
        return package_id in patterns

    def is_bloatware(self, package_id: str) -> bool:
        """Heuristic bloatware detection via keyword matching and carrier prefix check.

        A package is considered bloatware when its lowercased ID contains any
        entry from ``BLOATWARE_KEYWORDS`` or starts with a known carrier prefix.

        Args:
            package_id: Android package identifier.

        Returns:
            ``True`` when the package looks like pre-installed bloatware.
        """
        pkg = package_id.lower()
        if any(kw in pkg for kw in self.BLOATWARE_KEYWORDS):
            return True
        return any(pkg.startswith(p) for p in self._CARRIER_PREFIXES)

    def is_system_package(self, package_id: str) -> bool:
        """Return ``True`` if the package looks like a core system component.

        Uses keyword matching against ``SYSTEM_KEYWORDS`` on the lowercased
        package ID.  This is a heuristic — prefer ``is_critical`` for
        definitive safety-gate decisions.

        Args:
            package_id: Android package identifier.

        Returns:
            ``True`` when at least one system keyword is present.
        """
        pkg = package_id.lower()
        return any(kw in pkg for kw in self.SYSTEM_KEYWORDS)

    def get_confidence_weight(self, source: str) -> float:
        """Return the confidence multiplier for a data-source tag.

        Performs an exact lookup first, then falls back to splitting the source
        on ``"+"`` and taking the minimum weight across all parts.  This handles
        composite source tags like ``"desktop+uad+variant:samsung"``.

        Args:
            source: Data source tag from the training dataset (e.g. ``"uad"``).

        Returns:
            A float in ``(0, 1]`` representing how much to trust that source.
        """
        # Exact match is cheapest — try it first
        if source in self.SOURCE_CONFIDENCE_WEIGHTS:
            return self.SOURCE_CONFIDENCE_WEIGHTS[source]

        # Composite tag: take the minimum weight of all constituent parts
        parts = set(source.split("+"))
        weights = [self.SOURCE_CONFIDENCE_WEIGHTS.get(p, 0.70) for p in parts]
        return min(weights) if weights else 0.70
