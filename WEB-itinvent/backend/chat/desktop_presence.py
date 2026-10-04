"""Distributed "HUB Desktop is active" markers for chat notification routing.

Policy: a user is *desktop-active* while one of their chat WebSockets comes from
HUB Desktop (WebView2) and that window was in the foreground during the last
``CHAT_DESKTOP_ACTIVE_WINDOW_SEC`` seconds. While desktop-active the browser
Web Push for chat messages is not sent (the desktop shows its own toast).

Markers reuse the existing distributed presence storage, so every chat node and
the separate push worker see the same state without a new service or table:

- ``postgres`` transport: rows in ``chat_realtime_presence`` whose
  ``connection_id`` is ``desktop:<ws connection id>`` and ``expires_at`` is the
  end of the activity window. Regular presence readers skip these rows.
- ``redis`` transport: hash ``<CHAT_DESKTOP_PRESENCE_PREFIX>:<user_id>`` with
  ``connection_id -> expires_at epoch``.
- ``local`` transport: in-process only (single node).

Read errors return ``None`` so callers fail open (push is sent as before).
"""
from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

from backend.chat.utils import normalize_text as _normalize_text


logger = logging.getLogger("backend.chat.desktop_presence")

DESKTOP_MARKER_PREFIX = "desktop:"
_TRUTHY = {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = str(os.getenv(name, str(default)) or str(default)).strip() or str(default)
    try:
        value = int(raw)
    except ValueError:
        value = int(default)
    return max(minimum, min(maximum, value))


def _env_flag(name: str, default: str) -> bool:
    return str(os.getenv(name, default) or default).strip().lower() in _TRUTHY


def desktop_active_window_sec() -> int:
    """Seconds after the last desktop foreground signal the user stays desktop-active."""
    return _env_int("CHAT_DESKTOP_ACTIVE_WINDOW_SEC", 120, 60, 3600)


def desktop_refresh_interval_sec() -> int:
    """How often a foreground desktop should re-confirm activity (well inside the window)."""
    return max(5, desktop_active_window_sec() // 3)


def desktop_record_min_interval_sec() -> int:
    """Server-side throttle for repeated foreground confirmations of one connection."""
    return max(5, desktop_active_window_sec() // 4)


def suppress_web_push_when_desktop_active() -> bool:
    return _env_flag("CHAT_PUSH_SUPPRESS_WEB_WHEN_DESKTOP_ACTIVE", "1")


def suppress_mobile_push_when_desktop_active() -> bool:
    return _env_flag("CHAT_PUSH_SUPPRESS_MOBILE_WHEN_DESKTOP_ACTIVE", "0")


def desktop_marker_connection_id(connection_id: str) -> str:
    return f"{DESKTOP_MARKER_PREFIX}{_normalize_text(connection_id)}"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: object) -> Optional[datetime]:
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value)
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class SqlDesktopPresenceStore:
    """Markers in the existing ``chat_realtime_presence`` table (Alembic 0085)."""

    def __init__(self, *, engine_factory: Optional[Callable[[], object]] = None) -> None:
        self._engine_factory = engine_factory
        self._table_by_engine: dict[int, str] = {}

    def _engine(self, *, read: bool = False):
        if self._engine_factory is not None:
            return self._engine_factory()
        if read:
            from backend.chat.db import get_chat_read_engine

            return get_chat_read_engine()
        from backend.chat.db import get_chat_engine

        return get_chat_engine()

    def _table(self, engine) -> str:
        key = id(engine)
        table = self._table_by_engine.get(key)
        if table is None:
            from backend.chat.db import _qualified_table

            table = _qualified_table("chat_realtime_presence", engine=engine)
            self._table_by_engine[key] = table
        return table

    def record(self, *, node_id: str, connection_id: str, user_id: int, expires_at: datetime) -> None:
        from sqlalchemy import DateTime, bindparam, text

        engine = self._engine()
        statement = text(
            f"INSERT INTO {self._table(engine)} "
            "(node_id, connection_id, user_id, touched_at, expires_at) "
            "VALUES (:node_id, :connection_id, :user_id, :touched_at, :expires_at) "
            "ON CONFLICT (node_id, connection_id) DO UPDATE SET "
            "user_id = excluded.user_id, touched_at = excluded.touched_at, "
            "expires_at = excluded.expires_at"
        ).bindparams(
            bindparam("touched_at", type_=DateTime(timezone=True)),
            bindparam("expires_at", type_=DateTime(timezone=True)),
        )
        with engine.begin() as connection:
            connection.execute(
                statement,
                {
                    "node_id": str(node_id),
                    "connection_id": desktop_marker_connection_id(connection_id),
                    "user_id": int(user_id),
                    "touched_at": _utc_now(),
                    "expires_at": expires_at,
                },
            )

    def clear(self, *, node_id: str, connection_id: str, user_id: int) -> None:
        from sqlalchemy import text

        engine = self._engine()
        with engine.begin() as connection:
            connection.execute(
                text(
                    f"DELETE FROM {self._table(engine)} "
                    "WHERE node_id = :node_id AND connection_id = :connection_id"
                ),
                {
                    "node_id": str(node_id),
                    "connection_id": desktop_marker_connection_id(connection_id),
                },
            )

    def active_until(self, *, user_id: int) -> Optional[datetime]:
        from sqlalchemy import DateTime, bindparam, column, text

        engine = self._engine(read=True)
        statement = text(
            f"SELECT expires_at FROM {self._table(engine)} "
            "WHERE user_id = :user_id AND connection_id LIKE :marker_pattern "
            "AND expires_at > :now"
        ).bindparams(
            bindparam("now", type_=DateTime(timezone=True)),
        ).columns(column("expires_at", DateTime(timezone=True)))
        with engine.connect() as connection:
            rows = connection.execute(
                statement,
                {
                    "user_id": int(user_id),
                    "marker_pattern": f"{DESKTOP_MARKER_PREFIX}%",
                    "now": _utc_now(),
                },
            ).all()
        values = [_as_utc(row[0]) for row in rows]
        values = [value for value in values if value is not None]
        return max(values) if values else None


class RedisDesktopPresenceStore:
    def __init__(self, *, client_factory: Optional[Callable[[], object]] = None) -> None:
        self._client_factory = client_factory
        self._client = None
        self._prefix = (
            str(os.getenv("CHAT_DESKTOP_PRESENCE_PREFIX", "itinvent:chat:presence:desktop") or "").strip()
            or "itinvent:chat:presence:desktop"
        )

    def _key(self, user_id: int) -> str:
        return f"{self._prefix}:{int(user_id)}"

    def _get_client(self):
        if self._client_factory is not None:
            return self._client_factory()
        if self._client is not None:
            return self._client
        import redis

        from backend.config import config

        self._client = redis.Redis.from_url(
            str(config.redis.url or "").strip(),
            password=(str(config.redis.password or "").strip() or None),
            decode_responses=True,
            socket_timeout=2,
            socket_connect_timeout=2,
        )
        return self._client

    def record(self, *, node_id: str, connection_id: str, user_id: int, expires_at: datetime) -> None:
        del node_id
        client = self._get_client()
        key = self._key(user_id)
        client.hset(key, _normalize_text(connection_id), f"{expires_at.timestamp():.3f}")
        client.expire(key, desktop_active_window_sec() + 30)

    def clear(self, *, node_id: str, connection_id: str, user_id: int) -> None:
        del node_id
        client = self._get_client()
        client.hdel(self._key(user_id), _normalize_text(connection_id))

    def active_until(self, *, user_id: int) -> Optional[datetime]:
        client = self._get_client()
        payload = client.hgetall(self._key(user_id)) or {}
        now_ts = time.time()
        newest = 0.0
        for raw_value in payload.values():
            try:
                value = float(raw_value)
            except (TypeError, ValueError):
                continue
            if value > now_ts:
                newest = max(newest, value)
        if newest <= 0:
            return None
        return datetime.fromtimestamp(newest, tz=timezone.utc)


_stores: dict[str, object] = {}


def get_desktop_presence_store(transport: str):
    """Shared store for the realtime transport, or ``None`` for ``local``."""
    normalized = _normalize_text(transport).lower()
    if normalized not in {"postgres", "redis"}:
        return None
    store = _stores.get(normalized)
    if store is None:
        store = SqlDesktopPresenceStore() if normalized == "postgres" else RedisDesktopPresenceStore()
        _stores[normalized] = store
    return store


def set_desktop_presence_store(transport: str, store) -> None:
    """Test hook: replace the store used for ``transport``."""
    normalized = _normalize_text(transport).lower()
    if store is None:
        _stores.pop(normalized, None)
    else:
        _stores[normalized] = store


_last_read_error_log_at = 0.0


def desktop_active_remaining_sec(user_id: int) -> Optional[float]:
    """Seconds the user stays desktop-active (0.0 when not), ``None`` when unknown.

    Checks this process' own connections first, then the shared store of the
    configured realtime transport (other chat nodes, push worker).
    """
    global _last_read_error_log_at
    normalized_user_id = int(user_id or 0)
    if normalized_user_id <= 0:
        return 0.0
    try:
        from backend.chat.realtime import chat_realtime

        local_remaining = float(chat_realtime.local_desktop_active_remaining_sec(normalized_user_id) or 0.0)
        if local_remaining > 0:
            return local_remaining
        store = get_desktop_presence_store(chat_realtime.realtime_transport)
        if store is None:
            return 0.0
        active_until = store.active_until(user_id=normalized_user_id)
    except Exception as exc:
        now = time.monotonic()
        if now - _last_read_error_log_at >= 30.0:
            _last_read_error_log_at = now
            logger.warning(
                "chat.desktop_presence read failed user_id=%s error=%s; push stays enabled",
                normalized_user_id,
                exc.__class__.__name__,
            )
        return None
    if active_until is None:
        return 0.0
    return max(0.0, (active_until - _utc_now()).total_seconds())


def desktop_active_until_from_now() -> datetime:
    return _utc_now() + timedelta(seconds=desktop_active_window_sec())
