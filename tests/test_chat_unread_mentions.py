"""Unread mention counters: delivery-state apply, read cursors, summaries."""
from __future__ import annotations

import importlib
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import func, select

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

pytestmark = pytest.mark.integration

chat_db_module = importlib.import_module("backend.chat.db")
chat_models_module = importlib.import_module("backend.chat.models")
chat_delivery_module = importlib.import_module("backend.chat.chat_delivery_state")
chat_service_module = importlib.import_module("backend.chat.service")
hub_service_module = importlib.import_module("backend.services.hub_service")
event_outbox_module = importlib.import_module("backend.chat.event_outbox_service")

ChatConversation = chat_models_module.ChatConversation
ChatConversationUserState = chat_models_module.ChatConversationUserState
ChatMember = chat_models_module.ChatMember
ChatMessage = chat_models_module.ChatMessage
ChatMessageMention = chat_models_module.ChatMessageMention

NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _reset_chat_db_state() -> None:
    engines = {
        id(engine): engine
        for cache in (chat_db_module._engines, chat_db_module._read_engines)
        for engine in cache.values()
    }
    for engine in engines.values():
        engine.dispose()
    chat_db_module._engine = None
    chat_db_module._session_factory = None
    chat_db_module._read_engine = None
    chat_db_module._read_session_factory = None
    chat_db_module._engines.clear()
    chat_db_module._session_factories.clear()
    chat_db_module._read_engines.clear()
    chat_db_module._read_session_factories.clear()


@pytest.fixture
def chat_db(prebuilt_chat_db, monkeypatch):
    _reset_chat_db_state()
    monkeypatch.setattr(chat_db_module.config.chat, "enabled", True, raising=False)
    monkeypatch.setattr(
        chat_db_module.config.chat,
        "database_url",
        f"sqlite:///{prebuilt_chat_db.as_posix()}",
        raising=False,
    )
    yield
    _reset_chat_db_state()


def _state(session, user_id: int, conversation_id: str = "conv-1") -> ChatConversationUserState:
    session.flush()  # chat sessions run with autoflush=False
    return session.execute(
        select(ChatConversationUserState).where(
            ChatConversationUserState.conversation_id == conversation_id,
            ChatConversationUserState.user_id == int(user_id),
        )
    ).scalar_one()


def _seed_conversation(session, *, member_ids=(1, 2, 3)) -> ChatConversation:
    conversation = ChatConversation(
        id="conv-1",
        kind="group",
        title="Ops",
        created_by_user_id=1,
        last_message_seq=0,
        created_at=NOW,
        updated_at=NOW,
    )
    session.add(conversation)
    for user_id in member_ids:
        session.add(
            ChatMember(
                conversation_id=conversation.id,
                user_id=int(user_id),
                member_role="member",
                joined_at=NOW,
            )
        )
    return conversation


def _add_message(session, *, conversation_id: str = "conv-1", seq: int, sender: int = 1, body: str = "hi") -> ChatMessage:
    message = ChatMessage(
        id=str(uuid4()),
        conversation_id=conversation_id,
        sender_user_id=int(sender),
        kind="text",
        body_format="plain",
        body=body,
        conversation_seq=int(seq),
        created_at=NOW,
    )
    session.add(message)
    session.flush()
    conversation = session.get(ChatConversation, conversation_id)
    conversation.last_message_id = message.id
    conversation.last_message_seq = int(seq)
    conversation.last_message_at = NOW
    return message


