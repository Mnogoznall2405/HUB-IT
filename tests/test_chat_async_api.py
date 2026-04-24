from __future__ import annotations

import asyncio
import importlib
import sys
from contextvars import ContextVar
from pathlib import Path

from starlette.requests import Request


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

chat_api_module = importlib.import_module("backend.api.v1.chat")
chat_realtime_module = importlib.import_module("backend.chat.realtime")
auth_models_module = importlib.import_module("backend.models.auth")
chat_schemas_module = importlib.import_module("backend.chat.schemas")
chat_service_module = importlib.import_module("backend.chat.service")
main_module = importlib.import_module("backend.main")


def _build_chat_user():
    return auth_models_module.User(
        id=100,
        username="chat-user",
        email="chat-user@example.com",
        full_name="Chat User",
        role="viewer",
        is_active=True,
        permissions=[],
        use_custom_permissions=False,
        custom_permissions=[],
        auth_source="local",
        telegram_id=None,
        assigned_database=None,
        mailbox_email=None,
        mailbox_login=None,
        mail_signature_html=None,
        mail_is_configured=False,
    )


def test_send_chat_message_route_uses_async_boundary_and_background_publish(monkeypatch):
    current_user = _build_chat_user()
    payload = chat_schemas_module.SendMessageRequest(body="Hello", client_message_id="client-msg-1")
    request = Request({
        "type": "http",
        "method": "POST",
        "path": "/api/v1/chat/conversations/conv-1/messages",
        "headers": [],
        "query_string": b"",
    })
    async_boundary_calls = []
    scheduled_labels = []

    def _direct(*args, **kwargs):
        raise AssertionError("send_message should not be called directly")

    async def _fake_run_chat_call_with_meta(func, *args, **kwargs):
        async_boundary_calls.append({"func": func, "args": args, "kwargs": kwargs})
        return (
            {
                "id": "msg-1",
                "conversation_id": "conv-1",
                "kind": "text",
                "body": "Hello",
                "client_message_id": "client-msg-1",
            },
            {},
        )

    def _fake_schedule(coro, *, label):
        scheduled_labels.append(label)
        coro.close()
        return None

    monkeypatch.setattr(chat_api_module.chat_service, "send_message", _direct)
    monkeypatch.setattr(chat_api_module, "_run_chat_call_with_meta", _fake_run_chat_call_with_meta)
    monkeypatch.setattr(chat_api_module, "_schedule_chat_background_task", _fake_schedule)

    response = asyncio.run(
        chat_api_module.send_chat_message(
            request=request,
            conversation_id="conv-1",
            payload=payload,
            current_user=current_user,
        )
    )

    assert response == {
        "id": "msg-1",
        "conversation_id": "conv-1",
        "kind": "text",
        "body": "Hello",
        "client_message_id": "client-msg-1",
    }
    assert len(async_boundary_calls) == 1
    assert async_boundary_calls[0]["func"] is _direct
    assert async_boundary_calls[0]["kwargs"]["current_user_id"] == 100
    assert async_boundary_calls[0]["kwargs"]["conversation_id"] == "conv-1"
    assert async_boundary_calls[0]["kwargs"]["body"] == "Hello"
    assert async_boundary_calls[0]["kwargs"]["client_message_id"] == "client-msg-1"
    assert async_boundary_calls[0]["kwargs"]["defer_push_notifications"] is True
    assert scheduled_labels == ["publish_message_created", "queue_ai_run"]


