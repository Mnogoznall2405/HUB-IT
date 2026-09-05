from __future__ import annotations

import asyncio
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import date
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services import warehouse_1c_it_requests as it_requests  # noqa: E402
from backend.services import warehouse_1c_process_dispatcher  # noqa: E402
from backend.api import deps  # noqa: E402
from backend.api.v1 import warehouse_1c as warehouse_1c_api  # noqa: E402
from backend.models.auth import User  # noqa: E402
from backend.services.warehouse_1c_service import (  # noqa: E402
    PROCESS_BRIDGE_OPERATIONS,
    decode_it_request_cursor,
    encode_it_request_cursor,
)


TODAY = date(2026, 8, 28)


def request(**overrides):
    return {
        "request_ref": "11111111-1111-1111-1111-111111111111",
        "request_number": "00ЦБ-000174-ИТ",
        "posted": True,
        "required_date": "2026-08-30T00:00:00",
        "warehouse_ref": "warehouse-destination",
        "warehouse_name": "Склад ИТ",
        "factual_delivery_date": None,
        **overrides,
    }


def line(key="line-1", quantity=10, **overrides):
    return {
        "request_ref": "11111111-1111-1111-1111-111111111111",
        "line_key": key,
        "line_number": 1,
        "nomenclature_ref": f"nom-{key}",
        "nomenclature_name": f"Позиция {key}",
        "quantity": quantity,
        "unit_name": "шт",
        "required_date": "2026-08-30T00:00:00",
        "cancelled": False,
        **overrides,
    }


def event(event_type, quantity=0, key="line-1", **overrides):
    return {
        "type": event_type,
        "line_key": key,
        "nomenclature_ref": f"nom-{key}",
        "quantity": quantity,
        "date": "2026-08-27T10:00:00",
        "document_ref": f"doc-{event_type}",
        "document_number": event_type,
        **overrides,
    }


@pytest.mark.parametrize(
    ("request_overrides", "events", "expected"),
    [
        ({"posted": False}, [], "draft"),
        ({}, [], "created"),
        ({}, [event("assigned", manager_name="Иванов И.И.")], "assigned"),
        ({}, [event("ordered", 5)], "ordered"),
        ({}, [event("reserved", 5)], "reserved"),
        ({}, [event("movement_planned", 5)], "movement_planned"),
        ({}, [event("received", 5)], "received"),
        ({}, [event("received", 10)], "ready"),
        ({}, [event("issued", 10)], "fulfilled"),
        (
            {},
            [event("transferred", 10, destination_ref="warehouse-destination")],
            "fulfilled",
        ),
        ({"factual_delivery_date": "2026-08-27T00:00:00"}, [], "fulfilled"),
    ],
)
def test_line_stage_transitions(request_overrides, events, expected):
    state = it_requests.build_line_state(
        request(**request_overrides),
        line(),
        events,
        today=TODAY,
    )

    assert state["stage"]["key"] == expected


def test_cancelled_overdue_and_quantity_conflict_are_derived_per_line():
    cancelled = it_requests.build_line_state(
        request(),
        line(cancelled=True, cancellation_reason="Больше не требуется"),
        [],
        today=TODAY,
    )
    overdue = it_requests.build_line_state(
        request(required_date="2026-08-20T00:00:00"),
        line(required_date=None),
        [],
        today=TODAY,
    )
    conflict = it_requests.build_line_state(
        request(),
        line(quantity=10),
        [event("ordered", 11)],
        today=TODAY,
    )

    assert cancelled["stage"]["key"] == "cancelled"
    assert cancelled["completed"] is True
    assert overdue["overdue"] is True
    assert conflict["stage"]["key"] == "needs_review"


