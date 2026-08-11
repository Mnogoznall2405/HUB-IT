"""Small, cached PostgreSQL connection snapshot for runtime health checks."""
from __future__ import annotations

import os
import threading
import time
from typing import Any

from sqlalchemy import text


def _positive_int(value: object, default: int, *, minimum: int = 0) -> int:
    try:
        return max(minimum, int(value))
    except (TypeError, ValueError):
        return max(minimum, int(default))


def build_connection_snapshot(
    *,
    max_connections: int,
    state_counts: dict[str, int],
    reserve_target: int,
) -> dict[str, Any]:
    """Normalize a ``pg_stat_activity`` state aggregate into a health payload."""
    normalized_states = {
        str(state or "unknown"): max(0, int(count or 0))
        for state, count in dict(state_counts or {}).items()
    }
    maximum = _positive_int(max_connections, 0)
    reserve = _positive_int(reserve_target, 20)
    total = sum(normalized_states.values())
    available = max(0, maximum - total)
    shortfall = max(0, reserve - available)
    return {
        "available": maximum > 0,
        "max_connections": maximum,
        "total_connections": total,
        "active_connections": int(normalized_states.get("active", 0)),
        "idle_connections": int(normalized_states.get("idle", 0)),
        "available_connections": available,
        "reserve_target": reserve,
        "reserve_available": shortfall == 0,
        "reserve_shortfall": shortfall,
    }


class PostgresConnectionMetrics:
    """Avoid an extra catalog query on every health request."""

    def __init__(self, *, cache_ttl_sec: float = 5.0):
        self._cache_ttl_sec = max(0.5, float(cache_ttl_sec))
        self._lock = threading.Lock()
        self._cached_at = 0.0
        self._cached_payload: dict[str, Any] | None = None

    def get_snapshot(self, *, force: bool = False) -> dict[str, Any]:
        now = time.monotonic()
        with self._lock:
            if (
                not force
                and self._cached_payload is not None
                and (now - self._cached_at) < self._cache_ttl_sec
            ):
                return dict(self._cached_payload)

        reserve_target = _positive_int(os.getenv("POSTGRES_CONNECTION_RESERVE", "20"), 20)
        try:
            from backend.chat.db import get_chat_database_url, get_chat_read_engine

            database_url = get_chat_database_url()
            if not database_url.lower().startswith("postgres"):
                payload: dict[str, Any] = {
                    "available": False,
                    "reason": "not_postgresql",
                    "reserve_target": reserve_target,
                }
            else:
                with get_chat_read_engine(database_url).connect() as connection:
                    maximum = connection.execute(
                        text("SELECT current_setting('max_connections')::integer")
                    ).scalar_one()
                    rows = connection.execute(
                        text(
                            """
                            SELECT COALESCE(state, 'unknown') AS state, COUNT(*) AS count
                            FROM pg_stat_activity
                            WHERE datname = current_database()
                            GROUP BY COALESCE(state, 'unknown')
                            """
                        )
                    ).mappings().all()
                payload = build_connection_snapshot(
                    max_connections=int(maximum),
                    state_counts={str(row["state"]): int(row["count"]) for row in rows},
                    reserve_target=reserve_target,
                )
        except Exception as exc:  # health must remain informative, not fail closed
            payload = {
                "available": False,
                "reason": "query_failed",
                "error": str(exc)[:180],
                "reserve_target": reserve_target,
            }

        with self._lock:
            self._cached_at = time.monotonic()
            self._cached_payload = dict(payload)
        return dict(payload)


postgres_connection_metrics = PostgresConnectionMetrics()
