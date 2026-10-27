"""Rules of the «Предложить идею» feature: validation, limits, duplicate protection, status changes."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from uuid import uuid4

from backend.appdb.models import AppFeedbackSuggestion
from backend.services.feedback_store import FeedbackNotReady, FeedbackStore

logger = logging.getLogger(__name__)

CATEGORIES = ("idea", "inconvenience", "bug", "other")
STATUSES = ("new", "in_progress", "accepted", "declined", "done")
TITLE_MIN, TITLE_MAX = 3, 120
MESSAGE_MIN, MESSAGE_MAX = 10, 2000
SECTION_MAX = 64
ADMIN_NOTE_MAX = 1000
MAX_PER_DAY = 5
RATE_WINDOW = timedelta(hours=24)
DUPLICATE_WINDOW = timedelta(seconds=60)


class FeedbackRateLimited(RuntimeError):
    pass


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def _serialize(row: AppFeedbackSuggestion, author: dict[str, Any] | None = None) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": row.id,
        "category": row.category,
        "title": row.title,
        "message": row.message,
        "section": row.section,
        "status": row.status,
        "admin_note": row.admin_note,
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
    }
    if author is not None:
        data["author"] = author
    return data


def _author(row_user_id: int, user) -> dict[str, Any]:
    if user is None:
        return {"id": int(row_user_id), "username": None, "full_name": None}
    return {"id": int(user.id), "username": user.username, "full_name": user.full_name}


def _clean_text(value: Any, *, field: str, minimum: int, maximum: int) -> str:
    text = str(value or "").strip()
    if len(text) < minimum:
        raise ValueError(f"{field}: минимум {minimum} символов")
    if len(text) > maximum:
        raise ValueError(f"{field}: не больше {maximum} символов")
    return text


def _validate_create(payload: dict[str, Any]) -> dict[str, Any]:
    category = str(payload.get("category") or "").strip()
    if category not in CATEGORIES:
        raise ValueError("Недопустимая категория предложения")
    title = _clean_text(payload.get("title"), field="Заголовок", minimum=TITLE_MIN, maximum=TITLE_MAX)
    message = _clean_text(payload.get("message"), field="Описание", minimum=MESSAGE_MIN, maximum=MESSAGE_MAX)
    section = str(payload.get("section") or "").strip() or None
    if section is not None and len(section) > SECTION_MAX:
        raise ValueError(f"Раздел: не больше {SECTION_MAX} символов")
    return {"category": category, "title": title, "message": message, "section": section}


class FeedbackService:
    def __init__(self, store: FeedbackStore | None = None, *, clock: Callable[[], datetime] = _utcnow) -> None:
        self._store = store or FeedbackStore()
        self._clock = clock

    def create(self, *, user_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        data = _validate_create(payload)
        self._store.ensure_table()
        now = self._clock()
        with self._store.session() as session:
            self._store.lock_user(session, user_id)
            duplicate = self._store.find_recent_duplicate(
                session,
                user_id=user_id,
                title=data["title"],
                message=data["message"],
                since=now - DUPLICATE_WINDOW,
            )
            if duplicate is not None:
                # Double click or retry: answer with the suggestion that already exists.
                return _serialize(duplicate)
            sent = self._store.count_created_since(session, user_id=user_id, since=now - RATE_WINDOW)
            if sent >= MAX_PER_DAY:
                raise FeedbackRateLimited(
                    f"Можно отправить не более {MAX_PER_DAY} предложений за сутки. Попробуйте позже."
                )
            row = AppFeedbackSuggestion(
                id=str(uuid4()),
                user_id=int(user_id),
                category=data["category"],
                title=data["title"],
                message=data["message"],
                section=data["section"],
                status="new",
                admin_note=None,
                handled_by_user_id=None,
                created_at=now,
                updated_at=now,
            )
            self._store.add(session, row)
            logger.info("feedback suggestion created id=%s category=%s", row.id, row.category)
            return _serialize(row)

    def list_mine(self, *, user_id: int, limit: int) -> dict[str, Any]:
        self._store.ensure_table()
        with self._store.session() as session:
            rows, total = self._store.list_for_user(session, user_id=user_id, limit=_bounded(limit))
            return {"items": [_serialize(row) for row in rows], "total": total}

    def list_all(self, *, status: str | None, limit: int, offset: int) -> dict[str, Any]:
        normalized = str(status or "").strip() or None
        if normalized is not None and normalized not in STATUSES:
            raise ValueError("Недопустимый статус")
        self._store.ensure_table()
        with self._store.session() as session:
            pairs, total = self._store.list_all(
                session,
                status=normalized,
                limit=_bounded(limit),
                offset=max(0, int(offset or 0)),
            )
            counts = {name: 0 for name in STATUSES}
            counts.update(self._store.status_counts(session))
            items = [_serialize(row, _author(row.user_id, user)) for row, user in pairs]
        return {"items": items, "total": total, "counts": counts}

    def update(self, *, item_id: str, actor_user_id: int, changes: dict[str, Any]) -> dict[str, Any]:
        unknown = set(changes) - {"status", "admin_note"}
        if unknown:
            raise ValueError("Можно менять только статус и комментарий администратора")
        status = changes.get("status")
        if status is not None and status not in STATUSES:
            raise ValueError("Недопустимый статус")
        note_given = "admin_note" in changes
        note = None
        if note_given:
            note = str(changes.get("admin_note") or "").strip() or None
            if note is not None and len(note) > ADMIN_NOTE_MAX:
                raise ValueError(f"Комментарий: не больше {ADMIN_NOTE_MAX} символов")
        self._store.ensure_table()
        with self._store.session() as session:
            row = self._store.get_for_update(session, item_id)
            if row is None:
                raise LookupError("Предложение не найдено")
            if status is None and not note_given:
                return _serialize(row, _author(row.user_id, self._store.author_for(session, row.user_id)))
            if status is not None:
                row.status = status
            if note_given:
                row.admin_note = note
            row.handled_by_user_id = int(actor_user_id)
            row.updated_at = self._clock()
            session.flush()
            author = self._store.author_for(session, row.user_id)
            return _serialize(row, _author(row.user_id, author))


def _bounded(limit: int) -> int:
    return max(1, min(200, int(limit or 50)))


feedback_service = FeedbackService()

__all__ = [
    "CATEGORIES",
    "STATUSES",
    "FeedbackNotReady",
    "FeedbackRateLimited",
    "FeedbackService",
    "feedback_service",
]
