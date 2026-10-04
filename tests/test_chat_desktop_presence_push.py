"""Policy "HUB Desktop is active -> browser Web Push stays silent".

Unit-level on purpose: the decision spans several processes (chat nodes write
markers, the push worker reads them) and fail-open/expiry branches that an E2E
run against one process cannot reproduce.
"""
from __future__ import annotations

import asyncio
import importlib
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

desktop_presence = importlib.import_module("backend.chat.desktop_presence")
realtime_module = importlib.import_module("backend.chat.realtime")
push_service_module = importlib.import_module("backend.chat.push_service")
from backend.services.native_push_service import NativePushSendResult  # noqa: E402


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setenv("CHAT_REALTIME_TRANSPORT", "local")
    monkeypatch.delenv("CHAT_DESKTOP_ACTIVE_WINDOW_SEC", raising=False)
    monkeypatch.delenv("CHAT_PUSH_SUPPRESS_MOBILE_WHEN_DESKTOP_ACTIVE", raising=False)
    monkeypatch.delenv("CHAT_PUSH_SUPPRESS_WEB_WHEN_DESKTOP_ACTIVE", raising=False)
    push_service_module._recent_chat_push_deliveries.clear()
    yield
    push_service_module._recent_chat_push_deliveries.clear()
    desktop_presence.set_desktop_presence_store("postgres", None)


@pytest.fixture
def shared_presence_store(tmp_path, monkeypatch):
    """The chat_realtime_presence table shared by all processes (sqlite stand-in)."""
    engine = create_engine(f"sqlite:///{(tmp_path / 'presence.db').as_posix()}", future=True)
    with engine.begin() as connection:
        connection.execute(text(
            "CREATE TABLE chat_realtime_presence ("
            "node_id VARCHAR(128) NOT NULL, connection_id VARCHAR(64) NOT NULL, "
            "user_id INTEGER NOT NULL, touched_at TIMESTAMP NOT NULL, "
            "expires_at TIMESTAMP NOT NULL, PRIMARY KEY (node_id, connection_id))"
        ))
    store = desktop_presence.SqlDesktopPresenceStore(engine_factory=lambda: engine)
    desktop_presence.set_desktop_presence_store("postgres", store)
    # The push worker process: no own sockets, reads the shared store.
    monkeypatch.setattr(realtime_module.chat_realtime, "_realtime_transport", "postgres")
    yield store
    engine.dispose()


class _Socket:
    async def accept(self):
        return None

    async def close(self, **_kwargs):
        return None


def _node(node_id: str, monkeypatch) -> realtime_module.ChatRealtimeManager:
    manager = realtime_module.ChatRealtimeManager()
    manager._realtime_transport = "postgres"
    monkeypatch.setattr(type(manager), "node_id", property(lambda self, _n=node_id: getattr(self, "_test_node_id", _n)))
    manager._test_node_id = node_id
    return manager


async def _flush_markers(manager) -> None:
    pending = list(manager._desktop_marker_tasks.values())
    if pending:
        await asyncio.gather(*pending)


def _push_service(monkeypatch, *, native_calls: list, web_calls: list):
    service = push_service_module.ChatPushService()
    prefs = push_service_module.notification_preferences_service
    monkeypatch.setattr(prefs, "is_enabled", lambda **_: True)
    monkeypatch.setattr(prefs, "is_quiet_hours_active", lambda **_: False)
    monkeypatch.setattr(service, "_get_active_subscriptions", lambda **_: [object()])
    monkeypatch.setattr(
        service,
        "_send_payload_to_subscriptions",
        lambda **kwargs: web_calls.append(kwargs) or push_service_module.ChatPushSendResult(sent=1),
    )
    monkeypatch.setattr(
        "backend.services.native_push_service.native_push_service.send_notification",
        lambda **kwargs: native_calls.append(kwargs) or NativePushSendResult(tokens=1, sent=1),
    )
    return service


def _send(service, message_id: str):
    return service.send_chat_message_notification(
        recipient_user_id=7,
        conversation_id="conv-1",
        message_id=message_id,
        title="Chat",
        body="Hello",
        preference_channel="chat",
        conversation_kind="direct",
    )


def test_desktop_foreground_on_one_node_silences_web_push_in_push_worker(shared_presence_store, monkeypatch):
    node_a = _node("node-a", monkeypatch)
    node_b = _node("node-b", monkeypatch)
    native_calls: list = []
    web_calls: list = []
    service = _push_service(monkeypatch, native_calls=native_calls, web_calls=web_calls)

    async def _run():
        desktop_id, _ = await node_a.connect(_Socket(), user_id=7)
        browser_id, _ = await node_b.connect(_Socket(), user_id=7)
        state = node_a.set_desktop_client_state(desktop_id, foreground=True)
        # A browser tab never becomes desktop-active by itself.
        assert node_b.local_desktop_active_remaining_sec(7) == 0.0
        await _flush_markers(node_a)
        silenced = await asyncio.to_thread(_send, service, "msg-active")

        node_a.disconnect(desktop_id)
        await _flush_markers(node_a)
        delivered = await asyncio.to_thread(_send, service, "msg-after-close")
        node_b.disconnect(browser_id)
        return state, silenced, delivered

    state, silenced, delivered = asyncio.run(_run())

    assert state == {"published": True, "expires_in_ms": 120_000}
    # Web Push skipped, mobile (native) push still delivered by default.
    assert silenced.suppressed == 1 and silenced.suppressed_reason == "desktop_active"
    assert silenced.sent == 1
    assert len(native_calls) == 2
    assert [call["payload"]["tag"] for call in web_calls] == ["chat:msg:msg-after-close"]
    assert delivered.sent == 2 and delivered.suppressed == 0


