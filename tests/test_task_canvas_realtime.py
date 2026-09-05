from __future__ import annotations

import asyncio
import importlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

realtime_module = importlib.import_module("backend.chat.realtime")
canvas_realtime_module = importlib.import_module("backend.task_canvas.realtime")
canvas_ws_module = importlib.import_module("backend.api.v1.chat.task_canvas_ws")


def _user(*, user_id: int = 7):
    return SimpleNamespace(
        id=user_id,
        username="ivanov",
        full_name="Иван Иванов",
        role="user",
        department="ИТ",
        permissions=["tasks.read"],
        is_active=True,
    )


def _canvas_payload(*, can_edit: bool = True) -> dict:
    return {
        "task_id": "task-1",
        "revision": 2,
        "scene": {"elements": [], "appState": {}, "files": {}},
        "can_edit": can_edit,
        "max_scene_bytes": 2 * 1024 * 1024,
        "updated_by_user_id": None,
        "updated_by_username": "",
        "updated_at": None,
    }


class _CanvasStore:
    def __init__(self, *, can_edit: bool = True) -> None:
        self.can_edit = can_edit
        self.calls: list[dict] = []

    def get_task_canvas(self, **kwargs):
        self.calls.append(kwargs)
        return _canvas_payload(can_edit=self.can_edit)


class _RecordingRealtime:
    def __init__(self) -> None:
        self.published: list[dict] = []

    async def publish_conversation_room_event(self, **kwargs):
        self.published.append(kwargs)
        return 1


def test_task_canvas_realtime_validates_cursor_and_excludes_sender():
    manager = _RecordingRealtime()
    service = canvas_realtime_module.TaskCanvasRealtimeService(
        realtime_manager=manager,
        canvas_store=_CanvasStore(),
    )

    asyncio.run(service.broadcast_cursor(
        task_id="task-1",
        user=_user(),
        connection_id="conn-1",
        payload={"pointer": {"x": 12, "y": 24, "tool": "pointer"}, "button": "down"},
    ))

    event = manager.published[0]
    assert event["conversation_id"] == "task-canvas:task-1"
    assert event["event_type"] == "task_canvas.cursor"
    assert event["exclude_connection_id"] == "conn-1"
    assert event["payload"]["pointer"] == {"x": 12.0, "y": 24.0, "tool": "pointer"}
    assert event["payload"]["collaborator"]["username"] == "Иван Иванов"

    with pytest.raises(ValueError, match="cursor coordinates"):
        service.validate_cursor({"pointer": {"x": float("nan"), "y": 1}})


def test_task_canvas_realtime_validates_scene_contract():
    service = canvas_realtime_module.TaskCanvasRealtimeService(
        realtime_manager=_RecordingRealtime(),
        canvas_store=_CanvasStore(),
    )

    assert service.validate_scene({
        "scene": {
            "elements": [{"id": "rect-1", "type": "rectangle", "version": 1}],
            "appState": {"viewBackgroundColor": "#fff"},
            "files": {},
        },
    })["elements"][0]["id"] == "rect-1"

    with pytest.raises(ValueError):
        service.validate_scene({"scene": {"elements": [], "appState": {}, "files": {}, "extra": True}})


def test_task_canvas_rate_limiter_charges_large_updates_by_size(monkeypatch):
    current = {"now": 1000.0}
    monkeypatch.setattr(canvas_realtime_module.time, "monotonic", lambda: current["now"])
    limiter = canvas_realtime_module.TaskCanvasWsRateLimiter(rate_per_sec=10, burst=10)

    assert limiter.allow(cost=9)[0] is True
    allowed, retry_after_ms = limiter.allow(cost=2)

    assert allowed is False
    assert retry_after_ms >= 100
    current["now"] += 0.1
    assert limiter.allow(cost=2)[0] is True
    assert limiter.violations == 0


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


def test_chat_room_broadcast_can_exclude_one_connection():
    manager = realtime_module.ChatRealtimeManager()
    first = _DummyWebSocket()
    second = _DummyWebSocket()

    async def _exercise() -> None:
        first_id, _ = await manager.connect(first, user_id=7)
        second_id, _ = await manager.connect(second, user_id=8)
        manager.subscribe_conversation(first_id, "task-canvas:task-1")
        manager.subscribe_conversation(second_id, "task-canvas:task-1")
        await manager.publish_conversation_room_event(
            conversation_id="task-canvas:task-1",
            event_type="task_canvas.cursor",
            payload={"connection_id": first_id},
            distribute=False,
            exclude_connection_id=first_id,
        )
        await asyncio.sleep(0)
        manager.disconnect(first_id)
        manager.disconnect(second_id)

    asyncio.run(_exercise())

    assert first.messages == []
    assert [message["type"] for message in second.messages] == ["task_canvas.cursor"]


class _EndpointRealtime(_RecordingRealtime):
    def __init__(self) -> None:
        super().__init__()
        self.websocket = None
        self.subscriptions: list[tuple[str, str]] = []
        self.disconnected: list[str] = []

    async def connect(self, websocket, *, user_id: int):
        await websocket.accept()
        self.websocket = websocket
        return "conn-1", True

    def subscribe_conversation(self, connection_id: str, room_id: str) -> None:
        self.subscriptions.append((connection_id, room_id))

    def unsubscribe_conversation(self, connection_id: str, room_id: str) -> None:
        return None

    def disconnect(self, connection_id: str):
        self.disconnected.append(connection_id)
        return {"last_connection": True}

    async def send_to_connection(self, connection_id: str, *, event_type: str, payload: dict, request_id=None):
        await self.websocket.send_json({
            "type": event_type,
            "payload": payload,
            "request_id": request_id,
        })


def test_task_canvas_websocket_connects_and_rejects_read_only_scene(monkeypatch):
    manager = _EndpointRealtime()
    service = canvas_realtime_module.TaskCanvasRealtimeService(
        realtime_manager=manager,
        canvas_store=_CanvasStore(can_edit=False),
    )

    async def _current_user(_websocket):
        return _user()

    monkeypatch.setattr(canvas_ws_module, "task_canvas_realtime", service)
    monkeypatch.setattr(canvas_ws_module, "get_current_user_from_websocket", _current_user)
    monkeypatch.setattr(canvas_ws_module, "ensure_user_permission", lambda *_args: None)
    monkeypatch.setattr(canvas_ws_module, "extract_websocket_access_token", lambda *_args: "test-token")

    app = FastAPI()
    app.include_router(canvas_ws_module.router)

    with TestClient(app).websocket_connect("/task-canvas/ws?task_id=task-1") as websocket:
        connected = websocket.receive_json()
        assert connected["type"] == "task_canvas.connected"
        assert connected["payload"]["can_edit"] is False
        websocket.send_json({
            "type": "task_canvas.scene.update",
            "payload": {"scene": {"elements": [], "appState": {}, "files": {}}},
        })
        error = websocket.receive_json()
        assert error["type"] == "task_canvas.error"
        assert error["payload"]["code"] == "forbidden"

    assert manager.subscriptions == [("conn-1", "task-canvas:task-1")]
    assert manager.disconnected == ["conn-1"]
