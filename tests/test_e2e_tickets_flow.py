"""End-to-end tickets lifecycle through the real HTTP router.

Covers the user-visible flow instead of isolated units:
create a request -> it appears in the list -> open its detail -> move it
through the status state machine -> optimistic locking rejects a stale
writer -> export the XLSX the operator downloads. The real router, real
service and a real SQLite copy of the app schema are used; only the auth
dependency is replaced with a session-less test user.
"""
from __future__ import annotations

import sys
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

import conftest  # noqa: E402
from backend.api import deps  # noqa: E402
from backend.api.v1 import tickets as tickets_api  # noqa: E402
from backend.appdb.models import AppUser  # noqa: E402
from backend.appdb.tickets_models import TicketEmployee, TicketObject  # noqa: E402
from backend.models.auth import User  # noqa: E402

READ_WRITE = ["tickets.read", "tickets.write"]


def _user(user_id: int = 42, permissions: list[str] | None = None) -> User:
    perms = list(permissions if permissions is not None else READ_WRITE)
    return User(
        id=user_id,
        username="ticket-e2e",
        full_name="Ticket E2E",
        role="operator",
        is_active=True,
        permissions=perms,
        use_custom_permissions=True,
        custom_permissions=perms,
        auth_source="local",
    )


@pytest.fixture
def tickets_env(temp_dir, monkeypatch):
    """Tickets router on a fresh SQLite copy of the app schema."""
    from sqlalchemy import create_engine, event
    from sqlalchemy.orm import sessionmaker

    url = f"sqlite:///{(Path(temp_dir) / 'tickets_e2e.db').as_posix()}"

    import backend.appdb.db as appdb
    appdb._engines.clear()
    appdb._session_factories.clear()
    appdb._initialized_schema_urls.clear()

    engine = create_engine(
        url,
        execution_options={"schema_translate_map": {"app": None, "system": None}},
    )

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    conftest.copy_app_metadata_schema_for_url(url)
    SessionLocal = sessionmaker(bind=engine)

    @contextmanager
    def _test_app_session(database_url=None):
        session = SessionLocal()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    monkeypatch.setattr("backend.services.tickets_service.app_session", _test_app_session)

    now = datetime.now(timezone.utc)
    with _test_app_session() as session:
        session.add(AppUser(
            id=42, username="ticket-e2e", full_name="Ticket E2E",
            role="operator", is_active=True, created_at=now, updated_at=now,
        ))
        obj = TicketObject(
            code="KAM", name="Камчатка", region="ДВ",
            is_active=True, created_at=now, updated_at=now,
        )
        emp = TicketEmployee(
            full_name="Иванов Иван Иванович", date_of_birth_enc="",
            status="active", created_at=now, updated_at=now,
        )
        session.add_all([obj, emp])
        session.flush()
        object_id, employee_id = obj.id, emp.id

    app = FastAPI()
    app.include_router(tickets_api.router, prefix="/tickets")
    current = {"user": _user()}
    app.dependency_overrides[deps.get_current_active_user] = lambda: current["user"]
    client = TestClient(app)

    yield client, lambda u: current.update({"user": u}), {"employee_id": employee_id, "object_id": object_id}


def test_ticket_request_lifecycle_over_http(tickets_env):
    client, set_user, seed = tickets_env

    created = client.post(
        "/tickets/requests",
        json={
            "employee_id": seed["employee_id"],
            "object_id": seed["object_id"],
            "departure_date": "2030-01-10",
            "arrival_date": "2030-01-15",
            "route": "Москва — Петропавловск",
            "total_cost": "15000.00",
        },
    )
    assert created.status_code == 201, created.text
    request_id = created.json()["id"]

    listed = client.get("/tickets/requests")
    assert listed.status_code == 200, listed.text
    assert request_id in [r["id"] for r in listed.json()["items"]]

    detail = client.get(f"/tickets/requests/{request_id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["employee_name"] == "Иванов Иван Иванович"

    # A second editor working off a stale page version must lose the write.
    stale = client.patch(
        f"/tickets/requests/{request_id}/status",
        json={"new_status": "at_cashier", "expected_version": 99},
    )
    assert stale.status_code == 409, stale.text

    moved = client.patch(
        f"/tickets/requests/{request_id}/status",
        json={"new_status": "at_cashier", "expected_version": created.json()["version"]},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["status"] == "at_cashier"

    # The state machine rejects jumps that are not in the allowed set.
    illegal = client.patch(
        f"/tickets/requests/{request_id}/status",
        json={"new_status": "refund_needed", "expected_version": moved.json()["version"]},
    )
    assert illegal.status_code == 409, illegal.text

    exported = client.get("/tickets/reports/requests/export")
    assert exported.status_code == 200, exported.text
    assert exported.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument"
    )
    assert len(exported.content) > 1000


def test_ticket_write_requires_write_permission(tickets_env):
    client, set_user, seed = tickets_env
    set_user(_user(permissions=["tickets.read"]))

    denied = client.post(
        "/tickets/requests",
        json={"employee_id": seed["employee_id"], "object_id": seed["object_id"]},
    )
    assert denied.status_code == 403, denied.text


@pytest.mark.parametrize("code", [None, "", "   "])
def test_object_auto_codes_skip_reserved_codes_and_are_unique(tickets_env, code):
    client, set_user, seed = tickets_env
    set_user(_user().model_copy(update={"role": "admin"}))

    reserved = client.post(
        "/tickets/objects",
        json={"code": "O1", "name": "Reserved object", "region": "Test"},
    )
    assert reserved.status_code == 201, reserved.text
    assert reserved.json()["code"] == "O1"

    created = []
    for name in ("Auto object one", "Auto object two"):
        response = client.post(
            "/tickets/objects",
            json={"code": code, "name": name, "region": "Test"},
        )
        assert response.status_code == 201, response.text
        created.append(response.json())

    codes = {row["code"] for row in created}
    assert all(2 <= len(item) <= 10 for item in codes)
    assert len(codes) == 2
    assert "O1" not in codes

    listed = client.get("/tickets/objects")
    assert listed.status_code == 200, listed.text
    listed_ids = {row["id"] for row in listed.json()["items"]}
    assert reserved.json()["id"] in listed_ids
    for row in created:
        assert row["id"] in listed_ids
