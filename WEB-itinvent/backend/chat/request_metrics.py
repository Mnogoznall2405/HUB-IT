from __future__ import annotations

from collections import deque
from threading import Lock

_MAX_SAMPLES = 512
_lock = Lock()
_samples: dict[str, deque[float]] = {}
_cache_hits: dict[str, int] = {}
_cache_misses: dict[str, int] = {}


def record_chat_route_timing(route_name: str, took_ms: float) -> None:
    normalized_route = str(route_name or "").strip()
    if not normalized_route:
        return
    with _lock:
        bucket = _samples.setdefault(normalized_route, deque(maxlen=_MAX_SAMPLES))
        bucket.append(float(took_ms))


def record_chat_route_cache(route_name: str, cache_hit: bool) -> None:
    normalized_route = str(route_name or "").strip()
    if not normalized_route:
        return
    with _lock:
        if bool(cache_hit):
            _cache_hits[normalized_route] = int(_cache_hits.get(normalized_route, 0)) + 1
        else:
            _cache_misses[normalized_route] = int(_cache_misses.get(normalized_route, 0)) + 1


def get_chat_route_metrics() -> dict[str, dict[str, float]]:
    with _lock:
        result: dict[str, dict[str, float]] = {}
        for route_name, samples in _samples.items():
            if not samples:
                continue
            values = sorted(float(item) for item in samples)
            count = len(values)
            p95_index = max(0, min(count - 1, int(count * 0.95) - 1))
            hits = int(_cache_hits.get(route_name, 0))
            misses = int(_cache_misses.get(route_name, 0))
            cache_total = hits + misses
            cache_hit_rate = round((hits / cache_total) * 100.0, 1) if cache_total > 0 else 0.0
            result[route_name] = {
                "count": float(count),
                "avg_ms": round(sum(values) / count, 1),
                "p95_ms": round(values[p95_index], 1),
                "cache_hits": float(hits),
                "cache_misses": float(misses),
                "cache_hit_rate_pct": cache_hit_rate,
            }
        return result
