from __future__ import annotations

from backend.chat.request_metrics import (
    get_chat_route_metrics,
    record_chat_route_cache,
    record_chat_route_timing,
)


def test_route_metrics_include_cache_hit_rate() -> None:
    record_chat_route_timing("thread_bootstrap", 120.0)
    record_chat_route_cache("thread_bootstrap", True)
    record_chat_route_cache("thread_bootstrap", False)

    metrics = get_chat_route_metrics()
    route = metrics.get("thread_bootstrap") or {}

    assert route.get("count") == 1.0
    assert route.get("cache_hits") == 1.0
    assert route.get("cache_misses") == 1.0
    assert route.get("cache_hit_rate_pct") == 50.0
