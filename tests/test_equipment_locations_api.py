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
    return SimpleNamespace(id=1, username="tester", role="operator", full_name="Tester")


class _Background:
    def __init__(self):
        self.tasks = []

    def add_task(self, func, **kwargs):
        self.tasks.append((func, kwargs))

    def run_all(self):
        for func, kwargs in list(self.tasks):
            func(**kwargs)


def _forbid_branch_location_check(*args, **kwargs):
    raise AssertionError("legacy branch/location validation should not be used")


def _construct_transfer_location_payload(**kwargs):
    request = equipment_api.TransferLocationRequest
    if hasattr(request, "model_construct"):
        return request.model_construct(**kwargs)
    return request.construct(**kwargs)


@pytest.mark.asyncio
async def test_transfer_endpoint_uses_shared_execution_service(monkeypatch):
    calls = []

    def fake_execute(**kwargs):
        calls.append(kwargs)
        return {
            "success_count": 1,
            "failed_count": 0,
            "transferred": [{
                "inv_no": "1001",
                "new_employee_no": 55,
                "new_employee_name": "New Owner",
            }],
            "failed": [],
            "acts": [],
            "upload_reminder_created": False,
            "upload_reminder_task_id": None,
            "upload_reminder_id": None,
            "upload_reminder_warning": None,
            "upload_reminder_controller_username": None,
            "upload_reminder_controller_fallback_used": False,
        }

    monkeypatch.setattr(equipment_api, "execute_equipment_transfer", fake_execute)

    payload = equipment_api.TransferExecuteRequest(
        inv_nos=["1001"],
        new_employee="New Owner",
        new_employee_no=55,
    )
    background = _Background()
    result = await equipment_api.transfer_equipment(payload, background_tasks=background, db_id="main", current_user=_user())

    assert result.job_id
    assert result.job_status == "queued"
    background.run_all()
    completed = equipment_api.transfer_act_job_service.response_payload(result.job_id)
    assert completed["success_count"] == 1
    assert calls[0]["payload"] is payload
    assert calls[0]["db_id"] == "main"
    assert calls[0]["allow_create_owner"] is True


@pytest.mark.asyncio
async def test_transfer_location_endpoint_updates_location_without_acts(monkeypatch):
    calls = []
    cache_invalidations = []

    monkeypatch.setattr(equipment_api.queries, "get_branch_by_no", lambda branch_no, db_id=None: {"BRANCH_NO": branch_no})
    monkeypatch.setattr(equipment_api.queries, "get_location_by_no", lambda loc_no, db_id=None: {"LOC_NO": loc_no})
    monkeypatch.setattr(equipment_api.queries, "is_location_in_branch", lambda loc_no, branch_no, db_id=None: True)
    monkeypatch.setattr(equipment_api, "invalidate_equipment_cache", lambda db_id=None: cache_invalidations.append(db_id))

    def fake_transfer_location(**kwargs):
        calls.append(kwargs)
        return {
            "success": True,
            "inv_no": kwargs["inv_no"],
            "old_employee_no": 55,
            "old_employee_name": "Current Owner",
            "new_employee_no": 55,
            "new_employee_name": "Current Owner",
            "branch_no": kwargs["new_branch_no"],
            "loc_no": kwargs["new_loc_no"],
            "hist_id": 44,
        }

    monkeypatch.setattr(equipment_api.queries, "transfer_equipment_location_by_inv_with_history", fake_transfer_location)

    payload = equipment_api.TransferLocationRequest(inv_nos=["1001"], branch_no=10, loc_no=20)
    result = await equipment_api.transfer_equipment_location(payload, db_id="main", current_user=_user())

    assert result.success_count == 1
    assert result.failed_count == 0
    assert result.acts == []
    assert calls == [{
        "inv_no": "1001",
        "new_branch_no": 10,
        "new_loc_no": 20,
        "changed_by": "tester",
        "comment": None,
        "db_id": "main",
    }]
    assert cache_invalidations == ["main"]