def test_delivery_state_creates_mention_rows_and_recounts(chat_db):
    with chat_db_module.chat_session() as session:
        _seed_conversation(session)
        message = _add_message(session, seq=1, body="@assignee hello")

    with chat_db_module.chat_session() as session:
        stats = chat_delivery_module.apply_message_delivery_state_after_commit(
            session=session,
            conversation_id="conv-1",
            message_id=message.id,
            sender_user_id=1,
            member_user_ids=[1, 2, 3],
            conversation_seq=1,
            seen_at=NOW,
            mentioned_user_ids=[2],
        )
        assert int(stats["recipients_updated"]) == 2

    with chat_db_module.chat_session() as session:
        rows = list(
            session.execute(
                select(ChatMessageMention).where(ChatMessageMention.message_id == message.id)
            ).scalars()
        )
        assert len(rows) == 1
        assert int(rows[0].user_id) == 2
        assert int(_state(session, 2).unread_mention_count) == 1
        assert int(_state(session, 3).unread_mention_count) == 0
        # Sender state exists (sender-seen) with both counters zeroed.
        assert int(_state(session, 1).unread_mention_count) == 0
        assert int(_state(session, 1).unread_count) == 0

    # Idempotent re-apply: no duplicate rows, counters unchanged.
    with chat_db_module.chat_session() as session:
        chat_delivery_module.apply_message_delivery_state_after_commit(
            session=session,
            conversation_id="conv-1",
            message_id=message.id,
            sender_user_id=1,
            member_user_ids=[1, 2, 3],
            conversation_seq=1,
            seen_at=NOW,
            mentioned_user_ids=[2],
        )
    with chat_db_module.chat_session() as session:
        assert int(
            session.execute(
                select(func.count(ChatMessageMention.id)).where(
                    ChatMessageMention.message_id == message.id
                )
            ).scalar_one()
        ) == 1
        assert int(_state(session, 2).unread_mention_count) == 1


def test_read_state_recounts_unread_tail(chat_db):
    with chat_db_module.chat_session() as session:
        _seed_conversation(session)
        first = _add_message(session, seq=1, body="@assignee one")
        second = _add_message(session, seq=2, body="@assignee two")
        message_ids = (first.id, second.id)

    for index, message_id in enumerate(message_ids, start=1):
        with chat_db_module.chat_session() as session:
            chat_delivery_module.apply_message_delivery_state_after_commit(
                session=session,
                conversation_id="conv-1",
                message_id=message_id,
                sender_user_id=1,
                member_user_ids=[1, 2, 3],
                conversation_seq=index,
                seen_at=NOW,
                mentioned_user_ids=[2],
            )

    with chat_db_module.chat_session() as session:
        assert int(_state(session, 2).unread_mention_count) == 2
        # Reader advances past seq=1 — only the unread tail (seq=2) still counts.
        changed = chat_delivery_module.advance_conversation_read_state(
            session=session,
            conversation_id="conv-1",
            current_user_id=2,
            message_id=message_ids[0],
            target_seq=1,
            read_at=NOW,
            opened_at=NOW,
        )
        assert changed is True
        session.flush()
        assert int(_state(session, 2).unread_mention_count) == 1

        changed = chat_delivery_module.advance_conversation_read_state(
            session=session,
            conversation_id="conv-1",
            current_user_id=2,
            message_id=message_ids[1],
            target_seq=2,
            read_at=NOW,
            opened_at=NOW,
        )
        assert changed is True
        session.flush()
        assert int(_state(session, 2).unread_mention_count) == 0
        assert int(_state(session, 2).unread_count) == 0


