"""IT objects through the real FastAPI app: ownership, per-section grants and who may change them.

Only the deepest boundaries are replaced: the current user, the user directory and the read of the
objects SQL Server database. Routes, permission dependencies, the service and the app database
(sqlite) are real.
"""
from __future__ import annotations

import runpy
import sys
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import Request
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps  # noqa: E402
from backend.api.v1 import it_objects as it_objects_api  # noqa: E402
from backend.main import app  # noqa: E402
from backend.models.auth import User  # noqa: E402
from backend.services.it_objects_service import ItObjectsService  # noqa: E402

BRANCHES = [{"id": 12, "name": "Объект  Альфа"}, {"id": 13, "name": "Объект Бета"}]
OBJECT_REF = "OBJ-ITINVENT:12"
OTHER_REF = "OBJ-ITINVENT:13"
BASE = "/api/v1/it-objects"

ADMIN, OWNER, COLLEAGUE, VIEWER = 1, 2, 3, 4


def _user(user_id: int, username: str, role: str) -> dict:
    return {
        "id": user_id,
        "username": username,
        "email": f"{username}@zsgp.ru",
        "full_name": username.title(),
        "is_active": True,
        "role": role,
        "permissions": [],
        "use_custom_permissions": False,
        "custom_permissions": [],
        "auth_source": "local",
        "is_2fa_enabled": False,
    }


USERS = {
    ADMIN: _user(ADMIN, "admin_user", "admin"),
    OWNER: _user(OWNER, "owner_user", "operator"),
    COLLEAGUE: _user(COLLEAGUE, "colleague_user", "operator"),
    VIEWER: _user(VIEWER, "viewer_user", "viewer"),
}


def _as(user_id: int) -> dict[str, str]:
    return {"X-Test-User": str(user_id)}


@pytest.fixture
def service(tmp_path):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'it_objects.db').as_posix()}"
    return ItObjectsService(database_url=database_url, source_db_id="OBJ-ITINVENT", branch_reader=lambda db_id: list(BRANCHES))


@pytest.fixture
def client(service, monkeypatch):
    async def current_user(request: Request) -> User:
        return User(**USERS[int(request.headers["X-Test-User"])])

    app.dependency_overrides[deps.get_current_active_user] = current_user
    monkeypatch.setattr(it_objects_api, "get_it_objects_service", lambda: service)
    monkeypatch.setattr(it_objects_api.user_service, "get_by_id", lambda user_id: dict(USERS[int(user_id)]) if int(user_id) in USERS else None)
    try:
        yield TestClient(app, base_url="https://testserver", raise_server_exceptions=False)
    finally:
        app.dependency_overrides.pop(deps.get_current_active_user, None)


def _assign_owner(client, object_ref=OBJECT_REF, owner=OWNER, actor=ADMIN):
    return client.put(f"{BASE}/{object_ref}/owner", json={"user_id": owner}, headers=_as(actor))


def _grant(client, user_id, section="passwords", level="view", actor=OWNER, object_ref=OBJECT_REF):
    return client.put(
        f"{BASE}/{object_ref}/grants",
        json={"user_id": user_id, "section": section, "level": level},
        headers=_as(actor),
    )


def _card(client, actor, object_ref=OBJECT_REF):
    response = client.get(f"{BASE}/{object_ref}", headers=_as(actor))
    assert response.status_code == 200, response.text
    return response.json()


def test_cards_come_from_objects_database_and_owner_gets_every_section(client):
    listed = client.get(BASE, headers=_as(ADMIN))
    assert listed.status_code == 200
    assert [item["name"] for item in listed.json()["items"]] == ["Объект Альфа", "Объект Бета"]
    assert all(item["owner"] is None and item["my_access"]["sections"] == {} for item in listed.json()["items"])
    assert client.get(BASE, headers=_as(COLLEAGUE)).json()["items"] == []  # nothing is theirs yet

    assert _assign_owner(client).status_code == 200

    owner_card = _card(client, OWNER)
    assert owner_card["owner"]["user_id"] == OWNER
    assert owner_card["my_access"] == {
        "is_owner": True,
        "sections": {"passwords": "manage", "computers": "manage", "inventory": "manage", "monitoring": "manage"},
    }
    mine = client.get(BASE, params={"mine": "true"}, headers=_as(OWNER)).json()["items"]
    assert [item["object_ref"] for item in mine] == [OBJECT_REF]
    assert client.get(BASE, params={"mine": "true"}, headers=_as(COLLEAGUE)).json()["items"] == []


def test_non_admins_see_and_open_only_their_own_objects(client):
    assert _assign_owner(client, OBJECT_REF, OWNER).status_code == 200
    assert _assign_owner(client, OTHER_REF, COLLEAGUE).status_code == 200

    assert [item["object_ref"] for item in client.get(BASE, headers=_as(OWNER)).json()["items"]] == [OBJECT_REF]
    assert [item["object_ref"] for item in client.get(BASE, headers=_as(COLLEAGUE)).json()["items"]] == [OTHER_REF]
    assert client.get(f"{BASE}/{OTHER_REF}", headers=_as(OWNER)).status_code == 404

    assert _grant(client, OWNER, section="passwords", actor=COLLEAGUE, object_ref=OTHER_REF).status_code == 200
    assert [item["object_ref"] for item in client.get(BASE, headers=_as(OWNER)).json()["items"]] == [OBJECT_REF, OTHER_REF]
    assert client.get(f"{BASE}/{OTHER_REF}", headers=_as(OWNER)).status_code == 200

    assert [item["object_ref"] for item in client.get(BASE, headers=_as(ADMIN)).json()["items"]] == [OBJECT_REF, OTHER_REF]


def test_an_it_owner_gets_the_objects_permission_whatever_the_role(service, monkeypatch):
    from backend.api import deps
    from backend.appdb.db import app_session
    from backend.services import it_object_owner_access as access

    monkeypatch.setattr(access, "is_app_database_configured", lambda: True)
    monkeypatch.setattr(access, "app_session", lambda: app_session(service._database_url))
    custom = {**USERS[VIEWER], "use_custom_permissions": True, "custom_permissions": []}

    def has_read(user: dict) -> bool:
        return "it_objects.read" in deps.effective_public_permissions(dict(user))

    access.invalidate()
    try:
        assert not has_read(USERS[VIEWER]) and not has_read(custom)

        service.assign_owner(OBJECT_REF, target=USERS[VIEWER], actor_id=ADMIN)
        assert has_read(USERS[VIEWER]) and has_read(custom)
        assert not has_read(USERS[COLLEAGUE]) or USERS[COLLEAGUE]["role"] == "operator"  # operators have it by role anyway

        service.set_object_hidden(OBJECT_REF, hidden=True, actor_id=ADMIN)
        assert not has_read(USERS[VIEWER])  # a deleted object gives nothing
        service.set_object_hidden(OBJECT_REF, hidden=False, actor_id=ADMIN)
        assert has_read(USERS[VIEWER])

        service.clear_owner(OBJECT_REF, actor_id=ADMIN)
        assert not has_read(USERS[VIEWER])
    finally:
        access._owner_ids = frozenset()
        access.invalidate()


