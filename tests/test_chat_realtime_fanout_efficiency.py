from __future__ import annotations

import asyncio
import importlib
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

realtime_module = importlib.import_module("backend.chat.realtime")
side_effects_module = importlib.import_module("backend.chat.realtime_side_effects")


def test_user_fanout_uses_one_targeted_transport_event(monkeypatch):
    manager = realtime_module.ChatRealtimeManager()
    calls: list[dict] = []

    async def _publish_targeted_event(**kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(manager, "_publish_targeted_event", _publish_targeted_event)

    result = asyncio.run(
        manager.publish_user_events(
            user_ids=[2, 3, 3],
            conversation_id="conv-1",
            event_type="chat.message.created",
            payload={"id": "msg-1"},
        )
    )

    assert result == 2
    assert len(calls) == 1
    assert calls[0]["distribution"] == "user"
    assert calls[0]["target_user_ids"] == [2, 3, 3]


def test_fast_message_created_does_not_publish_room_and_inbox_duplicates(monkeypatch):
    room_calls: list[dict] = []
    user_calls: list[dict] = []

    async def _publish_room(**kwargs):
        room_calls.append(kwargs)
        return 1

    async def _publish_users(**kwargs):
        user_calls.append(kwargs)
        return len(set(kwargs["user_ids"]))

    monkeypatch.setattr(
        side_effects_module.chat_realtime,
        "publish_conversation_room_event",
        _publish_room,
    )
    monkeypatch.setattr(
        side_effects_module.chat_realtime,
        "conversation_room_user_ids",
        lambda **_kwargs: {2},
    )
    monkeypatch.setattr(
        side_effects_module.chat_realtime,
        "publish_user_events",
        _publish_users,
    )

    result = asyncio.run(
        side_effects_module.publish_message_created_fast_after_send(
            conversation_id="conv-1",
            message_id="msg-1",
            member_user_ids=[1, 2, 3],
            message_payload={"id": "msg-1", "conversation_id": "conv-1"},
            sender_user_id=1,
        )
    )

    assert len(room_calls) == 1
    assert room_calls[0]["distribute"] is False
    assert len(user_calls) == 1
    assert user_calls[0]["user_ids"] == [3]
    assert result["inbox_published"] == 1
