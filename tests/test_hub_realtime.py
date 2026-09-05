from __future__ import annotations

import asyncio
import importlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

realtime_module = importlib.import_module("backend.chat.realtime")
hub_realtime_module = importlib.import_module("backend.realtime.hub")
hub_ws_module = importlib.import_module("backend.api.v1.chat.hub_realtime_ws")
hub_service_module = importlib.import_module("backend.services.hub_service")
postgres_realtime_module = importlib.import_module("backend.chat.postgres_realtime")


class _DummyWebSocket:
    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def accept(self) -> None:
        return None

    async def close(self, code: int = 1000, reason: str = "") -> None:
        return None

    async def send_json(self, envelope: dict) -> None:
        self.messages.append(envelope)

    async def send_text(self, payload: str) -> None:
        self.messages.append(json.loads(payload))


def test_room_only_connection_does_not_receive_chat_user_events_or_presence():
    manager = realtime_module.ChatRealtimeManager()
    websocket = _DummyWebSocket()

    async def _exercise() -> None:
        connection_id, _ = await manager.connect(
            websocket,
            user_id=17,
            receive_user_events=False,
            track_presence=False,
        )
        manager.subscribe_conversation(connection_id, hub_realtime_module.hub_user_room_id(17))
        await manager.publish_user_event(
            user_id=17,
            event_type="chat.message.updated",
            payload={"id": "message-1"},
            distribute=False,
        )
        await manager.publish_conversation_room_event(
            conversation_id=hub_realtime_module.hub_user_room_id(17),
            event_type=hub_realtime_module.HUB_NOTIFICATION_CREATED_EVENT,
            payload={"event_id": "notification-1"},
            distribute=False,
        )
        await asyncio.sleep(0)
        assert manager.snapshot_connected_user_ids() == set()
        assert manager.get_presence_snapshot([17]) == {}
        manager.disconnect(connection_id)

    asyncio.run(_exercise())

    assert [message["type"] for message in websocket.messages] == [
        hub_realtime_module.HUB_NOTIFICATION_CREATED_EVENT,
    ]


class _EndpointRealtime:
    def __init__(self) -> None:
        self.websocket = None
        self.connect_kwargs: dict = {}
        self.subscriptions: list[tuple[str, str]] = []
        self.disconnected: list[str] = []
        self.unsubscriptions: list[tuple[str, str]] = []
        self.published: list[dict] = []

    async def connect(self, websocket, **kwargs):
        await websocket.accept()
        self.websocket = websocket
        self.connect_kwargs = kwargs
        return "hub-connection-1", True

    def subscribe_conversation(self, connection_id: str, room_id: str) -> None:
        self.subscriptions.append((connection_id, room_id))

    def unsubscribe_conversation(self, connection_id: str, room_id: str) -> None:
        self.unsubscriptions.append((connection_id, room_id))

    def disconnect(self, connection_id: str):
        self.disconnected.append(connection_id)
        return {"last_connection": False}

    def allow_ws_command(self, user_id: int):
        return True, 0, SimpleNamespace(violations=0)

    def record_rate_limited(self, connection_id: str) -> None:
        return None

    async def send_to_connection(
        self,
        connection_id: str,
        *,
        event_type: str,
        payload: dict,
        request_id=None,
        **_kwargs,
    ) -> None:
        await self.websocket.send_json({
            "type": event_type,
            "payload": payload,
            "request_id": request_id,
        })

    async def publish_conversation_room_event(self, **kwargs):
        self.published.append(kwargs)
        return 0


def test_hub_realtime_websocket_authenticates_and_supports_heartbeat(monkeypatch):
    manager = _EndpointRealtime()

    async def _current_user(_websocket):
        return SimpleNamespace(id=42, is_active=True)

    monkeypatch.setattr(hub_ws_module, "chat_realtime", manager)
    monkeypatch.setattr(hub_ws_module, "get_current_user_from_websocket", _current_user)
    monkeypatch.setattr(hub_ws_module, "extract_websocket_access_token", lambda *_args: "test-token")

    app = FastAPI()
    app.include_router(hub_ws_module.router)

    with TestClient(app).websocket_connect("/hub-realtime/ws") as websocket:
        connected = websocket.receive_json()
        assert connected["type"] == "hub.realtime.connected"
        assert connected["payload"]["snapshot_required"] is True
        websocket.send_json({"type": "hub.realtime.ping", "request_id": "ping-1"})
        pong = websocket.receive_json()
        assert pong["type"] == "hub.realtime.pong"
        assert pong["request_id"] == "ping-1"

    assert manager.connect_kwargs == {
        "user_id": 42,
        "receive_user_events": False,
        "track_presence": False,
    }
    assert manager.subscriptions == [("hub-connection-1", "hub:user:42")]
    assert manager.disconnected == ["hub-connection-1"]


