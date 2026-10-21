"""Manual «reconciled with 1C» mark: permission, idempotency, missing-table behaviour."""
from __future__ import annotations

import runpy
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps  # noqa: E402
from backend.api.v1 import equipment as equipment_api  # noqa: E402
from backend.appdb.db import app_session  # noqa: E402
from backend.services import equipment_one_c_mark_service as marks  # noqa: E402

MIGRATION = ROOT / "WEB-itinvent/backend/alembic/versions/20261020_0138_equipment_one_c_marks.py"


@pytest.fixture
def mark_env(monkeypatch, prebuilt_app_db):
    database_url = f"sqlite:///{prebuilt_app_db.as_posix()}"
    monkeypatch.setattr(marks, "app_session", lambda url=None: app_session(database_url))
    monkeypatch.setattr(marks, "is_app_database_configured", lambda: True)
    marks.reset_table_probe()
    monkeypatch.setattr(
        equipment_api.queries,
        "get_equipment_by_inv",
        lambda inv_no, db_id=None: {"inv_no": inv_no} if str(inv_no).startswith("1") else None,
    )

    current = {"user": SimpleNamespace(username="admin", role="admin", is_active=True)}
    app = FastAPI()
    app.include_router(equipment_api.router, prefix="/equipment")
    app.dependency_overrides[deps.get_current_active_user] = lambda: current["user"]
    app.dependency_overrides[deps.get_request_scoped_database_id] = lambda: "main"

    return SimpleNamespace(
        client=TestClient(app),
        database_url=database_url,
        set_user=lambda name, role, **extra: current.__setitem__(
            "user", SimpleNamespace(username=name, role=role, is_active=True, **extra)
        ),
    )


def test_admin_sets_and_clears_mark_and_keeps_original_author(mark_env):
    client = mark_env.client

    first = client.put("/equipment/1001/one-c-mark", json={"note": "акт 12"})
    assert first.status_code == 200, first.text
    assert first.json()["mark"]["marked_by"] == "admin"

    mark_env.set_user("second_admin", "admin")
    again = client.put("/equipment/1001.0/one-c-mark", json={})
    assert again.status_code == 200, again.text

    listed = client.get("/equipment/one-c-marks").json()["marks"]
    assert list(listed) == ["1001"]
    assert listed["1001"]["marked_by"] == "admin"
    assert listed["1001"]["note"] == "акт 12"
    assert listed["1001"]["marked_at"]

    assert client.delete("/equipment/1001/one-c-mark").json() == {"success": True, "removed": True}
    assert client.delete("/equipment/1001/one-c-mark").json() == {"success": True, "removed": False}
    assert client.get("/equipment/one-c-marks").json() == {"marks": {}}


def test_mark_requires_dedicated_permission_but_listing_needs_only_read(mark_env):
    client = mark_env.client
    mark_env.set_user("op", "operator")

    assert client.put("/equipment/1001/one-c-mark", json={}).status_code == 403
    assert "database.one_c_mark" in client.put("/equipment/1001/one-c-mark", json={}).json()["detail"]
    assert client.delete("/equipment/1001/one-c-mark").status_code == 403
    assert client.get("/equipment/one-c-marks").status_code == 200

    mark_env.set_user(
        "op", "operator", use_custom_permissions=True, custom_permissions=["database.read", "database.one_c_mark"]
    )
    assert client.put("/equipment/1001/one-c-mark", json={}).status_code == 200


def test_unknown_equipment_is_404_and_nothing_is_stored(mark_env):
    client = mark_env.client

    assert client.put("/equipment/9999/one-c-mark", json={}).status_code == 404
    assert client.get("/equipment/one-c-marks").json() == {"marks": {}}


def test_missing_table_lists_empty_and_refuses_writes_with_503(mark_env):
    engine = sa.create_engine(mark_env.database_url)
    with engine.begin() as connection:
        connection.execute(sa.text("DROP TABLE equipment_one_c_marks"))
    marks.reset_table_probe()

    assert mark_env.client.get("/equipment/one-c-marks").json() == {"marks": {}}
    assert mark_env.client.put("/equipment/1001/one-c-mark", json={}).status_code == 503
    assert mark_env.client.delete("/equipment/1001/one-c-mark").status_code == 503


