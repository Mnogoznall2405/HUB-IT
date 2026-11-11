from __future__ import annotations

from datetime import date
from pathlib import Path
import sys

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps  # noqa: E402
from backend.api.v1 import construction as construction_api  # noqa: E402
from backend.models.auth import User  # noqa: E402
from backend.models.construction import ConstructionObjectSaveRequest  # noqa: E402
from backend.services import warehouse_1c_process_dispatcher  # noqa: E402
from backend.services.warehouse_1c_construction import (  # noqa: E402
    ConstructionSnapshotStore,
    build_construction_snapshot,
    merge_managed_construction_objects,
    query_construction_objects,
)
from backend.services.warehouse_1c_service import PROCESS_BRIDGE_OPERATIONS  # noqa: E402


GROUP_ONE = "11111111-1111-1111-1111-111111111111"
GROUP_TWO = "22222222-2222-2222-2222-222222222222"


def request_row(**overrides):
    return {
        "request_ref": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "request_number": "ЕАСИ-С-71",
        "system_number": "000000071",
        "date": "2026-08-25T10:00:00",
        "required_date": "2026-09-01T00:00:00",
        "posted": True,
        "group_ref": GROUP_ONE,
        "group_name": "ЕАСИ",
        "department_name": "УМТО",
        "responsible_name": "Петров П.П.",
        "warehouse_name": "Склад ЕАСИ",
        **overrides,
    }


def test_snapshot_uses_stable_group_ref_and_keeps_general_and_unassigned_requests_visible():
    snapshot = build_construction_snapshot(
        [
            request_row(),
            request_row(
                request_ref="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                request_number="ЕАСИ-С-72",
                group_ref=GROUP_TWO,
            ),
            request_row(
                request_ref="cccccccc-cccc-cccc-cccc-cccccccccccc",
                group_ref="33333333-3333-3333-3333-333333333333",
                group_name="Общехозяйственная деятельность",
            ),
            request_row(
                request_ref="dddddddd-dddd-dddd-dddd-dddddddddddd",
                group_ref="",
                group_name="",
            ),
        ],
        as_of="2026-09-01T10:00:00+00:00",
        window_from=date(2025, 9, 1),
        today=date(2026, 9, 1),
    )

    assert snapshot["summary"] == {
        "project_count": 2,
        "request_count": 4,
        "requests_last_30_days": 4,
        "general_request_count": 1,
        "unassigned_request_count": 1,
    }
    assert [item["object_ref"] for item in snapshot["items"][:2]] == [GROUP_ONE, GROUP_TWO]
    assert snapshot["items"][-2]["kind"] == "general"
    assert snapshot["items"][-1]["kind"] == "unassigned"


class StaticStore:
    def __init__(self, snapshot):
        self.snapshot = snapshot

    def get(self, _connection, *, force_refresh=False):
        return self.snapshot, {
            "state": "cached",
            "age_seconds": 5,
            "last_error": "",
            "coalesced": False,
            "refresh_suppressed": force_refresh,
        }


def test_query_filters_searches_and_paginates_snapshot():
    snapshot = build_construction_snapshot(
        [
            request_row(),
            request_row(
                request_ref="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                request_number="БГГ-287мех",
                group_ref=GROUP_TWO,
                group_name="БГГ",
                department_name="Механизация",
            ),
        ],
        today=date(2026, 9, 1),
    )
    store = StaticStore(snapshot)
    first = query_construction_objects(object(), limit=1, snapshot_store=store)
    second = query_construction_objects(
        object(), limit=1, cursor=first["next_cursor"], snapshot_store=store
    )
    found = query_construction_objects(
        object(), search="287мех механизация", kind="project", snapshot_store=store
    )

    assert first["has_more"] is True
    assert second["has_more"] is False
    assert first["items"][0]["object_ref"] != second["items"][0]["object_ref"]
    assert [item["name"] for item in found["items"]] == ["БГГ"]


def test_search_keeps_all_request_numbers_not_only_three_card_examples():
    rows = [
        request_row(
            request_ref=f"00000000-0000-0000-0000-00000000000{index}",
            request_number=f"ЕАСИ-СТАРАЯ-{index}",
            date=f"2026-08-{20 + index:02d}T10:00:00",
        )
        for index in range(1, 5)
    ]
    snapshot = build_construction_snapshot(rows, today=date(2026, 9, 1))
    result = query_construction_objects(
        object(), search="ЕАСИ-СТАРАЯ-1", snapshot_store=StaticStore(snapshot)
    )

    assert len(snapshot["items"][0]["recent_requests"]) == 3
    assert [item["name"] for item in result["items"]] == ["ЕАСИ"]