def test_forward_chat_message_route_passes_body_format(monkeypatch):
    current_user = _build_chat_user()
    payload = chat_schemas_module.ForwardMessageRequest(
        source_message_id="msg-source",
        body="## Forward comment",
        body_format="markdown",
    )
    async_boundary_calls = []
    scheduled = []

    def _direct(*args, **kwargs):
        raise AssertionError("forward_message should not be called directly")

    async def _fake_run_chat_call_with_meta(func, *args, **kwargs):
        async_boundary_calls.append({"func": func, "args": args, "kwargs": kwargs})
        return (
            {
                "id": "msg-forward",
                "conversation_id": "conv-1",
                "kind": "text",
                "body": "## Forward comment",
                "body_format": "markdown",
            },
            {},
        )

    def _fake_schedule_side_effects(**kwargs):
        scheduled.append(kwargs)

    monkeypatch.setattr(chat_api_module.chat_service, "forward_message", _direct)
    monkeypatch.setattr(chat_api_module, "_run_chat_call_with_meta", _fake_run_chat_call_with_meta)
    monkeypatch.setattr(chat_api_module, "_schedule_chat_message_side_effects", _fake_schedule_side_effects)

    response = asyncio.run(
        chat_api_module.forward_chat_message(
            conversation_id="conv-1",
            payload=payload,
            current_user=current_user,
        )
    )

    assert response["id"] == "msg-forward"
    assert len(async_boundary_calls) == 1
    assert async_boundary_calls[0]["func"] is _direct
    assert async_boundary_calls[0]["kwargs"]["source_message_id"] == "msg-source"
    assert async_boundary_calls[0]["kwargs"]["body_format"] == "markdown"
    assert scheduled == [{"conversation_id": "conv-1", "message_id": "msg-forward"}]


def test_realtime_broadcast_does_not_wait_for_slow_socket():
    class SlowWebSocket:
        def __init__(self) -> None:
            self.accepted = False
            self.started = asyncio.Event()
            self.release = asyncio.Event()
            self.sent = []

        async def accept(self) -> None:
            self.accepted = True

        async def send_json(self, envelope: dict) -> None:
            self.started.set()
            await self.release.wait()
            self.sent.append(envelope)

    class FastWebSocket:
        def __init__(self) -> None:
            self.accepted = False
            self.delivered = asyncio.Event()
            self.sent = []

        async def accept(self) -> None:
            self.accepted = True

        async def send_json(self, envelope: dict) -> None:
            self.sent.append(envelope)
            self.delivered.set()

    async def _exercise_broadcast() -> None:
        manager = chat_realtime_module.ChatRealtimeManager()
        slow_socket = SlowWebSocket()
        fast_socket = FastWebSocket()

        await manager.connect(slow_socket, user_id=1)
        await manager.connect(fast_socket, user_id=2)

        publish_task = asyncio.create_task(
            manager.publish_global_event(
                event_type="chat.test",
                payload={"ok": True},
            )
        )

        await asyncio.wait_for(slow_socket.started.wait(), timeout=0.5)
        await asyncio.wait_for(fast_socket.delivered.wait(), timeout=0.5)
        assert len(fast_socket.sent) == 1
        assert fast_socket.sent[0]["type"] == "chat.test"
        assert fast_socket.sent[0]["payload"] == {"ok": True}
        assert slow_socket.sent == []

        slow_socket.release.set()
        await asyncio.wait_for(publish_task, timeout=0.5)
        assert len(slow_socket.sent) == 1

    asyncio.run(_exercise_broadcast())


def test_complete_upload_session_reads_service_meta_inside_threadpool(monkeypatch):
    current_user = _build_chat_user()
    request_meta_var: ContextVar[dict | None] = ContextVar("chat_upload_meta_test", default=None)
    scheduled_labels = []

    def _direct(*args, **kwargs):
        request_meta_var.set(
            {
                "upload_session_completed_now": True,
            }
        )
        return {
            "id": "msg-upload-1",
            "conversation_id": "conv-1",
            "kind": "files",
        }

    def _consume():
        payload = dict(request_meta_var.get() or {})
        request_meta_var.set(None)
        return payload

    def _fake_schedule(coro, *, label):
        scheduled_labels.append(label)
        coro.close()
        return None

    monkeypatch.setattr(chat_api_module.chat_service, "complete_upload_session", _direct)
    monkeypatch.setattr(chat_api_module.chat_service, "consume_request_meta", _consume)
    monkeypatch.setattr(chat_api_module, "_schedule_chat_background_task", _fake_schedule)

    response = asyncio.run(
        chat_api_module.complete_chat_upload_session(
            session_id="upload-1",
            current_user=current_user,
        )
    )

    assert response["id"] == "msg-upload-1"
    assert scheduled_labels == ["publish_message_created", "queue_ai_run"]


