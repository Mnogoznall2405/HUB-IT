"""SQL access for ``feedback_suggestions``. No business rules here: the service decides what to write."""
from __future__ import annotations

import threading
from datetime import datetime
from typing import Any

from sqlalchemy import func, inspect, select, text

from backend.appdb.db import app_session, get_app_engine
from backend.appdb.models import AppFeedbackSuggestion, AppUser

TABLE_NAME = "feedback_suggestions"
# Namespace of the per-user advisory lock (PostgreSQL). Arbitrary constant, unique within the app.
_ADVISORY_LOCK_NAMESPACE = 20261027


class FeedbackNotReady(RuntimeError):
    """The table is missing: the release migration 20261027_0148 has not been applied yet."""


class FeedbackStore:
    def __init__(self, database_url: str | None = None) -> None:
        self.database_url = database_url
        self._ready_urls: set[str] = set()
        self._ready_lock = threading.Lock()

    def session(self):
        return app_session(self.database_url)

    def ensure_table(self) -> None:
        """Positive answers are cached; a missing table is re-checked on every call so that
        the migration takes effect without a process restart."""
        engine = get_app_engine(self.database_url)
        key = str(engine.url)
        if key in self._ready_urls:
            return
        schema = "app" if engine.dialect.name == "postgresql" else None
        if not inspect(engine).has_table(TABLE_NAME, schema=schema):
            raise FeedbackNotReady(TABLE_NAME)
        with self._ready_lock:
            self._ready_urls.add(key)

    @staticmethod
    def lock_user(session, user_id: int) -> None:
        """Serialises submissions of one user across worker processes (short transaction lock)."""
        if session.get_bind().dialect.name == "postgresql":
            session.execute(
                text("SELECT pg_advisory_xact_lock(:namespace, :user_id)"),
                {"namespace": _ADVISORY_LOCK_NAMESPACE, "user_id": int(user_id)},
            )

    @staticmethod
    def count_created_since(session, *, user_id: int, since: datetime) -> int:
        return int(
            session.scalar(
                select(func.count())
                .select_from(AppFeedbackSuggestion)
                .where(
                    AppFeedbackSuggestion.user_id == int(user_id),
                    AppFeedbackSuggestion.created_at >= since,
                )
            )
            or 0
        )

    @staticmethod
    def find_recent_duplicate(
        session, *, user_id: int, title: str, message: str, since: datetime
    ) -> AppFeedbackSuggestion | None:
        return session.scalars(
            select(AppFeedbackSuggestion)
            .where(
                AppFeedbackSuggestion.user_id == int(user_id),
                AppFeedbackSuggestion.title == title,
                AppFeedbackSuggestion.message == message,
                AppFeedbackSuggestion.created_at >= since,
            )
            .order_by(AppFeedbackSuggestion.created_at.desc(), AppFeedbackSuggestion.id.desc())
            .limit(1)
        ).first()

    @staticmethod
    def add(session, row: AppFeedbackSuggestion) -> None:
        session.add(row)
        session.flush()

    @staticmethod
    def get_for_update(session, item_id: str) -> AppFeedbackSuggestion | None:
        return session.scalar(
            select(AppFeedbackSuggestion).where(AppFeedbackSuggestion.id == item_id).with_for_update()
        )

    @staticmethod
    def author_for(session, user_id: int) -> AppUser | None:
        return session.get(AppUser, int(user_id))

    @staticmethod
    def list_for_user(session, *, user_id: int, limit: int) -> tuple[list[AppFeedbackSuggestion], int]:
        condition = AppFeedbackSuggestion.user_id == int(user_id)
        total = int(
            session.scalar(select(func.count()).select_from(AppFeedbackSuggestion).where(condition)) or 0
        )
        rows = session.scalars(
            select(AppFeedbackSuggestion)
            .where(condition)
            .order_by(AppFeedbackSuggestion.created_at.desc(), AppFeedbackSuggestion.id.desc())
            .limit(limit)
        ).all()
        return list(rows), total

    @staticmethod
    def list_all(
        session, *, status: str | None, limit: int, offset: int
    ) -> tuple[list[tuple[AppFeedbackSuggestion, AppUser | None]], int]:
        conditions: list[Any] = []
        if status:
            conditions.append(AppFeedbackSuggestion.status == status)
        total = int(
            session.scalar(select(func.count()).select_from(AppFeedbackSuggestion).where(*conditions)) or 0
        )
        rows = session.execute(
            select(AppFeedbackSuggestion, AppUser)
            .outerjoin(AppUser, AppUser.id == AppFeedbackSuggestion.user_id)
            .where(*conditions)
            .order_by(AppFeedbackSuggestion.created_at.desc(), AppFeedbackSuggestion.id.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        return [(row[0], row[1]) for row in rows], total

    @staticmethod
    def status_counts(session) -> dict[str, int]:
        rows = session.execute(
            select(AppFeedbackSuggestion.status, func.count()).group_by(AppFeedbackSuggestion.status)
        ).all()
        return {str(status): int(count) for status, count in rows}
