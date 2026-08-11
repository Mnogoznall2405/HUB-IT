"""Tests for short send TX, outbox unread, sequence uniqueness, and WS fan-out."""
from __future__ import annotations

import asyncio
import concurrent.futures
import importlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import func, select

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

chat_db_module = importlib.import_module("backend.chat.db")
chat_models_module = importlib.import_module("backend.chat.models")
chat_service_module = importlib.import_module("backend.chat.service")
hub_service_module = importlib.import_module("backend.services.hub_service")
from backend.chat.chat_delivery_state import CHAT_MESSAGE_DELIVERY_STATE_EVENT
from backend.chat.realtime import ChatRealtimeConnection, ChatRealtimeManager


def _raw_user(user_id: int, username: str, full_name: str, role: str) -> dict:
    return {
        "id": user_id,
        "username": username,
        "full_name": full_name,
        "role": role,
        "is_active": True,
        "use_custom_permissions": False,
        "custom_permissions": [],
        "permissions": [],
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
    monkeypatch.setattr(hub_service_module, "hub_service", hub_service)
    monkeypatch.setattr(chat_service_module, "hub_service", hub_service)

    chat_db_module._engine = None
    chat_db_module._session_factory = None
    monkeypatch.setattr(chat_db_module.config.chat, "enabled", True, raising=False)
    monkeypatch.setattr(
        chat_db_module.config.chat,
        "database_url",
        f"sqlite:///{Path(temp_dir) / 'chat.sqlite3'}",
        raising=False,
    )
    monkeypatch.setattr(chat_db_module.config.chat, "pool_size", 5, raising=False)
    monkeypatch.setattr(chat_db_module.config.chat, "max_overflow", 10, raising=False)

    service = chat_service_module.ChatService()
    direct = service.create_direct_conversation(current_user_id=1, peer_user_id=2)
    yield {"service": service, "direct": direct}
    chat_db_module._engine = None
    chat_db_module._session_factory = None


def test_concurrent_sends_get_unique_ordered_sequences(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]

    def _send(index: int) -> dict:
        return service.send_message(
            current_user_id=1,
            conversation_id=conversation["id"],
            body=f"concurrent-{index}",
            client_message_id=f"concurrent-client-{index}",
            defer_push_notifications=True,
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(_send, range(8)))

    assert len({item["id"] for item in results}) == 8
    with chat_db_module.chat_session() as session:
        seqs = list(
            session.execute(
                select(chat_models_module.ChatMessage.conversation_seq)
                .where(chat_models_module.ChatMessage.conversation_id == conversation["id"])
                .order_by(chat_models_module.ChatMessage.conversation_seq.asc())
            ).scalars()
        )
        tip = session.get(chat_models_module.ChatConversation, conversation["id"])
    assert seqs == list(range(1, 9))
    assert int(tip.last_message_seq) == 8


def test_claim_failure_does_not_persist_message(chat_env, monkeypatch):
    service = chat_env["service"]
    conversation = chat_env["direct"]

    def _boom(*_args, **_kwargs):
        raise RuntimeError("forced claim failure")

    monkeypatch.setattr(
        "backend.chat.message_persistence.claim_next_conversation_seq_and_touch",
        _boom,
    )
    with pytest.raises(RuntimeError, match="forced claim failure"):
        service.send_message(
            current_user_id=1,
            conversation_id=conversation["id"],
            body="should fail before commit",
            client_message_id="fail-before-commit",
            defer_push_notifications=True,
        )
    with chat_db_module.chat_session() as session:
        count = session.execute(
            select(func.count())
            .select_from(chat_models_module.ChatMessage)
            .where(chat_models_module.ChatMessage.client_message_id == "fail-before-commit")
        ).scalar_one()
    assert int(count) == 0


def test_text_send_defers_delivery_outbox_and_records_lock_hold(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]
    persisted = service._text_message_persistence.persist_text_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="deferred outbox",
        body_format="plain",
        client_message_id="deferred-outbox-1",
        reply_to_message_id=None,
    )
    assert float(persisted.stage_metrics.get("outbox_insert_ms", -1)) == 0.0
    assert "conversation_lock_hold_ms" in persisted.stage_metrics
    assert float(persisted.stage_metrics["conversation_lock_hold_ms"]) >= 0.0
    deferred = persisted.payload.get("_deferred_delivery_outbox")
    assert isinstance(deferred, dict)
    assert deferred.get("message_id") == persisted.message_id
    with chat_db_module.chat_session() as session:
        outbox_count = session.execute(
            select(func.count())
            .select_from(chat_models_module.ChatEventOutbox)
            .where(chat_models_module.ChatEventOutbox.message_id == persisted.message_id)
        ).scalar_one()
    assert int(outbox_count) == 0

    from backend.chat.event_outbox_service import chat_event_outbox_service

    assert chat_event_outbox_service.enqueue_delivery_state_job_idempotent(deferred) is True
    assert chat_event_outbox_service.enqueue_delivery_state_job_idempotent(deferred) is False
    assert service.apply_delivery_state_for_message(message_id=persisted.message_id) is True


