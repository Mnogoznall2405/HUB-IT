"""Exercise the WS session watchdog without importing application/DB singletons."""
import ast
import asyncio
import time
from pathlib import Path
from unittest.mock import AsyncMock
from unittest.mock import Mock
from types import SimpleNamespace

from fastapi import HTTPException


def _lease(revalidate):
    """The part of WsSessionLease the watchdog uses: revalidate() -> 'ok' | 'grace' | 'dead' (or raises)."""
    return SimpleNamespace(revalidate=revalidate, grace_remaining_ms=lambda: 0)


def _watchdog():
    source = Path(__file__).resolve().parents[1] / "WEB-itinvent/backend/api/v1/chat/ws.py"
    tree = ast.parse(source.read_text(encoding="utf-8-sig"))
    function = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef)
                    and node.name == "_ws_session_watchdog")
    namespace = {"asyncio": asyncio, "HTTPException": HTTPException, "Optional": __import__("typing").Optional,
                 "WsSessionLease": object, "WebSocket": object,
                 "_WS_AUTH_REQUIRED_HINT_MS": 5000,
                 "chat_api": lambda: SimpleNamespace(chat_realtime=SimpleNamespace(send_control=AsyncMock())),
                 "run_in_threadpool": AsyncMock(side_effect=lambda fn, *args, **kwargs: fn(*args, **kwargs))}
    module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), function], type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), str(source), "exec"), namespace)
    return namespace["_ws_session_watchdog"]


def test_silent_socket_is_closed_when_session_is_revoked():
    async def run():
        socket = type("Socket", (), {"close": AsyncMock()})()
        outcome = {}
        await asyncio.wait_for(
            _watchdog()(socket, _lease(lambda: "dead"), connection_id="c", interval_sec=0.001, outcome=outcome), 1)
        socket.close.assert_awaited_once_with(code=4401, reason="session expired")
        assert outcome == {"close_code": 4401, "close_reason": "session expired"}
    asyncio.run(run())


def test_watchdog_cancellation_does_not_close_healthy_socket():
    async def run():
        socket = type("Socket", (), {"close": AsyncMock()})()
        task = asyncio.create_task(_watchdog()(socket, _lease(lambda: "ok"), connection_id="c", interval_sec=60))
        await asyncio.sleep(0)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        socket.close.assert_not_awaited()
    asyncio.run(run())


def test_watchdog_validation_failure_closes_transport_without_expiring_auth():
    def unavailable():
        raise ConnectionError("synthetic unavailable store")

    async def run():
        socket = type("Socket", (), {"close": AsyncMock()})()
        await asyncio.wait_for(
            _watchdog()(socket, _lease(unavailable), connection_id="c", interval_sec=0.001), 1)
        socket.close.assert_awaited_once_with(code=1011, reason="session validation unavailable")
    asyncio.run(run())


def test_watchdog_in_grace_asks_the_client_for_fresh_credentials_and_keeps_the_socket():
    async def run():
        sent = AsyncMock()
        statuses = iter(["grace", "dead"])
        lease = SimpleNamespace(revalidate=lambda: next(statuses), grace_remaining_ms=lambda: 4321)
        socket = type("Socket", (), {"close": AsyncMock()})()
        watchdog = _watchdog()
        watchdog.__globals__["chat_api"] = lambda: SimpleNamespace(chat_realtime=SimpleNamespace(send_control=sent))
        await asyncio.wait_for(watchdog(socket, lease, connection_id="c1", interval_sec=0.001), 1)
        sent.assert_awaited_once_with("c1", event_type="chat.auth.required", payload={"retry_after_ms": 4321})
        socket.close.assert_awaited_once_with(code=4401, reason="session expired")
    asyncio.run(run())


def test_periodic_validation_preserves_idle_deadline_but_commands_touch_session():
    source = Path(__file__).resolve().parents[1] / "WEB-itinvent/backend/api/deps.py"
    tree = ast.parse(source.read_text(encoding="utf-8-sig"))
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef)
                    and node.name == "assert_access_token_still_valid")
    session_service = SimpleNamespace(is_session_active=lambda _: True, touch_session=Mock())
    namespace = {
        "HTTPException": HTTPException, "status": SimpleNamespace(HTTP_401_UNAUTHORIZED=401),
        "decode_access_token": lambda *a, **kw: SimpleNamespace(jti="j", session_id="s"),
        "auth_runtime_store_service": SimpleNamespace(is_jti_revoked=lambda _: False),
        "session_service": session_service,
    }
    module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), function], type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), str(source), "exec"), namespace)
    validate = namespace["assert_access_token_still_valid"]
    validate("test", touch_session=False)
    session_service.touch_session.assert_not_called()
    validate("test")
    session_service.touch_session.assert_called_once_with("s")