def test_managed_object_merges_multiple_1c_groups_before_pagination():
    snapshot = build_construction_snapshot(
        [
            request_row(),
            request_row(
                request_ref="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                request_number="ЕАСИ-ДОП-1",
                group_ref=GROUP_TWO,
                group_name="ЕАСИ — дополнительный контур",
                warehouse_name="Склад объекта 2",
            ),
        ],
        today=date(2026, 9, 1),
    )
    definitions = [
        {
            "id": "construction-easi",
            "name": "ЕАСИ — единый объект",
            "is_active": True,
            "groups": [
                {"group_ref": GROUP_ONE, "group_name": "ЕАСИ"},
                {"group_ref": GROUP_TWO, "group_name": "ЕАСИ — дополнительный контур"},
            ],
            "team": [
                {
                    "role_key": "project_lead",
                    "employee_code": "E-1",
                    "full_name": "Иванов Иван Иванович",
                }
            ],
        }
    ]

    merged, signature = merge_managed_construction_objects(snapshot["items"], definitions)
    result = query_construction_objects(
        object(),
        search="Иванов дополнительный",
        managed_objects=definitions,
        snapshot_store=StaticStore(snapshot),
    )

    assert signature
    assert len(merged) == 1
    assert merged[0]["object_ref"] == "managed:construction-easi"
    assert merged[0]["request_count"] == 2
    assert set(merged[0]["warehouse_names"]) == {"Склад ЕАСИ", "Склад объекта 2"}
    assert result["summary"]["project_count"] == 1
    assert [item["name"] for item in result["items"]] == ["ЕАСИ — единый объект"]


def test_snapshot_store_serves_previous_data_after_refresh_error():
    now = [0.0]
    calls = [0]
    snapshot = build_construction_snapshot([request_row()], today=date(2026, 9, 1))

    def loader(_connection):
        calls[0] += 1
        if calls[0] > 1:
            raise RuntimeError("1C temporarily unavailable")
        return snapshot

    store = ConstructionSnapshotStore(
        ttl_seconds=1,
        force_refresh_cooldown_seconds=0,
        clock=lambda: now[0],
        loader=loader,
    )
    loaded, first_cache = store.get(object())
    now[0] = 2.0
    stale, stale_cache = store.get(object(), force_refresh=True)

    assert loaded is stale
    assert first_cache["state"] == "fresh"
    assert stale_cache["state"] == "stale"
    assert "temporarily unavailable" in stale_cache["last_error"]


def test_force_refresh_bypasses_fresh_ttl_once():
    calls = [0]

    def loader(_connection):
        calls[0] += 1
        return build_construction_snapshot([request_row()], today=date(2026, 9, 1))

    store = ConstructionSnapshotStore(
        ttl_seconds=300,
        force_refresh_cooldown_seconds=0,
        clock=lambda: 1.0,
        loader=loader,
    )

    store.get(object())
    store.get(object(), force_refresh=True)

    assert calls[0] == 2


def test_process_bridge_allowlist_and_dispatcher_cover_construction_portfolio(monkeypatch):
    calls = []

    class FakeService:
        async def get_construction_objects(self, **kwargs):
            calls.append(kwargs)
            return {"items": [], "has_more": False}

    monkeypatch.setattr(warehouse_1c_process_dispatcher, "_service", FakeService())
    result = warehouse_1c_process_dispatcher.dispatch(
        "construction_objects",
        {"search": "ЕАСИ", "kind": "project", "limit": 24, "refresh": True},
    )

    assert "construction_objects" in PROCESS_BRIDGE_OPERATIONS
    assert result["items"] == []
    assert calls == [
        {
            "search": "ЕАСИ",
            "kind": "project",
            "limit": 24,
            "cursor": None,
            "refresh": True,
            "managed_objects": [],
        }
    ]


