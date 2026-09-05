from __future__ import annotations

from datetime import date
from pathlib import Path
import sys

from fastapi import FastAPI
from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps  # noqa: E402
from backend.api.v1 import construction as construction_api  # noqa: E402
from backend.models.auth import User  # noqa: E402
from backend.services import warehouse_1c_construction_requests as object_requests  # noqa: E402
from backend.services import warehouse_1c_process_dispatcher  # noqa: E402
from backend.services.warehouse_1c_it_requests import build_request_view  # noqa: E402
from backend.services.warehouse_1c_service import PROCESS_BRIDGE_OPERATIONS  # noqa: E402


GROUP_ONE = "11111111-1111-1111-1111-111111111111"
GROUP_TWO = "22222222-2222-2222-2222-222222222222"
REQUEST_ONE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
REQUEST_TWO = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"


def request_view(*, request_ref=REQUEST_ONE, number="ЕАСИ-ЭС-188утим", group_ref=GROUP_ONE):
    return build_request_view(
        {
            "request_ref": request_ref,
            "request_number": number,
            "system_number": "00000188",
            "date": "2026-08-27T10:00:00",
            "required_date": "2026-09-10T00:00:00",
            "posted": True,
            "group_ref": group_ref,
            "group_name": "ЕАСИ",
            "department_name": "УМТО",
            "responsible_name": "Петров П.П.",
            "warehouse_ref": "33333333-3333-3333-3333-333333333333",
            "warehouse_name": "Склад ЕАСИ",
        },
        [
            {
                "request_ref": request_ref,
                "line_key": "line-1",
                "nomenclature_ref": "44444444-4444-4444-4444-444444444444",
                "nomenclature_name": "Кабель силовой",
                "quantity": 50,
                "unit_name": "м",
                "cancelled": False,
            }
        ],
        [
            {
                "type": "assigned",
                "request_ref": request_ref,
                "line_key": "line-1",
                "manager_name": "Сидоров С.С.",
                "quantity": 50,
                "date": "2026-08-28T10:00:00",
            }
        ],
        today=date(2026, 9, 1),
    )


def test_object_request_snapshot_loads_non_it_numbers_for_all_linked_groups_once(monkeypatch):
    calls = []
    views = [
        request_view(),
        request_view(
            request_ref=REQUEST_TWO,
            number="БГГ-287мех",
            group_ref=GROUP_TWO,
        ),
    ]

    monkeypatch.setattr(
        object_requests,
        "_rebuild_group_references",
        lambda _connection, refs: list(refs),
    )

    def fake_load(_connection, group_references, scan_limit, timings, **kwargs):
        calls.append((group_references, scan_limit, kwargs))
        timings["headers_ms"] = 2.0
        return [object_requests._summary_from_view(item) for item in views], False, "2025-09-01"

    monkeypatch.setattr(object_requests, "_load_construction_request_summaries", fake_load)
    store = object_requests.ConstructionObjectRequestsSnapshotStore(ttl_seconds=300)

    first = object_requests.query_construction_object_requests(
        object(),
        group_refs=[GROUP_ONE, GROUP_TWO],
        view="all",
        search="кабель",
        limit=1,
        snapshot_store=store,
        nomenclature_lookup=lambda refs: {ref: {"name": ref} for ref in refs},
    )
    second = object_requests.query_construction_object_requests(
        object(),
        group_refs=[GROUP_TWO, GROUP_ONE],
        view="all",
        cursor=first["next_cursor"],
        limit=1,
        snapshot_store=store,
    )

    assert first["items"][0]["request_number"] in {"ЕАСИ-ЭС-188утим", "БГГ-287мех"}
    assert second["items"][0]["request_ref"] != first["items"][0]["request_ref"]
    assert first["summary"] == {"total": 2, "active": 2, "history": 0, "overdue": 0}
    assert first["overview"] == {
        "buyers": [{"name": "Сидоров С.С.", "active_requests": 2}],
        "request_responsibles": [{"name": "Петров П.П.", "active_requests": 2}],
        "departments": [{"name": "УМТО", "active_requests": 2}],
        "warehouses": [{"name": "Склад ЕАСИ", "active_requests": 2}],
        "stages": [{"key": "assigned", "label": "Назначен закупщик", "count": 2}],
    }
    assert {item["group_ref"] for item in first["source_groups"]} == {GROUP_ONE, GROUP_TWO}
    assert len(calls) == 1
    assert calls[0][0] == [GROUP_ONE, GROUP_TWO]
    assert callable(calls[0][2]["nomenclature_lookup"])


def test_object_request_detail_rejects_request_from_another_group(monkeypatch):
    monkeypatch.setattr(
        object_requests,
        "_load_views",
        lambda *_args, **_kwargs: ([request_view(group_ref=GROUP_TWO)], False),
    )

    result = object_requests.query_construction_object_request_detail(
        object(),
        object(),
        group_refs=[GROUP_ONE],
    )

    assert result is None


def test_object_request_summary_treats_receipt_as_delivery_for_the_whole_request():
    summary = object_requests._build_request_summary(
        {
            "request_ref": REQUEST_ONE,
            "request_number": "ЕАСИ-ЭС-188утим",
            "date": "2026-08-27T10:00:00",
            "required_date": "2026-08-30T00:00:00",
            "posted": True,
            "warehouse_ref": "33333333-3333-3333-3333-333333333333",
            "warehouse_name": "Склад ЕАСИ",
        },
        [
            {
                "request_ref": REQUEST_ONE,
                "nomenclature_ref": "44444444-4444-4444-4444-444444444444",
                "nomenclature_name": "Кабель силовой",
                "quantity": 50,
                "unit_name": "м",
                "cancelled": False,
            }
        ],
        [
            {
                "type": "received",
                "label": "Поступление на склад",
                "request_ref": REQUEST_ONE,
                "quantity": 10,
                "destination_ref": "33333333-3333-3333-3333-333333333333",
                "destination_name": "Склад ЕАСИ",
                "date": "2026-09-01T10:00:00",
                "document_number": "ПО-188",
            }
        ],
        today=date(2026, 9, 1),
    )

    assert summary["stage"]["key"] == "fulfilled"
    assert summary["is_active"] is False
    assert summary["overdue"] is False
    assert summary["progress_label"] == "Доставлено на склад"