def test_request_uses_one_common_stage_for_all_positions():
    lines = [line("one"), line("two")]
    view = it_requests.build_request_view(
        request(),
        lines,
        [event("assigned", 0, "one", manager_name="Петров П.П.")],
        today=TODAY,
    )

    assert view["stage"]["key"] == "assigned"
    assert view["positions_completed"] == 0
    assert view["progress_label"] == "2 позиции в заявке"
    assert view["status_group"] == "active"


def test_receipt_completes_the_whole_request_and_builds_common_journey():
    completed = it_requests.build_request_view(
        request(required_date="2026-08-20T00:00:00"),
        [line("one"), line("two")],
        [
            event("assigned", 0, "one", manager_name="Петров П.П."),
            event("ordered", 10, "one"),
            event("movement_planned", 10, "one"),
            event("received", 3, "one"),
        ],
        today=TODAY,
    )
    assert completed["stage"]["key"] == "fulfilled"
    assert completed["status_group"] == "history"
    assert completed["positions_completed"] == 2
    assert completed["progress_label"] == "Доставлено на склад"
    assert completed["overdue"] is False
    assert all(position["completed"] for position in completed["positions"])
    assert [step["key"] for step in completed["journey"]] == [
        "created",
        "assigned",
        "ordered",
        "movement_planned",
        "fulfilled",
    ]
    assert completed["journey"][-1]["current"] is True
    assert completed["journey"][-1]["reached"] is True


def test_all_cancelled_positions_close_request_as_cancelled():
    completed = it_requests.build_request_view(
        request(),
        [line("one", cancelled=True), line("two", cancelled=True)],
        [],
        today=TODAY,
    )

    assert completed["stage"]["key"] == "cancelled"
    assert completed["status_group"] == "history"
    assert completed["positions_completed"] == 2


def test_request_timeline_groups_document_lines_without_losing_quantities():
    view = it_requests.build_request_view(
        request(),
        [line("one", quantity=10), line("two", quantity=20)],
        [
            event(
                "assigned",
                10,
                "one",
                document_ref="assignment-1",
                document_number="000064922",
                nomenclature_name="Первая позиция",
            ),
            event(
                "assigned",
                20,
                "two",
                document_ref="assignment-1",
                document_number="000064922",
                nomenclature_name="Вторая позиция",
            ),
        ],
        today=TODAY,
    )

    assert len(view["timeline"]) == 1
    assert view["timeline"][0]["quantity"] == 30
    assert view["timeline"][0]["nomenclature_names"] == ["Первая позиция", "Вторая позиция"]


def test_destination_warehouse_falls_back_to_documents_and_duplicate_items_are_grouped():
    view = it_requests.build_request_view(
        request(warehouse_ref="", warehouse_name="Все склады"),
        [
            line("one", nomenclature_ref="nom-battery", nomenclature_name="Аккумулятор", quantity=10),
            line("two", nomenclature_ref="nom-battery", nomenclature_name="Аккумулятор", quantity=20),
        ],
        [
            event(
                "movement_planned",
                30,
                "one",
                destination_ref="warehouse-it",
                destination_name="Склад ИТ",
            ),
        ],
        today=TODAY,
    )

    assert view["destination_warehouse"] == {
        "ref": "warehouse-it",
        "name": "Склад ИТ",
        "source": "documents",
        "mismatch": False,
    }
    assert view["warehouse_name"] == "Склад ИТ"
    assert view["positions_total"] == 2
    assert view["positions_unique"] == 1
    assert view["item_groups"][0]["quantity"] == 30
    assert view["item_groups"][0]["source_line_count"] == 2


def test_transfer_to_document_destination_completes_request_with_generic_header_warehouse():
    view = it_requests.build_request_view(
        request(warehouse_ref="", warehouse_name="Все склады"),
        [line()],
        [
            event(
                "transferred",
                10,
                destination_ref="warehouse-it",
                destination_name="Склад ИТ",
            ),
        ],
        today=TODAY,
    )

    assert view["stage"]["key"] == "fulfilled"
    assert view["warehouse_ref"] == "warehouse-it"
    assert view["is_active"] is False


