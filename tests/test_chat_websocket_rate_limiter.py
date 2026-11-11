import asyncio
import importlib
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))


def test_chat_ws_rate_limiter_allows_burst_then_limits(monkeypatch):
    chat_realtime = importlib.import_module("backend.chat.realtime")
    now = 1000.0
    monkeypatch.setattr(chat_realtime.time, "monotonic", lambda: now)
    limiter = chat_realtime.ChatWsCommandRateLimiter(rate_per_sec=20, burst=2)

    assert limiter.allow()[0] is True
    assert limiter.allow()[0] is True

    allowed, retry_after_ms = limiter.allow()

    assert allowed is False
    assert retry_after_ms >= 1000
    assert limiter.violations == 1


def test_chat_ws_rate_limiter_refills_over_time(monkeypatch):
    chat_realtime = importlib.import_module("backend.chat.realtime")
    current = {"now": 1000.0}
    monkeypatch.setattr(chat_realtime.time, "monotonic", lambda: current["now"])
    limiter = chat_realtime.ChatWsCommandRateLimiter(rate_per_sec=2, burst=1)

    assert limiter.allow()[0] is True
    assert limiter.allow()[0] is False

    current["now"] += 0.5

    assert limiter.allow()[0] is True


def test_chat_ws_rate_limiter_is_shared_per_user():
    chat_realtime = importlib.import_module("backend.chat.realtime")
    manager = chat_realtime.ChatRealtimeManager()

    _, _, limiter_a1 = manager.allow_ws_command(7)
    _, _, limiter_a2 = manager.allow_ws_command(7)
    _, _, limiter_b = manager.allow_ws_command(8)

    assert limiter_a1 is limiter_a2
    assert limiter_b is not limiter_a1


def test_chat_ws_rate_limiter_resets_violations_after_quiet_window(monkeypatch):
    chat_realtime = importlib.import_module("backend.chat.realtime")
    current = {"now": 1000.0}
    monkeypatch.setattr(chat_realtime.time, "monotonic", lambda: current["now"])
    limiter = chat_realtime.ChatWsCommandRateLimiter(rate_per_sec=20, burst=1)

    assert limiter.allow()[0] is True
    assert limiter.allow()[0] is False
    assert limiter.violations == 1

    # Violations still counted while the quiet window has not elapsed.
    current["now"] += 30.0
    assert limiter.allow()[0] is True
    assert limiter.allow()[0] is False
    assert limiter.violations == 2

    current["now"] += 61.0
    assert limiter.allow()[0] is True
    assert limiter.violations == 0

    # A new violation starts a fresh count instead of accumulating forever.
    assert limiter.allow()[0] is False
    assert limiter.violations == 1


def _compile_chat_websocket():
    """Exec chat_websocket without importing the app (no .env, no DB handles)."""
    import ast

    source = Path(__file__).resolve().parents[1] / "WEB-itinvent/backend/api/v1/chat/ws.py"
    tree = ast.parse(source.read_text(encoding="utf-8-sig"))
    function = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef)
                    and node.name == "chat_websocket")
    function.decorator_list = []
    module = ast.Module(
        body=[
            ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0),
            function,
        ],
        type_ignores=[],
    )
    ast.fix_missing_locations(module)
    return source, module


def test_rate_limited_command_echoes_request_id_and_closes_with_4429():
    import json
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, Mock

    source, module = _compile_chat_websocket()

    async def run():
        frames = [
            "not-a-json-payload",
            json.dumps({"type": "chat.send_message", "request_id": "req-77", "payload": {}}),
            json.dumps({"type": "chat.send_message", "request_id": "req-78", "payload": {}}),
        ]
        incoming = list(frames)

        class Disconnect(Exception):
            def __init__(self):
                self.code = 1006

        async def receive_text():
            if incoming:
                return incoming.pop(0)
            raise Disconnect()

        socket = SimpleNamespace(receive_text=receive_text, close=AsyncMock())

        async def watchdog(*args, **kwargs):
            await asyncio.Event().wait()

        limiter = SimpleNamespace(violations=0)

        def allow_ws_command(_user_id):
            limiter.violations += 1
            return False, 1500, limiter

        runtime = SimpleNamespace(
            connect=AsyncMock(return_value=("conn-1", False)),
            send_to_connection=AsyncMock(),
            send_error=AsyncMock(),
            is_connection_registered=lambda _cid: True,
            disconnect=Mock(return_value={"last_connection": False, "user_id": 1}),
            record_rate_limited=Mock(),
            allow_ws_command=allow_ws_command,
        )
        api = SimpleNamespace(
            chat_realtime=runtime,
            _ws_is_connected=lambda _ws: True,
            CHAT_WS_SESSION_REVALIDATE_SEC=30,
            CHAT_WS_RATE_LIMIT_MAX_VIOLATIONS=3,
            logger=SimpleNamespace(warning=Mock(), exception=Mock(), info=Mock()),
        )
        namespace = {
            "asyncio": asyncio, "time": __import__("time"), "json": json,
            "HTTPException": __import__("fastapi").HTTPException,
            "WebSocketDisconnect": Disconnect,
            "get_current_user_from_websocket": AsyncMock(
                return_value=SimpleNamespace(id=1, is_active=True),
            ),
            "ensure_user_permission": lambda *a: None, "PERM_CHAT_READ": "read",
            "chat_api": lambda: api,
            "extract_websocket_access_token": lambda _ws: "tok",
            "WsSessionLease": Mock(),
            "_ws_post_connect_bootstrap": AsyncMock(),
            "_ws_session_watchdog": watchdog,
            "dispatch_chat_ws_command": AsyncMock(),
            "run_in_threadpool": AsyncMock(),
        }
        exec(compile(module, str(source), "exec"), namespace)
        await asyncio.wait_for(namespace["chat_websocket"](socket), 2)

        error_calls = [
            call for call in runtime.send_to_connection.await_args_list
            if call.kwargs.get("event_type") == "error"
        ]
        assert len(error_calls) == 3
        assert [call.kwargs["request_id"] for call in error_calls] == [None, "req-77", "req-78"]
        assert all(
            call.kwargs["payload"] == {"code": "rate_limited", "retry_after_ms": 1500}
            for call in error_calls
        )
        socket.close.assert_awaited_once()
        assert socket.close.await_args.kwargs["code"] == 4429
        assert "retry_after_ms=1500" in socket.close.await_args.kwargs["reason"]
        runtime.disconnect.assert_called_once_with(
            "conn-1",
            close_code=4429,
            close_reason=socket.close.await_args.kwargs["reason"],
        )

    asyncio.run(run())


def test_chat_ws_rate_limiter_cleared_when_last_connection_disconnects():
    chat_realtime = importlib.import_module("backend.chat.realtime")
    manager = chat_realtime.ChatRealtimeManager()

    _, _, limiter_before = manager.allow_ws_command(42)

    class DummyWebSocket:
        async def accept(self) -> None:
            return None

        async def close(self, code: int = 1000, reason: str = "") -> None:
            return None

        async def send_json(self, envelope: dict) -> None:
            return None

    async def _exercise() -> None:
        connection_id, _ = await manager.connect(DummyWebSocket(), user_id=42)
        _, _, limiter_connected = manager.allow_ws_command(42)
        assert limiter_connected is limiter_before
        disconnect_state = manager.disconnect(connection_id)
        assert disconnect_state["last_connection"] is True
        _, _, limiter_after = manager.allow_ws_command(42)
        assert limiter_after is not limiter_before

    asyncio.run(_exercise())