@pytest.mark.asyncio
async def test_transfer_location_endpoint_validates_branch_location_and_empty_targets(monkeypatch):
    payload = _construct_transfer_location_payload(inv_nos=[], branch_no=10, loc_no=20)
    with pytest.raises(HTTPException) as empty_exc:
        await equipment_api.transfer_equipment_location(payload, db_id="main", current_user=_user())
    assert empty_exc.value.status_code == 400

    monkeypatch.setattr(equipment_api.queries, "get_branch_by_no", lambda branch_no, db_id=None: None)
    payload = equipment_api.TransferLocationRequest(inv_nos=["1001"], branch_no=10, loc_no=20)
    with pytest.raises(HTTPException) as branch_exc:
        await equipment_api.transfer_equipment_location(payload, db_id="main", current_user=_user())
    assert branch_exc.value.status_code == 400
    assert branch_exc.value.detail == "Invalid branch_no"

    monkeypatch.setattr(equipment_api.queries, "get_branch_by_no", lambda branch_no, db_id=None: {"BRANCH_NO": branch_no})
    monkeypatch.setattr(equipment_api.queries, "get_location_by_no", lambda loc_no, db_id=None: None)
    with pytest.raises(HTTPException) as loc_exc:
        await equipment_api.transfer_equipment_location(payload, db_id="main", current_user=_user())
    assert loc_exc.value.status_code == 400
    assert loc_exc.value.detail == "Invalid loc_no"

    monkeypatch.setattr(equipment_api.queries, "get_location_by_no", lambda loc_no, db_id=None: {"LOC_NO": loc_no})
    monkeypatch.setattr(equipment_api.queries, "is_location_in_branch", lambda loc_no, branch_no, db_id=None: False)
    with pytest.raises(HTTPException) as mismatch_exc:
        await equipment_api.transfer_equipment_location(payload, db_id="main", current_user=_user())
    assert mismatch_exc.value.status_code == 400
    assert mismatch_exc.value.detail == "loc_no does not belong to branch_no"


def test_transfer_location_query_writes_history_and_updates_only_location(monkeypatch):
    executed = []

    class Cursor:
        def __init__(self):
            self.description = []
            self._next = None

        def execute(self, sql, params=()):
            executed.append((sql, params))
            if "FROM ITEMS i" in sql:
                self.description = [
                    ("ID",), ("INV_NO",), ("SERIAL_NO",), ("HW_SERIAL_NO",), ("PART_NO",),
                    ("EMPL_NO",), ("BRANCH_NO",), ("LOC_NO",), ("STATUS_NO",),
                    ("TYPE_NO",), ("MODEL_NO",), ("CI_TYPE",), ("QTY",),
                    ("OLD_EMPLOYEE_NAME",), ("BRANCH_NAME",), ("LOCATION_NAME",),
                    ("TYPE_NAME",), ("MODEL_NAME",),
                ]
                self._next = (
                    7, 1001.0, "SN-1", None, "PN-1",
                    55, 1, 2, 3,
                    4, 5, 1, 1,
                    "Current Owner", "Old Branch", "Old Room",
                    "Notebook", "ThinkPad",
                )
            elif "MAX(HIST_ID)" in sql:
                self._next = (44,)
            elif "BRANCH_NAME FROM BRANCHES" in sql:
                self._next = ("New Branch",)
            elif "DESCR FROM LOCATIONS" in sql:
                self._next = ("New Room",)
            else:
                self._next = None

        def fetchone(self):
            return self._next

    class Connection:
        def __init__(self):
            self.cursor_obj = Cursor()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return self.cursor_obj

    class Db:
        def get_connection(self):
            return Connection()

    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: Db())

    result = db_queries.transfer_equipment_location_by_inv_with_history(
        inv_no="1001",
        new_branch_no=10,
        new_loc_no=20,
        changed_by="tester",
        comment="move only",
        db_id="main",
    )

    assert result["success"] is True
    assert result["new_employee_no"] == 55
    assert result["branch_no"] == 10
    assert result["loc_no"] == 20
    history_sql, history_params = next(item for item in executed if "INSERT INTO CI_HISTORY" in item[0])
    update_sql, update_params = next(item for item in executed if "UPDATE ITEMS" in item[0])
    assert "EMPL_NO_OLD, EMPL_NO_NEW" in history_sql
    assert history_params[2:8] == (55, 55, 1, 10, 2, 20)
    assert "SET BRANCH_NO = ?" in update_sql
    assert "EMPL_NO =" not in update_sql
    assert update_params[0:2] == (10, 20)


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
            if "INFORMATION_SCHEMA.COLUMNS" in query:
                return []
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
        (db_queries.QUERY_LOCATIONS_HAS_BRANCH_COLUMN, None),
        (db_queries.QUERY_GET_ALL_LOCATIONS_WITH_BRANCH_PRIORITY, ("17",)),
        (db_queries.QUERY_LOCATIONS_HAS_BRANCH_COLUMN, None),
        (db_queries.QUERY_GET_ALL_LOCATIONS_WITH_BRANCH_PRIORITY, ("17",)),
    ]


