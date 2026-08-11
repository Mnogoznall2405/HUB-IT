"""Fail-closed feature flags for 1C compact (D-lite) catalogue search.

Defaults keep production on the legacy token engine.  Invalid engine values
never auto-enable compact.
"""
from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass, field
from typing import Any


ENGINE_TOKENS = "tokens"
ENGINE_COMPACT = "compact"
VALID_ENGINES = frozenset({ENGINE_TOKENS, ENGINE_COMPACT})


def _raw(name: str, default: str = "") -> str:
    return str(os.getenv(name, default) or default).strip()


def _flag(name: str, default: str = "0") -> bool:
    return _raw(name, default).casefold() in {"1", "true", "yes", "on"}


def _positive_int(name: str, default: int, minimum: int = 0, maximum: int | None = None) -> int:
    try:
        value = int(_raw(name, str(default)) or default)
    except (TypeError, ValueError):
        value = default
    value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value


def _float(name: str, default: float, minimum: float = 0.0, maximum: float | None = None) -> float:
    try:
        value = float(_raw(name, str(default)) or default)
    except (TypeError, ValueError):
        value = default
    value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value


@dataclass(frozen=True)
class OneCCatalogCompactFlags:
    """Parsed compact-search controls (all production-safe defaults)."""

    search_engine: str = ENGINE_TOKENS
    search_shadow: bool = False
    write_compact: bool = False
    compact_backfill_enabled: bool = False
    typo_fallback_enabled: bool = False
    midtoken_min_length: int = 3
    shadow_sample_rate: float = 0.0
    shadow_timeout_ms: int = 150
    midtoken_timeout_ms: int = 80
    typo_timeout_ms: int = 120
    typo_max_candidates: int = 5
    typo_similarity_threshold: float = 0.35
    backfill_batch_size: int = 2_000
    backfill_max_runtime_seconds: int = 0
    backfill_pause_ms: int = 0
    backfill_statement_timeout_ms: int = 30_000
    backfill_error_budget: int = 20
    min_free_disk_bytes: int = 15 * 1024**3
    # Canary: 0 = disabled (fail-closed). Deterministic per routing key, never random.
    search_canary_percent: int = 0
    # Optional admin allowlist of opaque routing keys (never log raw IDs).
    search_canary_allowlist: frozenset[str] = field(default_factory=frozenset)
    # Incremental compact dual-write thresholds (fail-closed → stale + recovery).
    # 0 = disabled threshold (never trip on that axis). Defaults keep ordinary
    # hourly patches on the incremental path; mass changes escalate.
    compact_incremental_max_changed_rows: int = 50_000
    compact_incremental_max_changed_percent: float = 5.0
    # Percent threshold applies only when incoming_count >= this (avoids tiny
    # fixture catalogs escalating 1/9 ≈ 11% into a full versioned rebuild).
    compact_incremental_percent_min_base: int = 10_000
    # token_stats maintenance: delta (prefer) | scope (full rebuild of stats for scope)
    compact_token_stats_mode: str = "delta"
    # Deferred previous-version cleanup (fail-closed: off + dry_run).
    compact_previous_cleanup_enabled: bool = False
    compact_previous_cleanup_dry_run: bool = True
    compact_previous_cleanup_batch_size: int = 2_000
    compact_previous_cleanup_max_batches: int = 50
    compact_previous_cleanup_max_runtime_seconds: int = 60
    compact_previous_cleanup_pause_ms: int = 50
    compact_previous_cleanup_statement_timeout_ms: int = 30_000
    compact_previous_cleanup_error_budget: int = 5
    compact_previous_cleanup_grace_seconds: int = 3_600
    engine_config_error: str = ""

    @property
    def compact_reader_enabled(self) -> bool:
        return self.search_engine == ENGINE_COMPACT and not self.engine_config_error

    @property
    def shadow_enabled(self) -> bool:
        return bool(self.search_shadow and self.shadow_sample_rate > 0)

    @property
    def canary_enabled(self) -> bool:
        return self.search_canary_percent > 0 and not self.engine_config_error


def parse_compact_flags(environ: Any | None = None) -> OneCCatalogCompactFlags:
    """Parse env into flags.  Invalid engine falls back to tokens (fail-closed)."""
    if environ is not None:
        previous = dict(os.environ)
        try:
            os.environ.clear()
            os.environ.update({str(k): str(v) for k, v in dict(environ).items()})
            return _parse()
        finally:
            os.environ.clear()
            os.environ.update(previous)
    return _parse()


