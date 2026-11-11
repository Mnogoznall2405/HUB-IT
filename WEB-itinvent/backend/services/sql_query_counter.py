"""Request-scoped SQL query counter for Hub (and other compat) DB paths.

Counts only while an active ContextVar session is open. Startup, workers,
health checks and parallel tests outside that session are ignored.
"""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass, field
from typing import Any, Iterator
from uuid import uuid4


@dataclass
class SqlQuerySession:
    correlation_id: str
    statements: list[str] = field(default_factory=list)

    @property
    def count(self) -> int:
        return len(self.statements)

    def record(self, sql: str) -> None:
        text = str(sql or "").strip()
        if text:
            self.statements.append(text)

    def summary(self) -> dict[str, Any]:
        return {
            "correlation_id": self.correlation_id,
            "query_count": self.count,
            "statements": list(self.statements),
        }


_active_session: ContextVar[SqlQuerySession | None] = ContextVar(
    "hub_sql_query_session",
    default=None,
)


def get_active_sql_query_session() -> SqlQuerySession | None:
    return _active_session.get()


def note_sql_execute(sql: str) -> None:
    session = _active_session.get()
    if session is not None:
        session.record(sql)


@contextmanager
def track_sql_queries(*, correlation_id: str | None = None) -> Iterator[SqlQuerySession]:
    session = SqlQuerySession(correlation_id=str(correlation_id or uuid4()))
    token: Token = _active_session.set(session)
    try:
        yield session
    finally:
        _active_session.reset(token)


@dataclass
class HubStageTimingSample:
    op: str
    stages: dict[str, Any]
    extra: dict[str, Any] = field(default_factory=dict)


_stage_samples: ContextVar[list[HubStageTimingSample] | None] = ContextVar(
    "hub_stage_timing_samples",
    default=None,
)


def note_hub_stage_timing(op: str, *, stages: dict[str, Any], **extra: Any) -> None:
    sink = _stage_samples.get()
    if sink is None:
        return
    # Preserve measured values including real 0.0; do not coerce missing→0.
    normalized_stages: dict[str, Any] = {}
    for key, value in (stages or {}).items():
        if value is None:
            normalized_stages[key] = None
        else:
            try:
                normalized_stages[key] = float(value)
            except (TypeError, ValueError):
                normalized_stages[key] = value
    sink.append(
        HubStageTimingSample(
            op=str(op or ""),
            stages=normalized_stages,
            extra={k: v for k, v in extra.items() if v is not None},
        )
    )


@contextmanager
def track_hub_stage_timings() -> Iterator[list[HubStageTimingSample]]:
    samples: list[HubStageTimingSample] = []
    token: Token = _stage_samples.set(samples)
    try:
        yield samples
    finally:
        _stage_samples.reset(token)


_diag_timings: ContextVar[dict[str, float] | None] = ContextVar(
    "hub_diag_stage_timings",
    default=None,
)


def note_diag_timing(key: str, elapsed_ms: float) -> None:
    sink = _diag_timings.get()
    if sink is None:
        return
    name = str(key or "").strip()
    if not name:
        return
    try:
        value = float(elapsed_ms)
    except (TypeError, ValueError):
        return
    # Sum if the same key is hit multiple times in one workflow.
    sink[name] = round(float(sink.get(name, 0.0)) + value, 3)


@contextmanager
def track_hub_diag_timings() -> Iterator[dict[str, float]]:
    timings: dict[str, float] = {}
    token: Token = _diag_timings.set(timings)
    try:
        yield timings
    finally:
        _diag_timings.reset(token)