def test_queries_get_all_locations_filters_by_locations_branch_column(monkeypatch):
    calls = []

    class FakeDB:
        def execute_query(self, query, params=None):
            calls.append((query, params))
            if "INFORMATION_SCHEMA.COLUMNS" in query:
                return [{"ok": 1}]
            if "FROM LOCATIONS" in query:
                return [
                    {"LOC_NO": 300, "LOC_NAME": "Empty branch room", "BRANCH_NO": params[0]},
                ]
            return []

    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: FakeDB())

    assert db_queries.get_all_locations(db_id="main", branch_no="17") == [
        {"loc_no": 300, "loc_name": "Empty branch room", "branch_no": "17"},
    ]
    assert calls == [
        (db_queries.QUERY_LOCATIONS_HAS_BRANCH_COLUMN, None),
        (db_queries.QUERY_GET_LOCATIONS_BY_BRANCH_COLUMN, ("17",)),
    ]


def test_queries_is_location_in_branch_uses_locations_branch_column_when_available(monkeypatch):
    calls = []

    class FakeDB:
        def __init__(self, has_branch_column=True, belongs=True):
            self.has_branch_column = has_branch_column
            self.belongs = belongs

        def execute_query(self, query, params=None):
            calls.append((query, params))
            if "INFORMATION_SCHEMA.COLUMNS" in query:
                return [{"ok": 1}] if self.has_branch_column else []
            if "FROM LOCATIONS" in query:
                return [{"ok": 1}] if self.belongs else []
            return []

    fake = FakeDB(has_branch_column=True, belongs=True)
    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: fake)
    assert db_queries.is_location_in_branch(300, 17, db_id="main") is True
    assert calls[-1][1] == (300, 17)

    fake.belongs = False
    assert db_queries.is_location_in_branch(300, 18, db_id="main") is False

    fake.has_branch_column = False
    assert db_queries.is_location_in_branch(300, 99, db_id="main") is True


