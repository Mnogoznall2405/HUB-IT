"""Д2-9: GET /chat/config отдаёт лимит группы из backend; R30: POST /retry при активном запуске -> 409."""
from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("ENVIRONMENT", "development")

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))


def _user(permissions):
    from backend.models.auth import User

    return User(
        id=99,
        username="operator_user",
        email=None,
        full_name="Operator User",
        role="viewer",
        is_active=True,
        permissions=permissions,
        use_custom_permissions=True,
        custom_permissions=permissions,
        auth_source="local",
        telegram_id=None,
        assigned_database=None,
        mailbox_email=None,
        mailbox_login=None,
        mail_profile_mode="manual",
        mail_signature_html=None,
        mail_is_configured=False,
    )


def _client(permissions):
    deps = importlib.import_module("backend.api.deps")
    chat_api = importlib.import_module("backend.api.v1.chat")
    app = FastAPI()
    app.include_router(chat_api.router, prefix="/chat")
    app.dependency_overrides[deps.get_current_active_user] = lambda: _user(permissions)
    return TestClient(app)


def test_chat_config_returns_group_limit_from_backend(monkeypatch):
    monkeypatch.setenv("CHAT_GROUP_MAX_MEMBERS", "64")
    response = _client(["chat.read"]).get("/chat/config")
    assert response.status_code == 200
    assert response.json() == {"group_max_members": 64, "scheduled_messages_enabled": False}


def test_chat_config_default_limit_is_128(monkeypatch):
    monkeypatch.delenv("CHAT_GROUP_MAX_MEMBERS", raising=False)
    response = _client(["chat.read"]).get("/chat/config")
    assert response.status_code == 200
    assert response.json()["group_max_members"] == 128


def test_retry_route_maps_active_run_to_409(monkeypatch):
    ai_chat_module = importlib.import_module("backend.ai_chat.service")

    def _busy(**kwargs):
        raise ai_chat_module.AiRunConflictError("Ответ ещё готовится")

    monkeypatch.setattr(ai_chat_module.ai_chat_service, "retry_conversation_run", _busy)
    response = _client(["chat.ai.use"]).post("/chat/ai/conversations/conv-1/retry")
    assert response.status_code == 409
    assert response.json()["detail"] == "Ответ ещё готовится"
