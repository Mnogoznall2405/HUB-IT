from __future__ import annotations

import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.warehouse_1c_scope import (  # noqa: E402
    Warehouse1CAllScopeConfigurationError,
    allowlisted_reconcile_db_configs,
    select_hub_db_configs_for_scope,
)


def test_all_scope_uses_only_explicit_configured_allowlist(monkeypatch):
    monkeypatch.setenv("WAREHOUSE_1C_RECONCILE_ALLOWED_DB_IDS", "MSK, ITINVENT")

    selected = select_hub_db_configs_for_scope(
        [
            {"id": "ITINVENT", "name": "Primary"},
            {"id": "MSK", "name": "Moscow"},
            {"id": "SECRET", "name": "Must not leak"},
        ],
        current_db_id="ITINVENT",
        scope="all",
    )

    assert [row["id"] for row in selected] == ["MSK", "ITINVENT"]


def test_all_scope_fails_closed_for_blank_or_stale_allowlist(monkeypatch):
    configs = [{"id": "ITINVENT", "name": "Primary"}]
    monkeypatch.delenv("WAREHOUSE_1C_RECONCILE_ALLOWED_DB_IDS", raising=False)
    with pytest.raises(Warehouse1CAllScopeConfigurationError):
        allowlisted_reconcile_db_configs(configs)

    monkeypatch.setenv("WAREHOUSE_1C_RECONCILE_ALLOWED_DB_IDS", "MISSING")
    with pytest.raises(Warehouse1CAllScopeConfigurationError):
        allowlisted_reconcile_db_configs(configs)
