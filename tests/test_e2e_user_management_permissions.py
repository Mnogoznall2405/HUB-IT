"""HIGH-02: delegated user-management permissions over the real router.

Policy: a non-admin holding ``settings.users.manage`` may only create plain
viewers without custom permissions and edit non-secret fields of ordinary
users; roles, existing passwords and permissions stay admin-only; delete is
admin-only; and even an admin cannot escalate their own role/permissions.
Only the deepest boundary (user/session stores) is stubbed.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps  # noqa: E402
from backend.api.v1 import auth  # noqa: E402
from backend.models.auth import User  # noqa: E402
from backend.services.session_service import SessionService  # noqa: E402


def _raw_user(user_id: int, username: str, role: str = "viewer") -> dict:
    return {
        "id": user_id,
        "username": username,
        "email": f"{username}@zsgp.ru",
        "full_name": username.title(),
        "is_active": True,
        "role": role,
        "auth_source": "local",
    }


MANAGER = User(
    id=5,
    username="manager",
    role="operator",
    permissions=["settings.users.manage"],
)
ADMIN = User(id=1, username="root", role="admin")
PLAIN_VIEWER = User(id=8, username="petrov", role="viewer", permissions=[])


@pytest.fixture
def user_mgmt_env(tmp_path, monkeypatch):
    sessions = SessionService(database_url=f"sqlite:///{(tmp_path / 'sessions.db').as_posix()}")
    users = {
        1: _raw_user(1, "root", role="admin"),
        7: _raw_user(7, "ivanov"),
        9: _raw_user(9, "boss", role="admin"),
    }
    create_calls: list[dict] = []
    update_calls: list[tuple[int, dict]] = []
    delete_calls: list[int] = []

    monkeypatch.setattr(auth, "session_service", sessions)
    monkeypatch.setattr(auth.user_service, "get_by_id", lambda user_id: users.get(int(user_id)))

    def fake_create(**fields):
        create_calls.append(dict(fields))
        user_id = max(users) + 1
        record = {"id": user_id, "is_active": True, "auth_source": "local", **fields}
        record.pop("password", None)
        users[user_id] = record
        return dict(record)

    def fake_update(user_id, **fields):
        record = users.get(int(user_id))
        if record is None:
            return None
        record.update(fields)
        update_calls.append((int(user_id), dict(fields)))
        return dict(record)

    def fake_delete(user_id):
        delete_calls.append(int(user_id))
        return users.pop(int(user_id), None) is not None

    monkeypatch.setattr(auth.user_service, "create_user", fake_create)
    monkeypatch.setattr(auth.user_service, "update_user", fake_update)
    monkeypatch.setattr(auth.user_service, "delete_user", fake_delete)
    monkeypatch.setattr(
        auth.mobile_biometric_session_service,
        "revoke_all_user_credentials",
        lambda user_id: 1,
    )

    app = FastAPI()
    app.include_router(auth.router, prefix="/auth")
    client = TestClient(app, raise_server_exceptions=False)

    def act_as(user: User) -> None:
        app.dependency_overrides[deps.get_current_active_user] = lambda: user

    return {
        "app": app,
        "client": client,
        "users": users,
        "act_as": act_as,
        "create_calls": create_calls,
        "update_calls": update_calls,
        "delete_calls": delete_calls,
    }


def test_permission_gate_applies_without_manage_right(user_mgmt_env):
    """Sanity: the route really enforces settings.users.manage — a plain
    viewer never reaches the new policy checks at all."""
    env = user_mgmt_env
    env["act_as"](PLAIN_VIEWER)

    response = env["client"].patch("/auth/users/7", json={"full_name": "New"})

    assert response.status_code == 403
    assert env["update_calls"] == []


def test_manager_cannot_escalate_own_role(user_mgmt_env):
    env = user_mgmt_env
    env["act_as"](MANAGER)

    response = env["client"].patch("/auth/users/5", json={"role": "admin"})

    assert response.status_code == 403
    assert env["update_calls"] == []


def test_manager_cannot_change_admin_password(user_mgmt_env):
    env = user_mgmt_env
    env["act_as"](MANAGER)

    response = env["client"].patch("/auth/users/9", json={"password": "newsecret1"})

    assert response.status_code == 403
    assert env["update_calls"] == []


def test_manager_cannot_create_admin(user_mgmt_env):
    env = user_mgmt_env
    env["act_as"](MANAGER)

    response = env["client"].post(
        "/auth/users", json={"username": "newadmin", "password": "secret1", "role": "admin"}
    )

    assert response.status_code == 403
    assert env["create_calls"] == []


def test_manager_cannot_create_viewer_with_custom_permissions(user_mgmt_env):
    env = user_mgmt_env
    env["act_as"](MANAGER)

    response = env["client"].post(
        "/auth/users",
        json={
            "username": "privileged",
            "password": "secret1",
            "use_custom_permissions": True,
            "custom_permissions": ["equipment.write"],
        },
    )

    assert response.status_code == 403
    assert env["create_calls"] == []


def test_manager_can_edit_non_secret_fields_of_ordinary_user(user_mgmt_env):
    env = user_mgmt_env
    env["act_as"](MANAGER)

    response = env["client"].patch("/auth/users/7", json={"full_name": "New"})

    assert response.status_code == 200, response.text
    assert env["users"][7]["full_name"] == "New"


def test_manager_cannot_edit_admin_metadata(user_mgmt_env):
    """Non-admin must not touch even delegated fields on an admin record."""
    env = user_mgmt_env
    env["act_as"](MANAGER)

    response = env["client"].patch("/auth/users/9", json={"full_name": "New"})

    assert response.status_code == 403
    assert env["update_calls"] == []
    assert env["users"][9]["full_name"] == "Boss"


def test_manager_can_create_plain_viewer(user_mgmt_env):
    env = user_mgmt_env
    env["act_as"](MANAGER)

    response = env["client"].post(
        "/auth/users",
        json={
            "username": "petrov2",
            "password": "secret1",
            "email": "petrov2@zsgp.ru",
            "full_name": "Petr Petrov",
        },
    )

    assert response.status_code == 201, response.text
    assert env["create_calls"] and env["create_calls"][0]["role"] == "viewer"


def test_manager_cannot_delete_user(user_mgmt_env):
    env = user_mgmt_env
    env["act_as"](MANAGER)

    response = env["client"].delete("/auth/users/7")

    assert response.status_code == 403
    assert env["delete_calls"] == []
    assert 7 in env["users"]


def test_admin_can_change_ordinary_user_role(user_mgmt_env):
    env = user_mgmt_env
    env["act_as"](ADMIN)

    response = env["client"].patch("/auth/users/7", json={"role": "admin"})

    assert response.status_code == 200, response.text
    assert env["users"][7]["role"] == "admin"


def test_admin_cannot_change_own_role(user_mgmt_env):
    env = user_mgmt_env
    env["act_as"](ADMIN)

    response = env["client"].patch("/auth/users/1", json={"role": "viewer"})

    assert response.status_code == 403
    assert env["update_calls"] == []


def test_admin_cannot_change_own_custom_permissions(user_mgmt_env):
    env = user_mgmt_env
    env["act_as"](ADMIN)

    response = env["client"].patch(
        "/auth/users/1",
        json={"use_custom_permissions": True, "custom_permissions": ["settings.users.manage"]},
    )

    assert response.status_code == 403
    assert env["update_calls"] == []


def test_admin_can_delete_ordinary_user(user_mgmt_env):
    env = user_mgmt_env
    env["act_as"](ADMIN)

    response = env["client"].delete("/auth/users/7")

    assert response.status_code == 200, response.text
    assert 7 not in env["users"]
