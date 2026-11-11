from __future__ import annotations

import asyncio

import pytest
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
        {
            "OWNER_NO": 10,
            "OWNER_DISPLAY_NAME": "Рябов Александр Сергеевич",
            "OWNER_DEPT": "IT-отдел",
        },
    ]
    fake_queries.count_equipment_by_owners_hub_query.return_value = {10: 2}
    fake_queries.count_all_owners_by_hub_query.return_value = []

    import backend.database.queries as db_queries

    monkeypatch.setattr(db_queries, "list_owners_compact", fake_queries.list_owners_compact)
    monkeypatch.setattr(
        db_queries,
        "count_equipment_by_owners_hub_query",
        fake_queries.count_equipment_by_owners_hub_query,
    )
    monkeypatch.setattr(
        db_queries,
        "count_all_owners_by_hub_query",
        fake_queries.count_all_owners_by_hub_query,
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
    assert person_row["hub_employee_dept"] == "IT-отдел"
    assert person_row["exact_linked_count"] == 0
    assert person_row["unlinked_candidate_count"] == 2
    assert person_row["employment_status"] == "active"
    assert person_row["employment_label"] == "Сотрудник работает"

    warehouse_row = rows[1]
    assert warehouse_row["hub_count"] is None
    assert warehouse_row["hub_owner_no"] is None
    assert warehouse_row["hub_employee_dept"] == ""
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
    monkeypatch.setattr(db_queries, "count_all_owners_by_hub_query", lambda **kwargs: [])
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
    monkeypatch.setattr(db_queries, "count_all_owners_by_hub_query", lambda **kwargs: [])
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
    monkeypatch.setattr(db_queries, "count_all_owners_by_hub_query", lambda **kwargs: [])
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


def test_get_balances_with_hub_appends_hub_only_owners(monkeypatch):
    """Owners with the PART_NO only in Hub must appear as В 1С = 0 rows."""
    service = Warehouse1CService()

    async def fake_get_balances(**kwargs):
        return [
            {
                "warehouse_ref": "w1",
                "warehouse_name": "Манько Виталий Евгеньевич",
                "qty_balance": 8,
                "nomenclature_name": "Монитор",
            },
        ]

    monkeypatch.setattr(service, "get_balances", fake_get_balances)
    monkeypatch.setattr(
        "backend.api.v1.database.get_all_db_configs",
        lambda: [{"id": "ITINVENT", "name": "ITINVENT"}],
    )

    import backend.database.queries as db_queries

    monkeypatch.setattr(
        db_queries,
        "list_owners_compact",
        lambda db_id=None: [
            {
                "OWNER_NO": 10,
                "OWNER_DISPLAY_NAME": "Манько Виталий Евгеньевич",
                "OWNER_DEPT": "УМТО",
            },
            {
                "OWNER_NO": 20,
                "OWNER_DISPLAY_NAME": "Сидоров Пётр",
                "OWNER_DEPT": "IT",
            },
        ],
    )
    monkeypatch.setattr(
        db_queries,
        "count_equipment_by_owners_hub_query",
        lambda owner_nos, **kwargs: {10: 0},
    )
    monkeypatch.setattr(
        db_queries,
        "count_all_owners_by_hub_query",
        lambda **kwargs: [
            {
                "owner_no": 10,
                "hub_count": 0,
                "owner_display_name": "Манько Виталий Евгеньевич",
                "owner_dept": "УМТО",
            },
            {
                "owner_no": 20,
                "hub_count": 3,
                "owner_display_name": "Сидоров Пётр",
                "owner_dept": "IT",
            },
        ],
    )
    monkeypatch.setattr(
        "backend.services.employment_status_service.resolve_employment_status_batch",
        lambda names, cache=None: {
            "Манько Виталий Евгеньевич": {
                "status": "active",
                "label": "Сотрудник работает",
                "matched_name": "Манько Виталий Евгеньевич",
            },
            "Сидоров Пётр": {
                "status": "active",
                "label": "Сотрудник работает",
                "matched_name": "Сидоров Пётр",
            },
        },
    )

    rows = asyncio.run(
        service.get_balances_with_hub(
            nomenclature_ref="n1",
            part_no="ЦБ-00170664",
            nomenclature_code="ЦБ-00170664",
            db_id="ITINVENT",
        )
    )

    assert len(rows) == 2
    assert rows[0]["warehouse_name"] == "Манько Виталий Евгеньевич"
    assert float(rows[0]["qty_balance"]) == 8
    assert rows[0]["hub_count"] == 0

    hub_only = rows[1]
    assert hub_only["hub_owner_no"] == 20
    assert hub_only["hub_count"] == 3
    assert float(hub_only["qty_balance"]) == 0
    assert float(hub_only["qty_1c_total"]) == 0
    assert hub_only["owner_link_method"] == "hub_only"
    assert hub_only["warehouse_name"] == "Сидоров Пётр"
    assert hub_only["hub_employee_dept"] == "IT"
    assert hub_only["employment_status"] == "active"


def test_get_balances_with_hub_shows_hub_only_when_1c_empty(monkeypatch):
    service = Warehouse1CService()

    async def fake_get_balances(**kwargs):
        return []

    monkeypatch.setattr(service, "get_balances", fake_get_balances)
    monkeypatch.setattr(
        "backend.api.v1.database.get_all_db_configs",
        lambda: [{"id": "ITINVENT", "name": "ITINVENT"}],
    )

    import backend.database.queries as db_queries

    monkeypatch.setattr(db_queries, "list_owners_compact", lambda db_id=None: [])
    monkeypatch.setattr(
        db_queries,
        "count_equipment_by_owners_hub_query",
        lambda owner_nos, **kwargs: {},
    )
    monkeypatch.setattr(
        db_queries,
        "count_all_owners_by_hub_query",
        lambda **kwargs: [
            {
                "owner_no": 33,
                "hub_count": 1,
                "owner_display_name": "Только Хаб",
                "owner_dept": "Склад",
            },
        ],
    )
    monkeypatch.setattr(
        "backend.services.employment_status_service.resolve_employment_status_batch",
        lambda names, cache=None: {
            "Только Хаб": {
                "status": "active",
                "label": "Сотрудник работает",
                "matched_name": "Только Хаб",
            },
        },
    )

    rows = asyncio.run(
        service.get_balances_with_hub(
            nomenclature_ref="n1",
            part_no="ЦБ-00170664",
            db_id="ITINVENT",
        )
    )

    assert len(rows) == 1
    assert rows[0]["hub_owner_no"] == 33
    assert rows[0]["hub_count"] == 1
    assert float(rows[0]["qty_1c_total"]) == 0
    assert rows[0]["owner_link_method"] == "hub_only"


def test_get_balances_with_hub_marks_unknown_when_count_query_fails(monkeypatch):
    """A failed HUB count must surface as unknown, not as a trustworthy zero."""
    service = Warehouse1CService()

    async def fake_get_balances(**kwargs):
        return [
            {
                "warehouse_ref": "w1",
                "warehouse_name": "Рябов Александр Сергеевич",
                "qty_balance": 1,
            },
        ]

    monkeypatch.setattr(service, "get_balances", fake_get_balances)
    monkeypatch.setattr(
        "backend.api.v1.database.get_all_db_configs",
        lambda: [{"id": "ITINVENT", "name": "ITINVENT"}],
    )

    import backend.database.queries as db_queries

    monkeypatch.setattr(
        db_queries,
        "list_owners_compact",
        lambda db_id=None: [
            {"OWNER_NO": 10, "OWNER_DISPLAY_NAME": "Рябов Александр Сергеевич"},
        ],
    )

    def failing_counts(owner_nos, **kwargs):
        raise RuntimeError("hub db unavailable")

    monkeypatch.setattr(db_queries, "count_equipment_by_owners_hub_query", failing_counts)
    monkeypatch.setattr(db_queries, "count_all_owners_by_hub_query", lambda **kwargs: [])
    monkeypatch.setattr(
        "backend.services.employment_status_service.resolve_employment_status_batch",
        lambda names, cache=None: {},
    )

    rows = asyncio.run(
        service.get_balances_with_hub(
            nomenclature_ref="n1",
            part_no="PN-111",
            db_id="ITINVENT",
        )
    )

    assert len(rows) == 1
    assert rows[0]["hub_owner_no"] == 10
    assert rows[0]["hub_count"] is None
    assert rows[0]["hub_count_kind"] == "unknown"
    assert rows[0]["unlinked_candidate_count"] is None


def _two_db_service(monkeypatch, *, owners, counts, hub_only):
    service = Warehouse1CService()
    monkeypatch.setenv("WAREHOUSE_1C_RECONCILE_ALLOWED_DB_IDS", "ITINVENT,MSK-ITINVENT")

    async def fake_get_balances(**kwargs):
        return [{"warehouse_ref": "w1", "warehouse_name": "Alice Covered", "qty_balance": 1}]

    monkeypatch.setattr(service, "get_balances", fake_get_balances)
    monkeypatch.setattr(
        "backend.api.v1.database.get_all_db_configs",
        lambda: [{"id": "ITINVENT", "name": "ITINVENT"}, {"id": "MSK-ITINVENT", "name": "MSK"}],
    )
    import backend.database.queries as db_queries

    monkeypatch.setattr(db_queries, "list_owners_compact", owners)
    monkeypatch.setattr(db_queries, "count_equipment_by_owners_hub_query", counts)
    monkeypatch.setattr(db_queries, "count_all_owners_by_hub_query", hub_only)
    monkeypatch.setattr(
        "backend.services.employment_status_service.resolve_employment_status_batch",
        lambda names, cache=None: {},
    )
    return service


def _run_all_scope(service):
    return asyncio.run(
        service.get_balances_with_hub(
            nomenclature_ref="n1",
            part_no="PN-1",
            db_id="ITINVENT",
            scope="all",
            include_meta=True,
        )
    )


def test_same_owner_no_in_another_database_is_a_different_person(monkeypatch):
    """DWH-01: OWNER_NO is unique only inside one DB; a covered owner 7 in A must not hide
    a different person with OWNER_NO 7 in B, and hub-only rows say which DB they came from."""

    def owners(db_id=None):
        if db_id == "ITINVENT":
            return [{"OWNER_NO": 7, "OWNER_DISPLAY_NAME": "Alice Covered"}]
        return []

    def hub_only(**kwargs):
        if kwargs.get("db_id") == "ITINVENT":
            return [{"owner_no": 7, "hub_count": 2, "owner_display_name": "Alice Covered"}]
        return [{"owner_no": 7, "hub_count": 3, "owner_display_name": "Bob Other"}]

    service = _two_db_service(
        monkeypatch, owners=owners, counts=lambda owner_nos, **kw: {7: 2}, hub_only=hub_only
    )
    payload = _run_all_scope(service)

    hub_only_rows = [r for r in payload["items"] if r["owner_link_method"] == "hub_only"]
    assert [(r["hub_employee_name"], r["hub_count"], r["hub_db_id"]) for r in hub_only_rows] == [
        ("Bob Other", 3, "MSK-ITINVENT")
    ]


def test_same_owner_no_in_two_databases_stays_two_hub_only_rows(monkeypatch):
    def owners(db_id=None):
        return []

    def hub_only(**kwargs):
        if kwargs.get("db_id") == "ITINVENT":
            return [{"owner_no": 7, "hub_count": 2, "owner_display_name": "Alice"}]
        return [{"owner_no": 7, "hub_count": 3, "owner_display_name": "Bob"}]

    service = _two_db_service(
        monkeypatch, owners=owners, counts=lambda owner_nos, **kw: {}, hub_only=hub_only
    )
    rows = [r for r in _run_all_scope(service)["items"] if r["owner_link_method"] == "hub_only"]
    assert sorted((r["hub_employee_name"], r["hub_count"], r["hub_db_id"]) for r in rows) == [
        ("Alice", 2, "ITINVENT"),
        ("Bob", 3, "MSK-ITINVENT"),
    ]


@pytest.mark.parametrize("failing", ["owners", "hub_only"])
def test_unavailable_hub_database_makes_the_answer_incomplete(monkeypatch, failing):
    """DWH-03: a contributor that cannot be read is not 'no equipment'."""

    def owners(db_id=None):
        if failing == "owners" and db_id == "MSK-ITINVENT":
            raise RuntimeError("db down")
        return [{"OWNER_NO": 7, "OWNER_DISPLAY_NAME": "Alice Covered"}] if db_id == "ITINVENT" else []

    def hub_only(**kwargs):
        if failing == "hub_only" and kwargs.get("db_id") == "MSK-ITINVENT":
            raise RuntimeError("db down")
        return []

    service = _two_db_service(
        monkeypatch, owners=owners, counts=lambda owner_nos, **kw: {7: 0}, hub_only=hub_only
    )
    payload = _run_all_scope(service)

    assert payload["exact"] is False
    assert payload["status"] == "incomplete"
    assert payload["hub_incomplete_db_ids"] == ["MSK-ITINVENT"]
    row = payload["items"][0]
    assert row["status"] == "incomplete" and row["exact_linked_count"] is None
    if failing == "owners":
        assert row["hub_count"] is None  # not a confirmed zero
