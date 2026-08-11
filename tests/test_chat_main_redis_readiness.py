from __future__ import annotations

import asyncio
import importlib
import json
import sys
from pathlib import Path

from fastapi.responses import JSONResponse


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

chat_main = importlib.import_module("backend.chat_main")


def _patch_chat_health(
    monkeypatch,
    *,
    redis_available: bool,
    pubsub_subscribed: bool,
    realtime_transport: str | None = None,
    realtime_available: bool | None = None,
    realtime_subscriber_ready: bool | None = None,
) -> None:
    async def _run_sync(_func, *_args, **_kwargs):
        payload = {
            "enabled": True,
            "configured": True,
            "available": True,
            "redis_configured": True,
            "redis_available": redis_available,
            "pubsub_subscribed": pubsub_subscribed,
        }
        if realtime_transport is not None:
            payload.update(
                {
                    "realtime_transport": realtime_transport,
                    "realtime_configured": True,
                    "realtime_available": bool(realtime_available),
                    "realtime_subscriber_ready": bool(realtime_subscriber_ready),
                }
            )
        return payload

    monkeypatch.setattr(chat_main.to_thread, "run_sync", _run_sync)


def test_strict_readiness_returns_503_until_redis_pubsub_is_ready(monkeypatch):
    monkeypatch.setenv("CHAT_REDIS_REQUIRED", "1")
    _patch_chat_health(monkeypatch, redis_available=False, pubsub_subscribed=False)

    response = asyncio.run(chat_main.health_ready())

    assert isinstance(response, JSONResponse)
    assert response.status_code == 503
    payload = json.loads(response.body)
    assert payload["status"] == "degraded"
    assert payload["redis_required"] is True
    assert payload["chat"]["redis_available"] is False
    assert payload["chat"]["pubsub_subscribed"] is False


def test_strict_readiness_is_ok_when_redis_and_pubsub_are_ready(monkeypatch):
    monkeypatch.setenv("CHAT_REDIS_REQUIRED", "true")
    _patch_chat_health(monkeypatch, redis_available=True, pubsub_subscribed=True)

    payload = asyncio.run(chat_main.health_ready())

    assert isinstance(payload, dict)
    assert payload["status"] == "ok"
    assert payload["redis_required"] is True


def test_default_readiness_keeps_local_realtime_mode_compatible(monkeypatch):
    monkeypatch.delenv("CHAT_REDIS_REQUIRED", raising=False)
    monkeypatch.delenv("CHAT_REALTIME_REQUIRED", raising=False)
    _patch_chat_health(monkeypatch, redis_available=False, pubsub_subscribed=False)

    payload = asyncio.run(chat_main.health_ready())

    assert isinstance(payload, dict)
    assert payload["status"] == "ok"
    assert payload["redis_required"] is False


def test_generic_strict_readiness_accepts_postgres_subscriber(monkeypatch):
    monkeypatch.delenv("CHAT_REDIS_REQUIRED", raising=False)
    monkeypatch.setenv("CHAT_REALTIME_REQUIRED", "1")
    _patch_chat_health(
        monkeypatch,
        redis_available=False,
        pubsub_subscribed=False,
        realtime_transport="postgres",
        realtime_available=True,
        realtime_subscriber_ready=True,
    )

    payload = asyncio.run(chat_main.health_ready())

    assert isinstance(payload, dict)
    assert payload["status"] == "ok"
    assert payload["realtime_required"] is True


def test_generic_strict_readiness_rejects_unsubscribed_postgres(monkeypatch):
    monkeypatch.delenv("CHAT_REDIS_REQUIRED", raising=False)
    monkeypatch.setenv("CHAT_REALTIME_REQUIRED", "true")
    _patch_chat_health(
        monkeypatch,
        redis_available=False,
        pubsub_subscribed=False,
        realtime_transport="postgres",
        realtime_available=True,
        realtime_subscriber_ready=False,
    )

    response = asyncio.run(chat_main.health_ready())

    assert isinstance(response, JSONResponse)
    assert response.status_code == 503
