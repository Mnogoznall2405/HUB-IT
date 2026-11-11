from __future__ import annotations

from types import SimpleNamespace

import pytest


class _RealtimeStub:
    def __init__(self) -> None:
        self.command_oks: list[dict] = []

    async def send_command_ok(self, connection_id: str, **kwargs) -> None:
        self.command_oks.append({"connection_id": connection_id, **kwargs})


def _install_mark_read_stubs(monkeypatch, *, changed: bool):
    import backend.api.v1.chat as chat_api

    scheduled: list[str] = []
    published: list[dict] = []
    cleared: list[dict] = []
    realtime = _RealtimeStub()

    async def _run_mark_read(_func, /, *args, **kwargs):
        return {
            "conversation_id": kwargs["conversation_id"],
            "message_id": kwargs["message_id"],
            "read_at": "2026-08-06T09:00:00Z",
            "changed": changed,
            "clear_hub_notifications": changed,
        }

    def _publish(**kwargs):
        published.append(kwargs)
        return ("publish", kwargs)

    def _clear(**kwargs):
        cleared.append(kwargs)
        return ("clear", kwargs)

    def _schedule(_work, *, label: str):
        scheduled.append(label)
        return SimpleNamespace()

    monkeypatch.setattr(chat_api, "chat_service", SimpleNamespace(mark_read=object()))
    monkeypatch.setattr(chat_api, "chat_realtime", realtime)
    monkeypatch.setattr(chat_api, "_run_chat_mark_read_call", _run_mark_read)
    monkeypatch.setattr(chat_api, "_publish_message_read_after_mark_read", _publish)
    monkeypatch.setattr(chat_api, "_clear_hub_notifications_after_mark_read", _clear)
    monkeypatch.setattr(chat_api, "_schedule_chat_background_task", _schedule)
    monkeypatch.setattr(chat_api, "_log_ws_command_timing", lambda *args, **kwargs: None)
    return scheduled, published, cleared, realtime


@pytest.mark.asyncio
@pytest.mark.parametrize("changed", [False, True])
async def test_http_mark_read_publishes_only_when_state_changed(monkeypatch, changed):
    from backend.api.v1.chat import messages
    from backend.chat.schemas import MarkReadRequest

    scheduled, published, cleared, _realtime = _install_mark_read_stubs(
        monkeypatch,
        changed=changed,
    )
    request = SimpleNamespace(
        state=SimpleNamespace(chat_asgi_received_at=0.0, chat_middleware_enter_at=0.0)
    )

    payload = await messages.mark_chat_conversation_read(
        conversation_id="c-1",
        payload=MarkReadRequest(message_id="m-1"),
        request=request,
        current_user=SimpleNamespace(id=7),
    )

    assert payload["message_id"] == "m-1"
    assert (len(published), len(cleared), scheduled) == (
        (1, 1, ["publish_message_read", "clear_hub_notifications_after_mark_read"])
        if changed
        else (0, 0, [])
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("changed", [False, True])
async def test_ws_mark_read_publishes_only_when_state_changed(monkeypatch, changed):
    from backend.chat.ws_commands import dispatch_chat_ws_command

    scheduled, published, cleared, realtime = _install_mark_read_stubs(
        monkeypatch,
        changed=changed,
    )

    await dispatch_chat_ws_command(
        current_user=SimpleNamespace(id=7),
        connection_id="ws-1",
        message_type="chat.mark_read",
        request_id="req-1",
        conversation_id="c-1",
        payload={"message_id": "m-1"},
    )

    assert len(realtime.command_oks) == 1
    assert (len(published), len(cleared), scheduled) == (
        (1, 1, ["publish_message_read", "clear_hub_notifications_after_mark_read"])
        if changed
        else (0, 0, [])
    )
