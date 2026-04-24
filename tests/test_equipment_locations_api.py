import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api.v1 import equipment as equipment_api  # noqa: E402
from backend.database import queries as db_queries  # noqa: E402


def _user():
    return SimpleNamespace(username="tester")


def _forbid_branch_location_check(*args, **kwargs):
    raise AssertionError("legacy branch/location validation should not be used")


@pytest.mark.asyncio
async def test_locations_endpoints_use_global_directory(monkeypatch):
    sample_locations = [
        {"loc_no": 10, "loc_name": "Кабинет 10"},
        {"loc_no": 20, "loc_name": "Склад"},
    ]
    calls = []

    def fake_get_all_locations(db_id=None, branch_no=None):
        calls.append((db_id, branch_no))
        return sample_locations

    monkeypatch.setattr(equipment_api.queries, "get_all_locations", fake_get_all_locations)

    assert await equipment_api.get_all_locations(db_id="main", branch_no=None, _=_user()) == sample_locations
    assert await equipment_api.get_all_locations(db_id="main", branch_no="17", _=_user()) == sample_locations
    assert await equipment_api.get_locations(branch_id="123", db_id="main", _=_user()) == sample_locations
    assert calls == [("main", None), ("main", "17"), ("main", "123")]


def test_queries_get_all_locations_uses_branch_priority_query_only_for_ordering(monkeypatch):
    rows = [
        {"LOC_NO": 100, "LOC_NAME": "Alpha"},
        {"LOC_NO": 200, "LOC_NAME": "Beta"},
    ]
    calls = []

    class FakeDB:
        def execute_query(self, query, params=None):
            calls.append((query, params))
            return rows

    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: FakeDB())

    assert db_queries.get_all_locations(db_id="main") == [
        {"loc_no": 100, "loc_name": "Alpha"},
        {"loc_no": 200, "loc_name": "Beta"},
    ]
    assert db_queries.get_all_locations(db_id="main", branch_no="17") == [
        {"loc_no": 100, "loc_name": "Alpha"},
        {"loc_no": 200, "loc_name": "Beta"},
    ]
    assert db_queries.get_locations_by_branch("17", db_id="main") == [
        {"loc_no": 100, "loc_name": "Alpha"},
        {"loc_no": 200, "loc_name": "Beta"},
    ]

    assert calls == [
        (db_queries.QUERY_GET_ALL_LOCATIONS, None),
        (db_queries.QUERY_GET_ALL_LOCATIONS_WITH_BRANCH_PRIORITY, ("17",)),
        (db_queries.QUERY_GET_ALL_LOCATIONS_WITH_BRANCH_PRIORITY, ("17",)),
    ]


@pytest.mark.asyncio
async def test_create_equipment_accepts_existing_location_without_branch_mapping(monkeypatch):
    monkeypatch.setattr(equipment_api.queries, "get_branch_by_no", lambda branch_no, db_id=None: {"BRANCH_NO": branch_no})
    monkeypatch.setattr(equipment_api.queries, "get_location_by_no", lambda loc_no, db_id=None: {"LOC_NO": loc_no})
    monkeypatch.setattr(equipment_api.queries, "get_type_by_no", lambda type_no, db_id=None: {"TYPE_NO": type_no})
    monkeypatch.setattr(equipment_api.queries, "get_status_by_no", lambda status_no, db_id=None: {"STATUS_NO": status_no})
    monkeypatch.setattr(equipment_api.queries, "is_location_in_branch", _forbid_branch_location_check)
    monkeypatch.setattr(
        equipment_api.queries,
        "create_equipment_item",
        lambda **kwargs: {
            "success": True,
            "item_id": 101,
            "inv_no": "1001",
            "created_owner": False,
            "created_model": False,
            "message": "ok",
        },
    )

    payload = equipment_api.EquipmentCreateRequest(
        serial_no="SN-1",
        employee_name="Иванов И.И.",
        branch_no=1,
        loc_no=999,
        type_no=10,
        status_no=1,
        model_name="Dell OptiPlex",
    )

    result = await equipment_api.create_equipment(payload, db_id="main", current_user=_user())
    assert result.success is True
    assert result.inv_no == "1001"


@pytest.mark.asyncio
async def test_create_consumable_accepts_existing_location_without_branch_mapping(monkeypatch):
    monkeypatch.setattr(equipment_api.queries, "get_branch_by_no", lambda branch_no, db_id=None: {"BRANCH_NO": branch_no})
    monkeypatch.setattr(equipment_api.queries, "get_location_by_no", lambda loc_no, db_id=None: {"LOC_NO": loc_no})
    monkeypatch.setattr(equipment_api.queries, "get_type_by_no", lambda type_no, db_id=None, ci_type=4: {"TYPE_NO": type_no})
    monkeypatch.setattr(equipment_api.queries, "is_location_in_branch", _forbid_branch_location_check)
    monkeypatch.setattr(
        equipment_api.queries,
        "create_consumable_item",
        lambda **kwargs: {
            "success": True,
            "item_id": 202,
            "inv_no": "2002",
            "created_model": False,
            "message": "ok",
        },
    )

    payload = equipment_api.ConsumableCreateRequest(
        branch_no=1,
        loc_no=999,
        type_no=4,
        qty=3,
        model_name="HP 85A",
    )

    result = await equipment_api.create_consumable(payload, db_id="main", current_user=_user())
    assert result.success is True
    assert result.inv_no == "2002"