def test_queries_directory_read_helpers_preserve_public_shapes(monkeypatch):
    db_ids = []

    class FakeDB:
        def __init__(self):
            self.calls = []

        def execute_query(self, query, params=None):
            self.calls.append((query, tuple(params or ())))
            if "FROM BRANCHES" in query and not params:
                return [
                    {"BRANCH_NO": 1, "BRANCH_NAME": "North"},
                    {"id": 2, "name": "South"},
                ]
            if "FROM BRANCHES" in query:
                return [{"BRANCH_NO": params[0], "BRANCH_NAME": "North"}]
            if "FROM LOCATIONS" in query:
                return [{"LOC_NO": params[0], "LOC_NAME": "Room 101"}]
            return []

    fake_db = FakeDB()

    def fake_get_db(db_id=None):
        db_ids.append(db_id)
        return fake_db

    monkeypatch.setattr(db_queries, "get_db", fake_get_db)

    assert db_queries.get_all_branches(db_id="main") == [
        {"id": 1, "name": "North"},
        {"id": 2, "name": "South"},
    ]
    assert db_queries.get_branch_by_no(1, db_id="main") == {"BRANCH_NO": 1, "BRANCH_NAME": "North"}
    assert db_queries.get_location_by_no(101, db_id="main") == {"LOC_NO": 101, "LOC_NAME": "Room 101"}
    assert [call[1] for call in fake_db.calls] == [(), (1,), (101,)]
    assert db_ids == ["main", "main", "main"]


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
    transfer_execution_service = __import__(
        "backend.services.equipment_transfer_execution_service",
        fromlist=["generate_transfer_acts"],
    )
    monkeypatch.setattr(transfer_execution_service, "generate_transfer_acts", lambda **kwargs: [])

    payload = equipment_api.TransferExecuteRequest(
        inv_nos=["1001"],
        new_employee="Новый сотрудник",
        new_employee_no=55,
        branch_no=2,
        loc_no=999,
    )

    background = _Background()
    result = await equipment_api.transfer_equipment(payload, background_tasks=background, db_id="main", current_user=_user())
    background.run_all()
    completed = equipment_api.transfer_act_job_service.response_payload(result.job_id)

    assert completed["success_count"] == 1
    assert completed["failed_count"] == 0


@pytest.mark.asyncio
async def test_transfer_act_only_uses_current_owner_without_updating_inventory(monkeypatch):
    captured = {}

    monkeypatch.setattr(
        equipment_api.queries,
        "get_owner_by_no",
        lambda owner_no, db_id=None: {
            "OWNER_NO": owner_no,
            "OWNER_DISPLAY_NAME": "Issuer User",
            "OWNER_DEPT": "IT",
        },
    )
    monkeypatch.setattr(equipment_api.queries, "get_owner_email_by_no", lambda owner_no, db_id=None: "issuer@example.test")
    monkeypatch.setattr(
        equipment_api.queries,
        "get_transfer_act_items_by_inv_nos",
        lambda inv_no, db_id=None: [{
            "inv_no": "1001",
            "serial_no": "SN-1",
            "part_no": "PN-1",
            "type_name": "Notebook",
            "model_name": "ThinkPad",
            "employee_name": "Current Holder",
            "employee_dept": "Finance",
            "employee_email": "holder@example.test",
        }],
    )

    def fail_transfer(**kwargs):
        raise AssertionError("act-only endpoint must not transfer equipment")

    def fake_generate_without_move(**kwargs):
        captured.update(kwargs)
        return [
            {
                "act_id": "act-1",
                "old_employee": kwargs["issuer_name"],
                "new_employee": "Current Holder",
                "equipment_count": 1,
                "file_name": "act.docx",
                "file_type": "docx",
            }
        ]

    monkeypatch.setattr(equipment_api.queries, "transfer_equipment_by_inv_with_history", fail_transfer)
    monkeypatch.setattr(equipment_api, "generate_transfer_acts_without_move", fake_generate_without_move)

    payload = equipment_api.TransferActOnlyRequest(
        inv_nos=["1001"],
        issuer_employee="manual fallback",
        issuer_owner_no=77,
    )

    background = _Background()
    result = await equipment_api.create_transfer_act_without_move(payload, background_tasks=background, db_id="main", _=_user())
    assert result.job_id
    assert result.job_status == "queued"
    background.run_all()
    completed = equipment_api.transfer_act_job_service.response_payload(result.job_id)

    assert completed["success_count"] == 1
    assert completed["failed_count"] == 0
    assert completed["acts"][0]["old_employee"] == "Issuer User"
    assert completed["acts"][0]["new_employee"] == "Current Holder"
    assert captured["issuer_name"] == "Issuer User"
    assert captured["issuer_email"] == "issuer@example.test"
    assert captured["items"][0]["employee_name"] == "Current Holder"
