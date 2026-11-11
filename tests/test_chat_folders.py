from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps
from backend.api.v1 import chat
from backend.models.auth import User

chat_db_module = importlib.import_module("backend.chat.db")
chat_service_module = importlib.import_module("backend.chat.service")
hub_service_module = importlib.import_module("backend.services.hub_service")


def _raw_user(user_id: int, username: str, full_name: str, role: str) -> dict:
    return {
        "id": user_id,
        "username": username,
        "full_name": full_name,
        "role": role,
        "is_active": True,
        "use_custom_permissions": False,
        "custom_permissions": [],
        "permissions": ["chat.read", "chat.write"],
    }


def _public_user(raw: dict) -> User:
    permissions = list(raw.get("custom_permissions") or raw.get("permissions") or [])
    return User(
        id=int(raw["id"]),
        username=str(raw["username"]),
        email=None,
        full_name=str(raw["full_name"]),
        role=str(raw["role"]),
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
        created_at=None,
        updated_at=None,
        mail_updated_at=None,
    )


@pytest.fixture
def chat_folder_env(temp_dir, monkeypatch):
    raw_users = {
        1: _raw_user(1, "owner", "Folder Owner", "operator"),
        2: _raw_user(2, "peer", "Folder Peer", "operator"),
        3: _raw_user(3, "outsider", "Folder Outsider", "viewer"),
    }
    users_by_id = dict(raw_users)
    store = SimpleNamespace(
        db_path=str(Path(temp_dir) / "hub.sqlite3"),
        data_dir=str(Path(temp_dir) / "hub-data"),
    )
    Path(store.data_dir).mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(hub_service_module, "get_local_store", lambda: store)
    monkeypatch.setattr(hub_service_module, "is_app_database_configured", lambda: False)
    monkeypatch.setattr(hub_service_module.user_service, "list_users", lambda: list(users_by_id.values()))
    monkeypatch.setattr(hub_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))
    monkeypatch.setattr(chat_service_module.user_service, "list_users", lambda: list(users_by_id.values()))
    monkeypatch.setattr(chat_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))
    monkeypatch.setattr(chat_service_module.user_service, "get_users_map_by_ids", lambda user_ids: {
        int(user_id): users_by_id[int(user_id)]
        for user_id in set(user_ids or [])
        if int(user_id) in users_by_id
    })
    monkeypatch.setattr(chat_service_module.user_service, "to_public_user", lambda raw: dict(raw))

    chat_db_module._engine = None
    chat_db_module._session_factory = None
    monkeypatch.setattr(chat_db_module.config.chat, "enabled", True, raising=False)
    monkeypatch.setattr(chat_db_module.config.chat, "database_url", f"sqlite:///{Path(temp_dir) / 'chat.sqlite3'}", raising=False)
    monkeypatch.setattr(chat_db_module.config.chat, "pool_size", 5, raising=False)
    monkeypatch.setattr(chat_db_module.config.chat, "max_overflow", 10, raising=False)

    service = chat_service_module.ChatService()
    monkeypatch.setattr(chat, "chat_service", service)

    app = FastAPI()
    app.include_router(chat.router, prefix="/chat")
    current = {"user": _public_user(raw_users[1])}

    def _override_current_user() -> User:
        return current["user"]

    app.dependency_overrides[deps.get_current_active_user] = _override_current_user
    client = TestClient(app)

    def set_user(user_id: int) -> None:
        current["user"] = _public_user(raw_users[user_id])

    yield {
        "client": client,
        "service": service,
        "set_user": set_user,
    }

    chat_db_module._engine = None
    chat_db_module._session_factory = None


def _create_direct_conversation(service, *, owner_id: int, peer_id: int) -> dict:
    return service.create_direct_conversation(current_user_id=owner_id, peer_user_id=peer_id)


def test_chat_folder_crud_and_membership(chat_folder_env):
    client = chat_folder_env["client"]
    service = chat_folder_env["service"]

    direct = _create_direct_conversation(service, owner_id=1, peer_id=2)
    created = client.post("/chat/folders", json={"name": "Работа"})
    assert created.status_code == 200, created.text
    folder = created.json()["item"]
    assert folder["name"] == "Работа"
    assert folder["conversation_count"] == 0

    added = client.post(f"/chat/folders/{folder['id']}/conversations/{direct['id']}")
    assert added.status_code == 200, added.text
    assert added.json()["item"]["conversation_count"] == 1
    assert direct["id"] in added.json()["item"]["conversation_ids"]

    listed = client.get("/chat/folders")
    assert listed.status_code == 200, listed.text
    payload = listed.json()
    assert len(payload["items"]) == 1
    assert payload["conversation_ids_by_folder"][folder["id"]] == [direct["id"]]

    renamed = client.patch(f"/chat/folders/{folder['id']}", json={"name": "Проекты"})
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["item"]["name"] == "Проекты"

    removed = client.delete(f"/chat/folders/{folder['id']}/conversations/{direct['id']}")
    assert removed.status_code == 200, removed.text
    assert removed.json()["item"]["conversation_count"] == 0

    deleted = client.delete(f"/chat/folders/{folder['id']}")
    assert deleted.status_code == 200, deleted.text
    assert client.get("/chat/folders").json()["items"] == []

    still_there = service.get_conversation(conversation_id=direct["id"], current_user_id=1)
    assert still_there["id"] == direct["id"]


def test_chat_folder_rejects_foreign_folder(chat_folder_env):
    client = chat_folder_env["client"]
    set_user = chat_folder_env["set_user"]

    set_user(1)
    created = client.post("/chat/folders", json={"name": "Личное"})
    folder_id = created.json()["item"]["id"]

    set_user(3)
    denied = client.patch(f"/chat/folders/{folder_id}", json={"name": "Чужая"})
    assert denied.status_code == 404