def test_warehouse_mismatch_is_a_warning_without_hiding_the_real_stage():
    view = it_requests.build_request_view(
        request(),
        [line()],
        [
            event(
                "movement_planned",
                10,
                destination_ref="another-warehouse",
                destination_name="Другой склад",
            ),
        ],
        today=TODAY,
    )

    assert view["stage"]["key"] == "movement_planned"
    assert view["attention_required"] is True
    assert "warehouse_mismatch" in view["diagnostics"]
    assert view["current_state"]["description"] == "Перемещение запланировано на склад «Склад ИТ»"


def test_exact_cyrillic_it_suffix_is_required():
    assert it_requests.is_it_request_number("00ЦБ-000174-ИТ") is True
    assert it_requests.is_it_request_number("00ЦБ-000174-IT") is False
    assert it_requests.is_it_request_number("00ЦБ-000174-ИТ ") is False
    assert it_requests.is_it_request_number("ИТ-00ЦБ-000174") is False


def test_cursor_and_pagination_are_stable(monkeypatch):
    rows = []
    for index in range(30):
        rows.append({
            **request(request_ref=f"ref-{index}", request_number=f"00ЦБ-{index:06d}-ИТ"),
            "is_active": True,
            "stage": {"key": "created", "label": "Заявка создана", "rank": 1},
            "overdue": False,
            "positions": [line(str(index))],
            "timeline": [],
            "manager_names": [],
            "nomenclature_items": [],
        })

    load_calls = []

    def fake_load(_connection, _request_reference, _scan_limit, _timings=None):
        load_calls.append(True)
        return deepcopy(rows), False

    monkeypatch.setattr(it_requests, "_load_views", fake_load)
    store = it_requests.ItRequestsSnapshotStore(ttl_seconds=300)
    first = it_requests.query_it_requests(
        object(), view="active", search="", stage="", overdue=None, limit=25,
        offset=0, snapshot_store=store,
    )
    second = it_requests.query_it_requests(
        object(), view="active", search="", stage="", overdue=None, limit=25,
        cursor=first["next_cursor"], snapshot_store=store,
    )

    assert len(first["items"]) == 25
    assert first["has_more"] is True
    assert len(second["items"]) == 5
    assert second["has_more"] is False
    assert len(load_calls) == 1
    cursor = encode_it_request_cursor(25)
    assert decode_it_request_cursor(cursor) == 25


def test_snapshot_filters_search_and_groups_without_reloading_1c(monkeypatch):
    rows = [
        {
            **request(request_ref="ref-it", request_number="00ЦБ-000174-ИТ"),
            "is_active": True,
            "stage": {"key": "assigned", "label": "Назначен закупщик", "rank": 2},
            "overdue": False,
            "positions": [],
            "timeline": [],
            "journey": [],
            "manager_names": ["Петров П.П."],
            "supplier_names": [],
            "nomenclature_items": [{"name": "Аккумулятор Ippon", "quantity": 30, "unit": "шт"}],
        },
        {
            **request(
                request_ref="ref-office",
                request_number="00ЦБ-000173-ИТ",
                warehouse_ref="warehouse-office",
                warehouse_name="Главный склад",
            ),
            "is_active": True,
            "stage": {"key": "created", "label": "Заявка создана", "rank": 1},
            "overdue": False,
            "positions": [],
            "timeline": [],
            "journey": [],
            "manager_names": [],
            "supplier_names": [],
            "nomenclature_items": [{"name": "Кабель", "quantity": 2, "unit": "шт"}],
        },
    ]
    calls = []

    def fake_load(_connection, _request_reference, _scan_limit, _timings=None):
        calls.append(True)
        return deepcopy(rows), False

    monkeypatch.setattr(it_requests, "_load_views", fake_load)
    store = it_requests.ItRequestsSnapshotStore(ttl_seconds=300)
    found = it_requests.query_it_requests(
        object(), view="active", search="Ippon Петров", stage="", overdue=None,
        limit=25, warehouse_ref="warehouse-destination", snapshot_store=store,
    )
    other = it_requests.query_it_requests(
        object(), view="active", search="", stage="", overdue=None,
        limit=25, warehouse_ref="warehouse-office", snapshot_store=store,
    )

    assert [item["request_ref"] for item in found["items"]] == ["ref-it"]
    assert [item["request_ref"] for item in other["items"]] == ["ref-office"]
    assert {facet["name"] for facet in found["warehouse_facets"]} == {"Склад ИТ"}
    assert len(calls) == 1


