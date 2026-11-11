"""Шаг C: отключённый пользователь теряет доступ при первой связи с сервером.

Контракт: auth-проверки отвечают 401 + X-Hubit-Auth-Reason: user_inactive.
"""
from __future__ import annotations

import importlib
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps
from backend.api.v1 import auth
from backend.models.auth import User
from backend.services.auth_runtime_store_service import AuthRuntimeStoreService
from backend.services.session_service import SessionService

auth_security_module = importlib.import_module("backend.services.auth_security_service")

_REASON_HEADER = "x-hubit-auth-reason"
_REASON_VALUE = "user_inactive"


def _raw_user(user_id: int = 7, *, is_active: bool = True) -> dict:
    return {
        "id": user_id,
        "username": "ivanov",
        "email": "ivanov@zsgp.ru",
        "full_name": "Ivan Ivanov",
        "is_active": is_active,
        "role": "viewer",
        "auth_source": "local",
    }


def _public_user(**overrides) -> dict:
    payload = {
        "id": 7,
        "username": "ivanov",
        "email": "ivanov@zsgp.ru",
        "full_name": "Ivan Ivanov",
        "is_active": True,
        "role": "viewer",
        "permissions": [],
        "use_custom_permissions": False,
        "custom_permissions": [],
        "auth_source": "local",
    }
    payload.update(overrides)
    return payload


@pytest.fixture
def deactivation_env(tmp_path, monkeypatch):
    store = AuthRuntimeStoreService(database_url=f"sqlite:///{(tmp_path / 'runtime.db').as_posix()}")
    sessions = SessionService(database_url=f"sqlite:///{(tmp_path / 'sessions.db').as_posix()}")
    users = {7: _raw_user(7)}

    monkeypatch.setattr(deps, "auth_runtime_store_service", store)
    monkeypatch.setattr(deps, "session_service", sessions)
    monkeypatch.setattr(deps.user_service, "get_by_id", lambda user_id: users.get(int(user_id)))
    monkeypatch.setattr(
        deps.user_service,
        "get_by_username",
        lambda username: next((u for u in users.values() if u["username"] == username), None),
    )
    monkeypatch.setattr(deps.user_service, "to_public_user", lambda raw: dict(raw))
    monkeypatch.setattr(deps.trusted_device_service, "is_token_device_valid", lambda **kwargs: True)
    monkeypatch.setattr(deps.authorization_service, "get_effective_permissions", lambda *a, **kw: [])

    monkeypatch.setattr(auth, "auth_runtime_store_service", store)
    monkeypatch.setattr(auth, "session_service", sessions)
    monkeypatch.setattr(auth_security_module, "auth_runtime_store_service", store)
    monkeypatch.setattr(auth, "_enforce_rate_limit", lambda **kwargs: None)
    monkeypatch.setattr(auth, "_build_current_user_payload", lambda current_user, request: current_user)

    revoked_biometric: list[int] = []
    deleted_contexts: list[str] = []
    monkeypatch.setattr(
        auth.mobile_biometric_session_service,
        "revoke_all_user_credentials",
        lambda user_id: revoked_biometric.append(int(user_id)) or 1,
    )
    monkeypatch.setattr(
        auth.session_auth_context_service,
        "delete_session_context",
        lambda session_id: deleted_contexts.append(str(session_id or "")),
    )

    app = FastAPI()
    app.include_router(auth.router, prefix="/auth")
    client = TestClient(app, raise_server_exceptions=False)
    return {
        "app": app,
        "client": client,
        "store": store,
        "sessions": sessions,
        "users": users,
        "revoked_biometric": revoked_biometric,
        "deleted_contexts": deleted_contexts,
    }


def _create_session(env, session_id: str = "sess-1") -> None:
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    env["sessions"].create_session(
        session_id=session_id,
        user_id=7,
        username="ivanov",
        role="viewer",
        ip_address="10.0.0.5",
        user_agent="pytest",
        expires_at=expires_at,
    )


def _issue_tokens(env, session_id: str = "sess-1") -> dict:
    return auth.auth_security_service.issue_tokens(
        user=env["users"][7],
        session_id=session_id,
        device_id=f"session:{session_id}",
    )


def test_me_rejects_deactivated_user_with_reason_header(deactivation_env):
    env = deactivation_env
    _create_session(env)
    tokens = _issue_tokens(env)
    env["users"][7]["is_active"] = False

    response = env["client"].get("/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})

    assert response.status_code == 401
    assert response.headers.get(_REASON_HEADER) == _REASON_VALUE
    assert response.headers.get("www-authenticate") == "Bearer"
    assert response.json()["detail"] == "User is not active"


def test_me_reports_reason_when_session_already_closed(deactivation_env):
    """Сессия закрыта при отключении — клиент всё равно получает причину."""
    env = deactivation_env
    _create_session(env)
    tokens = _issue_tokens(env)
    env["users"][7]["is_active"] = False
    env["sessions"].close_session("sess-1")

    response = env["client"].get("/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})

    assert response.status_code == 401
    assert response.headers.get(_REASON_HEADER) == _REASON_VALUE


def test_me_active_user_closed_session_has_no_reason(deactivation_env):
    env = deactivation_env
    _create_session(env)
    tokens = _issue_tokens(env)
    env["sessions"].close_session("sess-1")

    response = env["client"].get("/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})

    assert response.status_code == 401
    assert _REASON_HEADER not in response.headers


def test_me_invalid_token_has_no_reason_header(deactivation_env):
    env = deactivation_env
    response = env["client"].get("/auth/me", headers={"Authorization": "Bearer garbage-token"})

    assert response.status_code == 401
    assert _REASON_HEADER not in response.headers


def test_me_active_user_unchanged(deactivation_env):
    env = deactivation_env
    _create_session(env)
    tokens = _issue_tokens(env)

    response = env["client"].get("/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})

    assert response.status_code == 200
    assert response.json()["username"] == "ivanov"


def test_refresh_rejects_deactivated_user_with_reason(deactivation_env):
    env = deactivation_env
    _create_session(env)
    tokens = _issue_tokens(env)
    env["users"][7]["is_active"] = False
    env["sessions"].close_session("sess-1")

    response = env["client"].post(
        "/auth/refresh",
        headers={"X-Auth-Client": "mobile"},
        json={"refresh_token": tokens["refresh_token"]},
    )

    assert response.status_code == 401
    assert response.headers.get(_REASON_HEADER) == _REASON_VALUE
    assert response.json()["detail"] == "User is not active"


def test_update_user_deactivation_closes_sessions(deactivation_env, monkeypatch):
    env = deactivation_env
    _create_session(env)
    admin = User(**_public_user(id=1, username="admin", role="admin"))
    env["app"].dependency_overrides[deps.get_current_active_user] = lambda: admin

    def fake_update(user_id, **fields):
        env["users"][int(user_id)].update(fields)
        return _public_user(**env["users"][int(user_id)])

    monkeypatch.setattr(auth.user_service, "update_user", fake_update)
    response = env["client"].patch("/auth/users/7", json={"is_active": False})

    assert response.status_code == 200
    assert env["sessions"].is_session_active("sess-1") is False
    assert env["revoked_biometric"] == [7]
    assert "sess-1" in env["deleted_contexts"]


def test_reactivated_user_can_authenticate_again(deactivation_env):
    env = deactivation_env
    env["users"][7]["is_active"] = False
    env["users"][7]["is_active"] = True

    _create_session(env)
    tokens = _issue_tokens(env)
    response = env["client"].get("/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})

    assert response.status_code == 200
    assert response.json()["username"] == "ivanov"