def test_client_message_id_dedup_does_not_create_second_row(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]
    first = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="once",
        client_message_id="dedup-opt",
        defer_push_notifications=True,
    )
    second = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="once",
        client_message_id="dedup-opt",
        defer_push_notifications=True,
    )
    assert first["id"] == second["id"]
    with chat_db_module.chat_session() as session:
        count = session.execute(
            select(func.count())
            .select_from(chat_models_module.ChatMessage)
            .where(chat_models_module.ChatMessage.conversation_id == conversation["id"])
        ).scalar_one()
    assert int(count) == 1


def test_delivery_outbox_unread_is_idempotent(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]
    created = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="delivery outbox",
        client_message_id="delivery-1",
        defer_push_notifications=True,
    )
    # Production enqueues via after-ACK aux TX; unit path calls service.send_message directly.
    from backend.chat.event_outbox_service import chat_event_outbox_service

    deferred = created.pop("_deferred_delivery_outbox", None)
    assert isinstance(deferred, dict)
    assert chat_event_outbox_service.enqueue_delivery_state_job_idempotent(deferred) is True
    assert service.apply_delivery_state_for_message(message_id=created["id"]) is True
    assert service.apply_delivery_state_for_message(message_id=created["id"]) is False

    with chat_db_module.chat_session() as session:
        session.add(
            chat_models_module.ChatEventOutbox(
                event_type=CHAT_MESSAGE_DELIVERY_STATE_EVENT,
                target_scope="system",
                target_user_id=1,
                conversation_id=conversation["id"],
                message_id=created["id"],
                payload_json=json.dumps(
                    {
                        "sender_user_id": 1,
                        "member_user_ids": [1, 2],
                        "conversation_seq": 1,
                    }
                ),
                dedupe_key=f"delivery_state_retry:{created['id']}",
                status="queued",
                attempt_count=0,
            )
        )
    assert service.apply_delivery_state_for_message(message_id=created["id"]) is True
    with chat_db_module.chat_session() as session:
        recipient_state = session.execute(
            select(chat_models_module.ChatConversationUserState).where(
                chat_models_module.ChatConversationUserState.conversation_id == conversation["id"],
                chat_models_module.ChatConversationUserState.user_id == 2,
            )
        ).scalar_one()
    assert int(recipient_state.unread_count) == 1


def test_text_persist_avoids_second_db_session(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]
    opened = {"count": 0}
    original_factory = service._text_message_persistence._session_factory

    class _CountingSessionCtx:
        def __init__(self, inner):
            self._inner = inner

        def __enter__(self):
            opened["count"] += 1
            return self._inner.__enter__()

        def __exit__(self, exc_type, exc, tb):
            return self._inner.__exit__(exc_type, exc, tb)

    service._text_message_persistence._session_factory = lambda: _CountingSessionCtx(original_factory())
    persisted = service._text_message_persistence.persist_text_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="no second session",
        body_format="plain",
        client_message_id="no-second-session",
        reply_to_message_id=None,
    )
    assert opened["count"] == 1
    assert int(persisted.stage_metrics.get("second_db_session") or 0) == 0
    assert persisted.payload.get("body") == "no second session"


