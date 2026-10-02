import asyncio
import time

from fastapi import FastAPI, Response
from fastapi.testclient import TestClient

from backend.api import deps
from backend.api.v1 import database as database_api
from backend.api.v1 import equipment as equipment_api
from backend.database import equipment_db
from backend.models.auth import User


def _admin() -> User:
    return User(
        id=91,
        username="mobile-db-admin",
        role="admin",
        is_active=True,
        permissions=["database.read"],
        use_custom_permissions=True,
        custom_permissions=["database.read"],
    )


def test_equipment_detail_uses_request_database_header_over_concurrent_selection(monkeypatch):
    captured: dict[str, str | None] = {}
    monkeypatch.setattr(
        database_api,
        "get_all_db_configs",
        lambda: [
            {"id": "ITINVENT", "name": "Main", "access": "read-only"},
            {"id": "OBJ-ITINVENT", "name": "Objects", "access": "read-only"},
        ],
    )
    monkeypatch.setattr(database_api, "get_user_database", lambda *_args, **_kwargs: "ITINVENT")
    monkeypatch.setattr(
        database_api.settings_service,
        "get_user_settings",
        lambda _user_id: {"pinned_database": "ITINVENT"},
    )
    monkeypatch.setattr(database_api.user_db_selection_service, "get_assigned_database", lambda _telegram_id: None)

    def get_equipment(inv_no: str, db_id: str | None):
        captured.update(inv_no=inv_no, db_id=db_id)
        return {"inv_no": inv_no, "model_name": "Scoped device"}

    monkeypatch.setattr(equipment_api.queries, "get_equipment_by_inv", get_equipment)
    app = FastAPI()
    app.include_router(equipment_api.router, prefix="/equipment")
    app.dependency_overrides[deps.get_current_active_user] = _admin

    response = TestClient(app).get(
        "/equipment/INV-1",
        headers={"X-Database-ID": "OBJ-ITINVENT"},
    )

    assert response.status_code == 200
    assert captured == {"inv_no": "INV-1", "db_id": "OBJ-ITINVENT"}


def _viewer_without_database_permissions() -> User:
    return User(
        id=92,
        username="viewer-no-db",
        role="viewer",
        is_active=True,
        permissions=[],
        use_custom_permissions=True,
        custom_permissions=[],
    )


def test_equipment_branches_rejects_user_without_database_permissions(monkeypatch):
    calls: list = []
    monkeypatch.setattr(
        equipment_api.queries,
        "get_all_branches",
        lambda db_id=None: calls.append(db_id) or [],
    )
    app = FastAPI()
    app.include_router(equipment_api.router, prefix="/equipment")
    app.dependency_overrides[deps.get_current_active_user] = _viewer_without_database_permissions

    response = TestClient(app).get("/equipment/branches")

    assert response.status_code == 403
    assert calls == []


def test_equipment_by_inv_nos_uses_single_batch_query(monkeypatch):
    batch_calls: list = []

    def fake_batch(inv_nos, db_id=None):
        batch_calls.append((list(inv_nos), db_id))
        rows = []
        for inv_no in inv_nos:
            if inv_no == "MISSING-1":
                continue
            returned_inv_no = inv_no.lower() if inv_no == "INV-5" else inv_no
            rows.append({"inv_no": returned_inv_no, "id": len(rows) + 1})
        return rows

    def fail_if_called(*_args, **_kwargs):
        raise AssertionError("get_equipment_by_inv must not be called per inventory number")

    monkeypatch.setattr(equipment_api.queries, "get_equipment_items_by_inv_nos", fake_batch)
    monkeypatch.setattr(equipment_api.queries, "get_equipment_by_inv", fail_if_called)

    app = FastAPI()
    app.include_router(equipment_api.router, prefix="/equipment")
    app.dependency_overrides[deps.get_current_active_user] = _admin

    inv_nos = [f"INV-{index}" for index in range(19)] + ["MISSING-1"]
    response = TestClient(app).post(
        "/equipment/by-inv-nos",
        json={"inv_nos": inv_nos},
        headers={"X-Database-ID": "OBJ-ITINVENT"},
    )

    assert response.status_code == 200
    assert len(batch_calls) == 1
    assert batch_calls[0][0] == inv_nos
    payload = response.json()
    assert payload["requested"] == 20
    expected_inv_nos = ["inv-5" if inv_no == "INV-5" else inv_no for inv_no in inv_nos[:19]]
    assert [row["inv_no"] for row in payload["equipment"]] == expected_inv_nos
    assert payload["not_found"] == ["MISSING-1"]


async def test_threadpool_reads_do_not_block_the_event_loop(monkeypatch):
    def slow_grouped(*_args, **_kwargs):
        time.sleep(0.08)
        return {"grouped": {}, "total": 0, "page": 1, "limit": 10, "pages": 0}

    def slow_branches(*_args, **_kwargs):
        time.sleep(0.08)
        return []

    monkeypatch.setattr(equipment_db, "get_equipment_grouped", slow_grouped)
    monkeypatch.setattr(equipment_db, "get_all_branches", slow_branches)

    started = time.monotonic()
    grouped, branches = await asyncio.gather(
        equipment_api.get_all_equipment_grouped(page=1, limit=10, branch=None, db_id=None, _=None),
        equipment_api.get_branches_list(response=Response(), db_id=None, _=None),
    )
    elapsed = time.monotonic() - started

    assert grouped["total"] == 0
    assert branches == []
    assert elapsed < 0.20


