from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import MagicMock


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.warehouse_1c_service import Warehouse1CService  # noqa: E402


def test_get_balances_with_hub_enriches_rows(monkeypatch):
    service = Warehouse1CService()

    async def fake_get_balances(**kwargs):
        return [
            {
                "warehouse_ref": "w1",
                "warehouse_name": "Рябов А.С.",
                "qty_balance": 1,
                "nomenclature_name": "Монитор",
            },
            {
                "warehouse_ref": "w2",
                "warehouse_name": "Основной склад",
                "qty_balance": 3,
                "nomenclature_name": "Монитор",
            },
        ]

    monkeypatch.setattr(service, "get_balances", fake_get_balances)
    monkeypatch.setattr(
        "backend.api.v1.database.get_all_db_configs",
        lambda: [{"id": "ITINVENT", "name": "ITINVENT"}],
    )

    fake_queries = MagicMock()
    fake_queries.list_owners_compact.return_value = [
        {"OWNER_NO": 10, "OWNER_DISPLAY_NAME": "Рябов Александр Сергеевич"},
    ]
    fake_queries.count_equipment_by_owners_hub_query.return_value = {10: 2}

    import backend.database.queries as db_queries

    monkeypatch.setattr(db_queries, "list_owners_compact", fake_queries.list_owners_compact)
    monkeypatch.setattr(
        db_queries,
        "count_equipment_by_owners_hub_query",
        fake_queries.count_equipment_by_owners_hub_query,
    )

    monkeypatch.setattr(
        "backend.services.employment_status_service.resolve_employment_status_batch",
        lambda names, cache=None: {
            "Рябов А.С.": {
                "status": "active",
                "label": "Сотрудник работает",
                "matched_name": "Рябов Александр Сергеевич",
            },
        },
    )

    rows = asyncio.run(
        service.get_balances_with_hub(
            nomenclature_ref="n1",
            part_no="PN-111",
            model_name="Dell P2419H",
            db_id="ITINVENT",
        )
    )

    fake_queries.count_equipment_by_owners_hub_query.assert_called_once()
    call_kwargs = fake_queries.count_equipment_by_owners_hub_query.call_args.kwargs
    assert call_kwargs["part_no"] == "PN-111"
    assert call_kwargs["model_name"] == "Dell P2419H"
    assert call_kwargs["db_id"] == "ITINVENT"

    assert len(rows) == 2
    person_row = rows[0]
    assert person_row["hub_owner_no"] == 10
    assert person_row["hub_count"] == 2
    assert person_row["exact_linked_count"] == 0
    assert person_row["unlinked_candidate_count"] == 2
    assert person_row["employment_status"] == "active"
    assert person_row["employment_label"] == "Сотрудник работает"

    warehouse_row = rows[1]
    assert warehouse_row["hub_count"] is None
    assert warehouse_row["hub_owner_no"] is None
    assert warehouse_row["employment_status"] == "unknown"
    assert warehouse_row["employment_label"] == ""


def test_get_balances_with_hub_sums_counts_across_databases(monkeypatch):
    service = Warehouse1CService()
    monkeypatch.setenv("WAREHOUSE_1C_RECONCILE_ALLOWED_DB_IDS", "ITINVENT,MSK-ITINVENT")

    async def fake_get_balances(**kwargs):
        return [
            {
                "warehouse_ref": "w1",
                "warehouse_name": "Левицкий Александр Степанович",
                "qty_balance": 1,
            },
        ]

    monkeypatch.setattr(service, "get_balances", fake_get_balances)
    monkeypatch.setattr(
        "backend.api.v1.database.get_all_db_configs",
        lambda: [
            {"id": "ITINVENT", "name": "ITINVENT"},
            {"id": "MSK-ITINVENT", "name": "MSK"},
        ],
    )

    def fake_owners(db_id=None):
        if db_id == "MSK-ITINVENT":
            return [{"OWNER_NO": 55, "OWNER_DISPLAY_NAME": "Левицкий Александр Степанович"}]
        return [{"OWNER_NO": 10, "OWNER_DISPLAY_NAME": "Левицкий Александр Степанович"}]

    def fake_counts(owner_nos, **kwargs):
        db_id = kwargs.get("db_id")
        if db_id == "ITINVENT":
            return {10: 0}
        if db_id == "MSK-ITINVENT":
            return {55: 1}
        return {}

    import backend.database.queries as db_queries

    monkeypatch.setattr(db_queries, "list_owners_compact", fake_owners)
    monkeypatch.setattr(db_queries, "count_equipment_by_owners_hub_query", fake_counts)
    monkeypatch.setattr(
        "backend.services.employment_status_service.resolve_employment_status_batch",
        lambda names, cache=None: {
            "Левицкий Александр Степанович": {
                "status": "active",
                "label": "Сотрудник работает",
                "matched_name": "Левицкий Александр Степанович",
            },
        },
    )

    rows = asyncio.run(
        service.get_balances_with_hub(
            nomenclature_ref="n1",
            nomenclature_code="C0000158780",
            db_id="ITINVENT",
            scope="all",
        )
    )

    assert len(rows) == 1
    assert rows[0]["hub_count"] == 1
    assert rows[0]["hub_owner_no"] == 10