def test_reassigning_the_owner_closes_the_previous_one(client, service):
    _assign_owner(client, owner=OWNER)
    _grant(client, COLLEAGUE)
    assert service.can_access(OBJECT_REF, user_id=OWNER, section="computers")

    assert _assign_owner(client, owner=COLLEAGUE).status_code == 200

    card = _card(client, ADMIN)
    assert card["owner"]["user_id"] == COLLEAGUE
    assert not service.can_access(OBJECT_REF, user_id=OWNER, section="computers")
    assert service.can_access(OBJECT_REF, user_id=COLLEAGUE, section="computers", level="manage")


def test_grant_gives_exactly_that_section_and_revoke_takes_effect_at_once(client, service):
    _assign_owner(client)

    assert _grant(client, COLLEAGUE, section="passwords", level="view").status_code == 200

    assert service.can_access(OBJECT_REF, user_id=COLLEAGUE, section="passwords", level="view")
    assert not service.can_access(OBJECT_REF, user_id=COLLEAGUE, section="passwords", level="manage")
    assert not service.can_access(OBJECT_REF, user_id=COLLEAGUE, section="computers")
    assert not service.can_access(OTHER_REF, user_id=COLLEAGUE, section="passwords")
    assert _card(client, COLLEAGUE)["my_access"] == {"is_owner": False, "sections": {"passwords": "view"}}
    assert [item["object_ref"] for item in client.get(BASE, params={"mine": "true"}, headers=_as(COLLEAGUE)).json()["items"]] == [OBJECT_REF]

    assert _grant(client, COLLEAGUE, section="passwords", level="manage").status_code == 200
    assert service.can_access(OBJECT_REF, user_id=COLLEAGUE, section="passwords", level="manage")

    revoked = client.delete(
        f"{BASE}/{OBJECT_REF}/grants", params={"user_id": COLLEAGUE, "section": "passwords"}, headers=_as(OWNER)
    )
    assert revoked.status_code == 200
    assert not service.can_access(OBJECT_REF, user_id=COLLEAGUE, section="passwords")
    assert client.get(f"{BASE}/{OBJECT_REF}", headers=_as(COLLEAGUE)).status_code == 404  # the object is no longer theirs


def test_only_admin_or_the_objects_owner_can_hand_out_access_and_only_admin_to_themselves(client, service):
    _assign_owner(client)

    assert _grant(client, OWNER, actor=OWNER).status_code == 403
    assert _grant(client, VIEWER, actor=COLLEAGUE).status_code == 403
    assert _grant(client, COLLEAGUE, actor=COLLEAGUE).status_code == 403
    assert _assign_owner(client, owner=COLLEAGUE, actor=COLLEAGUE).status_code == 403
    assert not service.can_access(OBJECT_REF, user_id=COLLEAGUE, section="passwords")

    # An owner of another object has no say here either.
    _assign_owner(client, object_ref=OTHER_REF, owner=COLLEAGUE)
    assert _grant(client, VIEWER, actor=COLLEAGUE).status_code == 403
    assert _grant(client, VIEWER, actor=ADMIN).status_code == 200


def _set_access(client, user_id, sections, actor=OWNER, object_ref=OBJECT_REF):
    return client.put(f"{BASE}/{object_ref}/access/{user_id}", json={"sections": sections}, headers=_as(actor))


def _audit_actions(service):
    from backend.appdb.models import AppItObjectAudit
    from backend.appdb.db import app_session

    with app_session(service._database_url) as session:
        rows = session.query(AppItObjectAudit).order_by(AppItObjectAudit.id).all()
        return [(row.action, row.section) for row in rows]


def test_one_call_sets_a_persons_access_to_all_sections_and_audits_only_real_changes(client, service):
    _assign_owner(client)
    baseline = len(_audit_actions(service))

    response = _set_access(client, COLLEAGUE, {"passwords": "view", "computers": "manage", "inventory": "view"})
    assert response.status_code == 200, response.text
    assert _card(client, COLLEAGUE)["my_access"]["sections"] == {
        "passwords": "view", "computers": "manage", "inventory": "view",
    }

    # Same map again changes nothing and writes nothing; one section goes to null and is taken away.
    assert _set_access(client, COLLEAGUE, {"passwords": "view", "computers": "manage", "inventory": "view"}).status_code == 200
    assert len(_audit_actions(service)) == baseline + 3
    assert _set_access(client, COLLEAGUE, {"passwords": "view", "computers": None, "inventory": "manage"}).status_code == 200
    assert _card(client, COLLEAGUE)["my_access"]["sections"] == {"passwords": "view", "inventory": "manage"}
    assert _audit_actions(service)[baseline + 3:] == [("grant_revoked", "computers"), ("grant_set", "inventory")]

    # A section left out of the map stays as it was.
    assert _set_access(client, COLLEAGUE, {"passwords": None}).status_code == 200
    assert _card(client, COLLEAGUE)["my_access"]["sections"] == {"inventory": "manage"}
    assert _set_access(client, COLLEAGUE, {"passwords": None, "computers": None, "inventory": None}).status_code == 200
    assert client.get(f"{BASE}/{OBJECT_REF}", headers=_as(COLLEAGUE)).status_code == 404


def test_batch_access_follows_the_same_rules_as_single_grants(client, service):
    _assign_owner(client)
    everything = {"passwords": "view", "computers": "view", "inventory": "view"}

    assert _set_access(client, VIEWER, everything, actor=COLLEAGUE).status_code == 403
    assert _set_access(client, COLLEAGUE, everything, actor=COLLEAGUE).status_code == 403
    assert _set_access(client, COLLEAGUE, {"secrets": "view"}).status_code == 400
    assert _set_access(client, COLLEAGUE, {"passwords": "root"}).status_code == 400
    assert _set_access(client, 999, everything).status_code == 400
    # A bad section next to a good one must not leave the good one half-applied.
    assert _set_access(client, COLLEAGUE, {"passwords": "view", "secrets": "view"}).status_code == 400
    assert not service.can_access(OBJECT_REF, user_id=COLLEAGUE, section="passwords")

    assert _set_access(client, ADMIN, everything, actor=ADMIN).status_code == 200
    assert service.can_access(OBJECT_REF, user_id=ADMIN, section="inventory")


def _create_object(client, name="Новый склад", linked_ref=None, actor=ADMIN):
    body = {"name": name, **({"linked_ref": linked_ref} if linked_ref else {})}
    return client.post(BASE, json=body, headers=_as(actor))


def _listed(client, actor=ADMIN, **params):
    response = client.get(BASE, params=params, headers=_as(actor))
    assert response.status_code == 200, response.text
    return {item["object_ref"]: item for item in response.json()["items"]}