def test_expired_snapshot_is_kept_when_1c_refresh_fails(monkeypatch):
    now = [0.0]
    calls = []
    rows = [{
        **request(),
        "is_active": True,
        "stage": {"key": "created", "label": "Заявка создана", "rank": 1},
        "overdue": False,
        "positions": [],
        "timeline": [],
        "journey": [],
        "manager_names": [],
        "supplier_names": [],
        "nomenclature_items": [],
    }]

    def fake_load(_connection, _request_reference, _scan_limit, _timings=None):
        calls.append(True)
        if len(calls) > 1:
            raise RuntimeError("1C unavailable")
        return deepcopy(rows), False

    monkeypatch.setattr(it_requests, "_load_views", fake_load)
    store = it_requests.ItRequestsSnapshotStore(ttl_seconds=10, clock=lambda: now[0])
    first = it_requests.query_it_requests(
        object(), view="all", search="", stage="", overdue=None, limit=25,
        snapshot_store=store,
    )
    now[0] = 11.0
    stale = it_requests.query_it_requests(
        object(), view="all", search="", stage="", overdue=None, limit=25,
        snapshot_store=store,
    )

    assert stale["items"] == first["items"]
    assert stale["source"] == "stale_snapshot"
    assert stale["cache"]["refresh_error"] == "1C unavailable"


def test_concurrent_cold_reads_share_one_snapshot_refresh(monkeypatch):
    started = threading.Event()
    release = threading.Event()
    calls = []
    rows = [{
        **request(),
        "is_active": True,
        "stage": {"key": "created", "label": "Заявка создана", "rank": 1},
        "overdue": False,
        "positions": [],
        "timeline": [],
        "journey": [],
        "manager_names": [],
        "supplier_names": [],
        "nomenclature_items": [],
    }]

    def fake_load(_connection, _request_reference, _scan_limit, _timings=None):
        calls.append(True)
        started.set()
        assert release.wait(timeout=2)
        return deepcopy(rows), False

    monkeypatch.setattr(it_requests, "_load_views", fake_load)
    store = it_requests.ItRequestsSnapshotStore(ttl_seconds=300)

    def read_snapshot():
        return it_requests.query_it_requests(
            object(), view="all", search="", stage="", overdue=None,
            limit=25, snapshot_store=store,
        )

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(read_snapshot) for _ in range(10)]
        assert started.wait(timeout=2)
        release.set()
        results = [future.result(timeout=3) for future in futures]

    assert len(calls) == 1
    assert all(result["items"][0]["request_ref"] == request()["request_ref"] for result in results)


def test_cursor_restarts_page_when_snapshot_changes(monkeypatch):
    now = [0.0]
    rows = []
    for index in range(30):
        rows.append({
            **request(request_ref=f"ref-{index}", request_number=f"00ЦБ-{index:06d}-ИТ"),
            "is_active": True,
            "stage": {"key": "created", "label": "Заявка создана", "rank": 1},
            "overdue": False,
            "positions": [],
            "timeline": [],
            "journey": [],
            "manager_names": [],
            "supplier_names": [],
            "nomenclature_items": [],
        })

    monkeypatch.setattr(
        it_requests,
        "_load_views",
        lambda _connection, _request_reference, _scan_limit, _timings=None: (deepcopy(rows), False),
    )
    store = it_requests.ItRequestsSnapshotStore(ttl_seconds=1, clock=lambda: now[0])
    first = it_requests.query_it_requests(
        object(), view="all", search="", stage="", overdue=None,
        limit=25, snapshot_store=store,
    )
    now[0] = 2.0
    restarted = it_requests.query_it_requests(
        object(), view="all", search="", stage="", overdue=None,
        limit=25, cursor=first["next_cursor"], snapshot_store=store,
    )

    assert restarted["snapshot_changed"] is True
    assert restarted["items"][0]["request_ref"] == first["items"][0]["request_ref"]