def _migration(connection, scope):
    namespace = runpy.run_path(str(MIGRATION))
    namespace["upgrade"].__globals__["op"] = Operations(MigrationContext.configure(connection))
    namespace["upgrade"].__globals__["_scope"] = lambda: scope
    return namespace


def test_migration_is_repeatable_unique_per_card_and_downgrades_cleanly():
    engine = sa.create_engine("sqlite:///:memory:")
    insert = "INSERT INTO equipment_one_c_marks (db_id, inv_no) VALUES ('main', '1001')"
    with engine.begin() as connection:
        namespace = _migration(connection, "app")
        namespace["upgrade"]()
        namespace["upgrade"]()
        connection.execute(sa.text(insert))
        with pytest.raises(sa.exc.IntegrityError):
            connection.execute(sa.text(insert))
        namespace["downgrade"]()
        namespace["downgrade"]()
        assert not sa.inspect(connection).has_table("equipment_one_c_marks")
        _migration(connection, "chat")["upgrade"]()
        assert sa.inspect(connection).get_table_names() == []


MIGRATION_KIND = ROOT / "WEB-itinvent/backend/alembic/versions/20261020_0141_equipment_one_c_mark_kind.py"


def test_mismatch_mark_needs_comment_and_switching_kind_takes_new_author(mark_env):
    client = mark_env.client

    assert client.put("/equipment/1001/one-c-mark", json={"kind": "mismatch"}).status_code == 400
    assert client.put("/equipment/1001/one-c-mark", json={"kind": "bogus", "note": "x"}).status_code == 400
    assert client.get("/equipment/one-c-marks").json() == {"marks": {}}

    ok = client.put("/equipment/1001/one-c-mark", json={}).json()["mark"]
    assert ok["kind"] == "ok"

    mark_env.set_user("second_admin", "admin")
    bad = client.put("/equipment/1001/one-c-mark", json={"kind": "mismatch", "note": "в 1С 2 шт, в хабе 1"})
    assert bad.status_code == 200, bad.text
    stored = client.get("/equipment/one-c-marks").json()["marks"]["1001"]
    assert (stored["kind"], stored["marked_by"], stored["note"]) == ("mismatch", "second_admin", "в 1С 2 шт, в хабе 1")


def test_without_kind_column_marks_read_as_ok_and_only_mismatch_is_refused(mark_env):
    engine = sa.create_engine(mark_env.database_url)
    with engine.begin() as connection:
        connection.execute(sa.text("ALTER TABLE equipment_one_c_marks DROP COLUMN kind"))
    marks.reset_table_probe()
    client = mark_env.client

    assert client.put("/equipment/1001/one-c-mark", json={"note": "акт"}).status_code == 200
    assert client.put("/equipment/1002/one-c-mark", json={"kind": "mismatch", "note": "нет"}).status_code == 503
    listed = client.get("/equipment/one-c-marks").json()["marks"]
    assert list(listed) == ["1001"] and listed["1001"]["kind"] == "ok"


def test_kind_migration_adds_column_once_keeps_rows_as_ok_and_downgrades():
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        base = runpy.run_path(str(MIGRATION))
        base["upgrade"].__globals__["op"] = Operations(MigrationContext.configure(connection))
        base["upgrade"].__globals__["_scope"] = lambda: "app"
        base["upgrade"]()
        connection.execute(sa.text("INSERT INTO equipment_one_c_marks (db_id, inv_no) VALUES ('main', '1001')"))

        step = runpy.run_path(str(MIGRATION_KIND))
        step["upgrade"].__globals__["op"] = Operations(MigrationContext.configure(connection))
        step["upgrade"].__globals__["_scope"] = lambda: "app"
        step["upgrade"]()
        step["upgrade"]()
        assert connection.execute(sa.text("SELECT kind FROM equipment_one_c_marks")).scalar() == "ok"

        step["downgrade"]()
        step["downgrade"]()
        columns = {column["name"] for column in sa.inspect(connection).get_columns("equipment_one_c_marks")}
        assert "kind" not in columns and "inv_no" in columns
