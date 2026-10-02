import asyncio
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))


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


def _run_commands_with_exceptions(exceptions):
    """Drive chat_websocket with dispatch raising each exception in turn.

    Returns (send_error_await_args_list, socket_close_mock).
    """
    import json
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, Mock

    from fastapi import HTTPException

    source, module = _compile_chat_websocket()

    async def run():
        frames = [
            json.dumps({
                "type": "chat.send_message",
                "request_id": f"req-{index}",
                "conversation_id": "conv-1",
                "payload": {"body": "x"},
            })
            for index in range(len(exceptions))
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

        dispatch = AsyncMock()
        for exc in exceptions:
            if isinstance(exc, HTTPException):
                dispatch.side_effect = list(exceptions)
                break
        dispatch.side_effect = list(exceptions)

        limiter = SimpleNamespace(violations=0)
        runtime = SimpleNamespace(
            connect=AsyncMock(return_value=("conn-1", False)),
            send_to_connection=AsyncMock(),
            send_error=AsyncMock(),
            send_control=AsyncMock(),
            touch_presence=Mock(),
            is_connection_registered=lambda _cid: True,
            disconnect=Mock(return_value={"last_connection": False, "user_id": 1}),
            record_rate_limited=Mock(),
            allow_ws_command=lambda _uid: (True, 0, limiter),
        )
        api = SimpleNamespace(
            chat_realtime=runtime,
            _ws_is_connected=lambda _ws: True,
            CHAT_WS_SESSION_REVALIDATE_SEC=30,
            CHAT_WS_SESSION_REVALIDATE_COMMAND_INTERVAL=100,
            CHAT_WS_RATE_LIMIT_MAX_VIOLATIONS=3,
            logger=SimpleNamespace(warning=Mock(), exception=Mock(), info=Mock()),
        )
        namespace = {
            "asyncio": asyncio, "time": __import__("time"), "json": json,
            "HTTPException": HTTPException,
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
            "dispatch_chat_ws_command": dispatch,
            "run_in_threadpool": AsyncMock(),
            "_WS_AUTH_REQUIRED_HINT_MS": 5000,
        }
        exec(compile(module, str(source), "exec"), namespace)
        await asyncio.wait_for(namespace["chat_websocket"](socket), 2)
        return runtime.send_error.await_args_list, socket.close

    return asyncio.run(run())


def test_ws_command_error_maps_value_error_to_validation_error():
    calls, _ = _run_commands_with_exceptions([ValueError("bad text")])
    assert len(calls) == 1
    assert calls[0].kwargs["code"] == "validation_error"
    assert calls[0].kwargs["request_id"] == "req-0"


def test_ws_command_error_maps_permission_error_to_forbidden():
    calls, _ = _run_commands_with_exceptions([PermissionError("not a member")])
    assert len(calls) == 1
    assert calls[0].kwargs["code"] == "forbidden"
    assert calls[0].kwargs["request_id"] == "req-0"


def test_ws_command_error_maps_http_403_to_forbidden():
    from fastapi import HTTPException

    calls, _ = _run_commands_with_exceptions([HTTPException(status_code=403, detail="denied")])
    assert len(calls) == 1
    assert calls[0].kwargs["code"] == "forbidden"


def test_ws_command_error_maps_unexpected_to_command_failed():
    calls, _ = _run_commands_with_exceptions([RuntimeError("boom")])
    assert len(calls) == 1
    assert calls[0].kwargs["code"] == "command_failed"
    assert calls[0].kwargs["detail"] == "Command failed"


def test_ws_command_error_codes_for_mixed_failures_in_one_session():
    from fastapi import HTTPException

    calls, _ = _run_commands_with_exceptions([
        ValueError("v"),
        PermissionError("p"),
        HTTPException(status_code=503, detail="upstream"),
        KeyError("k"),
    ])
    assert [call.kwargs["code"] for call in calls] == [
        "validation_error",
        "forbidden",
        "command_failed",
        "command_failed",
    ]
    assert [call.kwargs["request_id"] for call in calls] == ["req-0", "req-1", "req-2", "req-3"]
