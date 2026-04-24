from __future__ import annotations

import asyncio
import importlib
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import select


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

chat_db_module = importlib.import_module("backend.chat.db")
chat_models_module = importlib.import_module("backend.chat.models")
chat_push_outbox_service_module = importlib.import_module("backend.chat.push_outbox_service")
chat_push_service_module = importlib.import_module("backend.chat.push_service")
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


@pytest.fixture
def chat_outbox_env(temp_dir, monkeypatch):
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
    conversation = service.create_direct_conversation(current_user_id=1, peer_user_id=2)
    worker = chat_push_outbox_service_module.ChatPushOutboxService()

    yield {
        "service": service,
        "conversation": conversation,
        "worker": worker,
    }

    chat_db_module._engine = None
    chat_db_module._session_factory = None


def _get_outbox_job(message_id: str):
    with chat_db_module.chat_session() as session:
        job = session.execute(
            select(chat_models_module.ChatPushOutbox).where(
                chat_models_module.ChatPushOutbox.message_id == message_id,
            )
        ).scalar_one()
    if job.next_attempt_at is not None and job.next_attempt_at.tzinfo is None:
        job.next_attempt_at = job.next_attempt_at.replace(tzinfo=timezone.utc)
    if job.updated_at is not None and job.updated_at.tzinfo is None:
        job.updated_at = job.updated_at.replace(tzinfo=timezone.utc)
    return job


def test_chat_push_outbox_worker_marks_job_sent_after_success(chat_outbox_env, monkeypatch):
    service = chat_outbox_env["service"]
    conversation = chat_outbox_env["conversation"]
    worker = chat_outbox_env["worker"]

    monkeypatch.setattr(type(chat_push_service_module.chat_push_service), "enabled", property(lambda self: True))
    monkeypatch.setattr(
        chat_push_service_module.chat_push_service,
        "send_chat_message_notification",
        lambda **kwargs: chat_push_service_module.ChatPushSendResult(sent=1),
    )

    created = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="Queued push",
        defer_push_notifications=True,
    )

    result = asyncio.run(worker.poll_once())
    job = _get_outbox_job(created["id"])

    assert result["claimed"] == 1
    assert result["sent"] == 1
    assert job.status == "sent"
    assert int(job.attempt_count or 0) == 1


def test_chat_push_outbox_worker_marks_job_no_subscriptions_without_retry(chat_outbox_env, monkeypatch):
    service = chat_outbox_env["service"]
    conversation = chat_outbox_env["conversation"]
    worker = chat_outbox_env["worker"]

    monkeypatch.setattr(type(chat_push_service_module.chat_push_service), "enabled", property(lambda self: True))
    monkeypatch.setattr(
        chat_push_service_module.chat_push_service,
        "send_chat_message_notification",
        lambda **kwargs: chat_push_service_module.ChatPushSendResult(),
    )

    created = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="Queued push",
        defer_push_notifications=True,
    )

    result = asyncio.run(worker.poll_once())
    job = _get_outbox_job(created["id"])

    assert result["claimed"] == 1
    assert result["no_subscriptions"] == 1
    assert job.status == "no_subscriptions"
    assert int(job.attempt_count or 0) == 1


def test_chat_push_outbox_worker_retries_transient_failures_and_then_marks_terminal_failed(chat_outbox_env, monkeypatch):
    service = chat_outbox_env["service"]
    conversation = chat_outbox_env["conversation"]
    worker = chat_outbox_env["worker"]

    monkeypatch.setenv("CHAT_PUSH_OUTBOX_MAX_ATTEMPTS", "2")
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_RETRY_BASE_SEC", "5")
    monkeypatch.setattr(type(chat_push_service_module.chat_push_service), "enabled", property(lambda self: True))
    monkeypatch.setattr(
        chat_push_service_module.chat_push_service,
        "send_chat_message_notification",
        lambda **kwargs: chat_push_service_module.ChatPushSendResult(failed=1),
    )

    created = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="Queued push",
        defer_push_notifications=True,
    )

    first_result = asyncio.run(worker.poll_once())
    first_job = _get_outbox_job(created["id"])

    assert first_result["claimed"] == 1
    assert first_result["requeued"] == 1
    assert first_job.status == "queued"
    assert int(first_job.attempt_count or 0) == 1
    assert first_job.next_attempt_at > datetime.now(timezone.utc)

    with chat_db_module.chat_session() as session:
        job = session.get(chat_models_module.ChatPushOutbox, int(first_job.id))
        job.next_attempt_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        job.updated_at = datetime.now(timezone.utc)

    second_result = asyncio.run(worker.poll_once())
    second_job = _get_outbox_job(created["id"])

    assert second_result["claimed"] == 1
    assert second_result["failed"] == 1
    assert second_job.status == "failed"
    assert int(second_job.attempt_count or 0) == 2
