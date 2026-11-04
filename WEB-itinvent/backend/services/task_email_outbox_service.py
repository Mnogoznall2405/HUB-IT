"""Task email outbox queue and dispatch for hub tasks."""

from __future__ import annotations

import logging
import os
import sqlite3
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import BoundedSemaphore
from typing import Any

from backend.services.task_email_service import EmailDeliveryOutcomeUnknownError, task_email_service

logger = logging.getLogger(__name__)

_TASK_EMAIL_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="task-email")
_TASK_EMAIL_DISPATCH_SLOT = BoundedSemaphore(1)
# Written by the heartbeat right before the send call: a stale claim carrying it may have sent the mail.
_SEND_STARTED_MARK = "send_started"
_UNKNOWN_AFTER_WORKER_LOST = "Unknown delivery outcome: worker lost during send"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_text(value: Any, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


def _task_email_claim_timeout_sec() -> int:
    """Age after which a row left in 'sending' is considered abandoned (default 15 min)."""
    try:
        value = int(_normalize_text(os.getenv("TASK_EMAIL_CLAIM_TIMEOUT_SEC"), "900"))
    except (TypeError, ValueError):
        value = 900
    return max(60, min(86400, value))


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
        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()
        stale_before_iso = (now - timedelta(seconds=_task_email_claim_timeout_sec())).isoformat()
        max_attempts = task_email_service.max_attempts()
        with self._lock, self._connect() as conn:
            # Rows stuck in 'sending' (worker died after claim) go back to the queue;
            # the claim already counted the attempt, so exhausted rows end as 'failed'.
            # A claim whose send already started has an unknown outcome (the mail may have left):
            # never resend it automatically, an operator decides.
            recovered_unknown = self._rowcount(
                conn.execute(
                    f"""
                    UPDATE {self._TASK_EMAIL_OUTBOX_TABLE}
                    SET status = 'unknown', updated_at = ?, last_error = ?
                    WHERE status = 'sending' AND updated_at < ? AND last_error = ?
                    """,
                    (now_iso, _UNKNOWN_AFTER_WORKER_LOST, stale_before_iso, _SEND_STARTED_MARK),
                )
            )
            recovered_failed = self._rowcount(
                conn.execute(
                    f"""
                    UPDATE {self._TASK_EMAIL_OUTBOX_TABLE}
                    SET status = 'failed', updated_at = ?, last_error = 'Recovered stale sending claim: attempts exhausted'
                    WHERE status = 'sending' AND updated_at < ? AND attempt_count >= ?
                    """,
                    (now_iso, stale_before_iso, max_attempts),
                )
            )
            recovered_pending = self._rowcount(
                conn.execute(
                    f"""
                    UPDATE {self._TASK_EMAIL_OUTBOX_TABLE}
                    SET status = 'pending', available_at = ?, updated_at = ?, last_error = 'Recovered stale sending claim'
                    WHERE status = 'sending' AND updated_at < ? AND attempt_count < ?
                    """,
                    (now_iso, now_iso, stale_before_iso, max_attempts),
                )
            )
            if recovered_failed or recovered_pending or recovered_unknown:
                logger.warning(
                    "Task email outbox recovered stale claims: requeued=%s failed=%s unknown=%s",
                    recovered_pending,
                    recovered_failed,
                    recovered_unknown,
                )
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
            claimed = []
            for row in rows:
                payload = dict(row)
                # Conditional claim: a concurrent process that won the row leaves rowcount 0.
                result = conn.execute(
                    f"""
                    UPDATE {self._TASK_EMAIL_OUTBOX_TABLE}
                    SET status = 'sending', attempt_count = attempt_count + 1, updated_at = ?, last_error = ''
                    WHERE id = ? AND status = 'pending' AND attempt_count = ?
                    """,
                    (now_iso, _normalize_text(payload.get("id")), self._as_int(payload.get("attempt_count"))),
                )
                if self._rowcount(result) == 1:
                    # attempt_count only grows on claim, so its post-claim value is this claim's token:
                    # a worker whose row was recovered and re-claimed holds a stale one.
                    payload["claim_token"] = self._as_int(payload.get("attempt_count")) + 1
                    claimed.append(payload)
            conn.commit()

        sent = 0
        failed = 0
        unknown = 0
        for row in claimed:
            outbox_id = _normalize_text(row.get("id"))
            claim_token = self._as_int(row.get("claim_token"))
            if not self._touch_task_email_claim(outbox_id, claim_token):
                # Claim was recovered/taken over while earlier rows of this batch were sending.
                continue
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
            except EmailDeliveryOutcomeUnknownError as exc:
                unknown += 1
                self._mark_task_email_unknown(row, str(exc))
            except Exception as exc:
                failed += 1
                self._mark_task_email_failed(row, str(exc))
        return {"claimed": len(claimed), "sent": sent, "failed": failed, "unknown": unknown}

    def _touch_task_email_claim(self, outbox_id: str, claim_token: int) -> bool:
        """Refresh the claim heartbeat right before sending; False if the row is no longer ours."""
        normalized_id = _normalize_text(outbox_id)
        if not normalized_id:
            return False
        with self._lock, self._connect() as conn:
            result = conn.execute(
                f"""
                UPDATE {self._TASK_EMAIL_OUTBOX_TABLE}
                SET updated_at = ?, last_error = ?
                WHERE id = ? AND status = 'sending' AND attempt_count = ?
                """,
                (_utc_now_iso(), _SEND_STARTED_MARK, normalized_id, int(claim_token)),
            )
            conn.commit()
            return self._rowcount(result) == 1

    def _mark_task_email_sent(self, outbox_id: str) -> None:
        # Deliberately not claim-token guarded (unlike heartbeat/failed): a "sent" ack from a worker
        # that lost its claim is still true, and recording it stops the new owner from re-sending.
        normalized_id = _normalize_text(outbox_id)
        if not normalized_id:
            return
        now_iso = _utc_now_iso()
        with self._lock, self._connect() as conn:
            conn.execute(
                f"""
                UPDATE {self._TASK_EMAIL_OUTBOX_TABLE}
                SET status = 'sent', sent_at = ?, updated_at = ?, last_error = ''
                WHERE id = ? AND status <> 'sent'
                """,
                (now_iso, now_iso, normalized_id),
            )
            conn.commit()

    def _mark_task_email_unknown(self, row: dict[str, Any], error: str) -> None:
        """Delivery outcome unknown: stop automatic retries (a resend could duplicate the mail)."""
        outbox_id = _normalize_text(row.get("id"))
        if not outbox_id:
            return
        claim_token = self._as_int(row.get("claim_token")) or self._as_int(row.get("attempt_count")) + 1
        with self._lock, self._connect() as conn:
            conn.execute(
                f"""
                UPDATE {self._TASK_EMAIL_OUTBOX_TABLE}
                SET status = 'unknown', updated_at = ?, last_error = ?
                WHERE id = ? AND status = 'sending' AND attempt_count = ?
                """,
                (_utc_now_iso(), ("Unknown delivery outcome: " + _normalize_text(error))[:1000], outbox_id, claim_token),
            )
            conn.commit()
        logger.warning("Task email delivery outcome unknown, not retrying: outbox_id=%s", outbox_id)

    def _mark_task_email_failed(self, row: dict[str, Any], error: str) -> None:
        outbox_id = _normalize_text(row.get("id"))
        if not outbox_id:
            return
        attempt_count = self._as_int(row.get("claim_token")) or self._as_int(row.get("attempt_count")) + 1
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
                WHERE id = ? AND status = 'sending' AND attempt_count = ?
                """,
                (status, available_at, now_iso, _normalize_text(error)[:1000], outbox_id, attempt_count),
            )
            conn.commit()