def test_hub_realtime_websocket_joins_and_leaves_task_presence(monkeypatch):
    manager = _EndpointRealtime()
    current_user = SimpleNamespace(
        id=42,
        is_active=True,
        role="viewer",
        username="ivanov",
        full_name="Иван Иванов",
    )

    async def _current_user(_websocket):
        return current_user

    monkeypatch.setattr(hub_ws_module, "chat_realtime", manager)
    monkeypatch.setattr(hub_ws_module, "get_current_user_from_websocket", _current_user)
    monkeypatch.setattr(hub_ws_module, "extract_websocket_access_token", lambda *_args: "test-token")
    monkeypatch.setattr(hub_ws_module, "_authorize_task_presence", lambda **_kwargs: {"id": "task-7"})

    app = FastAPI()
    app.include_router(hub_ws_module.router)

    with TestClient(app).websocket_connect("/hub-realtime/ws") as websocket:
        websocket.receive_json()
        websocket.send_json({
            "type": "tasks.presence.join",
            "payload": {"task_id": "task-7"},
        })
        snapshot = websocket.receive_json()
        assert snapshot["type"] == "tasks.presence.snapshot"
        assert snapshot["payload"]["task_id"] == "task-7"

    task_room = "hub:task-presence:task-7"
    assert ("hub-connection-1", task_room) in manager.subscriptions
    assert ("hub-connection-1", task_room) in manager.unsubscriptions
    assert [item["event_type"] for item in manager.published] == [
        "tasks.presence.joined",
        "tasks.presence.sync.requested",
        "tasks.presence.left",
    ]


class _FakeConnection:
    def __init__(self) -> None:
        self.commits = 0
        self.rollbacks = 0

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1

    def close(self) -> None:
        return None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type is None:
            self.commit()
        else:
            self.rollback()
        return False


def test_after_commit_callbacks_never_run_for_rolled_back_notifications():
    delivered: list[str] = []
    connection = hub_service_module._AfterCommitConnection(_FakeConnection())

    connection.add_after_commit(lambda: delivered.append("rolled-back"))
    connection.rollback()
    assert delivered == []

    connection.add_after_commit(lambda: delivered.append("committed"))
    connection.commit()
    assert delivered == ["committed"]


def test_hub_realtime_publisher_targets_only_the_recipient_room():
    published: list[dict] = []

    class _Manager:
        async def publish_conversation_room_event(self, **kwargs):
            published.append(kwargs)
            return 1

    publisher = hub_realtime_module.HubRealtimePublisher()

    async def _exercise() -> None:
        await publisher.start(realtime_manager=_Manager())
        assert publisher.publish_notification({
            "id": "notification-7",
            "recipient_user_id": 7,
            "event_type": "task.assigned",
        }) is True
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        await publisher.stop()

    asyncio.run(_exercise())

    assert published == [{
        "conversation_id": "hub:user:7",
        "event_type": "hub.notification.created",
        "payload": {
            "protocol": 1,
            "event_id": "notification-7",
            "notification": {
                "id": "notification-7",
                "recipient_user_id": 7,
                "event_type": "task.assigned",
            },
        },
    }]


def test_hub_realtime_publisher_forwards_generic_domain_events():
    published: list[dict] = []

    class _Manager:
        async def publish_conversation_room_event(self, **kwargs):
            published.append(kwargs)
            return 1

    publisher = hub_realtime_module.HubRealtimePublisher()

    async def _exercise() -> None:
        await publisher.start(realtime_manager=_Manager())
        assert publisher.publish_user_event(
            recipient_user_id=9,
            event_type=hub_realtime_module.HUB_TASK_UPDATED_EVENT,
            event_id="task-event-9",
            payload={"task_id": "task-9", "operation": "updated"},
        ) is True
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        await publisher.stop()

    asyncio.run(_exercise())

    assert published == [{
        "conversation_id": "hub:user:9",
        "event_type": "tasks.task.updated",
        "payload": {
            "protocol": 1,
            "event_id": "task-event-9",
            "task_id": "task-9",
            "operation": "updated",
        },
    }]


def test_task_realtime_audience_is_permission_and_visibility_scoped(monkeypatch):
    service = hub_service_module.hub_service
    users = [
        {"id": 1, "can_read": True},
        {"id": 2, "can_read": True},
        {"id": 3, "can_read": False},
    ]
    monkeypatch.setattr(service, "_get_cached_user_directory", lambda *_args: users)
    monkeypatch.setattr(service, "_active_users", lambda: users)
    monkeypatch.setattr(service, "_user_can_read_tasks", lambda user: bool(user.get("can_read")))
    monkeypatch.setattr(service, "_task_viewer_user_ids", lambda *_args, **_kwargs: {1})
    monkeypatch.setattr(
        hub_service_module,
        "can_view_task",
        lambda user, _task, *, participant_user_ids: int(user["id"]) in participant_user_ids,
    )

    assert service._task_realtime_recipient_user_ids({"id": "task-1"}) == {1}


def test_postgres_relay_can_start_as_a_bounded_publisher_without_listener(monkeypatch):
    monkeypatch.setattr(
        postgres_realtime_module,
        "postgres_database_url_supported",
        lambda _database_url: True,
    )
    bus = postgres_realtime_module.ChatRealtimePostgresBus(
        manager=None,
        database_url="postgresql://example.invalid/realtime",
        node_id="hub-publisher-test",
        subscriber_enabled=False,
    )

    async def _exercise() -> None:
        await bus.start()
        assert bus.started is True
        assert bus._listener_task is None
        assert bus.publish_queue_capacity > 0
        await bus.stop()

    asyncio.run(_exercise())