def test_process_bridge_allowlist_and_dispatcher_cover_list_and_detail(monkeypatch):
    calls = []

    class FakeService:
        async def get_it_requests(self, **kwargs):
            calls.append(("list", kwargs))
            return {"items": [], "has_more": False}

        async def get_it_request_detail(self, request_ref):
            calls.append(("detail", request_ref))
            return {"request_ref": request_ref}

    monkeypatch.setattr(warehouse_1c_process_dispatcher, "_service", FakeService())
    list_result = warehouse_1c_process_dispatcher.dispatch(
        "it_requests",
        {
            "view": "history",
            "overdue": True,
            "limit": 25,
            "warehouse_ref": "warehouse-it",
            "refresh": True,
        },
    )
    detail_result = warehouse_1c_process_dispatcher.dispatch(
        "it_request_detail",
        {"request_ref": "11111111-1111-1111-1111-111111111111"},
    )

    assert "it_requests" in PROCESS_BRIDGE_OPERATIONS
    assert "it_request_detail" in PROCESS_BRIDGE_OPERATIONS
    assert list_result["items"] == []
    assert calls[0][1]["view"] == "history"
    assert calls[0][1]["overdue"] is True
    assert calls[0][1]["warehouse_ref"] == "warehouse-it"
    assert calls[0][1]["refresh"] is True
    assert detail_result["request_ref"].startswith("11111111")


def _api_client(*, role="operator", permissions=None):
    user = User(
        id=42,
        username="it-request-user",
        full_name="IT Request User",
        role=role,
        permissions=permissions or [],
        use_custom_permissions=True,
        custom_permissions=permissions or [],
        is_active=True,
    )
    app = FastAPI()
    app.include_router(warehouse_1c_api.router, prefix="/warehouse-1c")
    app.dependency_overrides[deps.get_current_active_user] = lambda: user
    return TestClient(app)


def test_it_request_api_rejects_general_warehouse_permission(monkeypatch):
    async def must_not_run(*args, **kwargs):
        raise AssertionError("1C service must not run without the dedicated permission")

    monkeypatch.setattr(warehouse_1c_api.warehouse_1c_service, "get_it_requests", must_not_run)
    monkeypatch.setattr(warehouse_1c_api.warehouse_1c_service, "get_it_request_detail", must_not_run)
    client = _api_client(permissions=["warehouse_1c.read"])

    assert client.get("/warehouse-1c/it-requests").status_code == 403
    assert client.get("/warehouse-1c/it-requests/11111111-1111-1111-1111-111111111111").status_code == 403


@pytest.mark.parametrize(
    ("role", "permissions"),
    [
        ("operator", ["warehouse_1c.it_requests.read"]),
        ("admin", []),
    ],
)
def test_it_request_api_allows_individual_permission_and_admin(monkeypatch, role, permissions):
    async def fake_list(**kwargs):
        return {"items": [], "next_cursor": None, "has_more": False, "as_of": "2026-08-28T10:00:00Z"}

    monkeypatch.setattr(warehouse_1c_api.warehouse_1c_service, "get_it_requests", fake_list)
    client = _api_client(role=role, permissions=permissions)

    response = client.get("/warehouse-1c/it-requests")

    assert response.status_code == 200
    assert response.json()["items"] == []
