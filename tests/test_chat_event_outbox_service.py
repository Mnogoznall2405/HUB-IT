import asyncio
import importlib
import sys
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
chat_event_outbox_service_module = importlib.import_module("backend.chat.event_outbox_service")
chat_realtime_side_effects_module = importlib.import_module("backend.chat.realtime_side_effects")
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
def chat_event_env(temp_dir, monkeypatch):
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
    worker = chat_event_outbox_service_module.ChatEventOutboxService()

    yield {
        "service": service,
        "conversation": conversation,
        "worker": worker,
    }

    chat_db_module._engine = None
    chat_db_module._session_factory = None


def test_chat_event_outbox_dispatcher_publishes_enqueued_message_side_effects(chat_event_env, monkeypatch):
    service = chat_event_env["service"]
    conversation = chat_event_env["conversation"]
    worker = chat_event_env["worker"]

    created = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="Realtime via outbox",
        defer_push_notifications=True,
    )
    jobs = asyncio.run(
        chat_realtime_side_effects_module.build_message_created_event_jobs(
            conversation_id=conversation["id"],
            message_id=created["id"],
        )
    )
    inserted = worker.enqueue_events([
        {
            "event_type": job.event_type,
            "target_scope": job.target_scope,
            "target_user_id": int(job.target_user_id),
            "conversation_id": job.conversation_id,
            "message_id": job.message_id,
            "payload": job.payload,
            "dedupe_key": job.dedupe_key,
        }
        for job in jobs
    ])

    published_events: list[tuple[str, dict]] = []

    async def _publish_inbox_event(**kwargs):
        published_events.append(("inbox", kwargs))
        return None

    async def _publish_conversation_event(**kwargs):
        published_events.append(("conversation", kwargs))
        return None

    monkeypatch.setattr(chat_realtime_side_effects_module.chat_realtime, "publish_inbox_event", _publish_inbox_event)
    monkeypatch.setattr(chat_realtime_side_effects_module.chat_realtime, "publish_conversation_event", _publish_conversation_event)

    result = asyncio.run(worker.poll_once())

    with chat_db_module.chat_session() as session:
        rows = list(session.execute(select(chat_models_module.ChatEventOutbox)).scalars())

    assert inserted == len(jobs)
    assert result["claimed"] == len(jobs)
    assert result["delivered"] == len(jobs)
    assert published_events
    assert any(item[1]["event_type"] == "chat.message.created" for item in published_events)
    assert all(str(row.status) == "delivered" for row in rows)


def test_chat_event_outbox_dispatcher_retries_and_marks_failed_jobs(chat_event_env, monkeypatch):
    conversation = chat_event_env["conversation"]
    worker = chat_event_env["worker"]

    monkeypatch.setenv("CHAT_EVENT_OUTBOX_MAX_ATTEMPTS", "1")
    worker.enqueue_event(
        event_type="chat.ai.run.updated",
        target_scope="both",
        target_user_id=1,
        conversation_id=conversation["id"],
        payload={"conversation_id": conversation["id"], "status": "queued"},
    )

    async def _failing_publish(**kwargs):
        raise RuntimeError("dispatcher is offline")

    monkeypatch.setattr(chat_realtime_side_effects_module.chat_realtime, "publish_inbox_event", _failing_publish)
    monkeypatch.setattr(chat_realtime_side_effects_module.chat_realtime, "publish_conversation_event", _failing_publish)

    result = asyncio.run(worker.poll_once())

    with chat_db_module.chat_session() as session:
        row = session.execute(select(chat_models_module.ChatEventOutbox)).scalar_one()

    assert result["claimed"] == 1
    assert result["failed"] == 1
    assert str(row.status) == "failed"
    assert int(row.attempt_count or 0) == 1