def test_deleting_an_object_hides_it_everywhere_and_restoring_brings_everything_back(client, service):
    _assign_owner(client)
    _grant(client, COLLEAGUE)
    assert _set_access(client, VIEWER, {"inventory": "view"}).status_code == 200
    assert OBJECT_REF in _listed(client, COLLEAGUE, mine="true")

    assert client.delete(f"{BASE}/{OBJECT_REF}", headers=_as(OWNER)).status_code == 403
    assert client.delete(f"{BASE}/{OBJECT_REF}", headers=_as(ADMIN)).status_code == 200

    assert OBJECT_REF not in _listed(client, ADMIN)
    assert OBJECT_REF in _listed(client, ADMIN, hidden="true")
    assert _listed(client, ADMIN, hidden="true")[OBJECT_REF]["hidden"] is True
    assert client.get(BASE, params={"hidden": "true"}, headers=_as(OWNER)).status_code == 403
    assert client.get(f"{BASE}/{OBJECT_REF}", headers=_as(OWNER)).status_code == 404
    assert client.get(f"{BASE}/{OBJECT_REF}", headers=_as(ADMIN)).json()["hidden"] is True
    assert not service.can_access(OBJECT_REF, user_id=OWNER, section="passwords")
    assert not service.can_access(OBJECT_REF, user_id=COLLEAGUE, section="passwords")
    assert service.accessible_object_refs(user_id=OWNER, section="passwords") == set()
    # A deleted object takes no new owner or access until it is restored.
    assert _assign_owner(client, owner=COLLEAGUE).status_code == 409
    assert _set_access(client, VIEWER, {"inventory": "view"}).status_code == 409

    assert client.post(f"{BASE}/{OBJECT_REF}/restore", headers=_as(OWNER)).status_code == 403
    assert client.post(f"{BASE}/{OBJECT_REF}/restore", headers=_as(ADMIN)).status_code == 200
    assert OBJECT_REF in _listed(client, ADMIN) and OBJECT_REF not in _listed(client, ADMIN, hidden="true")
    card = _card(client, OWNER)
    assert card["owner"]["user_id"] == OWNER and card["hidden"] is False
    assert service.can_access(OBJECT_REF, user_id=COLLEAGUE, section="passwords")
    assert {(row["user_id"], row["section"]) for row in _card(client, ADMIN)["grants"]} == {
        (COLLEAGUE, "passwords"), (VIEWER, "inventory"),
    }
    assert [action for action, _ in _audit_actions(service) if action.startswith("object_")] == [
        "object_hidden", "object_restored",
    ]


def test_deleting_an_object_nobody_touched_yet_still_hides_it(client):
    assert client.delete(f"{BASE}/{OTHER_REF}", headers=_as(ADMIN)).status_code == 200
    assert OTHER_REF not in _listed(client, ADMIN)
    assert client.delete(f"{BASE}/OBJ-ITINVENT:999", headers=_as(ADMIN)).status_code == 404


def test_admin_adds_an_object_that_can_be_linked_to_an_itinvent_branch(client, service, monkeypatch):
    from backend.database import equipment_db

    assert _create_object(client, actor=OWNER).status_code == 403
    assert _create_object(client, name="x").status_code == 422
    assert _create_object(client, linked_ref="OBJ-ITINVENT:999").status_code == 400

    created = _create_object(client, name="  Новый   склад ")
    assert created.status_code == 201, created.text
    ref = created.json()["object_ref"]
    assert ref.startswith("OBJ-HUB:") and created.json()["name"] == "Новый склад"
    assert _create_object(client, name="новый склад").status_code == 409

    listed = _listed(client, ADMIN)
    assert listed[ref]["custom"] is True and listed[ref]["linked"] is False
    assert listed[OBJECT_REF]["custom"] is False and listed[OBJECT_REF]["linked"] is True
    assert _assign_owner(client, object_ref=ref).status_code == 200
    card = _card(client, OWNER, object_ref=ref)
    assert card["name"] == "Новый склад" and card["custom"] is True and card["linked"] is False
    assert card["my_access"]["sections"] == {"passwords": "manage", "computers": "manage", "inventory": "manage", "monitoring": "manage"}
    assert _set_access(client, COLLEAGUE, {"passwords": "view"}, object_ref=ref).status_code == 200
    assert service.can_access(ref, user_id=COLLEAGUE, section="passwords")
    # Without a branch there is no inventory to show.
    assert client.get(f"{BASE}/{ref}/inventory", headers=_as(OWNER)).status_code == 409

    linked = _create_object(client, name="Альфа, склад", linked_ref=OBJECT_REF)
    assert linked.status_code == 201, linked.text
    linked_ref = linked.json()["object_ref"]
    assert _listed(client, ADMIN)[linked_ref]["linked"] is True
    calls = []

    def by_branch(branch_no, page=1, limit=200, db_id=None):
        calls.append((branch_no, db_id))
        return {"equipment": [], "total": 0, "page": page, "limit": limit, "pages": 1}

    monkeypatch.setattr(equipment_db, "get_equipment_by_branch_no", by_branch)
    _assign_owner(client, object_ref=linked_ref)
    response = client.get(f"{BASE}/{linked_ref}/inventory", headers=_as(OWNER))
    assert response.status_code == 200, response.text
    assert calls == [(12, "OBJ-ITINVENT")] and response.json()["branch_name"] == "Объект  Альфа"

    assert client.delete(f"{BASE}/{linked_ref}", headers=_as(ADMIN)).status_code == 200
    assert linked_ref not in _listed(client, ADMIN) and linked_ref in _listed(client, ADMIN, hidden="true")
    assert client.get(f"{BASE}/{linked_ref}/inventory", headers=_as(OWNER)).status_code == 403


def test_admin_manages_access_but_sees_no_section_without_a_grant(client, service):
    _assign_owner(client)

    card = _card(client, ADMIN)

    assert card["can_manage_owner"] is True and card["can_manage_grants"] is True
    assert card["my_access"] == {"is_owner": False, "sections": {}}
    assert not service.can_access(OBJECT_REF, user_id=ADMIN, section="passwords")

    assert _grant(client, ADMIN, actor=ADMIN).status_code == 200
    assert service.can_access(OBJECT_REF, user_id=ADMIN, section="passwords")
    assert _assign_owner(client, owner=ADMIN, actor=ADMIN).status_code == 200


def test_people_without_the_base_permission_or_with_bad_input_are_refused(client):
    assert client.get(BASE, headers=_as(VIEWER)).status_code == 403
    assert client.get(f"{BASE}/OBJ-ITINVENT:999", headers=_as(OWNER)).status_code == 404
    assert _assign_owner(client, owner=999).status_code == 400
    _assign_owner(client)
    assert _grant(client, COLLEAGUE, section="secrets").status_code == 400
    assert _grant(client, COLLEAGUE, level="root").status_code == 400
    assert client.put(f"{BASE}/{OBJECT_REF}/owner", json={"user_id": COLLEAGUE}, headers=_as(OWNER)).status_code == 403


def test_unavailable_storage_or_objects_database_degrades_to_an_error_response(client, service, monkeypatch):
    def _broken_branches(db_id):
        raise OSError("sql server is down")

    monkeypatch.setattr(service, "_branch_reader", _broken_branches)
    assert client.get(BASE, headers=_as(OWNER)).status_code == 502

    def _no_storage():
        raise RuntimeError("APP_DATABASE_URL is required")

    monkeypatch.setattr(it_objects_api, "get_it_objects_service", _no_storage)
    assert client.get(BASE, headers=_as(OWNER)).status_code == 503