def test_get_chat_messages_logs_request_meta_from_threadpool(monkeypatch):
    current_user = _build_chat_user()
    request_meta_var: ContextVar[dict | None] = ContextVar("chat_messages_meta_test", default=None)
    log_calls = []

    def _direct(*args, **kwargs):
        request_meta_var.set({
            "cache_hit": True,
            "items_count": 2,
            "direction": "before",
        })
        return {
            "items": [],
            "has_more": False,
            "viewer_last_read_message_id": None,
            "viewer_last_read_at": None,
        }

    def _consume():
        payload = dict(request_meta_var.get() or {})
        request_meta_var.set(None)
        return payload

    def _fake_log_request_timing(name, request_id, started_at, **payload):
        log_calls.append({"name": name, **payload})

    monkeypatch.setattr(chat_api_module.chat_service, "get_messages", _direct)
    monkeypatch.setattr(chat_api_module.chat_service, "consume_request_meta", _consume)
    monkeypatch.setattr(chat_api_module, "_log_request_timing", _fake_log_request_timing)

    request = Request({
        "type": "http",
        "method": "GET",
        "path": "/api/v1/chat/conversations/conv-1/messages",
        "headers": [],
        "query_string": b"",
    })

    response = asyncio.run(
        chat_api_module.get_chat_messages(
            request=request,
            conversation_id="conv-1",
            before_message_id=None,
            after_message_id=None,
            limit=100,
            current_user=current_user,
        )
    )

    assert response["items"] == []
    assert log_calls == [{
        "name": "messages",
        "user_id": 100,
        "conversation_id": "conv-1",
        "limit": 100,
        "before_message_id": None,
        "after_message_id": None,
        "cache_hit": 1,
        "items_count": 2,
        "direction": "before",
        "cursor_invalid": 0,
    }]


def test_get_chat_conversation_route_uses_async_boundary(monkeypatch):
    current_user = _build_chat_user()
    async_boundary_calls = []

    def _direct(*args, **kwargs):
        raise AssertionError("get_conversation should not be called directly")

    async def _fake_run_chat_call(func, *args, **kwargs):
        async_boundary_calls.append({"func": func, "args": args, "kwargs": kwargs})
        return {
            "id": "conv-1",
            "kind": "group",
            "title": "Ops",
            "member_count": 3,
            "online_member_count": 1,
            "member_preview": [],
            "members": [],
        }

    monkeypatch.setattr(chat_api_module.chat_service, "get_conversation", _direct)
    monkeypatch.setattr(chat_api_module, "_run_chat_call", _fake_run_chat_call)

    response = asyncio.run(
        chat_api_module.get_chat_conversation(
            conversation_id="conv-1",
            current_user=current_user,
        )
    )

    assert response["id"] == "conv-1"
    assert async_boundary_calls == [{
        "func": _direct,
        "args": (),
        "kwargs": {
            "current_user_id": 100,
            "conversation_id": "conv-1",
        },
    }]


def test_publish_presence_updated_uses_presence_watch_distribution(monkeypatch):
    publish_calls = []

    async def _fake_run_chat_call(func, *args, **kwargs):
        assert getattr(func, "__name__", "") == "get_presence"
        assert kwargs == {"user_id": 100}
        return {"is_online": True, "status_text": "В сети"}

    async def _fake_publish_presence_event(*, user_id, payload, request_id=None, distribute=True):
        publish_calls.append({
            "user_id": user_id,
            "payload": payload,
            "request_id": request_id,
            "distribute": distribute,
        })

    monkeypatch.setattr(chat_api_module, "_run_chat_call", _fake_run_chat_call)
    monkeypatch.setattr(chat_api_module.chat_realtime, "publish_presence_event", _fake_publish_presence_event)

    asyncio.run(chat_api_module._publish_presence_updated(100))

    assert publish_calls == [{
        "user_id": 100,
        "payload": {
            "user_id": 100,
            "presence": {"is_online": True, "status_text": "В сети"},
        },
        "request_id": None,
        "distribute": True,
    }]