def _api_client(*, role="operator", permissions=None):
    user = User(
        id=43,
        username="construction-user",
        full_name="Construction User",
        role=role,
        permissions=permissions or [],
        use_custom_permissions=True,
        custom_permissions=permissions or [],
        is_active=True,
    )
    app = FastAPI()
    app.include_router(construction_api.router, prefix="/construction")
    app.dependency_overrides[deps.get_current_active_user] = lambda: user
    return TestClient(app)


def test_construction_api_requires_dedicated_permission(monkeypatch):
    async def must_not_run(**_kwargs):
        raise AssertionError("1C must not be queried without construction.read")

    monkeypatch.setattr(
        construction_api.warehouse_1c_service,
        "get_construction_objects",
        must_not_run,
    )
    client = _api_client(permissions=["warehouse_1c.read"])

    assert client.get("/construction/objects").status_code == 403


def test_construction_management_write_requires_separate_permission():
    client = _api_client(permissions=["construction.read"])

    response = client.post(
        "/construction/management/objects",
        json={
            "name": "ЕАСИ",
            "groups": [{"group_ref": GROUP_ONE, "group_name": "ЕАСИ"}],
            "roles": [],
        },
    )

    assert response.status_code == 403


def test_construction_management_write_accepts_individual_permission(monkeypatch):
    calls = []

    class FakeManagementService:
        def save_object(self, **kwargs):
            calls.append(kwargs)
            return {
                "id": "construction-easi",
                "name": kwargs["name"],
                "is_active": True,
                "groups": kwargs["groups"],
                "team": [],
                "role_history": [],
            }

    async def fake_resolve(_payload):
        return {"project_lead": None, "pto_manager": None, "umto_coordinator": None}

    monkeypatch.setattr(construction_api, "_management_service", lambda: FakeManagementService())
    monkeypatch.setattr(construction_api, "_resolve_role_candidates", fake_resolve)
    client = _api_client(permissions=["construction.write"])

    response = client.post(
        "/construction/management/objects",
        json={
            "name": "ЕАСИ",
            "groups": [{"group_ref": GROUP_ONE, "group_name": "ЕАСИ"}],
            "roles": [],
        },
    )

    assert response.status_code == 201
    assert response.json()["id"] == "construction-easi"
    assert calls[0]["actor_user_id"] == 43


@pytest.mark.asyncio
async def test_role_assignment_resolves_employee_by_exact_zup_code(monkeypatch):
    looked_up = []

    def fake_get_person_by_code(employee_code):
        looked_up.append(employee_code)
        return {
            "employee_code": "E-100",
            "full_name": "Иванов Иван Иванович",
            "position": "Руководитель проекта",
            "department": "Управление проектами",
        }

    monkeypatch.setattr(
        construction_api.address_book_service,
        "get_person_by_code",
        fake_get_person_by_code,
    )
    payload = ConstructionObjectSaveRequest.model_validate(
        {
            "name": "ЕАСИ",
            "groups": [{"group_ref": GROUP_ONE, "group_name": "ЕАСИ"}],
            "roles": [{"role_key": "project_lead", "employee_code": "E-100"}],
        }
    )

    resolved = await construction_api._resolve_role_candidates(payload)

    assert looked_up == ["E-100"]
    assert resolved["project_lead"]["full_name"] == "Иванов Иван Иванович"


@pytest.mark.parametrize(
    ("role", "permissions"),
    [("operator", ["construction.read"]), ("admin", [])],
)
def test_construction_api_allows_individual_permission_and_admin(monkeypatch, role, permissions):
    async def fake_list(**_kwargs):
        return {
            "items": [],
            "next_cursor": None,
            "has_more": False,
            "snapshot_changed": False,
            "as_of": "2026-09-01T10:00:00+00:00",
            "window_from": "2025-09-01",
            "scanned_requests": 0,
            "scan_truncated": False,
            "summary": {
                "project_count": 0,
                "request_count": 0,
                "requests_last_30_days": 0,
                "general_request_count": 0,
                "unassigned_request_count": 0,
            },
            "cache": {
                "state": "fresh",
                "age_seconds": 0,
                "last_error": "",
                "coalesced": False,
                "refresh_suppressed": False,
            },
        }

    monkeypatch.setattr(
        construction_api.warehouse_1c_service,
        "get_construction_objects",
        fake_list,
    )
    client = _api_client(role=role, permissions=permissions)

    response = client.get("/construction/objects")

    assert response.status_code == 200
    assert response.json()["items"] == []
