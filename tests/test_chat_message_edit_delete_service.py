import pytest

from sqlalchemy import select

from backend.chat import db as chat_db_module
from backend.chat import models as chat_models_module
from backend.chat import service as chat_service_module
from backend.services import hub_service as hub_service_module
from types import SimpleNamespace
from pathlib import Path


def _raw_user(user_id, username, full_name, role):
    return {
        "id": int(user_id),
        "username": username,
        "full_name": full_name,
        "role": role,
        "is_active": True,
        "presence": None,
    }


@pytest.fixture
def chat_env(temp_dir, monkeypatch):
    raw_users = {
        1: _raw_user(1, "author", "Task Author", "operator"),
        2: _raw_user(2, "assignee", "Task Assignee", "operator"),
    }
    users = list(raw_users.values())
    users_by_id = dict(raw_users)
    store = SimpleNamespace(
        db_path=str(Path(temp_dir) / "hub.sqlite3"),
        data_dir=str(Path(temp_dir) / "hub-data"),
    )
    Path(store.data_dir).mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(hub_service_module, "get_local_store", lambda: store)
    monkeypatch.setattr(hub_service_module, "is_app_database_configured", lambda: False)
    monkeypatch.setattr(hub_service_module.user_service, "list_users", lambda: list(users))
    monkeypatch.setattr(hub_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))
    monkeypatch.setattr(chat_service_module.user_service, "list_users", lambda: list(users))
    monkeypatch.setattr(chat_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))
    monkeypatch.setattr(chat_service_module.user_service, "to_public_user", lambda raw: dict(raw))

    hub_service = hub_service_module.HubService()
    monkeypatch.setattr(chat_service_module, "hub_service", hub_service)

    chat_db_module._engine = None
    chat_db_module._session_factory = None
    monkeypatch.setattr(chat_db_module.config.chat, "enabled", True, raising=False)
    monkeypatch.setattr(chat_db_module.config.chat, "database_url", f"sqlite:///{Path(temp_dir) / 'chat.sqlite3'}", raising=False)
    monkeypatch.setattr(chat_db_module.config.chat, "pool_size", 5, raising=False)
    monkeypatch.setattr(chat_db_module.config.chat, "max_overflow", 10, raising=False)

    service = chat_service_module.ChatService()
    direct = service.create_direct_conversation(current_user_id=1, peer_user_id=2)

    yield {
        "service": service,
        "direct": direct,
    }

    chat_db_module._engine = None
    chat_db_module._session_factory = None


def test_edit_and_delete_own_text_message_in_direct_chat(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]

    created = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="Original text",
    )
    assert created["body"] == "Original text"
    assert not created.get("edited_at")

    edited = service.edit_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        message_id=created["id"],
        body="Updated text",
    )
    assert edited["body"] == "Updated text"
    assert edited.get("edited_at")

    peer_view = service.get_messages(current_user_id=2, conversation_id=conversation["id"], limit=20)
    assert peer_view["items"][0]["body"] == "Updated text"

    deleted = service.delete_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        message_id=created["id"],
    )
    assert deleted["is_deleted"] is True
    assert deleted["body"] == "Сообщение удалено"

    with chat_db_module.chat_session() as session:
        messages = list(
            session.execute(
                select(chat_models_module.ChatMessage).where(
                    chat_models_module.ChatMessage.conversation_id == conversation["id"],
                )
            ).scalars()
        )
    assert len(messages) == 1
    assert messages[0].kind == "text"


def test_edit_message_denies_foreign_sender(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]

    created = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="Only author can edit",
    )

    with pytest.raises(PermissionError):
        service.edit_message(
            current_user_id=2,
            conversation_id=conversation["id"],
            message_id=created["id"],
            body="Hacked",
        )
