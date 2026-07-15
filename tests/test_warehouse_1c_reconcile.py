from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.database import queries as db_queries  # noqa: E402
from backend.services import warehouse_1c_reconcile as reconcile  # noqa: E402
from backend.services.one_c_reconcile_registry_service import (  # noqa: E402
    OneCReconcileRegistryService,
)


def test_part_no_sentinel_not_usable_but_closed():
    assert db_queries._is_not_in_1c_hub_part_no("нет в 1С") is True
    assert db_queries._is_not_in_1c_hub_part_no("нет в 1c") is True
    assert db_queries._is_usable_hub_part_no("нет в 1С") is False
    assert db_queries._is_pending_hub_part_no("нет в 1С") is False
    assert db_queries._is_pending_hub_part_no("") is True
    assert db_queries._is_pending_hub_part_no("-") is True
    assert db_queries._is_pending_hub_part_no("не найден") is True
    assert db_queries._is_usable_hub_part_no("ЦБ-00104234") is True
    assert db_queries._is_pending_hub_part_no("ЦБ-00104234") is False


def test_legacy_coverage_is_a_counter_payload_without_spurious_item_id(monkeypatch):
    class FakeDb:
        def execute_query(self, sql, params):
            assert "FROM ITEMS i" in sql
            assert params == ()
            return [
                {
                    "pending_count": 2,
                    "not_in_1c_count": 3,
                    "linked_count": 7,
                    "total_count": 12,
                }
            ]

    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: FakeDb())

    payload = db_queries.count_hub_part_no_coverage(db_id="ITINVENT")

    assert payload["pending_count"] == 2
    assert payload["not_in_1c_count"] == 3
    assert payload["linked_count"] == 7
    assert payload["legacy_linked_count"] == 7
    assert "item_id" not in payload


def test_reconcile_queue_query_selects_immutable_item_id(monkeypatch):
    sql_calls = []

    class FakeDb:
        def execute_query(self, sql, params):
            sql_calls.append(sql)
            if "COUNT(1) AS total" in sql:
                return [{"total": 1}]
            return [
                {
                    "item_id": 51,
                    "inv_no": "1001",
                    "serial_no": "SER-1",
                    "hw_serial_no": "",
                    "part_no": "",
                    "model_name": "Monitor",
                    "type_name": "Display",
                    "vendor_name": "Vendor",
                    "owner_no": 7,
                    "employee_name": "Иванов И.И.",
                    "employee_dept": "IT",
                }
            ]

    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: FakeDb())

    payload = db_queries.list_hub_equipment_by_part_no_status(
        status="pending",
        db_id="ITINVENT",
    )

    assert payload["items"][0]["item_id"] == "51"
    assert "i.ID AS item_id" in sql_calls[-1]


def test_coverage_uses_confirmed_registry_links_not_legacy_part_no(monkeypatch):
    class Registry:
        configured = True

    monkeypatch.setattr(reconcile, "one_c_reconcile_registry_service", Registry())
    monkeypatch.setattr(
        reconcile,
        "_hub_db_configs",
        lambda db_id=None: [{"id": "ITINVENT", "name": "IT-Invent"}],
    )
    monkeypatch.setattr(
        db_queries,
        "count_hub_part_no_coverage",
        lambda **kwargs: {
            "pending_count": 0,
            "not_in_1c_count": 0,
            "linked_count": 9,
            "total_count": 5,
            "legacy_pending_count": 0,
            "legacy_not_in_1c_count": 0,
            "legacy_linked_count": 9,
        },
    )
    monkeypatch.setattr(
        reconcile,
        "_get_registry_link_status_counts",
        lambda **kwargs: {
            reconcile.STATUS_PENDING: 1,
            reconcile.STATUS_LINKED: 2,
            reconcile.STATUS_EXCLUDED: 1,
            reconcile.STATUS_INVALID: 1,
        },
    )

    payload = reconcile.get_reconcile_coverage(db_id="ITINVENT")

    assert payload["coverage_source"] == "app_registry"
    assert payload["linked_count"] == 2
    assert payload["not_in_1c_count"] == 1
    assert payload["invalid_count"] == 1
    assert payload["pending_count"] == 1
    assert payload["coverage_pct"] == 40.0
    assert payload["legacy_linked_count"] == 9
    assert payload["databases"][0]["legacy_linked_count"] == 9


def test_registry_coverage_status_query_is_scoped_to_hub_database_and_source(temp_dir, monkeypatch):
    database_path = Path(temp_dir) / "reconcile_coverage.db"
    registry = OneCReconcileRegistryService(f"sqlite:///{database_path.as_posix()}")
    registry.upsert_item_link(
        hub_db_id="ITINVENT",
        hub_item_id="1",
        nomenclature_ref="ref-1",
        nomenclature_code_snapshot="PN-1",
        status=reconcile.STATUS_LINKED,
        actor="alice",
        reason="verified",
        expected_version=0,
    )
    registry.upsert_item_link(
        hub_db_id="ITINVENT",
        hub_item_id="2",
        nomenclature_ref=None,
        nomenclature_code_snapshot=None,
        status=reconcile.STATUS_EXCLUDED,
        actor="alice",
        reason="not present in 1C",
        expected_version=0,
    )
    registry.upsert_item_link(
        hub_db_id="OTHER",
        hub_item_id="3",
        nomenclature_ref="ref-3",
        nomenclature_code_snapshot="PN-3",
        status=reconcile.STATUS_LINKED,
        actor="alice",
        reason="different HUB database",
        expected_version=0,
    )
    registry.upsert_item_link(
        hub_db_id="ITINVENT",
        hub_item_id="4",
        nomenclature_ref="ref-4",
        nomenclature_code_snapshot="PN-4",
        status=reconcile.STATUS_LINKED,
        actor="alice",
        reason="different source",
        source_base="another_1c",
        expected_version=0,
    )
    monkeypatch.setattr(reconcile, "one_c_reconcile_registry_service", registry)

    counts = reconcile._get_registry_link_status_counts(hub_db_id="ITINVENT")

    assert counts == {
        reconcile.STATUS_PENDING: 0,
        reconcile.STATUS_LINKED: 1,
        reconcile.STATUS_EXCLUDED: 1,
        reconcile.STATUS_INVALID: 0,
    }