def test_endpoint_cancels_watchdog_when_peer_disconnects():
    source = Path(__file__).resolve().parents[1] / "WEB-itinvent/backend/api/v1/chat/ws.py"
    tree = ast.parse(source.read_text(encoding="utf-8-sig"))
    function = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef)
                    and node.name == "chat_websocket")
    function.decorator_list = []

    async def run():
        started = asyncio.Event()
        stopped = asyncio.Event()
        class Disconnect(Exception):
            pass

        async def watchdog(*args, **kwargs):
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                stopped.set()

        async def receive():
            await started.wait()
            raise Disconnect()

        runtime = SimpleNamespace(
            connect=AsyncMock(return_value=("c", False)), send_to_connection=AsyncMock(),
            is_connection_registered=lambda _: True,
            disconnect=Mock(return_value={"last_connection": False}),
        )
        api = SimpleNamespace(chat_realtime=runtime, _ws_is_connected=lambda _: True,
                              CHAT_WS_SESSION_REVALIDATE_SEC=30)
        namespace = {
            "asyncio": asyncio, "time": time, "HTTPException": HTTPException,
            "WebSocketDisconnect": Disconnect,
            "get_current_user_from_websocket": AsyncMock(return_value=SimpleNamespace(id=1, is_active=True)),
            "ensure_user_permission": lambda *a: None, "PERM_CHAT_READ": "read",
            "chat_api": lambda: api, "extract_websocket_access_token": lambda _: "test",
            "_ws_post_connect_bootstrap": AsyncMock(), "_ws_session_watchdog": watchdog,
            "WsSessionLease": lambda token, user_id: SimpleNamespace(token=token, user_id=user_id),
        }
        module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), function], type_ignores=[])
        exec(compile(ast.fix_missing_locations(module), str(source), "exec"), namespace)
        await asyncio.wait_for(namespace["chat_websocket"](SimpleNamespace(receive_text=receive)), 1)
        assert stopped.is_set()
        runtime.disconnect.assert_called_once_with("c", close_code=None, close_reason="peer closed")
    asyncio.run(run())


def test_endpoint_prefers_watchdog_reason_over_peer_disconnect_code():
    source = Path(__file__).resolve().parents[1] / "WEB-itinvent/backend/api/v1/chat/ws.py"
    tree = ast.parse(source.read_text(encoding="utf-8-sig"))
    function = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef)
                    and node.name == "chat_websocket")
    function.decorator_list = []

    async def run():
        started = asyncio.Event()
        class Disconnect(Exception):
            def __init__(self):
                self.code = 1006

        async def watchdog(*args, **kwargs):
            outcome = kwargs["outcome"]
            outcome["close_code"] = 4401
            outcome["close_reason"] = "session expired"
            started.set()
            await asyncio.Event().wait()

        async def receive():
            await started.wait()
            raise Disconnect()

        runtime = SimpleNamespace(
            connect=AsyncMock(return_value=("c", False)), send_to_connection=AsyncMock(),
            is_connection_registered=lambda _: True,
            disconnect=Mock(return_value={"last_connection": False}),
        )
        api = SimpleNamespace(chat_realtime=runtime, _ws_is_connected=lambda _: True,
                              CHAT_WS_SESSION_REVALIDATE_SEC=30)
        namespace = {
            "asyncio": asyncio, "time": time, "HTTPException": HTTPException,
            "WebSocketDisconnect": Disconnect,
            "get_current_user_from_websocket": AsyncMock(return_value=SimpleNamespace(id=1, is_active=True)),
            "ensure_user_permission": lambda *a: None, "PERM_CHAT_READ": "read",
            "chat_api": lambda: api, "extract_websocket_access_token": lambda _: "test",
            "_ws_post_connect_bootstrap": AsyncMock(), "_ws_session_watchdog": watchdog,
            "WsSessionLease": lambda token, user_id: SimpleNamespace(token=token, user_id=user_id),
        }
        module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), function], type_ignores=[])
        exec(compile(ast.fix_missing_locations(module), str(source), "exec"), namespace)
        await asyncio.wait_for(namespace["chat_websocket"](SimpleNamespace(receive_text=receive)), 1)
        runtime.disconnect.assert_called_once_with("c", close_code=4401, close_reason="session expired")
    asyncio.run(run())