@pytest.mark.asyncio
async def test_invalid_location_is_still_rejected(monkeypatch):
    monkeypatch.setattr(equipment_api.queries, "get_branch_by_no", lambda branch_no, db_id=None: {"BRANCH_NO": branch_no})
    monkeypatch.setattr(equipment_api.queries, "get_location_by_no", lambda loc_no, db_id=None: None)

    payload = equipment_api.EquipmentCreateRequest(
        serial_no="SN-404",
        employee_name="Петров П.П.",
        branch_no=1,
        loc_no=404,
        type_no=10,
        status_no=1,
        model_name="Test model",
    )

    with pytest.raises(HTTPException) as exc_info:
        await equipment_api.create_equipment(payload, db_id="main", current_user=_user())

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Invalid loc_no"


@pytest.mark.asyncio
async def test_update_branch_keeps_existing_location(monkeypatch):
    before_row = {"inv_no": "1001", "branch_no": 1, "loc_no": 777, "type_no": 10}
    after_row = {"inv_no": "1001", "branch_no": 2, "loc_no": 777, "type_no": 10}
    captured = {}
    call_count = {"value": 0}

    def get_equipment_by_inv(inv_no, db_id=None):
        call_count["value"] += 1
        return before_row if call_count["value"] == 1 else after_row

    def update_equipment_fields(inv_no, fields, changed_by="IT-WEB", db_id=None):
        captured["inv_no"] = inv_no
        captured["fields"] = dict(fields)
        captured["changed_by"] = changed_by
        return True

    monkeypatch.setattr(equipment_api.queries, "get_equipment_by_inv", get_equipment_by_inv)
    monkeypatch.setattr(equipment_api.queries, "get_branch_by_no", lambda branch_no, db_id=None: {"BRANCH_NO": branch_no})
    monkeypatch.setattr(equipment_api.queries, "is_location_in_branch", _forbid_branch_location_check)
    monkeypatch.setattr(equipment_api.queries, "update_equipment_fields", update_equipment_fields)

    payload = equipment_api.EquipmentUpdateRequest(branch_no=2)
    updated = await equipment_api.update_equipment_by_inv("1001", payload, db_id="main", current_user=_user())

    assert captured["fields"] == {"branch_no": 2}
    assert updated["loc_no"] == 777


@pytest.mark.asyncio
async def test_transfer_accepts_existing_location_without_branch_mapping(monkeypatch):
    monkeypatch.setattr(
        equipment_api.queries,
        "get_owner_by_no",
        lambda owner_no, db_id=None: {
            "OWNER_NO": owner_no,
            "OWNER_DISPLAY_NAME": "Новый сотрудник",
            "OWNER_DEPT": "ИТ",
        },
    )
    monkeypatch.setattr(equipment_api.queries, "get_owner_email_by_no", lambda owner_no, db_id=None: None)
    monkeypatch.setattr(equipment_api.queries, "get_branch_by_no", lambda branch_no, db_id=None: {"BRANCH_NO": branch_no})
    monkeypatch.setattr(equipment_api.queries, "get_location_by_no", lambda loc_no, db_id=None: {"LOC_NO": loc_no})
    monkeypatch.setattr(equipment_api.queries, "is_location_in_branch", _forbid_branch_location_check)
    monkeypatch.setattr(
        equipment_api.queries,
        "transfer_equipment_by_inv_with_history",
        lambda **kwargs: {
            "success": True,
            "inv_no": kwargs["inv_no"],
            "new_employee_no": kwargs["new_employee_no"],
            "new_employee_name": kwargs["new_employee_name"],
            "old_employee_no": 1,
            "old_employee_name": "Старый сотрудник",
            "branch_no": kwargs["new_branch_no"],
            "loc_no": kwargs["new_loc_no"],
        },
    )
    monkeypatch.setattr(equipment_api, "generate_transfer_acts", lambda **kwargs: [])

    payload = equipment_api.TransferExecuteRequest(
        inv_nos=["1001"],
        new_employee="Новый сотрудник",
        new_employee_no=55,
        branch_no=2,
        loc_no=999,
    )

    result = await equipment_api.transfer_equipment(payload, db_id="main", current_user=_user())

    assert result.success_count == 1
    assert result.failed_count == 0