def test_it_objects_migration_up_and_down():
    revision = PROJECT_ROOT / "WEB-itinvent" / "backend" / "alembic" / "versions" / "20261027_0149_it_objects.py"
    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))

        def run(name: str) -> None:
            operation = runpy.run_path(str(revision))[name]
            operation.__globals__["op"] = operations
            operation.__globals__["_scope"] = lambda: "app"
            operation()

        run("upgrade")
        run("upgrade")  # created "if missing": a second run must be a no-op
        inspector = sa.inspect(connection)
        for table in ("it_objects", "it_object_owners", "it_object_grants", "it_object_audit"):
            assert inspector.has_table(table)
        owner_indexes = {item["name"]: item for item in inspector.get_indexes("it_object_owners")}
        assert owner_indexes["uq_app_it_object_active_owner"]["unique"] == 1
        grant_indexes = {item["name"]: item for item in inspector.get_indexes("it_object_grants")}
        assert grant_indexes["uq_app_it_object_active_grant"]["unique"] == 1

        run("downgrade")
        inspector = sa.inspect(connection)
        assert not any(
            inspector.has_table(table) for table in ("it_objects", "it_object_owners", "it_object_grants", "it_object_audit")
        )


def test_linked_ref_migration_up_and_down():
    versions = PROJECT_ROOT / "WEB-itinvent" / "backend" / "alembic" / "versions"
    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))

        def run(file_name: str, name: str) -> None:
            operation = runpy.run_path(str(versions / file_name))[name]
            operation.__globals__["op"] = operations
            operation.__globals__["_scope"] = lambda: "app"
            operation()

        def columns() -> set[str]:
            return {column["name"] for column in sa.inspect(connection).get_columns("it_objects")}

        run("20261027_0149_it_objects.py", "upgrade")
        assert "linked_ref" not in columns()
        run("20261030_0152_it_object_linked_ref.py", "upgrade")
        run("20261030_0152_it_object_linked_ref.py", "upgrade")  # added "if missing": a second run is a no-op
        assert "linked_ref" in columns()
        run("20261030_0152_it_object_linked_ref.py", "downgrade")
        assert "linked_ref" not in columns() and "name" in columns()


def test_team_migration_up_and_down():
    versions = PROJECT_ROOT / "WEB-itinvent" / "backend" / "alembic" / "versions"
    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))

        def run(name: str) -> None:
            operation = runpy.run_path(str(versions / "20261102_0154_it_object_team.py"))[name]
            operation.__globals__["op"] = operations
            operation.__globals__["_scope"] = lambda: "app"
            operation()

        run("upgrade")
        run("upgrade")  # created "if missing": a second run is a no-op
        inspector = sa.inspect(connection)
        indexes = {item["name"]: item for item in inspector.get_indexes("it_object_role_assignments")}
        assert indexes["uq_app_it_object_active_role"]["unique"] == 1
        run("downgrade")
        assert not sa.inspect(connection).has_table("it_object_role_assignments")


def test_object_team_roles_are_versioned_and_only_managers_change_them(client, monkeypatch):
    def person(code, name):
        return {"employee_code": code, "full_name": name, "position": "Инженер", "department": "ПТО"}

    def put(who, roles):
        return client.put(f"{BASE}/{OBJECT_REF}/team", json={"roles": roles}, headers=_as(who))

    def card(who):
        return client.get(f"{BASE}/{OBJECT_REF}", headers=_as(who)).json()

    assert _assign_owner(client).status_code == 200
    assert put(OWNER, {"pto_manager": person("Z1", "Иванов И. И.")}).status_code == 403

    first = put(ADMIN, {"pto_manager": person("Z1", "Иванов И. И."), "chief_project_engineer": person("Z2", "Петров П. П.")})
    assert first.status_code == 200, first.text
    team = {item["role_key"]: item for item in card(ADMIN)["team"]}
    assert team["pto_manager"]["full_name"] == "Иванов И. И." and team["pto_manager"]["position"] == "Инженер"
    assert team["chief_project_engineer"]["employee_code"] == "Z2"

    assert put(ADMIN, {"pto_manager": person("Z3", "Сидоров С. С.")}).status_code == 200
    after = card(ADMIN)
    team = {item["role_key"]: item for item in after["team"]}
    assert team["pto_manager"]["full_name"] == "Сидоров С. С." and team["chief_project_engineer"]["full_name"] == "Петров П. П."
    assert [(item["role_key"], item["full_name"]) for item in after["team_history"]] == [("pto_manager", "Иванов И. И.")]
    assert after["team_history"][0]["valid_to"]

    assert put(ADMIN, {"chief_project_engineer": None}).status_code == 200
    assert "chief_project_engineer" not in {item["role_key"] for item in card(ADMIN)["team"]}

    owner_card = card(OWNER)
    assert [item["role_key"] for item in owner_card["team"]] == ["pto_manager"] and owner_card["team_history"] == []

    assert put(ADMIN, {"site_manager": person("Z4", "Кузнецов К. К.")}).status_code == 400
    assert put(ADMIN, {"pto_manager": {"employee_code": "", "full_name": ""}}).status_code == 422


def test_employee_candidates_come_from_the_zup_directory_for_managers_only(client, monkeypatch):
    from backend.services import company_structure_service

    class Directory:
        def list_leader_candidates(self, query, *, limit=30):
            return {"items": [{"employee_code": "Z1", "full_name": f"Иванов ({query})"}]}

    monkeypatch.setattr(company_structure_service, "get_company_structure_service", lambda: Directory())
    assert client.get(f"{BASE}/employee-candidates", params={"q": "ив"}, headers=_as(OWNER)).status_code == 403
    found = client.get(f"{BASE}/employee-candidates", params={"q": "ив"}, headers=_as(ADMIN))
    assert found.status_code == 200 and found.json()["items"][0]["full_name"] == "Иванов (ив)"