def test_background_desktop_stays_active_for_window_then_expires(shared_presence_store, monkeypatch):
    node_a = _node("node-a", monkeypatch)

    async def _run():
        desktop_id, _ = await node_a.connect(_Socket(), user_id=7)
        node_a.set_desktop_client_state(desktop_id, foreground=True)
        moved_to_background = node_a.set_desktop_client_state(desktop_id, foreground=False)
        repeated_background = node_a.set_desktop_client_state(desktop_id, foreground=False)
        await _flush_markers(node_a)
        return desktop_id, moved_to_background, repeated_background

    desktop_id, moved_to_background, repeated_background = asyncio.run(_run())

    assert moved_to_background["published"] is True
    assert repeated_background["published"] is False
    remaining = desktop_presence.desktop_active_remaining_sec(7)
    assert 110 < remaining <= 120

    # The window ran out (marker expired in the shared store).
    shared_presence_store.record(
        node_id="node-a",
        connection_id=desktop_id,
        user_id=7,
        expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
    )
    assert desktop_presence.desktop_active_remaining_sec(7) == 0.0


def test_desktop_that_only_reports_background_never_silences_push(shared_presence_store, monkeypatch):
    node_a = _node("node-a", monkeypatch)
    native_calls: list = []
    web_calls: list = []
    service = _push_service(monkeypatch, native_calls=native_calls, web_calls=web_calls)

    async def _run():
        desktop_id, _ = await node_a.connect(_Socket(), user_id=7)
        state = node_a.set_desktop_client_state(desktop_id, foreground=False)
        await _flush_markers(node_a)
        return state

    state = asyncio.run(_run())
    result = _send(service, "msg-bg")

    assert state == {"published": False, "expires_in_ms": 0}
    assert result.suppressed == 0
    assert len(web_calls) == 1


def test_mobile_flag_suppresses_native_push_too(shared_presence_store, monkeypatch):
    monkeypatch.setenv("CHAT_PUSH_SUPPRESS_MOBILE_WHEN_DESKTOP_ACTIVE", "1")
    shared_presence_store.record(
        node_id="node-a",
        connection_id="conn-1",
        user_id=7,
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=60),
    )
    native_calls: list = []
    web_calls: list = []
    service = _push_service(monkeypatch, native_calls=native_calls, web_calls=web_calls)

    result = _send(service, "msg-mobile")

    assert result.sent == 0 and result.suppressed == 1
    assert native_calls == [] and web_calls == []


def test_presence_read_error_fails_open(monkeypatch):
    class _BrokenStore:
        def active_until(self, *, user_id):
            raise ConnectionError("presence store down")

    desktop_presence.set_desktop_presence_store("postgres", _BrokenStore())
    monkeypatch.setattr(realtime_module.chat_realtime, "_realtime_transport", "postgres")
    native_calls: list = []
    web_calls: list = []
    service = _push_service(monkeypatch, native_calls=native_calls, web_calls=web_calls)

    assert desktop_presence.desktop_active_remaining_sec(7) is None
    result = _send(service, "msg-fail-open")

    assert result.suppressed == 0
    assert len(web_calls) == 1 and len(native_calls) == 1


def test_client_state_command_validates_acks_and_notifies_user_sockets(monkeypatch):
    from types import SimpleNamespace

    ws_commands = importlib.import_module("backend.chat.ws_commands")
    calls: list[tuple[str, dict]] = []

    class _Realtime:
        def set_desktop_client_state(self, connection_id, *, foreground):
            calls.append(("state", {"connection_id": connection_id, "foreground": foreground}))
            return {"published": True, "expires_in_ms": 120_000}

        async def send_command_ok(self, connection_id, **kwargs):
            calls.append(("ok", kwargs))

        async def publish_user_event(self, **kwargs):
            calls.append(("publish", kwargs))

    monkeypatch.setattr(ws_commands, "_api", lambda: SimpleNamespace(chat_realtime=_Realtime()))
    user = SimpleNamespace(id=7)

    async def _dispatch(payload):
        await ws_commands.dispatch_chat_ws_command(
            current_user=user,
            connection_id="conn-1",
            message_type="chat.client_state",
            request_id="req-1",
            conversation_id=None,
            payload=payload,
        )

    asyncio.run(_dispatch({"client_kind": "desktop", "foreground": True}))
    with pytest.raises(ValueError):
        asyncio.run(_dispatch({"client_kind": "desktop", "foreground": "yes"}))
    with pytest.raises(ValueError):
        asyncio.run(_dispatch({"client_kind": "phone", "foreground": True}))

    assert [name for name, _ in calls] == ["state", "ok", "publish"]
    assert calls[1][1]["payload"]["refresh_interval_ms"] == 40_000
    assert calls[2][1]["event_type"] == "chat.desktop_presence"
    assert calls[2][1]["payload"] == {"user_id": 7, "active": True, "expires_in_ms": 120_000}