def _parse() -> OneCCatalogCompactFlags:
    raw_engine = _raw("WAREHOUSE_1C_CATALOG_SEARCH_ENGINE", ENGINE_TOKENS).casefold()
    engine_error = ""
    if raw_engine not in VALID_ENGINES:
        engine_error = f"invalid_engine:{raw_engine or '<empty>'}"
        engine = ENGINE_TOKENS
    else:
        engine = raw_engine

    allowlist_raw = _raw("WAREHOUSE_1C_CATALOG_SEARCH_CANARY_ALLOWLIST", "")
    allowlist = frozenset(
        part.strip()
        for part in allowlist_raw.split(",")
        if part.strip()
    )

    return OneCCatalogCompactFlags(
        search_engine=engine,
        search_shadow=_flag("WAREHOUSE_1C_CATALOG_SEARCH_SHADOW", "0"),
        write_compact=_flag("WAREHOUSE_1C_CATALOG_WRITE_COMPACT", "0"),
        compact_backfill_enabled=_flag("WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_ENABLED", "0"),
        typo_fallback_enabled=_flag("WAREHOUSE_1C_CATALOG_TYPO_FALLBACK_ENABLED", "0"),
        midtoken_min_length=_positive_int(
            "WAREHOUSE_1C_CATALOG_MIDTOKEN_MIN_LENGTH", 3, minimum=2, maximum=32
        ),
        shadow_sample_rate=_float(
            "WAREHOUSE_1C_CATALOG_SHADOW_SAMPLE_RATE", 0.0, minimum=0.0, maximum=1.0
        ),
        shadow_timeout_ms=_positive_int(
            "WAREHOUSE_1C_CATALOG_SHADOW_TIMEOUT_MS", 150, minimum=10, maximum=5_000
        ),
        midtoken_timeout_ms=_positive_int(
            "WAREHOUSE_1C_CATALOG_MIDTOKEN_TIMEOUT_MS", 80, minimum=10, maximum=5_000
        ),
        typo_timeout_ms=_positive_int(
            "WAREHOUSE_1C_CATALOG_TYPO_TIMEOUT_MS", 120, minimum=10, maximum=5_000
        ),
        typo_max_candidates=_positive_int(
            "WAREHOUSE_1C_CATALOG_TYPO_MAX_CANDIDATES", 5, minimum=1, maximum=20
        ),
        typo_similarity_threshold=_float(
            "WAREHOUSE_1C_CATALOG_TYPO_SIMILARITY_THRESHOLD",
            0.35,
            minimum=0.1,
            maximum=0.99,
        ),
        backfill_batch_size=_positive_int(
            "WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_BATCH", 2_000, minimum=100, maximum=50_000
        ),
        backfill_max_runtime_seconds=_positive_int(
            "WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_MAX_RUNTIME_SECONDS", 0, minimum=0
        ),
        backfill_pause_ms=_positive_int(
            "WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_PAUSE_MS", 0, minimum=0, maximum=60_000
        ),
        backfill_statement_timeout_ms=_positive_int(
            "WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_STATEMENT_TIMEOUT_MS",
            30_000,
            minimum=1_000,
            maximum=600_000,
        ),
        backfill_error_budget=_positive_int(
            "WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_ERROR_BUDGET", 20, minimum=1, maximum=10_000
        ),
        min_free_disk_bytes=_positive_int(
            "WAREHOUSE_1C_CATALOG_COMPACT_MIN_FREE_DISK_BYTES",
            15 * 1024**3,
            minimum=0,
        ),
        search_canary_percent=_positive_int(
            "WAREHOUSE_1C_CATALOG_SEARCH_CANARY_PERCENT", 0, minimum=0, maximum=100
        ),
        search_canary_allowlist=allowlist,
        compact_incremental_max_changed_rows=_positive_int(
            "WAREHOUSE_1C_CATALOG_COMPACT_INCREMENTAL_MAX_CHANGED_ROWS",
            50_000,
            minimum=0,
            maximum=10_000_000,
        ),
        compact_incremental_max_changed_percent=_float(
            "WAREHOUSE_1C_CATALOG_COMPACT_INCREMENTAL_MAX_CHANGED_PERCENT",
            5.0,
            minimum=0.0,
            maximum=100.0,
        ),
        compact_incremental_percent_min_base=_positive_int(
            "WAREHOUSE_1C_CATALOG_COMPACT_INCREMENTAL_PERCENT_MIN_BASE",
            10_000,
            minimum=0,
            maximum=10_000_000,
        ),
        compact_token_stats_mode=_token_stats_mode(),
        compact_previous_cleanup_enabled=_flag(
            "WAREHOUSE_1C_CATALOG_COMPACT_PREVIOUS_CLEANUP_ENABLED", "0"
        ),
        # Fail-closed: dry_run defaults ON unless explicitly set to 0.
        compact_previous_cleanup_dry_run=_flag(
            "WAREHOUSE_1C_CATALOG_COMPACT_PREVIOUS_CLEANUP_DRY_RUN", "1"
        ),
        compact_previous_cleanup_batch_size=_positive_int(
            "WAREHOUSE_1C_CATALOG_COMPACT_PREVIOUS_CLEANUP_BATCH",
            2_000,
            minimum=100,
            maximum=5_000,
        ),
        compact_previous_cleanup_max_batches=_positive_int(
            "WAREHOUSE_1C_CATALOG_COMPACT_PREVIOUS_CLEANUP_MAX_BATCHES",
            50,
            minimum=1,
            maximum=10_000,
        ),
        compact_previous_cleanup_max_runtime_seconds=_positive_int(
            "WAREHOUSE_1C_CATALOG_COMPACT_PREVIOUS_CLEANUP_MAX_RUNTIME_SECONDS",
            60,
            minimum=0,
            maximum=3_600,
        ),
        compact_previous_cleanup_pause_ms=_positive_int(
            "WAREHOUSE_1C_CATALOG_COMPACT_PREVIOUS_CLEANUP_PAUSE_MS",
            50,
            minimum=0,
            maximum=60_000,
        ),
        compact_previous_cleanup_statement_timeout_ms=_positive_int(
            "WAREHOUSE_1C_CATALOG_COMPACT_PREVIOUS_CLEANUP_STATEMENT_TIMEOUT_MS",
            30_000,
            minimum=1_000,
            maximum=600_000,
        ),
        compact_previous_cleanup_error_budget=_positive_int(
            "WAREHOUSE_1C_CATALOG_COMPACT_PREVIOUS_CLEANUP_ERROR_BUDGET",
            5,
            minimum=1,
            maximum=1_000,
        ),
        compact_previous_cleanup_grace_seconds=_positive_int(
            "WAREHOUSE_1C_CATALOG_COMPACT_PREVIOUS_CLEANUP_GRACE_SECONDS",
            3_600,
            minimum=0,
            maximum=86400 * 7,
        ),
        engine_config_error=engine_error,
    )