def test_object_computers_are_the_hosts_of_its_branch_and_need_the_computers_section(client, monkeypatch):
    from backend.api.v1 import inventory

    def host(hostname, database_id, branch_no, source="sql"):
        return {
            "hostname": hostname,
            "database_id": database_id,
            "branch_no": branch_no,
            "assignment_source": source,
            "status": "online",
            "ip_primary": "10.0.0.5",
            "cpu_model": "i5",
            "hardware_signature_secret": "must-not-leak",
        }

    seen = {}

    def collect(**kwargs):
        seen.update(kwargs)
        return [
            host("PC-ALPHA-1", "OBJ-ITINVENT", 12),
            host("PC-BETA-1", "OBJ-ITINVENT", 13),
            host("PC-OTHER-DB", "ITINVENT", 12),
            host("PC-GUESS", "OBJ-ITINVENT", 12, source="network_scope"),
        ]

    monkeypatch.setattr(inventory, "_collect_scoped_computer_records", collect)
    assert _assign_owner(client).status_code == 200

    owner = client.get(f"{BASE}/{OBJECT_REF}/computers", headers=_as(OWNER))
    assert owner.status_code == 200, owner.text
    assert [item["hostname"] for item in owner.json()["items"]] == ["PC-ALPHA-1"]
    assert "hardware_signature_secret" not in owner.json()["items"][0]
    assert seen["db_id_selected"] == "OBJ-ITINVENT" and seen["scope"] == "selected"

    for outsider in (ADMIN, COLLEAGUE, VIEWER):
        assert client.get(f"{BASE}/{OBJECT_REF}/computers", headers=_as(outsider)).status_code in (403,)

    assert _grant(client, COLLEAGUE, section="passwords").status_code == 200
    assert client.get(f"{BASE}/{OBJECT_REF}/computers", headers=_as(COLLEAGUE)).status_code == 403
    assert _grant(client, COLLEAGUE, section="computers").status_code == 200
    granted = client.get(f"{BASE}/{OBJECT_REF}/computers", headers=_as(COLLEAGUE))
    assert [item["hostname"] for item in granted.json()["items"]] == ["PC-ALPHA-1"]

    revoked = client.delete(
        f"{BASE}/{OBJECT_REF}/grants", params={"user_id": COLLEAGUE, "section": "computers"}, headers=_as(OWNER)
    )
    assert revoked.status_code == 200
    assert client.get(f"{BASE}/{OBJECT_REF}/computers", headers=_as(COLLEAGUE)).status_code == 403


def test_object_computer_detail_is_only_for_hosts_of_the_object_and_needs_the_computers_section(client, monkeypatch):
    from backend.api.v1 import inventory

    def host(mac, hostname, branch_no):
        return {"mac_address": mac, "hostname": hostname, "database_id": "OBJ-ITINVENT", "branch_no": branch_no, "assignment_source": "sql"}

    monkeypatch.setattr(
        inventory,
        "_collect_scoped_computer_records",
        lambda **kwargs: [host("AA-BB-CC-DD-EE-01", "PC-ALPHA-1", 12), host("AA-BB-CC-DD-EE-02", "PC-BETA-1", 13)],
    )
    built = {}

    def build(**kwargs):
        built.update(kwargs)
        return {
            "mac_address": kwargs["mac_address"],
            "hostname": "PC-ALPHA-1",
            "cpu_model": "i5",
            "logical_disks": [{"mountpoint": "C:", "total_gb": 237, "free_gb": 90, "secret_path": "must-not-leak"}],
            "hardware_signature_secret": "must-not-leak",
        }

    monkeypatch.setattr(inventory, "_build_computer_detail_payload", build)
    assert _assign_owner(client).status_code == 200
    alpha, beta = f"{BASE}/{OBJECT_REF}/computers/AA-BB-CC-DD-EE-01", f"{BASE}/{OBJECT_REF}/computers/AA-BB-CC-DD-EE-02"

    detail = client.get(alpha, headers=_as(OWNER))
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["cpu_model"] == "i5" and body["logical_disks"][0]["mountpoint"] == "C:"
    assert "hardware_signature_secret" not in body and "secret_path" not in body["logical_disks"][0]
    assert built["db_id_selected"] == "OBJ-ITINVENT" and built["scope"] == "selected"

    assert client.get(beta, headers=_as(OWNER)).status_code == 404  # a host of another object
    for outsider in (ADMIN, COLLEAGUE, VIEWER):
        assert client.get(alpha, headers=_as(outsider)).status_code == 403


def test_object_inventory_is_the_equipment_of_its_branch_number_and_needs_the_inventory_section(client, monkeypatch):
    from backend.database import equipment_db

    calls = []

    def by_branch(branch_no, page=1, limit=200, db_id=None):
        calls.append((branch_no, page, limit, db_id))
        return {
            "equipment": [{"ID": 7, "INV_NO": "4711", "type_name": "Монитор", "location": "Склад"}],
            "total": 1,
            "page": page,
            "limit": limit,
            "pages": 1,
        }

    monkeypatch.setattr(equipment_db, "get_equipment_by_branch_no", by_branch)
    assert _assign_owner(client).status_code == 200
    url = f"{BASE}/{OBJECT_REF}/inventory"

    owner = client.get(url, params={"page": 2, "limit": 50}, headers=_as(OWNER))
    assert owner.status_code == 200, owner.text
    assert owner.json()["items"] == [{"id": 7, "inv_no": "4711", "type_name": "Монитор", "location": "Склад"}]
    assert calls == [(12, 2, 50, "OBJ-ITINVENT")]
    # The inventory filter needs the branch name exactly as ITINVENT spells it (list names are space-normalised).
    assert owner.json()["branch_name"] == "Объект  Альфа"

    for outsider in (ADMIN, COLLEAGUE, VIEWER):
        assert client.get(url, headers=_as(outsider)).status_code == 403
    assert _grant(client, COLLEAGUE, section="computers").status_code == 200
    assert client.get(url, headers=_as(COLLEAGUE)).status_code == 403
    assert _grant(client, COLLEAGUE, section="inventory").status_code == 200
    assert client.get(url, headers=_as(COLLEAGUE)).status_code == 200
    assert client.get(url, params={"limit": 5000}, headers=_as(OWNER)).status_code == 422
    assert len(calls) == 2


def test_unavailable_inventory_or_computers_source_answers_502_not_500(client, monkeypatch):
    from backend.api.v1 import inventory
    from backend.database import equipment_db

    def boom(*args, **kwargs):
        raise RuntimeError("source is down")

    monkeypatch.setattr(inventory, "_collect_scoped_computer_records", boom)
    monkeypatch.setattr(equipment_db, "get_equipment_by_branch_no", boom)
    assert _assign_owner(client).status_code == 200

    assert client.get(f"{BASE}/{OBJECT_REF}/computers", headers=_as(OWNER)).status_code == 502
    assert client.get(f"{BASE}/{OBJECT_REF}/inventory", headers=_as(OWNER)).status_code == 502
    assert client.get(f"{BASE}/{OBJECT_REF}/computers", headers=_as(ADMIN)).status_code == 403