def _stub_database_resolution(monkeypatch, *, persisted: str = "ITINVENT", assigned: str | None = None):
    monkeypatch.setattr(
        database_api,
        "get_all_db_configs",
        lambda: [
            {"id": "ITINVENT", "name": "Main", "access": "read-only"},
            {"id": "OBJ-ITINVENT", "name": "Objects", "access": "read-only"},
        ],
    )
    monkeypatch.setattr(database_api, "get_user_database", lambda *_args, **_kwargs: persisted)
    monkeypatch.setattr(
        database_api.settings_service,
        "get_user_settings",
        lambda _user_id: {"pinned_database": persisted},
    )
    monkeypatch.setattr(database_api.user_db_selection_service, "get_assigned_database", lambda _telegram_id: assigned)


def _transfer_writer() -> User:
    return User(
        id=93,
        username="transfer-operator",
        role="operator",
        is_active=True,
        permissions=["database.write"],
        use_custom_permissions=True,
        custom_permissions=["database.write"],
    )


def test_equipment_transfer_uses_request_database_header_over_persisted_selection(monkeypatch):
    created: dict = {}
    _stub_database_resolution(monkeypatch)

    def fake_create_job(**kwargs):
        created.update(kwargs)
        return {"id": "job-1", "status": "done", "operation": "transfer"}

    monkeypatch.setattr(equipment_api.transfer_act_job_service, "create_job", fake_create_job)
    app = FastAPI()
    app.include_router(equipment_api.router, prefix="/equipment")
    app.dependency_overrides[deps.get_current_active_user] = _admin

    response = TestClient(app).post(
        "/equipment/transfer",
        json={"inv_nos": ["INV-1"], "new_employee": "Иванов Иван"},
        headers={"X-Database-ID": "OBJ-ITINVENT"},
    )

    assert response.status_code == 200
    assert created["db_id"] == "OBJ-ITINVENT"


def test_equipment_transfer_keeps_fixed_assignment_over_request_header(monkeypatch):
    created: dict = {}
    _stub_database_resolution(monkeypatch, assigned="ITINVENT")

    def fake_create_job(**kwargs):
        created.update(kwargs)
        return {"id": "job-2", "status": "done", "operation": "transfer"}

    monkeypatch.setattr(equipment_api.transfer_act_job_service, "create_job", fake_create_job)
    app = FastAPI()
    app.include_router(equipment_api.router, prefix="/equipment")
    app.dependency_overrides[deps.get_current_active_user] = _transfer_writer

    response = TestClient(app).post(
        "/equipment/transfer",
        json={"inv_nos": ["INV-1"], "new_employee": "Иванов Иван"},
        headers={"X-Database-ID": "OBJ-ITINVENT"},
    )

    assert response.status_code == 200
    assert created["db_id"] == "ITINVENT"


def test_transfer_act_job_read_matches_request_database(monkeypatch):
    _stub_database_resolution(monkeypatch)
    job = {"id": "job-9", "db_id": "OBJ-ITINVENT", "user_id": 93, "status": "done"}
    monkeypatch.setattr(equipment_api.transfer_act_job_service, "get_job", lambda _job_id: job)
    monkeypatch.setattr(
        equipment_api.transfer_act_job_service,
        "response_payload",
        lambda _job_id: {
            "success_count": 1,
            "failed_count": 0,
            "transferred": [],
            "failed": [],
            "retry_inv_nos": [],
            "acts": [],
        },
    )
    app = FastAPI()
    app.include_router(equipment_api.router, prefix="/equipment")
    app.dependency_overrides[deps.get_current_active_user] = _transfer_writer
    client = TestClient(app)

    persisted_only = client.get("/equipment/transfer/act-jobs/job-9")
    assert persisted_only.status_code == 404

    scoped = client.get(
        "/equipment/transfer/act-jobs/job-9",
        headers={"X-Database-ID": "OBJ-ITINVENT"},
    )
    assert scoped.status_code == 200
    assert scoped.json()["success_count"] == 1


def test_transfer_email_owner_lookup_uses_request_database(monkeypatch):
    captured: dict = {}
    _stub_database_resolution(monkeypatch)
    monkeypatch.setattr(
        equipment_api.queries,
        "get_owner_email_by_no",
        lambda owner_no, db_id=None: captured.update(owner_no=owner_no, db_id=db_id) or "user@example.com",
    )

    async def fake_send_transfer_acts_email(**_kwargs):
        return {"success_count": 1, "failed_count": 0, "errors": []}

    monkeypatch.setattr(equipment_api, "send_transfer_acts_email", fake_send_transfer_acts_email)
    app = FastAPI()
    app.include_router(equipment_api.router, prefix="/equipment")
    app.dependency_overrides[deps.get_current_active_user] = _admin

    response = TestClient(app).post(
        "/equipment/transfer/email",
        json={"act_ids": ["act-1"], "mode": "employee", "owner_no": 5},
        headers={"X-Database-ID": "OBJ-ITINVENT"},
    )

    assert response.status_code == 200
    assert captured == {"owner_no": 5, "db_id": "OBJ-ITINVENT"}