def test_get_balances_with_hub_defaults_to_current_database_scope(monkeypatch):
    service = Warehouse1CService()

    async def fake_get_balances(**kwargs):
        return [{"warehouse_ref": "w1", "warehouse_name": "Иванов Иван", "qty_balance": 1}]

    monkeypatch.setattr(service, "get_balances", fake_get_balances)
    monkeypatch.setattr(
        "backend.api.v1.database.get_all_db_configs",
        lambda: [
            {"id": "ITINVENT", "name": "ITINVENT"},
            {"id": "MSK-ITINVENT", "name": "MSK"},
        ],
    )
    calls = []
    import backend.database.queries as db_queries

    monkeypatch.setattr(
        db_queries,
        "list_owners_compact",
        lambda db_id=None: calls.append(db_id) or [],
    )
    monkeypatch.setattr(
        "backend.services.employment_status_service.resolve_employment_status_batch",
        lambda names, cache=None: {},
    )

    asyncio.run(service.get_balances_with_hub(nomenclature_ref="n1", db_id="ITINVENT"))

    assert calls == ["ITINVENT"]


def test_get_balances_with_hub_sums_duplicate_fio_owners(monkeypatch):
    """Same FIO can exist as multiple OWNER_NO — counts must include all of them."""
    service = Warehouse1CService()

    async def fake_get_balances(**kwargs):
        return [
            {
                "warehouse_ref": "w1",
                "warehouse_name": "Левицкий Александр Степанович",
                "qty_balance": 1,
            },
        ]

    monkeypatch.setattr(service, "get_balances", fake_get_balances)
    monkeypatch.setattr(
        "backend.api.v1.database.get_all_db_configs",
        lambda: [{"id": "ITINVENT", "name": "ITINVENT"}],
    )

    def fake_owners(db_id=None):
        return [
            {"OWNER_NO": 4033, "OWNER_DISPLAY_NAME": "Левицкий Александр Степанович"},
            {"OWNER_NO": 2630, "OWNER_DISPLAY_NAME": "Левицкий Александр Степанович"},
        ]

    def fake_counts(owner_nos, **kwargs):
        return {4033: 0, 2630: 1}

    import backend.database.queries as db_queries

    monkeypatch.setattr(db_queries, "list_owners_compact", fake_owners)
    monkeypatch.setattr(db_queries, "count_equipment_by_owners_hub_query", fake_counts)
    monkeypatch.setattr(
        "backend.services.employment_status_service.resolve_employment_status_batch",
        lambda names, cache=None: {
            "Левицкий Александр Степанович": {
                "status": "active",
                "label": "Сотрудник работает",
                "matched_name": "Левицкий Александр Степанович",
            },
        },
    )

    rows = asyncio.run(
        service.get_balances_with_hub(
            nomenclature_ref="n1",
            nomenclature_code="ЦБ-00104234",
            db_id="ITINVENT",
        )
    )

    assert rows[0]["hub_count"] == 1
    assert rows[0]["hub_owner_no"] == 2630
