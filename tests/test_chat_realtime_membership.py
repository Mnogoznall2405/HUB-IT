"""A member removed from a group must stop receiving the conversation's room events.

Sockets join a conversation room while the user is still a member; removal must
drop that subscription locally and on every other node (transport event).
"""
from __future__ import annotations

import asyncio
import importlib
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

realtime_module = importlib.import_module("backend.chat.realtime")


class _FakeSocket:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def accept(self) -> None:
        return None

    async def send_text(self, data: str) -> None:
        self.sent.append(json.loads(data))

    async def send_json(self, data) -> None:
        self.sent.append(data)

    async def send_bytes(self, data: bytes) -> None:
        self.sent.append(json.loads(data.decode("utf-8")))

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        return None


def _room_events(socket: _FakeSocket, event_type: str) -> list[dict]:
    return [item for item in socket.sent if item.get("type") == event_type or item.get("event_type") == event_type]


def test_removed_member_stops_receiving_room_events():
    async def scenario() -> tuple[list[dict], list[dict]]:
        manager = realtime_module.ChatRealtimeManager()
        member_socket, removed_socket = _FakeSocket(), _FakeSocket()
        member_conn, _ = await manager.connect(member_socket, user_id=2, track_presence=False)
        removed_conn, _ = await manager.connect(removed_socket, user_id=3, track_presence=False)
        manager.subscribe_conversation(member_conn, "group-1")
        manager.subscribe_conversation(removed_conn, "group-1")

        # Removal while the socket is still subscribed (what the group service triggers).
        await manager.publish_conversation_eviction(conversation_id="group-1", user_ids=[3])

        await manager.publish_conversation_room_event(
            conversation_id="group-1",
            event_type="chat.message.read",
            payload={"message_id": "m-1"},
            distribute=False,
        )
        await asyncio.sleep(0.2)
        return _room_events(member_socket, "chat.message.read"), _room_events(removed_socket, "chat.message.read")

    member_events, removed_events = asyncio.run(scenario())
    assert len(member_events) == 1, member_events
    assert removed_events == []


def test_eviction_event_from_another_node_drops_the_local_subscription():
    async def scenario() -> bool:
        manager = realtime_module.ChatRealtimeManager()
        socket = _FakeSocket()
        connection_id, _ = await manager.connect(socket, user_id=3, track_presence=False)
        manager.subscribe_conversation(connection_id, "group-1")
        await manager._handle_distributed_event_once({
            "distribution": "room_evict",
            "event_type": "chat.room.evict",
            "conversation_id": "group-1",
            "target_user_ids": [3],
            "payload": {},
        })
        return 3 in manager.conversation_room_user_ids(conversation_id="group-1")

    assert asyncio.run(scenario()) is False


def test_parallel_connects_of_one_user_respect_the_connection_limit(monkeypatch):
    """Eviction awaits outside the lock; parallel connects must not all slip past the limit."""
    monkeypatch.setattr(realtime_module, "_CHAT_WS_MAX_CONNECTIONS_PER_USER", 2)

    async def scenario() -> int:
        manager = realtime_module.ChatRealtimeManager()
        for _ in range(2):
            await manager.connect(_FakeSocket(), user_id=7, track_presence=False)

        real_evict = manager._evict_connection

        async def slow_evict(connection_id, **kwargs):
            await asyncio.sleep(0.05)
            await real_evict(connection_id, **kwargs)

        manager._evict_connection = slow_evict  # type: ignore[method-assign]
        await asyncio.gather(*[
            manager.connect(_FakeSocket(), user_id=7, track_presence=False) for _ in range(3)
        ])
        await asyncio.sleep(0.1)
        return len(manager._user_connection_ids.get(7, set()))

    assert asyncio.run(scenario()) <= 2


def test_subscribe_racing_an_eviction_does_not_rejoin_a_removed_member(monkeypatch):
    """DCHAT-02: access check passes, member is removed+evicted, then the old subscribe registers the room."""
    from types import SimpleNamespace

    from fastapi import HTTPException

    ws_commands = importlib.import_module("backend.chat.ws_commands")

    async def scenario() -> tuple[list[str], list[dict]]:
        manager = realtime_module.ChatRealtimeManager()
        socket = _FakeSocket()
        connection_id, _ = await manager.connect(socket, user_id=3, track_presence=False)
        state = {"member": True, "checks": 0}
        first_check_returned = asyncio.Event()
        release_first_check = asyncio.Event()

        async def run_chat_call(fn, **kwargs):
            return await fn(**kwargs)

        async def verify_conversation_access(**kwargs):
            state["checks"] += 1
            allowed = state["member"]
            if state["checks"] == 1:
                first_check_returned.set()
                await release_first_check.wait()  # the DB answered "member"; the reply is still in flight
            if not allowed and state["checks"] > 1:
                raise HTTPException(status_code=403, detail="not a member")
            return None

        chat_api = SimpleNamespace(
            chat_realtime=manager,
            chat_service=SimpleNamespace(verify_conversation_access=verify_conversation_access),
            _run_chat_call=run_chat_call,
        )
        monkeypatch.setattr(ws_commands, "_api", lambda: chat_api)

        subscribe = asyncio.create_task(ws_commands.dispatch_chat_ws_command(
            current_user=SimpleNamespace(id=3),
            connection_id=connection_id,
            message_type="chat.subscribe_conversation",
            request_id="r1",
            conversation_id="group-1",
            payload={},
        ))
        await first_check_returned.wait()
        state["member"] = False
        await manager.publish_conversation_eviction(conversation_id="group-1", user_ids=[3])
        release_first_check.set()
        try:
            await subscribe
        except HTTPException:
            pass
        await manager.publish_conversation_room_event(
            conversation_id="group-1", event_type="chat.message.read",
            payload={"message_id": "m-1"}, distribute=False,
        )
        await asyncio.sleep(0.2)
        return sorted(manager.conversation_room_user_ids(conversation_id="group-1")), _room_events(socket, "chat.message.read")

    room_users, events = asyncio.run(scenario())
    assert 3 not in room_users
    assert events == []
