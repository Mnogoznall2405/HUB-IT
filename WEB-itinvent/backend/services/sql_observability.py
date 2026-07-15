"""Low-overhead slow SQL logging without parameter values."""
from __future__ import annotations

import logging
import os
import re
import time

from sqlalchemy import event


logger = logging.getLogger("backend.sql_slow")
_WHITESPACE_RE = re.compile(r"\s+")
_NUMBER_RE = re.compile(r"\b\d+(?:\.\d+)?\b")
_STRING_RE = re.compile(r"'(?:''|[^'])*'")


def _threshold_ms() -> float:
    try:
        return max(50.0, min(60_000.0, float(os.getenv("SQL_SLOW_LOG_MS", "250"))))
    except (TypeError, ValueError):
        return 250.0


def _fingerprint(statement: object) -> str:
    value = _WHITESPACE_RE.sub(" ", str(statement or "")).strip()
    value = _STRING_RE.sub("?", value)
    value = _NUMBER_RE.sub("?", value)
    return value[:1200]


def attach_slow_sql_logging(engine, *, source: str) -> None:
    if getattr(engine, "_itinvent_slow_sql_attached", False):
        return
    setattr(engine, "_itinvent_slow_sql_attached", True)

    @event.listens_for(engine, "before_cursor_execute")
    def _before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        conn.info.setdefault("itinvent_sql_started", []).append(time.perf_counter())

    @event.listens_for(engine, "after_cursor_execute")
    def _after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        stack = conn.info.get("itinvent_sql_started") or []
        started_at = stack.pop() if stack else time.perf_counter()
        duration_ms = (time.perf_counter() - started_at) * 1000.0
        if duration_ms >= _threshold_ms():
            logger.warning(
                "sql.slow source=%s took_ms=%.1f fingerprint=%s",
                source,
                duration_ms,
                _fingerprint(statement),
            )
