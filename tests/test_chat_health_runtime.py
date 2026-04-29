from __future__ import annotations

import asyncio
import importlib
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

chat_service_module = importlib.import_module("backend.chat.service")
main_module = importlib.import_module("backend.main")


def test_chat_service_health_includes_realtime_mode_and_outbox_age(monkeypatch):
    class _Status:
        enabled = True
        configured = True
        available = True
        database_url_masked = "postgresql://***"

    monkeypatch.setattr(chat_service_module.chat_service, "initialize_runtime", lambda force=True: _Status())

    class _OutboxService:
        @staticmethod
        def get_backlog_snapshot():
            return {
                "queued": 4,
                "processing": 1,
                "failed": 2,
                "oldest_queued_age_sec": 18.5,
            }

    class _EventOutboxService:
        @staticmethod
        def get_backlog_snapshot():
            return {
                "queued": 3,
                "processing": 2,
                "failed": 1,
                "oldest_queued_age_sec": 9.5,
                "dispatcher_active": 1,
                "avg_job_ms": 12.5,
            }

    fake_realtime_metrics = {
        "redis_available": True,
        "redis_configured": True,
        "pubsub_subscribed": True,
        "realtime_node_id": "node-a",
        "outbound_queue_depth": 7,
        "slow_consumer_disconnects": 1,
        "presence_watch_count": 6,
        "local_connection_count": 3,
        "ws_rate_limited_count": 5,
        "ws_rate_limited_connections": 2,
    }

    monkeypatch.setitem(sys.modules, "backend.chat.push_outbox_service", type("_PushOutboxModule", (), {
        "chat_push_outbox_service": _OutboxService(),
    })())
    monkeypatch.setitem(sys.modules, "backend.chat.event_outbox_service", type("_EventOutboxModule", (), {
        "chat_event_outbox_service": _EventOutboxService(),
    })())
    monkeypatch.setitem(sys.modules, "backend.chat.realtime", type("_RealtimeModule", (), {
        "get_chat_realtime_metrics": staticmethod(lambda: fake_realtime_metrics),
    })())
    monkeypatch.setitem(sys.modules, "backend.ai_chat.retrieval_interface", type("_RetrievalModule", (), {
        "ai_kb_retrieval": type("_Retrieval", (), {
            "get_metrics": staticmethod(lambda: {"index_age_sec": 21.5}),
        })(),
    })())
    monkeypatch.setitem(sys.modules, "backend.ai_chat.service", type("_AiChatModule", (), {
        "get_ai_chat_runtime_metrics": staticmethod(lambda: {"last_run_duration_ms": 3456.7}),
    })())
    monkeypatch.setenv("AI_CHAT_WORKER_CONCURRENCY", "3")

    payload = chat_service_module.chat_service.get_health()

    assert payload["available"] is True
    assert payload["realtime_mode"] == "redis"
    assert payload["redis_available"] is True
    assert payload["pubsub_subscribed"] is True
    assert payload["push_outbox_backlog"] == 4
    assert payload["push_outbox_oldest_queued_age_sec"] == 18.5
    assert payload["event_outbox_backlog"] == 3
    assert payload["event_outbox_processing"] == 2
    assert payload["event_outbox_failed"] == 1
    assert payload["event_outbox_oldest_queued_age_sec"] == 9.5
    assert payload["event_dispatcher_active"] is True
    assert payload["event_outbox_avg_job_ms"] == 12.5
    assert payload["ws_rate_limited_count"] == 5
    assert payload["ws_rate_limited_connections"] == 2
    assert payload["ai_worker_concurrency"] == 3
    assert payload["ai_kb_index_age_sec"] == 21.5
    assert payload["ai_last_run_duration_ms"] == 3456.7


def test_main_health_check_includes_chat_snapshot_when_enabled(monkeypatch):
    async def _fake_run_sync(func, *args, **kwargs):
        return {
            "enabled": True,
            "available": True,
            "configured": True,
            "realtime_mode": "redis",
            "redis_configured": True,
            "redis_available": True,
            "pubsub_subscribed": True,
            "push_outbox_backlog": 0,
            "push_outbox_oldest_queued_age_sec": 0.0,
            "event_outbox_backlog": 0,
            "event_outbox_oldest_queued_age_sec": 0.0,
            "event_dispatcher_active": True,
        }

    monkeypatch.setattr(main_module.config.chat, "enabled", True, raising=False)
    monkeypatch.setattr(main_module.to_thread, "run_sync", _fake_run_sync)

    payload = asyncio.run(main_module.health_check())

    assert payload["status"] == "ok"
    assert payload["version"]
    assert payload["chat"]["realtime_mode"] == "redis"
    assert payload["chat"]["redis_available"] is True
    assert payload["chat"]["event_dispatcher_active"] is True
