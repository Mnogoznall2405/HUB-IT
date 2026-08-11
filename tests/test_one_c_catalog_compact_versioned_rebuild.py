"""Unit tests for 1C compact versioned rebuild + routing key (no prod DB)."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.one_c_catalog_compact_flags import (  # noqa: E402
    canary_selects_compact,
    opaque_routing_user_key,
    parse_compact_flags,
)
from backend.services.one_c_catalog_compact_rebuild import (  # noqa: E402
    VERSIONED_REBUILD_METRICS,
    OneCCatalogCompactVersionedRebuild,
    VersionedRebuildReport,
)


def test_opaque_routing_user_key_stable_and_not_raw():
    key1 = opaque_routing_user_key(42, username="Admin")
    key2 = opaque_routing_user_key(42, username="other")
    assert key1 == key2
    assert key1 != "42"
    assert "admin" not in key1.casefold()
    assert len(key1) == 32
    assert opaque_routing_user_key(None, username=None) == ""


def test_canary_zero_percent_never_selects_even_with_key():
    flags = parse_compact_flags(
        {
            "WAREHOUSE_1C_CATALOG_SEARCH_ENGINE": "tokens",
            "WAREHOUSE_1C_CATALOG_SEARCH_CANARY_PERCENT": "0",
        }
    )
    key = opaque_routing_user_key(7)
    assert canary_selects_compact(key, flags) is False


def test_canary_requires_key_at_100_percent():
    flags = parse_compact_flags(
        {
            "WAREHOUSE_1C_CATALOG_SEARCH_ENGINE": "tokens",
            "WAREHOUSE_1C_CATALOG_SEARCH_CANARY_PERCENT": "100",
        }
    )
    assert canary_selects_compact(None, flags) is False
    assert canary_selects_compact("", flags) is False
    assert canary_selects_compact(opaque_routing_user_key(1), flags) is True


def test_versioned_rebuild_disabled_is_ok_noop():
    orch = OneCCatalogCompactVersionedRebuild(enabled=False)
    session = MagicMock()
    report = orch.rebuild_after_sync(
        session,
        source_base="s",
        generation=1,
        catalog_type="nomenclature",
        expected_count=10,
    )
    assert report.ok is True
    assert report.outcome == "disabled"
    session.execute.assert_not_called()


def test_versioned_rebuild_lock_skipped():
    orch = OneCCatalogCompactVersionedRebuild(enabled=True)
    session = MagicMock()
    bind = MagicMock()
    bind.dialect.name = "postgresql"
    session.get_bind.return_value = bind
    # pg_try_advisory_lock → False
    session.execute.return_value.scalar_one.return_value = False
    before = VERSIONED_REBUILD_METRICS["rebuild_lock_skipped_total"]
    report = orch.rebuild_after_sync(
        session,
        source_base="s",
        generation=1,
        catalog_type="nomenclature",
        expected_count=10,
    )
    assert report.outcome == "lock_skipped"
    assert VERSIONED_REBUILD_METRICS["rebuild_lock_skipped_total"] == before + 1


def test_versioned_rebuild_report_dataclass_defaults():
    report = VersionedRebuildReport(ok=True, outcome="no_op")
    assert report.documents_built == 0
    assert report.validation_ok is False


def test_staged_search_caps_imported():
    from backend.services.one_c_catalog_compact_search import (
        CAP_COMMON_SINGLE_FTS,
        CAP_EXACT,
        CAP_PREFIX,
        COMMON_TOKEN_FREQUENCY,
    )

    assert CAP_EXACT <= 200
    assert CAP_PREFIX <= 500
    assert CAP_COMMON_SINGLE_FTS <= 250
    assert COMMON_TOKEN_FREQUENCY >= 1000
