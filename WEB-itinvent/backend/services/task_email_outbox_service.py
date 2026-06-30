"""Task email outbox queue and dispatch for hub tasks."""

from __future__ import annotations

import logging
import sqlite3
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import BoundedSemaphore
from typing import Any

from backend.services.task_email_service import task_email_service

logger = logging.getLogger(__name__)

_TASK_EMAIL_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="task-email")
_TASK_EMAIL_DISPATCH_SLOT = BoundedSemaphore(1)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_text(value: Any, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


def _normalize_email_deadline_remind_hours(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    try:
        hours = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("email_deadline_remind_hours must be an integer between 0 and 168") from exc
    if hours == 0:
        return 0
    if 1 <= hours <= 168:
        return hours
    raise ValueError("email_deadline_remind_hours must be between 0 and 168")


def _resolve_email_deadline_remind_hours(task: dict[str, Any]) -> float | None:
    raw = task.get("email_deadline_remind_hours")
    if raw is None or (isinstance(raw, str) and not str(raw).strip()):
        return task_email_service.deadline_soon_hours()
    try:
        hours = int(raw)
    except (TypeError, ValueError):
        return task_email_service.deadline_soon_hours()
    if hours <= 0:
        return None
    return float(hours)


class TaskEmailOutboxMixin:
    def _ensure_task_email_outbox_body_html_column(self, conn: sqlite3.Connection) -> None:
        cols = self._table_columns(conn, self._TASK_EMAIL_OUTBOX_TABLE)
        if "body_html" not in cols:
            conn.execute(
                f"ALTER TABLE {self._TASK_EMAIL_OUTBOX_TABLE} ADD COLUMN body_html TEXT NOT NULL DEFAULT ''"
            )

    def _enqueue_task_email(
        self,
        conn: sqlite3.Connection,
        *,
        dedupe_key: str,
        task_id: str,
        recipient_user_id: int,
        recipient_email: str,
        event_type: str,
        subject: str,
        body_text: str,
        body_html: str = "",
        available_at: str | None = None,
    ) -> bool:
        if not task_email_service.is_enabled():
            return False
        normalized_email = _normalize_text(recipient_email)
        if not task_email_service.is_valid_recipient(normalized_email):
            return False
        normalized_dedupe = _normalize_text(dedupe_key)
        if not normalized_dedupe:
            return False
        now_iso = _utc_now_iso()
        conn.execute(
            f"""
            INSERT OR IGNORE INTO {self._TASK_EMAIL_OUTBOX_TABLE}
            (id, dedupe_key, task_id, recipient_user_id, recipient_email, event_type, subject, body_text, body_html, status, attempt_count, available_at, created_at, updated_at, sent_at, last_error)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, NULL, '')
            """,
            (
                str(uuid.uuid4()),
                normalized_dedupe,
                _normalize_text(task_id) or None,
                self._as_int(recipient_user_id),
                normalized_email,
                _normalize_text(event_type),
                _normalize_text(subject),
                _normalize_text(body_text),
                _normalize_text(body_html),
                _normalize_text(available_at) or now_iso,
                now_iso,
                now_iso,
            ),
        )
        return True

    def _schedule_task_email_outbox_dispatch(self) -> None:
        if not task_email_service.is_enabled() or not task_email_service.auto_dispatch_enabled():
            return
        if not _TASK_EMAIL_DISPATCH_SLOT.acquire(blocking=False):
            return

        def _run() -> None:
            try:
                self.dispatch_task_email_outbox()
            finally:
                try:
                    _TASK_EMAIL_DISPATCH_SLOT.release()
                except ValueError:
                    pass

        try:
            _TASK_EMAIL_EXECUTOR.submit(_run)
        except Exception:
            try:
                _TASK_EMAIL_DISPATCH_SLOT.release()
            except ValueError:
                pass

    def dispatch_task_email_outbox(self, *, limit: int = 20) -> dict[str, int]:
        if not task_email_service.is_enabled():
            return {"claimed": 0, "sent": 0, "failed": 0}
        safe_limit = self._coerce_limit(limit, default=20, minimum=1, maximum=100)
        now_iso = _utc_now_iso()
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT *
                FROM {self._TASK_EMAIL_OUTBOX_TABLE}
                WHERE status = 'pending' AND available_at <= ?
                ORDER BY created_at ASC
                LIMIT ?
                """,
                (now_iso, safe_limit),
            ).fetchall()
            claimed = [dict(row) for row in rows]
            for row in claimed:
                conn.execute(
                    f"""
                    UPDATE {self._TASK_EMAIL_OUTBOX_TABLE}
                    SET status = 'sending', attempt_count = attempt_count + 1, updated_at = ?
                    WHERE id = ? AND status = 'pending'
                    """,
                    (now_iso, _normalize_text(row.get("id"))),
                )
            conn.commit()

        sent = 0
        failed = 0
        for row in claimed:
            outbox_id = _normalize_text(row.get("id"))
            try:
                ok = task_email_service.send_task_email(
                    recipient_email=_normalize_text(row.get("recipient_email")),
                    subject=_normalize_text(row.get("subject")),
                    body_text=_normalize_text(row.get("body_text")),
                    body_html=_normalize_text(row.get("body_html")),
                )
                if ok:
                    sent += 1
                    self._mark_task_email_sent(outbox_id)
                else:
                    failed += 1
                    self._mark_task_email_failed(row, "Task email sender returned false")
            except Exception as exc:
                failed += 1
                self._mark_task_email_failed(row, str(exc))
        return {"claimed": len(claimed), "sent": sent, "failed": failed}

    def _mark_task_email_sent(self, outbox_id: str) -> None:
        normalized_id = _normalize_text(outbox_id)
        if not normalized_id:
            return
        now_iso = _utc_now_iso()
        with self._lock, self._connect() as conn:
            conn.execute(
                f"""
                UPDATE {self._TASK_EMAIL_OUTBOX_TABLE}
                SET status = 'sent', sent_at = ?, updated_at = ?, last_error = ''
                WHERE id = ?
                """,
                (now_iso, now_iso, normalized_id),
            )
            conn.commit()

    def _mark_task_email_failed(self, row: dict[str, Any], error: str) -> None:
        outbox_id = _normalize_text(row.get("id"))
        if not outbox_id:
            return
        attempt_count = self._as_int(row.get("attempt_count")) + 1
        max_attempts = task_email_service.max_attempts()
        now = datetime.now(timezone.utc)
        status = "failed" if attempt_count >= max_attempts else "pending"
        delay_minutes = 0 if status == "failed" else min(60, 2 ** max(0, attempt_count - 1))
        available_at = (now + timedelta(minutes=delay_minutes)).isoformat()
        now_iso = now.isoformat()
        with self._lock, self._connect() as conn:
            conn.execute(
                f"""
                UPDATE {self._TASK_EMAIL_OUTBOX_TABLE}
                SET status = ?, available_at = ?, updated_at = ?, last_error = ?
                WHERE id = ?
                """,
                (status, available_at, now_iso, _normalize_text(error)[:1000], outbox_id),
            )
            conn.commit()
