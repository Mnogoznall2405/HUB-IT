"""Passwords of IT objects through the real FastAPI app: who sees, reveals and changes linked entries.

Replaced boundaries: the current user, the user directory, the objects SQL Server read and the
vault unlock/throttle (they need the auth runtime store). Routes, permission dependencies, the vault
service, the IT objects service and the app database (sqlite) are real.
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
from backend.api.v1 import passwords as passwords_api  # noqa: E402
from backend.main import app  # noqa: E402
from backend.models.auth import User  # noqa: E402
from backend.services import password_vault_service as vault_module  # noqa: E402
from backend.services.it_objects_service import ItObjectsService  # noqa: E402
from backend.services.password_vault_service import PasswordVaultService  # noqa: E402

BRANCHES = [{"id": 12, "name": "Объект Альфа"}, {"id": 13, "name": "Объект Бета"}]
OBJECT_REF = "OBJ-ITINVENT:12"
OTHER_REF = "OBJ-ITINVENT:13"
IT_OBJECTS = "/api/v1/it-objects"
VAULT = "/api/v1/passwords"
SECRET = "object-secret-1"

ADMIN, OWNER, COLLEAGUE, VAULT_USER = 1, 2, 3, 5


def _user(user_id: int, username: str, role: str, custom: list[str] | None = None) -> dict:
    return {
        "id": user_id,
        "username": username,
        "email": f"{username}@zsgp.ru",
        "full_name": username.title(),
        "is_active": True,
        "role": role,
        "permissions": list(custom or []),
        "use_custom_permissions": custom is not None,
        "custom_permissions": list(custom or []),
        "auth_source": "local",
        "is_2fa_enabled": False,
    }


USERS = {
    ADMIN: _user(ADMIN, "admin_user", "admin"),
    OWNER: _user(OWNER, "owner_user", "operator"),
    COLLEAGUE: _user(COLLEAGUE, "colleague_user", "operator"),
    # Holds the global vault permissions but has nothing to do with the object.
    VAULT_USER: _user(VAULT_USER, "vault_user", "operator", ["passwords.read", "passwords.write", "it_objects.read"]),
}


def _as(user_id: int) -> dict[str, str]:
    return {"X-Test-User": str(user_id)}


@pytest.fixture
def vault(tmp_path, monkeypatch):
    monkeypatch.setenv("PASSWORD_VAULT_KEY", "test-password-vault-key")
    url = f"sqlite+pysqlite:///{(tmp_path / 'vault.db').as_posix()}"
    objects = ItObjectsService(database_url=url, source_db_id="OBJ-ITINVENT", branch_reader=lambda db_id: list(BRANCHES))
    service = PasswordVaultService(database_url=url)
    monkeypatch.setattr(service, "require_unlocked", lambda **kwargs: "2099-01-01T00:00:00+00:00")
    monkeypatch.setattr(service, "_throttle_reveal", lambda **kwargs: None)
    monkeypatch.setattr(passwords_api, "password_vault_service", service)
    monkeypatch.setattr(passwords_api, "get_it_objects_service", lambda: objects)
    monkeypatch.setattr(vault_module, "get_it_objects_service", lambda database_url=None: objects)
    monkeypatch.setattr(it_objects_api, "get_it_objects_service", lambda: objects)
    monkeypatch.setattr(
        it_objects_api.user_service, "get_by_id", lambda user_id: dict(USERS[int(user_id)]) if int(user_id) in USERS else None
    )
    vault_module._links_state.clear()
    yield service, url
    vault_module._links_state.clear()


@pytest.fixture
def client(vault):
    async def current_user(request: Request) -> User:
        return User(**USERS[int(request.headers["X-Test-User"])])

    app.dependency_overrides[deps.get_current_active_user] = current_user
    app.dependency_overrides[deps.get_current_session_id] = lambda: "session-test"
    app.dependency_overrides[passwords_api.get_current_session_id] = lambda: "session-test"
    try:
        test_client = TestClient(app, base_url="https://testserver", raise_server_exceptions=False)
        created = test_client.post(f"{VAULT}/groups", json={"name": "Серверы"}, headers=_as(ADMIN))
        assert created.status_code == 201, created.text
        yield test_client
    finally:
        for dependency in (deps.get_current_active_user, deps.get_current_session_id, passwords_api.get_current_session_id):
            app.dependency_overrides.pop(dependency, None)


def _assign_owner(client, owner=OWNER, object_ref=OBJECT_REF):
    response = client.put(f"{IT_OBJECTS}/{object_ref}/owner", json={"user_id": owner}, headers=_as(ADMIN))
    assert response.status_code == 200, response.text


def _grant(client, user_id, level="view", object_ref=OBJECT_REF):
    response = client.put(
        f"{IT_OBJECTS}/{object_ref}/grants",
        json={"user_id": user_id, "section": "passwords", "level": level},
        headers=_as(OWNER),
    )
    assert response.status_code == 200, response.text


def _create(client, actor, *, login, object_ref=None, group="Серверы"):
    body = {"group": group, "login": login, "password": SECRET, "tags": ["общий"] if object_ref is None else ["объектный"]}
    if object_ref:
        body["object_ref"] = object_ref
    return client.post(VAULT, json=body, headers=_as(actor))


def _logins(client, actor, **params):
    response = client.get(VAULT, params=params, headers=_as(actor))
    assert response.status_code == 200, response.text
    return response.json()


def _reveal(client, actor, entry_id):
    return client.post(f"{VAULT}/{entry_id}/reveal", json={"purpose": "show"}, headers=_as(actor))


def test_object_password_is_visible_only_to_the_owner_and_grantees_even_for_global_vault_users(client):
    _assign_owner(client)
    created = _create(client, OWNER, login="rega-admin", object_ref=OBJECT_REF)
    assert created.status_code == 201, created.text
    assert created.json()["object_ref"] == OBJECT_REF and created.json()["object_name"] == "Объект Альфа"
    entry_id = created.json()["id"]
    general = _create(client, ADMIN, login="common-admin")
    assert general.status_code == 201, general.text
    general_id = general.json()["id"]

    for outsider in (VAULT_USER, ADMIN):
        listing = _logins(client, outsider)
        assert [item["login"] for item in listing["items"]] == ["common-admin"]
        assert listing["total"] == 1
        assert "объектный" not in listing["tags"]
        assert _logins(client, outsider, object_ref=OBJECT_REF)["items"] == []
        assert _reveal(client, outsider, entry_id).status_code == 404

    owner_listing = _logins(client, OWNER)
    assert [item["login"] for item in owner_listing["items"]] == ["rega-admin"]
    assert owner_listing["items"][0]["object_ref"] == OBJECT_REF
    assert _reveal(client, OWNER, entry_id).json()["password"] == SECRET
    assert _reveal(client, OWNER, general_id).status_code == 404

    audit = client.get(f"{VAULT}/audit", headers=_as(ADMIN))
    assert audit.status_code == 200
    assert entry_id not in {row["entry_id"] for row in audit.json()["items"]}


def test_grant_opens_view_only_and_revoke_closes_it_at_once(client):
    _assign_owner(client)
    entry_id = _create(client, OWNER, login="rega-admin", object_ref=OBJECT_REF).json()["id"]

    assert client.get(VAULT, headers=_as(COLLEAGUE)).status_code == 403
    assert _reveal(client, COLLEAGUE, entry_id).status_code == 403

    _grant(client, COLLEAGUE, level="view")
    assert [item["login"] for item in _logins(client, COLLEAGUE)["items"]] == ["rega-admin"]
    assert _reveal(client, COLLEAGUE, entry_id).json()["password"] == SECRET
    changed = client.patch(f"{VAULT}/{entry_id}", json={"description": "x"}, headers=_as(COLLEAGUE))
    assert changed.status_code == 403
    assert _create(client, COLLEAGUE, login="mine", object_ref=OBJECT_REF).status_code == 403

    revoked = client.delete(
        f"{IT_OBJECTS}/{OBJECT_REF}/grants",
        params={"user_id": COLLEAGUE, "section": "passwords"},
        headers=_as(OWNER),
    )
    assert revoked.status_code == 200, revoked.text
    assert _reveal(client, COLLEAGUE, entry_id).status_code == 403
    assert client.get(VAULT, headers=_as(COLLEAGUE)).status_code == 403


def test_manage_grant_edits_entries_of_the_object_but_cannot_unlink_or_touch_other_objects(client):
    _assign_owner(client)
    _grant(client, COLLEAGUE, level="manage")
    own = _create(client, COLLEAGUE, login="by-grantee", object_ref=OBJECT_REF)
    assert own.status_code == 201, own.text
    entry_id = own.json()["id"]

    edited = client.patch(f"{VAULT}/{entry_id}", json={"description": "updated"}, headers=_as(COLLEAGUE))
    assert edited.status_code == 200, edited.text

    # Moving the entry out of the object publishes it to everyone with the global permission.
    unlink = client.patch(f"{VAULT}/{entry_id}", json={"object_ref": None}, headers=_as(COLLEAGUE))
    assert unlink.status_code == 403
    move = client.patch(f"{VAULT}/{entry_id}", json={"object_ref": OTHER_REF}, headers=_as(COLLEAGUE))
    assert move.status_code == 403
    assert _create(client, COLLEAGUE, login="elsewhere", object_ref=OTHER_REF).status_code == 403

    still_linked = _logins(client, OWNER)["items"]
    assert [(item["login"], item["object_ref"]) for item in still_linked] == [("by-grantee", OBJECT_REF)]

    # Someone with only the global permission neither sees nor changes it.
    assert client.patch(f"{VAULT}/{entry_id}", json={"description": "hijack"}, headers=_as(VAULT_USER)).status_code == 404
    assert client.post(f"{VAULT}/{entry_id}/archive", headers=_as(VAULT_USER)).status_code == 404

    archived = client.post(f"{VAULT}/{entry_id}/archive", headers=_as(COLLEAGUE))
    assert archived.status_code == 200, archived.text


def test_vault_keeps_working_before_the_links_migration_and_refuses_to_link(client, vault):
    _service, url = vault
    assert _create(client, ADMIN, login="common-admin").status_code == 201
    engine = sa.create_engine(url, future=True)
    with engine.begin() as connection:
        connection.execute(sa.text("DROP TABLE it_object_password_links"))
    engine.dispose()
    vault_module._links_state.clear()

    assert [item["login"] for item in _logins(client, ADMIN)["items"]] == ["common-admin"]
    _assign_owner(client)
    refused = _create(client, OWNER, login="rega-admin", object_ref=OBJECT_REF)
    assert refused.status_code in (403, 503), refused.text
    refused_admin = _create(client, ADMIN, login="x", object_ref=OBJECT_REF)
    assert refused_admin.status_code == 503, refused_admin.text


def test_links_migration_up_and_down():
    revision = PROJECT_ROOT / "WEB-itinvent" / "backend" / "alembic" / "versions" / "20261027_0150_it_object_password_links.py"
    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))

        def run(name: str) -> None:
            operation = runpy.run_path(str(revision))[name]
            operation.__globals__["op"] = operations
            operation.__globals__["_scope"] = lambda: "app"
            operation()

        run("upgrade")
        run("upgrade")
        inspector = sa.inspect(connection)
        assert inspector.has_table("it_object_password_links")
        assert {"ix_app_it_object_password_links_object"} <= {item["name"] for item in inspector.get_indexes("it_object_password_links")}
        run("downgrade")
        assert not sa.inspect(connection).has_table("it_object_password_links")
