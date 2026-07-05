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