def test_an_it_owner_sees_only_the_branches_of_his_objects_in_the_inventory(client, service, monkeypatch):
    """Server-side branch scope of «Инвентарь»: search, list, branch directory and card. Admins and non-owners are untouched."""
    from backend.api.v1 import equipment as equipment_api
    from backend.appdb.db import app_session
    from backend.database import equipment_db
    from backend.services import it_object_branch_scope as scope
    from backend.services import it_object_owner_access as access

    for module in (access, scope):
        monkeypatch.setattr(module, "is_app_database_configured", lambda: True)
        monkeypatch.setattr(module, "app_session", lambda: app_session(service._database_url))
    monkeypatch.setattr(scope, "_objects_db_id", lambda: "OBJ-ITINVENT")

    calls: list[dict] = []

    def fake_universal(q, page, limit, db_id, type_no, field, **kwargs):
        calls.append(kwargs)
        return {"equipment": [], "total": 0, "page": 1, "pages": 0}

    items = {"1": {"inv_no": "1", "branch_no": 12}, "2": {"inv_no": "2", "branch_no": 13}}
    directory = [{"id": 12, "name": "Альфа"}, {"id": 13, "name": "Бета"}]
    monkeypatch.setattr(equipment_api.queries, "search_equipment_universal", fake_universal)
    monkeypatch.setattr(equipment_api.queries, "get_equipment_by_inv", lambda inv_no, db_id=None: items.get(inv_no))
    monkeypatch.setattr(equipment_api, "get_equipment_data_version", lambda db_id=None: 0)
    monkeypatch.setattr(equipment_db, "get_all_branches_cached", lambda db_id=None: list(directory))
    monkeypatch.setattr(equipment_db, "get_all_branches", lambda db_id=None: [{"BRANCH_NO": b["id"], "BRANCH_NAME": b["name"]} for b in directory])
    monkeypatch.setattr(
        equipment_db,
        "get_equipment_by_branch",
        lambda name, page=1, limit=1000, db_id=None: {
            "equipment": [dict(row, location="Склад") for row in items.values() if row["branch_no"] == (12 if name == "Альфа" else 13)],
            "total": 1, "page": 1, "limit": limit, "pages": 1, "branch": name, "data_version": 0,
        },
    )
    app.dependency_overrides[deps.get_request_scoped_database_id] = lambda: "OBJ-ITINVENT"
    access.invalidate()
    try:
        service.assign_owner(OBJECT_REF, target=USERS[OWNER], actor_id=ADMIN)
        access.invalidate()

        # IT owner: search is cut to branch 12 in SQL, the directory and the list hold only his branch, the card of another is 404.
        assert client.get("/api/v1/equipment/search/universal", params={"q": "x"}, headers=_as(OWNER)).status_code == 200
        assert calls[-1] == {"branch_nos": [12]}
        assert client.get("/api/v1/equipment/branches", headers=_as(OWNER)).json() == [{"id": 12, "name": "Альфа"}]
        assert [b["BRANCH_NO"] for b in client.get("/api/v1/equipment/branches-list", headers=_as(OWNER)).json()] == [12]
        grouped = client.get("/api/v1/equipment/all-grouped", headers=_as(OWNER)).json()
        assert list(grouped["grouped"]) == ["Альфа"] and grouped["total"] == 1
        assert list(client.get("/api/v1/equipment/all-grouped", params={"branch": "Бета"}, headers=_as(OWNER)).json()["grouped"]) == []
        assert client.get("/api/v1/equipment/1", headers=_as(OWNER)).status_code == 200
        assert client.get("/api/v1/equipment/2", headers=_as(OWNER)).status_code == 404

        # Admin and a colleague who owns nothing keep the full view.
        for user_id in (ADMIN, COLLEAGUE):
            client.get("/api/v1/equipment/search/universal", params={"q": "x"}, headers=_as(user_id))
            assert calls[-1] == {}
            assert len(client.get("/api/v1/equipment/branches", headers=_as(user_id)).json()) == 2
            assert client.get("/api/v1/equipment/2", headers=_as(user_id)).status_code == 200
    finally:
        app.dependency_overrides.pop(deps.get_request_scoped_database_id, None)
        access._owner_ids = frozenset()
        access.invalidate()


def test_the_branch_filter_is_injected_into_the_search_sql_with_its_params_first():
    from backend.database.equipment_search_reads import search_equipment_by_serial, search_equipment_universal

    class Db:
        def __init__(self):
            self.calls = []

        def execute_query(self, query, params=()):
            self.calls.append((query, tuple(params)))
            return [{"total": 1}] if "COUNT(*)" in query else []

    db = Db()
    search_equipment_universal("ab", 1, 10, None, type_no=5, branch_nos=[12, 14], get_db_fn=lambda _: db)
    select_sql, select_params = db.calls[-1]
    assert "i.CI_TYPE = 1 AND i.BRANCH_NO IN (?, ?) AND i.TYPE_NO = ? AND" in select_sql
    assert select_params[:3] == (12, 14, 5) and select_params[-2:] == (0, 10)

    db = Db()
    search_equipment_by_serial("77", None, branch_nos=[], get_db_fn=lambda _: db)
    assert "1 = 0" in db.calls[-1][0]


def test_an_it_owner_sees_only_the_mfu_of_his_branches(client, service, monkeypatch):
    from backend.api.v1 import mfu as mfu_api
    from backend.appdb.db import app_session
    from backend.services import it_object_branch_scope as scope
    from backend.services import it_object_owner_access as access

    for module in (access, scope):
        monkeypatch.setattr(module, "is_app_database_configured", lambda: True)
        monkeypatch.setattr(module, "app_session", lambda: app_session(service._database_url))
    monkeypatch.setattr(scope, "_objects_db_id", lambda: "OBJ-ITINVENT")

    def printer(item_id, branch_no):
        return {"ID": item_id, "INV_NO": str(item_id), "branch_no": branch_no, "branch_name": f"Ф{branch_no}",
                "type_name": "МФУ", "model_name": "LaserJet", "ip_address": f"10.0.0.{item_id}", "location": "Офис"}

    rows = [printer(1, 12), printer(2, 13)]
    monkeypatch.setattr(mfu_api, "get_all_equipment_flat", lambda db_id=None, limit=5000: list(rows))
    mfu_api._mfu_devices_cache.clear()
    app.dependency_overrides[deps.get_current_database_id] = lambda: "OBJ-ITINVENT"
    access.invalidate()
    try:
        service.assign_owner(OBJECT_REF, target=USERS[OWNER], actor_id=ADMIN)
        access.invalidate()

        def listed(user_id):
            response = client.get("/api/v1/mfu/devices", headers=_as(user_id))
            assert response.status_code == 200, response.text
            return sorted(d["inv_no"] for locations in response.json()["grouped"].values() for items in locations.values() for d in items)

        assert listed(OWNER) == ["1"]
        assert listed(ADMIN) == ["1", "2"]
        pages = lambda user_id, key: client.get("/api/v1/mfu/pages/monthly", params={"device_key": key}, headers=_as(user_id)).status_code
        assert pages(OWNER, "OBJ-ITINVENT|1") == 200
        assert pages(OWNER, "OBJ-ITINVENT|2") == 404
        assert pages(ADMIN, "OBJ-ITINVENT|2") == 200
    finally:
        app.dependency_overrides.pop(deps.get_current_database_id, None)
        mfu_api._mfu_devices_cache.clear()
        access._owner_ids = frozenset()
        access.invalidate()