@pytest.mark.asyncio
async def test_broadcast_does_not_await_slow_client_send():
    manager = ChatRealtimeManager()
    fast_ws = SimpleNamespace(send_text=AsyncMock(), send_json=AsyncMock())
    slow_ws = SimpleNamespace(
        send_text=AsyncMock(side_effect=lambda *_a, **_k: asyncio.sleep(30)),
        send_json=AsyncMock(side_effect=lambda *_a, **_k: asyncio.sleep(30)),
    )
    fast = ChatRealtimeConnection(id="fast", user_id=1, websocket=fast_ws)
    slow = ChatRealtimeConnection(id="slow", user_id=2, websocket=slow_ws)
    fast.sender_task = asyncio.create_task(manager._run_connection_sender(fast))
    slow.sender_task = asyncio.create_task(manager._run_connection_sender(slow))
    manager._connections = {"fast": fast, "slow": slow}

    started = asyncio.get_running_loop().time()
    await manager._broadcast_local(
        target_connections=[fast, slow],
        envelope={"type": "chat.message.created", "payload": {"id": "m1"}},
        durable=True,
        volatile_key=None,
    )
    elapsed = asyncio.get_running_loop().time() - started
    assert elapsed < 0.5
    assert fast.outbound_queue.qsize() == 1
    assert slow.outbound_queue.qsize() == 1

    await asyncio.sleep(0.05)
    assert fast.outbound_queue.qsize() == 0
    # Slow client may have dequeued and be blocked inside send_*; broadcast itself stayed non-blocking.
    assert slow_ws.send_text.await_count >= 1
    assert fast_ws.send_text.await_count >= 1

    slow.sender_task.cancel()
    fast.sender_task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await slow.sender_task
    with pytest.raises(asyncio.CancelledError):
        await fast.sender_task


@pytest.mark.asyncio
async def test_full_outbound_queue_does_not_block_event_loop():
    manager = ChatRealtimeManager()
    ws = SimpleNamespace(send_text=AsyncMock(), send_json=AsyncMock())
    connection = ChatRealtimeConnection(id="c1", user_id=1, websocket=ws)
    while not connection.outbound_queue.full():
        connection.outbound_queue.put_nowait(('{"type":"x"}', None))
    started = asyncio.get_running_loop().time()
    await manager._broadcast_local(
        target_connections=[connection],
        envelope={"type": "chat.message.created", "payload": {"id": "m2"}},
        durable=True,
        volatile_key=None,
    )
    elapsed = asyncio.get_running_loop().time() - started
    assert elapsed < 0.5
    assert manager._slow_consumer_disconnects >= 1


def test_sender_task_stops_on_cancel():
    async def _run():
        manager = ChatRealtimeManager()
        ws = SimpleNamespace(send_text=AsyncMock(), send_json=AsyncMock())
        connection = ChatRealtimeConnection(id="c2", user_id=3, websocket=ws)
        task = asyncio.create_task(manager._run_connection_sender(connection))
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert task.done()

    asyncio.run(_run())


def test_delivery_outbox_is_deferred_then_enqueued_idempotently(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]
    created = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="outbox row",
        client_message_id="outbox-row-1",
        defer_push_notifications=True,
    )
    with chat_db_module.chat_session() as session:
        count = session.execute(
            select(func.count())
            .select_from(chat_models_module.ChatEventOutbox)
            .where(
                chat_models_module.ChatEventOutbox.message_id == created["id"],
                chat_models_module.ChatEventOutbox.event_type == CHAT_MESSAGE_DELIVERY_STATE_EVENT,
            )
        ).scalar_one()
    assert int(count) == 0
    from backend.chat.event_outbox_service import chat_event_outbox_service

    deferred = created.get("_deferred_delivery_outbox")
    assert isinstance(deferred, dict)
    assert chat_event_outbox_service.enqueue_delivery_state_job_idempotent(deferred) is True
    with chat_db_module.chat_session() as session:
        row = session.execute(
            select(chat_models_module.ChatEventOutbox).where(
                chat_models_module.ChatEventOutbox.message_id == created["id"],
                chat_models_module.ChatEventOutbox.event_type == CHAT_MESSAGE_DELIVERY_STATE_EVENT,
            )
        ).scalar_one()
    assert row.status == "queued"
    assert row.dedupe_key == f"delivery_state:{created['id']}"
    assert chat_event_outbox_service.enqueue_delivery_state_job_idempotent(deferred) is False
