from __future__ import annotations

import asyncio
import importlib
import sys
from pathlib import Path
from types import SimpleNamespace


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

realtime_module = importlib.import_module("backend.chat.realtime")


class _Manager:
    async def handle_distributed_event(self, _payload):
        return None


class _FakePubSub:
    def __init__(self, *, fail_first_read: bool = False) -> None:
        self.fail_first_read = fail_first_read
        self.read_count = 0
        self.subscribed = False
        self.closed = False

    async def subscribe(self, _channel: str) -> None:
        self.subscribed = True

    async def get_message(self, **_kwargs):
        self.read_count += 1
        if self.fail_first_read and self.read_count == 1:
            raise ConnectionError("listener disconnected")
        await asyncio.sleep(0.001)
        return None

    async def close(self) -> None:
        self.closed = True


class _FakeRedisClient:
    def __init__(self, *, pubsub=None, publish_error: Exception | None = None) -> None:
        self._pubsub = pubsub
        self._publish_error = publish_error
        self.closed = False

    async def ping(self) -> bool:
        return True

    def pubsub(self, **_kwargs):
        assert self._pubsub is not None
        return self._pubsub

    async def publish(self, _channel: str, _payload: str) -> int:
        if self._publish_error is not None:
            raise self._publish_error
        return 1

    async def close(self) -> None:
        self.closed = True


class _ClientFactory:
    def __init__(self, clients) -> None:
        self.clients = list(clients)
        self.calls = 0

    def from_url(self, _url: str, **_kwargs):
        client = self.clients[self.calls]
        self.calls += 1
        return client


async def _wait_until(predicate, *, timeout: float = 0.5) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while not predicate():
        if asyncio.get_running_loop().time() >= deadline:
            raise AssertionError("condition was not reached before timeout")
        await asyncio.sleep(0.002)


def _configure_fake_redis(monkeypatch, factory: _ClientFactory) -> None:
    monkeypatch.setattr(realtime_module.config.redis, "url", "redis://fake")
    monkeypatch.setattr(realtime_module.config.redis, "password", "")
    monkeypatch.setattr(
        realtime_module,
        "redis_asyncio",
        SimpleNamespace(Redis=SimpleNamespace(from_url=factory.from_url)),
    )
    monkeypatch.setenv("CHAT_REDIS_RECONNECT_BASE_SEC", "0.01")
    monkeypatch.setenv("CHAT_REDIS_RECONNECT_MAX_SEC", "0.02")
    monkeypatch.setenv("CHAT_REDIS_RECONNECT_JITTER_RATIO", "0")


def test_listener_failure_marks_unavailable_then_reconnects(monkeypatch):
    first_pubsub = _FakePubSub(fail_first_read=True)
    second_pubsub = _FakePubSub()
    first_pub = _FakeRedisClient()
    first_sub = _FakeRedisClient(pubsub=first_pubsub)
    second_pub = _FakeRedisClient()
    second_sub = _FakeRedisClient(pubsub=second_pubsub)
    factory = _ClientFactory([first_pub, first_sub, second_pub, second_sub])
    _configure_fake_redis(monkeypatch, factory)

    async def _run() -> None:
        bus = realtime_module.ChatRealtimeRedisBus(_Manager())
        await bus.start()
        await _wait_until(
            lambda: factory.calls == 4 and bus.redis_available and bus.pubsub_subscribed
        )

        assert first_pub.closed is True
        assert first_sub.closed is True
        assert first_pubsub.closed is True

        await bus.stop()

        assert bus.redis_available is False
        assert bus.pubsub_subscribed is False
        assert second_pub.closed is True
        assert second_sub.closed is True
        assert second_pubsub.closed is True

    asyncio.run(_run())


def test_publish_failure_immediately_marks_bus_unavailable(monkeypatch):
    pubsub = _FakePubSub()
    pub = _FakeRedisClient(publish_error=ConnectionError("publish disconnected"))
    sub = _FakeRedisClient(pubsub=pubsub)
    factory = _ClientFactory([pub, sub])
    _configure_fake_redis(monkeypatch, factory)

    async def _run() -> None:
        bus = realtime_module.ChatRealtimeRedisBus(_Manager())
        await bus.start()
        await _wait_until(lambda: bus.redis_available and bus.pubsub_subscribed)

        assert await bus.publish({"type": "chat.message.created"}) is False
        assert bus.redis_available is False
        assert bus.pubsub_subscribed is False

        await bus.stop()

    asyncio.run(_run())


def test_reconnect_delay_uses_exponential_backoff_jitter_and_cap(monkeypatch):
    monkeypatch.setenv("CHAT_REDIS_RECONNECT_BASE_SEC", "1")
    monkeypatch.setenv("CHAT_REDIS_RECONNECT_MAX_SEC", "5")
    monkeypatch.setenv("CHAT_REDIS_RECONNECT_JITTER_RATIO", "0.5")
    monkeypatch.setattr(realtime_module.random, "uniform", lambda _low, high: high)

    bus = realtime_module.ChatRealtimeRedisBus(_Manager())

    assert bus._reconnect_delay(0) == 1.5
    assert bus._reconnect_delay(1) == 3.0
    assert bus._reconnect_delay(2) == 5.0
    assert bus._reconnect_delay(10) == 5.0


def test_stop_cancels_pending_connect_and_closes_partial_clients(monkeypatch):
    async def _run() -> None:
        ping_started = asyncio.Event()
        never_finish = asyncio.Event()

        class _BlockingPingClient(_FakeRedisClient):
            async def ping(self) -> bool:
                ping_started.set()
                await never_finish.wait()
                return True

        pub = _BlockingPingClient()
        sub = _FakeRedisClient(pubsub=_FakePubSub())
        factory = _ClientFactory([pub, sub])
        _configure_fake_redis(monkeypatch, factory)
        bus = realtime_module.ChatRealtimeRedisBus(_Manager())

        await bus.start()
        await asyncio.wait_for(ping_started.wait(), timeout=0.2)
        await asyncio.wait_for(bus.stop(), timeout=0.2)

        assert pub.closed is True
        assert sub.closed is True
        assert bus.redis_available is False
        assert bus.pubsub_subscribed is False

    asyncio.run(_run())