def test_an_it_owner_works_with_consumables_of_his_branches_only(client, service, monkeypatch):
    from backend.api.v1 import equipment as equipment_api
    from backend.appdb.db import app_session
    from backend.database import equipment_db
    from backend.services import it_object_branch_scope as scope
    from backend.services import it_object_owner_access as access

    for module in (access, scope):
        monkeypatch.setattr(module, "is_app_database_configured", lambda: True)
        monkeypatch.setattr(module, "app_session", lambda: app_session(service._database_url))
    monkeypatch.setattr(scope, "_objects_db_id", lambda: "OBJ-ITINVENT")

    cards = {1: {"id": 1, "branch_no": 12, "qty": 3}, 2: {"id": 2, "branch_no": 13, "qty": 5}}
    lookups: list = []

    def fake_lookup(**kwargs):
        lookups.append(kwargs["branch_no"])
        return [dict(card) for card in cards.values() if kwargs["branch_no"] in (None, card["branch_no"])]

    monkeypatch.setattr(equipment_api.queries, "get_consumable_by_id", lambda item_id, db_id=None: cards.get(item_id))
    monkeypatch.setattr(equipment_api.queries, "get_consumables_lookup", fake_lookup)
    monkeypatch.setattr(equipment_api.queries, "get_branch_by_no", lambda branch_no, db_id=None: None)
    monkeypatch.setattr(
        equipment_api.queries, "consume_consumable_stock", lambda **kwargs: {"success": False, "message": "stub"}
    )
    monkeypatch.setattr(
        equipment_db,
        "get_consumables_grouped",
        lambda page=1, limit=1000, db_id=None: {
            "grouped": {"Альфа": {"Склад": [dict(cards[1])]}, "Бета": {"Склад": [dict(cards[2])]}},
            "total": 2, "page": 1, "limit": limit, "pages": 1,
        },
    )
    app.dependency_overrides[deps.get_request_scoped_database_id] = lambda: "OBJ-ITINVENT"
    access.invalidate()
    try:
        service.assign_owner(OBJECT_REF, target=USERS[OWNER], actor_id=ADMIN)
        access.invalidate()
        base = "/api/v1/equipment/consumables"

        grouped = client.get("/api/v1/equipment/consumables-grouped", headers=_as(OWNER)).json()["grouped"]
        assert list(grouped) == ["Альфа"]
        assert len(client.get("/api/v1/equipment/consumables-grouped", headers=_as(ADMIN)).json()["grouped"]) == 2

        assert [row["id"] for row in client.get(f"{base}/lookup", headers=_as(OWNER)).json()] == [1]
        assert lookups[-1] == 12
        assert client.get(f"{base}/lookup", params={"branch_no": "13"}, headers=_as(OWNER)).json() == []
        assert sorted(row["id"] for row in client.get(f"{base}/lookup", headers=_as(ADMIN)).json()) == [1, 2]

        create = {"branch_no": 13, "loc_no": 1, "type_no": 1, "qty": 1, "model_name": "x"}
        assert client.post(f"{base}/create", json=create, headers=_as(OWNER)).status_code == 403
        assert client.post(f"{base}/create", json={**create, "branch_no": 12}, headers=_as(OWNER)).status_code == 400  # past the scope check
        assert client.post(f"{base}/create", json=create, headers=_as(ADMIN)).status_code == 400

        assert client.post(f"{base}/consume", json={"item_id": 2, "qty": 1}, headers=_as(OWNER)).status_code == 404
        assert client.post(f"{base}/consume", json={"item_id": 1, "qty": 1}, headers=_as(OWNER)).status_code == 400
        assert client.post(f"{base}/consume", json={"inv_no": "7", "qty": 1}, headers=_as(OWNER)).status_code == 400
        assert client.patch(f"{base}/qty", json={"item_id": 2, "qty": 1}, headers=_as(OWNER)).status_code == 404
        assert client.get(f"{base}/2", headers=_as(OWNER)).status_code == 404
        assert client.get(f"{base}/2", headers=_as(ADMIN)).status_code != 404
    finally:
        app.dependency_overrides.pop(deps.get_request_scoped_database_id, None)
        access._owner_ids = frozenset()
        access.invalidate()


def test_an_it_owner_sees_only_the_computers_of_his_branches(client, service, monkeypatch):
    from backend.api.v1 import inventory as inventory_api
    from backend.appdb.db import app_session
    from backend.services import it_object_branch_scope as scope
    from backend.services import it_object_owner_access as access

    for module in (access, scope):
        monkeypatch.setattr(module, "is_app_database_configured", lambda: True)
        monkeypatch.setattr(module, "app_session", lambda: app_session(service._database_url))
    monkeypatch.setattr(scope, "_objects_db_id", lambda: "OBJ-ITINVENT")

    def host(mac, name, database_id, branch_no):
        return {
            "mac_address": mac, "hostname": name, "database_id": database_id, "branch_no": branch_no,
            "assignment_source": "sql", "status": "online", "ip_primary": "10.0.0.1", "ip_list": [],
        }

    records = [
        host("AA:00:00:00:00:01", "pc-own", "OBJ-ITINVENT", 12),
        host("AA:00:00:00:00:02", "pc-other-branch", "OBJ-ITINVENT", 13),
        host("AA:00:00:00:00:03", "pc-unassigned", "", None),
        host("AA:00:00:00:00:04", "pc-other-db", "ITINVENT", 5),
    ]
    monkeypatch.setattr(inventory_api, "_collect_all_scoped_computer_records", lambda **kwargs: [dict(r) for r in records])
    access.invalidate()
    try:
        service.assign_owner(OBJECT_REF, target=USERS[OWNER], actor_id=ADMIN)
        access.invalidate()

        def visible(user_id):
            return sorted(r["hostname"] for r in inventory_api._collect_scoped_computer_records(current_user=User(**USERS[user_id])))

        assert visible(OWNER) == ["pc-other-db", "pc-own"]
        assert visible(ADMIN) == sorted(r["hostname"] for r in records)
        assert visible(COLLEAGUE) == sorted(r["hostname"] for r in records)

        # The card of a computer outside the scope is not reachable either.
        owner_user = User(**USERS[OWNER])
        assert scope.computer_allowed(records[0], scope.computer_scope(owner_user))
        assert not scope.computer_allowed(records[1], scope.computer_scope(owner_user))
        assert not scope.computer_allowed(records[2], scope.computer_scope(owner_user))
        assert scope.computer_scope(User(**USERS[ADMIN])) is None
    finally:
        access._owner_ids = frozenset()
        access.invalidate()