def _token_stats_mode() -> str:
    raw = _raw("WAREHOUSE_1C_CATALOG_COMPACT_TOKEN_STATS_MODE", "delta").casefold()
    return raw if raw in {"delta", "scope"} else "delta"


def opaque_routing_user_key(user_id: Any = None, *, username: str | None = None) -> str:
    """Build an opaque canary routing key (never log the raw user id/username)."""
    material = ""
    if user_id is not None and str(user_id).strip():
        material = f"uid:{str(user_id).strip()}"
    elif username and str(username).strip():
        material = f"un:{str(username).strip().casefold()}"
    if not material:
        return ""
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:32]


def canary_bucket(routing_key: str) -> int:
    """Stable 0..99 bucket for a routing key (opaque; never log the raw key)."""
    digest = hashlib.sha256(str(routing_key or "").encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % 100


def canary_selects_compact(
    routing_key: str | None,
    flags: OneCCatalogCompactFlags | None = None,
) -> bool:
    """Deterministic canary gate. Fail-closed when key missing / percent=0.

    Integration point: pass an opaque ``routing_user_key`` (e.g. hashed user id
    or session subject) from the API layer.  Without a key, canary never flips
    to compact (no random).  Compact still requires index_state=ready at read.
    """
    resolved = flags or get_compact_flags()
    if resolved.engine_config_error:
        return False
    key = str(routing_key or "").strip()
    if key and key in resolved.search_canary_allowlist:
        return True
    percent = int(resolved.search_canary_percent or 0)
    if percent <= 0:
        return False
    if percent >= 100:
        return bool(key)  # still require a routing key (fail-closed)
    if not key:
        return False
    return canary_bucket(key) < percent


def should_attempt_compact_reader(
    flags: OneCCatalogCompactFlags | None = None,
    *,
    routing_user_key: str | None = None,
) -> bool:
    """True when this request should *attempt* compact (still gated by ready)."""
    resolved = flags or get_compact_flags()
    if resolved.engine_config_error:
        return False
    if resolved.search_engine == ENGINE_COMPACT:
        return True
    if resolved.search_engine != ENGINE_TOKENS:
        return False
    return canary_selects_compact(routing_user_key, resolved)


def get_compact_flags() -> OneCCatalogCompactFlags:
    return parse_compact_flags()
