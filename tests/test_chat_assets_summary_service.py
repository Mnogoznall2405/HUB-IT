from __future__ import annotations

import importlib
import io
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

chat_db_module = importlib.import_module("backend.chat.db")
chat_service_module = importlib.import_module("backend.chat.service")
hub_service_module = importlib.import_module("backend.services.hub_service")


def _raw_user(user_id: int, username: str, full_name: str, role: str, *, active: bool = True) -> dict:
    return {
        "id": user_id,
        "username": username,
        "full_name": full_name,
        "role": role,
        "is_active": active,
        "use_custom_permissions": False,
        "custom_permissions": [],
        "permissions": [],
    }


def _upload(name: str, payload: bytes, content_type: str) -> SimpleNamespace:
    return SimpleNamespace(
        filename=name,
        content_type=content_type,
        file=io.BytesIO(payload),
    )


@pytest.fixture
def chat_env(temp_dir, monkeypatch):
    raw_users = {
        1: _raw_user(1, "author", "Task Author", "operator"),
        2: _raw_user(2, "assignee", "Task Assignee", "operator"),
        3: _raw_user(3, "controller", "Task Controller", "admin"),
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
    actor = {"id": 1, "username": "author", "full_name": "Task Author", "role": "operator"}
    project = hub_service.create_task_project(name="Chat Assets Project", code="CHAT_ASSETS")
    task = hub_service.create_task(
        title="Проверить акт",
        description="Task body",
        assignee_user_id=2,
        controller_user_id=3,
        due_at="2026-03-22T10:00:00Z",
        project_id=project["id"],
        priority="high",
        actor=actor,
    )

    yield {
        "service": service,
        "task": task,
        "direct": service.create_direct_conversation(current_user_id=1, peer_user_id=2),
    }

    chat_db_module._engine = None
    chat_db_module._session_factory = None


def test_conversation_assets_summary_and_browser(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]
    task = chat_env["task"]

    created_image = service.send_files(
        current_user_id=1,
        conversation_id=conversation["id"],
        uploads=[_upload("photo.png", b"png-demo", "image/png")],
    )
    created_pdf = service.send_files(
        current_user_id=1,
        conversation_id=conversation["id"],
        uploads=[_upload("report.pdf", b"%PDF-1.4 demo", "application/pdf")],
    )
    created_text = service.send_files(
        current_user_id=1,
        conversation_id=conversation["id"],
        uploads=[_upload("notes.txt", b"notes", "text/plain")],
    )
    service.send_task_share(
        current_user_id=1,
        conversation_id=conversation["id"],
        task_id=task["id"],
    )

    summary = service.get_conversation_assets_summary(
        current_user_id=2,
        conversation_id=conversation["id"],
    )

    assert summary["photos_count"] == 1
    assert summary["files_count"] == 2
    assert summary["audio_count"] == 0
    assert summary["shared_tasks_count"] == 1
    assert [item["file_name"] for item in summary["recent_photos"]] == ["photo.png"]
    assert [item["file_name"] for item in summary["recent_files"]] == ["notes.txt", "report.pdf"]
    assert summary["recent_photos"][0]["message_id"] == created_image["id"]
    assert summary["recent_files"][0]["kind"] == "file"

    image_browser = service.list_conversation_attachments(
        current_user_id=2,
        conversation_id=conversation["id"],
        kind="image",
        limit=10,
    )
    assert image_browser["has_more"] is False
    assert [item["file_name"] for item in image_browser["items"]] == ["photo.png"]
    assert image_browser["items"][0]["message_id"] == created_image["id"]

    first_files_page = service.list_conversation_attachments(
        current_user_id=2,
        conversation_id=conversation["id"],
        kind="file",
        limit=1,
    )
    assert first_files_page["has_more"] is True
    assert [item["file_name"] for item in first_files_page["items"]] == ["notes.txt"]
    assert first_files_page["items"][0]["message_id"] == created_text["id"]
    assert first_files_page["next_before_attachment_id"]

    second_files_page = service.list_conversation_attachments(
        current_user_id=2,
        conversation_id=conversation["id"],
        kind="file",
        limit=1,
        before_attachment_id=first_files_page["next_before_attachment_id"],
    )
    assert [item["file_name"] for item in second_files_page["items"]] == ["report.pdf"]
    assert second_files_page["items"][0]["message_id"] == created_pdf["id"]