def test_an_it_owner_cannot_create_change_move_or_delete_equipment_outside_his_branches(client, service, monkeypatch):
    from backend.api.v1 import equipment as equipment_api
    from backend.appdb.db import app_session
    from backend.services import it_object_branch_scope as scope
    from backend.services import it_object_owner_access as access

    for module in (access, scope):
        monkeypatch.setattr(module, "is_app_database_configured", lambda: True)
        monkeypatch.setattr(module, "app_session", lambda: app_session(service._database_url))
    monkeypatch.setattr(scope, "_objects_db_id", lambda: "OBJ-ITINVENT")

    items = {"1": {"inv_no": "1", "branch_no": 12}, "2": {"inv_no": "2", "branch_no": 13}}
    monkeypatch.setattr(equipment_api.queries, "get_equipment_by_inv", lambda inv_no, db_id=None: items.get(inv_no))
    monkeypatch.setattr(
        equipment_api.queries,
        "get_equipment_items_by_inv_nos",
        lambda inv_nos, db_id=None: [items[i] for i in inv_nos if i in items],
    )
    monkeypatch.setattr(equipment_api.queries, "get_branch_by_no", lambda branch_no, db_id=None: None)
    monkeypatch.setattr(equipment_api.queries, "get_status_by_no", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        equipment_api.queries, "delete_equipment_by_inv", lambda *args, **kwargs: {"success": False, "message": "stub"}
    )
    app.dependency_overrides[deps.get_request_scoped_database_id] = lambda: "OBJ-ITINVENT"
    monkeypatch.setattr(equipment_api, "_run_transfer_job", lambda **kwargs: None)
    access.invalidate()
    try:
        service.assign_owner(OBJECT_REF, target=USERS[OWNER], actor_id=ADMIN)
        access.invalidate()
        base = "/api/v1/equipment"

        create = {"serial_no": "S", "employee_name": "Иван", "branch_no": 13, "loc_no": 1, "type_no": 1, "status_no": 1, "model_name": "m"}
        assert client.post(f"{base}/create", json=create, headers=_as(OWNER)).status_code == 403
        assert client.post(f"{base}/create", json={**create, "branch_no": 12}, headers=_as(OWNER)).status_code == 400  # past the scope check

        assert client.patch(f"{base}/2", json={"status_no": 1}, headers=_as(OWNER)).status_code == 404
        assert client.patch(f"{base}/1", json={"branch_no": 13}, headers=_as(OWNER)).status_code == 403
        assert client.patch(f"{base}/1", json={"status_no": 1}, headers=_as(OWNER)).status_code == 400  # past the scope check

        # delete needs a permission operators lack, so the guard it shares with transfers is checked directly
        import asyncio

        from fastapi import HTTPException

        asyncio.run(equipment_api._ensure_inv_nos_in_scope(["1"], "OBJ-ITINVENT", frozenset({12})))
        with pytest.raises(HTTPException) as denied:
            asyncio.run(equipment_api._ensure_inv_nos_in_scope(["2"], "OBJ-ITINVENT", frozenset({12})))
        assert denied.value.status_code == 403

        move = {"operation_id": "op-scope-0001", "inv_nos": ["2"], "branch_no": 12, "loc_no": 1}
        assert client.post(f"{base}/transfer/location", json=move, headers=_as(OWNER)).status_code == 403
        assert client.post(f"{base}/transfer/location", json={**move, "inv_nos": ["1"], "branch_no": 13}, headers=_as(OWNER)).status_code == 403

        assert client.get(f"{base}/2/history", headers=_as(OWNER)).status_code == 404
        assert client.get(f"{base}/2/acts", headers=_as(OWNER)).status_code == 404
    finally:
        app.dependency_overrides.pop(deps.get_request_scoped_database_id, None)
        access._owner_ids = frozenset()
        access.invalidate()


def test_an_it_owner_reaches_photos_and_acts_of_his_branches_only(client, service, monkeypatch):
    from backend.api.v1 import equipment as equipment_api
    from backend.appdb.db import app_session
    from backend.database import equipment_current_act_reads
    from backend.database.equipment_act_history_reads import list_latest_equipment_acts, search_equipment_acts
    from backend.services import it_object_branch_scope as scope
    from backend.services import it_object_owner_access as access

    for module in (access, scope):
        monkeypatch.setattr(module, "is_app_database_configured", lambda: True)
        monkeypatch.setattr(module, "app_session", lambda: app_session(service._database_url))
    monkeypatch.setattr(scope, "_objects_db_id", lambda: "OBJ-ITINVENT")

    item_branch = {4: 12, 5: 13}
    doc_branch = {1: 12, 2: 13}

    class Db:
        def __init__(self):
            self.calls = []

        def execute_query(self, query, params=()):
            self.calls.append((" ".join(query.split()), tuple(params)))
            params = tuple(params)
            if "FROM ITEMS WHERE ID IN" in query:
                return [{"ID": i} for i in item_branch if i in params and item_branch[i] in params]
            if "FROM DOCS d WHERE d.DOC_NO" in query:
                return [{"DOC_NO": params[0]}] if doc_branch.get(params[0]) in params[1:] else []
            return []

    db = Db()
    monkeypatch.setattr(equipment_api, "get_db", lambda db_id=None: db)
    monkeypatch.setattr(equipment_api.queries, "inspect_equipment_act_storage", lambda **kwargs: {"ok": True})
    seen_items: list = []
    monkeypatch.setattr(
        equipment_current_act_reads, "lookup_current_acts", lambda item_ids, db_id, get_db_fn=None: seen_items.append(list(item_ids)) or {}
    )
    monkeypatch.setattr(equipment_api.equipment_photos, "lookup_equipment_photo_counts", lambda *args, **kwargs: {})
    monkeypatch.setattr(equipment_api.equipment_photo_check_service, "lookup_mark_counts", lambda *args, **kwargs: {})
    def photos_stub(item_id, db_id=None):
        raise equipment_api.equipment_photos.PhotoValidationError("stub")  # 400: past the scope dependency

    monkeypatch.setattr(equipment_api.equipment_photos, "list_equipment_photos", photos_stub)
    app.dependency_overrides[deps.get_request_scoped_database_id] = lambda: "OBJ-ITINVENT"
    access.invalidate()
    try:
        service.assign_owner(OBJECT_REF, target=USERS[OWNER], actor_id=ADMIN)
        access.invalidate()
        base = "/api/v1/equipment"

        assert client.get(f"{base}/5/photos", headers=_as(OWNER)).status_code == 404
        assert client.get(f"{base}/5/photos/1/content", headers=_as(OWNER)).status_code == 404
        assert client.post(f"{base}/5/photo-uploads", json={}, headers=_as(OWNER)).status_code == 404
        assert client.get(f"{base}/4/photos", headers=_as(OWNER)).status_code == 400  # the dependency lets the owner's item through

        assert client.get(f"{base}/acts/2/inspect", headers=_as(OWNER)).status_code == 404
        assert client.get(f"{base}/acts/1/inspect", headers=_as(OWNER)).status_code == 200
        assert client.get(f"{base}/acts/2/inspect", headers=_as(ADMIN)).status_code == 200

        client.post(f"{base}/current-acts", json={"item_ids": [4, 5]}, headers=_as(OWNER))
        client.post(f"{base}/current-acts", json={"item_ids": [4, 5]}, headers=_as(ADMIN))
        assert seen_items == [[4], [4, 5]]
    finally:
        app.dependency_overrides.pop(deps.get_request_scoped_database_id, None)
        access._owner_ids = frozenset()
        access.invalidate()

    # The act feed and the act search carry the branch scope into SQL, params in placeholder order.
    feed_db = Db()
    list_latest_equipment_acts(limit=5, branch_nos=[12, 14], get_db_fn=lambda _: feed_db)
    sql, params = feed_db.calls[0]
    assert "d.BRANCH_NO IN (?, ?)" in sql and "iscope.BRANCH_NO IN (?, ?)" in sql and params == (12, 14, 12, 14)
    search_db = Db()
    search_equipment_acts("55", limit=5, branch_nos=[12], get_db_fn=lambda _: search_db)
    assert search_db.calls[0][1][2:] == (55, 12, 12)
    unscoped = Db()
    list_latest_equipment_acts(limit=5, get_db_fn=lambda _: unscoped)
    assert "iscope" not in unscoped.calls[0][0] and unscoped.calls[0][1] == ()