def test_apply_part_no_writes_usable_code(monkeypatch):
    updated = {"ok": True}
    monkeypatch.setattr(
        db_queries,
        "update_equipment_fields",
        lambda inv, fields, changed_by="IT-WEB", db_id=None: updated
        if fields.get("part_no") == "PN-1"
        else None,
    )
    monkeypatch.setattr(
        db_queries,
        "get_equipment_by_inv",
        lambda inv, db_id=None: {"inv_no": inv, "part_no": "PN-1"},
    )
    result = reconcile.apply_part_no(inv_no="1001", part_no="PN-1", db_id="ITINVENT")
    assert result["ok"] is True
    assert result["part_no"] == "PN-1"


def test_mark_not_in_1c_uses_sentinel(monkeypatch):
    captured = {}

    def fake_update(inv, fields, changed_by="IT-WEB", db_id=None):
        captured.update(fields)
        return True

    monkeypatch.setattr(db_queries, "update_equipment_fields", fake_update)
    monkeypatch.setattr(
        db_queries,
        "get_equipment_by_inv",
        lambda inv, db_id=None: {"inv_no": inv, "part_no": reconcile.HUB_PART_NO_NOT_IN_1C},
    )
    result = reconcile.mark_not_in_1c(inv_no="1002")
    assert captured.get("part_no") == "нет в 1С"
    assert result["part_no"] == "нет в 1С"


def test_confirmed_link_persists_audited_registry_projection(monkeypatch):
    captured = {}

    class Registry:
        configured = True

        def get_item_link(self, **kwargs):
            captured["lookup"] = kwargs
            return None

        def upsert_item_link(self, **kwargs):
            captured["upsert"] = kwargs
            return {"version": 1, "status": kwargs["status"]}

    monkeypatch.setattr(reconcile, "one_c_reconcile_registry_service", Registry())
    monkeypatch.setattr(
        reconcile.warehouse_1c_service,
        "lookup_nomenclature_ref",
        lambda ref: {"ref": ref, "code": "PN-1", "name": "Monitor"},
    )
    equipment = {"id": 51, "inv_no": "1001", "part_no": "OLD"}
    monkeypatch.setattr(db_queries, "get_equipment_by_inv", lambda *args, **kwargs: equipment)
    monkeypatch.setattr(
        db_queries,
        "update_equipment_part_no_if_current",
        lambda *args, **kwargs: captured.setdefault("conditional_update", kwargs) or True,
    )

    result = reconcile.apply_part_no(
        inv_no="1001",
        part_no="PN-1",
        nomenclature_ref="ref-1",
        reason="Проверено вручную",
        expected_version=0,
        expected_part_no="OLD",
        db_id="ITINVENT",
        changed_by="alice",
    )

    assert result["audit_persisted"] is True
    assert captured["lookup"]["hub_item_id"] == "51"
    assert captured["upsert"]["status"] == "linked"
    assert captured["upsert"]["nomenclature_ref"] == "ref-1"
    assert captured["upsert"]["legacy_part_no_before"] == "OLD"
    assert captured["upsert"]["legacy_part_no_after"] == "PN-1"
    assert captured["upsert"]["expected_version"] == 0


def test_auto_link_pending_dry_run_unique_suggest(monkeypatch):
    monkeypatch.setattr(
        reconcile,
        "list_reconcile_queue",
        lambda **kwargs: {
            "items": [
                {
                    "inv_no": "9001",
                    "model_name": "Dell P2419H",
                    "hub_db_id": "ITINVENT",
                }
            ]
        },
    )

    async def fake_suggest(text, limit=5):
        return {
            "results": [
                {"code": "PN-DELL-2419", "name": "Монитор Dell P2419H", "ref": "aaa"},
            ]
        }

    monkeypatch.setattr(reconcile.warehouse_1c_service, "suggest_nomenclature", fake_suggest)

    async def run():
        return await reconcile.auto_link_pending(limit=10, dry_run=True)

    import asyncio

    payload = asyncio.run(run())
    assert payload["linked_count"] == 1
    assert payload["linked"][0]["part_no"] == "PN-DELL-2419"
    assert payload["linked"][0]["applied"] is False


def test_auto_link_service_rejects_batch_commit():
    import asyncio

    with pytest.raises(reconcile.Warehouse1CValidationError):
        asyncio.run(reconcile.auto_link_pending(limit=1, dry_run=False))


def test_ai_suggest_catalog_only_when_openrouter_off(monkeypatch):
    monkeypatch.setattr(
        "backend.ai_chat.openrouter_client.openrouter_client.is_configured",
        lambda: False,
    )

    async def fake_suggest(text, limit=12):
        return {
            "results": [
                {"code": "A1", "name": "ИБП Ippon 800", "ref": "r1"},
                {"code": "A2", "name": "ИБП Ippon 1000", "ref": "r2"},
            ]
        }

    monkeypatch.setattr(reconcile.warehouse_1c_service, "suggest_nomenclature", fake_suggest)

    import asyncio

    payload = asyncio.run(
        reconcile.ai_suggest_part_no(model_name="ИБП Ippon 800", limit=3)
    )
    assert payload["configured"] is False
    assert payload["source"] == "catalog_only"
    assert payload["suggestions"][0]["code"] == "A1"
