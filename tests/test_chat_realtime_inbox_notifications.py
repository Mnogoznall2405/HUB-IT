from __future__ import annotations

import asyncio
import importlib
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

chat_api_module = importlib.import_module("backend.api.v1.chat")


def test_publish_message_created_notifies_inbox_and_conversation(monkeypatch):
    inbox_events = []
    conversation_events = []

    async def fake_run_in_threadpool(func, *args, **kwargs):
        return func(*args, **kwargs)

    async def fake_publish_inbox_event(**kwargs):
        inbox_events.append(kwargs)

    async def fake_publish_conversation_event(**kwargs):
        conversation_events.append(kwargs)

    def fake_get_messages_for_users(*, message_id, user_ids):
        return {
            int(user_id): {
                "id": str(message_id),
                "conversation_id": "conv-1",
                "body": f"hello-for-{int(user_id)}",
            }
            for user_id in list(user_ids or [])
        }

    def fake_get_conversation_summaries_for_users(*, conversation_id, user_ids):
        return {
            int(user_id): {
                "id": str(conversation_id),
                "title": f"summary-for-{int(user_id)}",
            }
            for user_id in list(user_ids or [])
        }

    def fake_get_unread_summaries(*, user_ids):
        return {
            int(user_id): {
                "messages_unread_total": int(user_id),
                "conversations_unread": 1,
            }
            for user_id in list(user_ids or [])
        }

    monkeypatch.setattr(chat_api_module, "run_in_threadpool", fake_run_in_threadpool)
    monkeypatch.setattr(chat_api_module.chat_service, "get_messages_for_users", fake_get_messages_for_users)
    monkeypatch.setattr(chat_api_module.chat_service, "get_conversation_summaries_for_users", fake_get_conversation_summaries_for_users)
    monkeypatch.setattr(chat_api_module.chat_service, "get_unread_summaries", fake_get_unread_summaries)
    monkeypatch.setattr(chat_api_module.chat_realtime, "publish_inbox_event", fake_publish_inbox_event)
    monkeypatch.setattr(chat_api_module.chat_realtime, "publish_conversation_event", fake_publish_conversation_event)

    asyncio.run(
        chat_api_module._publish_message_created(
            conversation_id="conv-1",
            message_id="msg-1",
            member_user_ids=[2, 3],
        )
    )

    message_created_events = [
        item for item in inbox_events
        if item["event_type"] == "chat.message.created"
    ]
    assert sorted(item["user_id"] for item in message_created_events) == [2, 3]
    assert all(item["conversation_id"] == "conv-1" for item in message_created_events)

    assert sorted(item["user_id"] for item in conversation_events) == [2, 3]
    assert [item["event_type"] for item in conversation_events] == ["chat.message.created", "chat.message.created"]
    assert all(item["conversation_id"] == "conv-1" for item in conversation_events)

    conversation_update_events = [
        item for item in inbox_events
        if item["event_type"] == "chat.conversation.updated"
    ]
    unread_summary_events = [
        item for item in inbox_events
        if item["event_type"] == "chat.unread.summary"
    ]
    assert sorted(item["user_id"] for item in conversation_update_events) == [2, 3]
    assert sorted(item["user_id"] for item in unread_summary_events) == [2, 3]
    assert all(item["payload"]["reason"] == "message_created" for item in conversation_update_events)
    assert unread_summary_events[0]["payload"]["conversations_unread"] == 1


def test_publish_message_read_uses_compact_delta_and_batched_sidebar_updates(monkeypatch):
    inbox_events = []
    conversation_events = []

    async def fake_run_in_threadpool(func, *args, **kwargs):
        return func(*args, **kwargs)

    async def fake_publish_inbox_event(**kwargs):
        inbox_events.append(kwargs)

    async def fake_publish_conversation_event(**kwargs):
        conversation_events.append(kwargs)

    def fake_get_message_read_delta(*, conversation_id, message_id):
        return {
            "conversation_id": str(conversation_id),
            "message_id": str(message_id),
            "read_by_count": 2,
            "delivery_status": "read",
        }

    def fake_get_conversation_summaries_for_users(*, conversation_id, user_ids):
        return {
            int(user_id): {
                "id": str(conversation_id),
                "title": f"summary-for-{int(user_id)}",
            }
            for user_id in list(user_ids or [])
        }

    def fake_get_unread_summaries(*, user_ids):
        return {
            int(user_id): {
                "messages_unread_total": 0,
                "conversations_unread": 0,
            }
            for user_id in list(user_ids or [])
        }

    monkeypatch.setattr(chat_api_module, "run_in_threadpool", fake_run_in_threadpool)
    monkeypatch.setattr(chat_api_module.chat_service, "get_message_read_delta", fake_get_message_read_delta)
    monkeypatch.setattr(chat_api_module.chat_service, "get_conversation_summaries_for_users", fake_get_conversation_summaries_for_users)
    monkeypatch.setattr(chat_api_module.chat_service, "get_unread_summaries", fake_get_unread_summaries)
    monkeypatch.setattr(chat_api_module.chat_realtime, "publish_inbox_event", fake_publish_inbox_event)
    monkeypatch.setattr(chat_api_module.chat_realtime, "publish_conversation_event", fake_publish_conversation_event)

    asyncio.run(
        chat_api_module._publish_message_read(
            conversation_id="conv-1",
            message_id="msg-1",
            member_user_ids=[2, 3],
            reader_user_id=9,
            read_at="2026-04-18T10:00:00Z",
        )
    )

    assert sorted(item["user_id"] for item in conversation_events) == [2, 3]
    assert all(item["event_type"] == "chat.message.read" for item in conversation_events)
    assert all("message" not in item["payload"] for item in conversation_events)
    assert all(item["payload"]["message_id"] == "msg-1" for item in conversation_events)
    assert all(item["payload"]["read_by_count"] == 2 for item in conversation_events)
    assert all(item["payload"]["reader_user_id"] == 9 for item in conversation_events)

    conversation_update_events = [
        item for item in inbox_events
        if item["event_type"] == "chat.conversation.updated"
    ]
    unread_summary_events = [
        item for item in inbox_events
        if item["event_type"] == "chat.unread.summary"
    ]
    assert sorted(item["user_id"] for item in conversation_update_events) == [2, 3]
    assert sorted(item["user_id"] for item in unread_summary_events) == [2, 3]
