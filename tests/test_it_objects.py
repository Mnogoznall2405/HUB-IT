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
    listed = client.get(BASE, headers=_as(COLLEAGUE))
    assert listed.status_code == 200
    assert [item["name"] for item in listed.json()["items"]] == ["Объект Альфа", "Объект Бета"]
    assert all(item["owner"] is None and item["my_access"]["sections"] == {} for item in listed.json()["items"])

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
    assert _card(client, COLLEAGUE)["my_access"]["sections"] == {}


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
    assert _card(client, COLLEAGUE)["my_access"]["sections"] == {}


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