def test_deleted_message_stops_counting(chat_db):
    with chat_db_module.chat_session() as session:
        _seed_conversation(session)
        message = _add_message(session, seq=1, body="@assignee ping")

    with chat_db_module.chat_session() as session:
        chat_delivery_module.apply_message_delivery_state_after_commit(
            session=session,
            conversation_id="conv-1",
            message_id=message.id,
            sender_user_id=1,
            member_user_ids=[1, 2, 3],
            conversation_seq=1,
            seen_at=NOW,
            mentioned_user_ids=[2],
        )
        assert int(_state(session, 2).unread_mention_count) == 1

    with chat_db_module.chat_session() as session:
        row = session.get(ChatMessage, message.id)
        row.is_deleted = True
        row.deleted_at = NOW
        row.deleted_by_user_id = 1
        chat_delivery_module.apply_message_mentions(
            session=session,
            conversation_id="conv-1",
            message_id=message.id,
            mentioned_user_ids=[2],
            seen_at=NOW,
        )
        assert int(_state(session, 2).unread_mention_count) == 0


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
    monkeypatch.setattr(hub_service_module.user_service, "list_users", lambda: list(users))
    monkeypatch.setattr(hub_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))
    monkeypatch.setattr(chat_service_module.user_service, "list_users", lambda: list(users))
    monkeypatch.setattr(chat_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))
    monkeypatch.setattr(
        chat_service_module.user_service,
        "get_users_map_by_ids",
        lambda user_ids: {
            int(user_id): dict(users_by_id[int(user_id)])
            for user_id in list(user_ids or [])
            if int(user_id) in users_by_id
        },
    )
    monkeypatch.setattr(chat_service_module.user_service, "to_public_user", lambda raw: dict(raw))
    monkeypatch.setattr(chat_service_module.session_service, "list_sessions", lambda active_only=False: [])
    monkeypatch.setattr(chat_service_module.session_service, "list_sessions_by_user_ids", lambda user_ids, active_only=False: [])

    hub_service = hub_service_module.HubService()
    monkeypatch.setattr(chat_service_module, "hub_service", hub_service)

    _reset_chat_db_state()
    monkeypatch.setattr(chat_db_module.config.chat, "enabled", True, raising=False)
    monkeypatch.setattr(chat_db_module.config.chat, "database_url", f"sqlite:///{Path(temp_dir) / 'chat.sqlite3'}", raising=False)
    monkeypatch.setattr(chat_db_module.config.chat, "pool_size", 5, raising=False)
    monkeypatch.setattr(chat_db_module.config.chat, "max_overflow", 10, raising=False)

    service = chat_service_module.ChatService()
    direct = service.create_direct_conversation(current_user_id=1, peer_user_id=2)
    yield {"service": service, "direct": direct}
    _reset_chat_db_state()


def _enqueue_and_apply_delivery_state(service, created: dict) -> None:
    deferred = created.pop("_deferred_delivery_outbox", None)
    if isinstance(deferred, dict) and deferred:
        assert event_outbox_module.chat_event_outbox_service.enqueue_delivery_state_job_idempotent(deferred) is True
    assert service.apply_delivery_state_for_message(message_id=created["id"]) is True


def test_send_message_mention_flows_through_outbox(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]

    created = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="@assignee please look",
    )
    assert created.get("mentioned_user_ids") is None  # ack payload is lean
    _enqueue_and_apply_delivery_state(service, created)

    listing = service.list_conversations(current_user_id=2)
    item = next(entry for entry in listing["items"] if entry["id"] == conversation["id"])
    assert int(item["unread_mention_count"]) == 1
    assert int(item["unread_count"]) == 1

    # Sender view has no unread mention badge.
    sender_listing = service.list_conversations(current_user_id=1)
    sender_item = next(entry for entry in sender_listing["items"] if entry["id"] == conversation["id"])
    assert int(sender_item["unread_mention_count"]) == 0

    summaries = service.get_unread_summaries(user_ids=[2])
    assert int(summaries[2]["mentions_unread_total"]) == 1
    assert int(summaries[2]["messages_unread_total"]) == 1

    detail = service.get_conversation(current_user_id=2, conversation_id=conversation["id"])
    assert int(detail["unread_mention_count"]) == 1

    # mark_read clears the badge through advance_conversation_read_state.
    marked = service.mark_read(
        current_user_id=2,
        conversation_id=conversation["id"],
        message_id=created["id"],
    )
    assert marked["changed"] is True
    summaries = service.get_unread_summaries(user_ids=[2])
    assert int(summaries[2]["mentions_unread_total"]) == 0