def test_object_request_snapshot_serves_stale_data_after_refresh_error(monkeypatch):
    now = [0.0]
    calls = [0]
    monkeypatch.setattr(
        object_requests,
        "_rebuild_group_references",
        lambda _connection, refs: list(refs),
    )

    def fake_load(*_args, **_kwargs):
        calls[0] += 1
        if calls[0] > 1:
            raise RuntimeError("1C unavailable")
        return [object_requests._summary_from_view(request_view())], False, "2025-09-01"

    monkeypatch.setattr(object_requests, "_load_construction_request_summaries", fake_load)
    store = object_requests.ConstructionObjectRequestsSnapshotStore(
        ttl_seconds=1,
        force_refresh_cooldown_seconds=0,
        clock=lambda: now[0],
    )
    first, _ = store.get(object(), [GROUP_ONE])
    now[0] = 2.0
    stale, cache = store.get(object(), [GROUP_ONE], force_refresh=True)

    assert first is stale
    assert cache["stale"] is True
    assert "unavailable" in cache["refresh_error"]


def test_process_bridge_allowlist_and_dispatcher_cover_object_requests(monkeypatch):
    calls = []

    class FakeService:
        async def get_construction_object_requests(self, **kwargs):
            calls.append(("list", kwargs))
            return {"items": []}

        async def get_construction_object_request_detail(self, **kwargs):
            calls.append(("detail", kwargs))
            return {"request_ref": kwargs["request_ref"]}

    monkeypatch.setattr(warehouse_1c_process_dispatcher, "_service", FakeService())
    listed = warehouse_1c_process_dispatcher.dispatch(
        "construction_object_requests",
        {"group_refs": [GROUP_ONE], "view": "active", "limit": 25},
    )
    detailed = warehouse_1c_process_dispatcher.dispatch(
        "construction_object_request_detail",
        {"group_refs": [GROUP_ONE], "request_ref": REQUEST_ONE},
    )

    assert "construction_object_requests" in PROCESS_BRIDGE_OPERATIONS
    assert "construction_object_request_detail" in PROCESS_BRIDGE_OPERATIONS
    assert listed == {"items": []}
    assert detailed["request_ref"] == REQUEST_ONE
    assert calls[0][1]["group_refs"] == [GROUP_ONE]


def _api_client(*, permissions):
    user = User(
        id=43,
        username="construction-user",
        full_name="Construction User",
        role="operator",
        permissions=permissions,
        use_custom_permissions=True,
        custom_permissions=permissions,
        is_active=True,
    )
    app = FastAPI()
    app.include_router(construction_api.router, prefix="/construction")
    app.dependency_overrides[deps.get_current_active_user] = lambda: user
    return TestClient(app)


def test_object_request_api_uses_only_the_objects_groups(monkeypatch):
    calls = []

    class FakeManagementService:
        def get_object(self, object_id, *, include_history):
            assert object_id == "construction-easi"
            assert include_history is True
            return {
                "id": object_id,
                "name": "ЕАСИ",
                "groups": [
                    {"group_ref": GROUP_ONE, "group_name": "ЕАСИ"},
                    {"group_ref": GROUP_TWO, "group_name": "ЕАСИ доп."},
                ],
                "team": [],
                "role_history": [],
            }

    async def fake_list(**kwargs):
        calls.append(kwargs)
        return {
            "items": [],
            "next_cursor": None,
            "has_more": False,
            "total": 0,
            "snapshot_id": "snapshot-1",
            "snapshot_changed": False,
            "as_of": "2026-09-01T10:00:00+00:00",
            "window_from": "2025-09-01",
            "truncated": False,
            "source_groups": [
                {"group_ref": GROUP_ONE, "group_name": "ЕАСИ"},
                {"group_ref": GROUP_TWO, "group_name": "ЕАСИ доп."},
            ],
            "warehouse_facets": [],
            "summary": {"total": 0, "active": 0, "history": 0, "overdue": 0},
            "cache": {},
            "query_metrics": {"query_count": 9},
        }

    monkeypatch.setattr(construction_api, "_management_service", lambda: FakeManagementService())
    monkeypatch.setattr(
        construction_api.warehouse_1c_service,
        "get_construction_object_requests",
        fake_list,
    )
    client = _api_client(permissions=["construction.read"])

    passport = client.get("/construction/objects/construction-easi")
    requests = client.get("/construction/objects/construction-easi/requests")

    assert passport.status_code == 200
    assert passport.json()["managed"] is True
    assert requests.status_code == 200
    assert calls[0]["group_refs"] == [GROUP_ONE, GROUP_TWO]


def test_object_request_api_requires_construction_read(monkeypatch):
    async def must_not_run(**_kwargs):
        raise AssertionError("1C must not run without construction.read")

    monkeypatch.setattr(
        construction_api.warehouse_1c_service,
        "get_construction_object_requests",
        must_not_run,
    )
    client = _api_client(permissions=["warehouse_1c.read"])

    assert client.get(f"/construction/objects/{GROUP_ONE}/requests").status_code == 403
