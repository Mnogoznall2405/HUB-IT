"""Short-lived, authenticated HUB Desktop presence."""
from __future__ import annotations

import math
from collections.abc import Callable
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select

from backend.appdb.db import app_session
from backend.appdb.models import AppDesktopPresence


DESKTOP_PRESENCE_TTL_SECONDS = 180
DESKTOP_PRESENCE_CLEANUP_LIMIT = 500


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class DesktopPresenceIdentityError(ValueError):
    """Raised if a session key is unexpectedly associated with another user."""


class DesktopPresenceService:
    def __init__(
        self,
        *,
        database_url: str | None = None,
        ttl_seconds: int = DESKTOP_PRESENCE_TTL_SECONDS,
        clock: Callable[[], datetime] = _utcnow,
    ) -> None:
        self._database_url = database_url
        self._ttl_seconds = max(30, min(int(ttl_seconds), 600))
        self._clock = clock

    @staticmethod
    def _identity(*, user_id: int, session_id: str) -> tuple[int, str]:
        normalized_user_id = int(user_id)
        normalized_session_id = str(session_id or "").strip()
        if normalized_user_id <= 0:
            raise DesktopPresenceIdentityError("A positive authenticated user id is required")
        if not normalized_session_id or len(normalized_session_id) > 64:
            raise DesktopPresenceIdentityError("An active authenticated session is required")
        return normalized_user_id, normalized_session_id

    def _now(self) -> datetime:
        return _as_utc(self._clock())

    def _status(self, *, active: bool, expires_at: datetime | None = None) -> dict[str, int | bool]:
        if not active or expires_at is None:
            return {"active": False, "expires_in_seconds": 0}
        remaining = max(0, math.ceil((_as_utc(expires_at) - self._now()).total_seconds()))
        return {"active": remaining > 0, "expires_in_seconds": remaining}

    def heartbeat(self, *, user_id: int, session_id: str) -> dict[str, int | bool]:
        normalized_user_id, normalized_session_id = self._identity(
            user_id=user_id,
            session_id=session_id,
        )
        now = self._now()
        expires_at = now + timedelta(seconds=self._ttl_seconds)
        with app_session(self._database_url) as session:
            row = session.get(AppDesktopPresence, normalized_session_id)
            if row is None:
                row = AppDesktopPresence(
                    session_id=normalized_session_id,
                    user_id=normalized_user_id,
                    created_at=now,
                    last_seen_at=now,
                    expires_at=expires_at,
                )
                session.add(row)
            else:
                if int(row.user_id) != normalized_user_id:
                    raise DesktopPresenceIdentityError("Session presence belongs to another user")
                row.last_seen_at = now
                row.expires_at = expires_at
        return {"active": True, "expires_in_seconds": self._ttl_seconds}

    def get_current(self, *, user_id: int, session_id: str) -> dict[str, int | bool]:
        normalized_user_id, normalized_session_id = self._identity(
            user_id=user_id,
            session_id=session_id,
        )
        with app_session(self._database_url) as session:
            row = session.scalar(
                select(AppDesktopPresence).where(
                    AppDesktopPresence.session_id == normalized_session_id,
                    AppDesktopPresence.user_id == normalized_user_id,
                )
            )
            expires_at = row.expires_at if row is not None else None
        return self._status(active=expires_at is not None, expires_at=expires_at)

    def disconnect(self, *, user_id: int, session_id: str) -> bool:
        normalized_user_id, normalized_session_id = self._identity(
            user_id=user_id,
            session_id=session_id,
        )
        with app_session(self._database_url) as session:
            result = session.execute(
                delete(AppDesktopPresence).where(
                    AppDesktopPresence.session_id == normalized_session_id,
                    AppDesktopPresence.user_id == normalized_user_id,
                )
            )
            return int(result.rowcount or 0) > 0

    def count_active_for_user(self, *, user_id: int) -> int:
        normalized_user_id = int(user_id)
        if normalized_user_id <= 0:
            return 0
        now = self._now()
        with app_session(self._database_url) as session:
            count = session.scalar(
                select(func.count())
                .select_from(AppDesktopPresence)
                .where(
                    AppDesktopPresence.user_id == normalized_user_id,
                    AppDesktopPresence.expires_at > now,
                )
            )
            return int(count or 0)

    def cleanup_expired(self, *, limit: int = DESKTOP_PRESENCE_CLEANUP_LIMIT) -> int:
        bounded_limit = max(1, min(int(limit), DESKTOP_PRESENCE_CLEANUP_LIMIT))
        now = self._now()
        with app_session(self._database_url) as session:
            session_ids = list(
                session.scalars(
                    select(AppDesktopPresence.session_id)
                    .where(AppDesktopPresence.expires_at <= now)
                    .order_by(AppDesktopPresence.expires_at.asc())
                    .limit(bounded_limit)
                )
            )
            if not session_ids:
                return 0
            result = session.execute(
                delete(AppDesktopPresence).where(AppDesktopPresence.session_id.in_(session_ids))
            )
            return int(result.rowcount or 0)


desktop_presence_service = DesktopPresenceService()
