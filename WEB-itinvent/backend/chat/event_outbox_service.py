from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from contextlib import contextmanager

from backend.chat.db import chat_write_session
from backend.chat.models import ChatEventOutbox, ChatMember, ChatMessage
from backend.chat.realtime_side_effects import publish_event_job
from backend.chat.utils import normalize_text as _normalize_text
from backend.chat.write_path_limits import aux_write_db_slot
from backend.chat.write_path_metrics import note_outbox_enqueue_failed, note_outbox_repaired


logger = logging.getLogger("backend.chat.event_outbox")


@contextmanager
def _aux_write_session():
    """Short write TX under aux DB slot (never holds conn during network publish)."""
    from backend.chat.write_path_limits import WriteSlotTimeoutError

    try:
        with aux_write_db_slot(timeout_sec=5.0):
            with chat_write_session() as session:
                yield session
    except WriteSlotTimeoutError:
        # Outbox must not crash the request path; caller retries on next poll.
        logger.warning("chat event outbox skipped: aux write DB slot timeout")
        raise

EVENT_OUTBOX_STATUS_QUEUED = "queued"
EVENT_OUTBOX_STATUS_PROCESSING = "processing"
EVENT_OUTBOX_STATUS_DELIVERED = "delivered"
EVENT_OUTBOX_STATUS_FAILED = "failed"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _coerce_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)



def _clamp_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = _normalize_text(os.getenv(name), str(default))
    try:
        return max(minimum, min(maximum, int(raw)))
    except Exception:
        return max(minimum, min(maximum, int(default)))


def _env_flag(name: str, default: str = "1") -> bool:
    return _normalize_text(os.getenv(name), default).lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class ChatEventOutboxJob:
    id: int
    event_type: str
    target_scope: str
    target_user_id: int
    conversation_id: str
    message_id: str
    payload: dict[str, Any]
    dedupe_key: str
    attempt_count: int
    status: str
    next_attempt_at: datetime
    updated_at: datetime


class ChatEventOutboxService:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._stop_event: asyncio.Event | None = None
        self._last_heartbeat_at: float = 0.0
        self._last_avg_job_ms: float = 0.0
        self._poll_lock: asyncio.Lock | None = None

    def _ensure_poll_lock(self) -> asyncio.Lock:
        if self._poll_lock is None:
            self._poll_lock = asyncio.Lock()
        return self._poll_lock

    @property
    def enabled(self) -> bool:
        return _env_flag("CHAT_EVENT_OUTBOX_ENABLED", "1")

    @property
    def poll_interval_ms(self) -> int:
        return _clamp_env_int("CHAT_EVENT_OUTBOX_POLL_INTERVAL_MS", 250, 50, 10_000)

    @property
    def batch_size(self) -> int:
        return _clamp_env_int("CHAT_EVENT_OUTBOX_BATCH_SIZE", 100, 1, 500)

    @property
    def max_attempts(self) -> int:
        return _clamp_env_int("CHAT_EVENT_OUTBOX_MAX_ATTEMPTS", 10, 1, 50)

    @property
    def processing_timeout_sec(self) -> int:
        return _clamp_env_int("CHAT_EVENT_OUTBOX_PROCESSING_TIMEOUT_SEC", 120, 10, 3600)

    @property
    def heartbeat_sec(self) -> int:
        return _clamp_env_int("CHAT_EVENT_OUTBOX_HEARTBEAT_SEC", 60, 10, 3600)

    @property
    def max_concurrency(self) -> int:
        return _clamp_env_int("CHAT_OUTBOX_CONCURRENCY", 4, 1, 32)

    @property
    def dispatcher_active(self) -> bool:
        return bool(self._task and not self._task.done())

    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop_event = asyncio.Event()
        self._task = asyncio.create_task(self._run_loop(), name="chat-event-outbox-dispatcher")

    async def stop(self) -> None:
        if self._stop_event is not None:
            self._stop_event.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None
        self._stop_event = None

    async def _run_loop(self) -> None:
        while True:
            try:
                await self.poll_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("chat.event_outbox.poll iteration failed")
            try:
                assert self._stop_event is not None
                await asyncio.wait_for(self._stop_event.wait(), timeout=max(0.05, self.poll_interval_ms / 1000.0))
                return
            except asyncio.TimeoutError:
                continue

    def _retry_delay_sec(self, attempt_count: int) -> int:
        exponent = max(0, int(attempt_count) - 1)
        return min(5 * 60, 2 * (2 ** exponent))

    def _serialize_job(self, job: ChatEventOutbox) -> ChatEventOutboxJob:
        payload: dict[str, Any]
        try:
            parsed = json.loads(str(job.payload_json or "{}"))
            payload = parsed if isinstance(parsed, dict) else {}
        except Exception:
            payload = {}
        return ChatEventOutboxJob(
            id=int(job.id),
            event_type=_normalize_text(job.event_type),
            target_scope=_normalize_text(job.target_scope, "inbox"),
            target_user_id=int(job.target_user_id or 0),
            conversation_id=_normalize_text(job.conversation_id),
            message_id=_normalize_text(job.message_id),
            payload=payload,
            dedupe_key=_normalize_text(job.dedupe_key),
            attempt_count=int(job.attempt_count or 0),
            status=_normalize_text(job.status, EVENT_OUTBOX_STATUS_QUEUED),
            next_attempt_at=_coerce_utc(job.next_attempt_at) or _utc_now(),
            updated_at=_coerce_utc(job.updated_at) or _utc_now(),
        )

    def enqueue_event(
        self,
        *,
        event_type: str,
        target_user_id: int,
        target_scope: str = "inbox",
        conversation_id: str | None = None,
        message_id: str | None = None,
        payload: dict[str, Any] | None = None,
        dedupe_key: str | None = None,
    ) -> bool:
        return self.enqueue_events([
            {
                "event_type": event_type,
                "target_user_id": int(target_user_id),
                "target_scope": target_scope,
                "conversation_id": conversation_id,
                "message_id": message_id,
                "payload": payload or {},
                "dedupe_key": dedupe_key,
            }
        ]) > 0

    def enqueue_delivery_state_job_idempotent(self, job: dict[str, Any]) -> bool:
        """Short aux TX: INSERT outbox ON CONFLICT DO NOTHING (no prior SELECT)."""
        if not isinstance(job, dict):
            return False
        try:
            return self.enqueue_events([job]) > 0
        except Exception:
            note_outbox_enqueue_failed()
            logger.exception("chat.event_outbox.delivery_state enqueue failed")
            return False

    def enqueue_events(self, jobs: list[dict[str, Any]]) -> int:
        normalized_jobs = [
            {
                "event_type": _normalize_text(item.get("event_type")),
                "target_scope": _normalize_text(item.get("target_scope"), "inbox"),
                "target_user_id": int(item.get("target_user_id") or 0),
                "conversation_id": _normalize_text(item.get("conversation_id")) or None,
                "message_id": _normalize_text(item.get("message_id")) or None,
                "payload": item.get("payload") if isinstance(item.get("payload"), dict) else {},
                "dedupe_key": _normalize_text(item.get("dedupe_key")) or None,
            }
            for item in list(jobs or [])
            if isinstance(item, dict)
        ]
        if not normalized_jobs:
            return 0
        inserted = 0
        now = _utc_now()
        with _aux_write_session() as session:
            bind = session.get_bind()
            dialect_name = str(getattr(getattr(bind, "dialect", None), "name", "") or "").lower()
            insert_fn = pg_insert if dialect_name == "postgresql" else sqlite_insert
            for item in normalized_jobs:
                if not item["event_type"] or int(item["target_user_id"]) <= 0:
                    continue
                values = {
                    "event_type": item["event_type"],
                    "target_scope": item["target_scope"],
                    "target_user_id": int(item["target_user_id"]),
                    "conversation_id": item["conversation_id"],
                    "message_id": item["message_id"],
                    "payload_json": json.dumps(item["payload"], ensure_ascii=False),
                    "dedupe_key": item["dedupe_key"],
                    "status": EVENT_OUTBOX_STATUS_QUEUED,
                    "attempt_count": 0,
                    "next_attempt_at": now,
                    "last_error": None,
                    "created_at": now,
                    "updated_at": now,
                }
                if item["dedupe_key"]:
                    stmt = insert_fn(ChatEventOutbox).values(**values)
                    if dialect_name == "postgresql":
                        stmt = stmt.on_conflict_do_nothing(constraint="uq_chat_event_outbox_dedupe_key")
                    else:
                        stmt = stmt.on_conflict_do_nothing(index_elements=["dedupe_key"])
                    result = session.execute(stmt)
                    # rowcount is 1 on insert, 0 on conflict for both dialects when supported
                    if int(getattr(result, "rowcount", 0) or 0) > 0:
                        inserted += 1
                else:
                    session.add(ChatEventOutbox(**values))
                    inserted += 1
        return inserted

    def repair_missing_delivery_state_outbox(
        self,
        *,
        lookback_sec: int = 300,
        limit: int = 50,
    ) -> int:
        """Re-enqueue delivery_state jobs for recent messages missing outbox rows."""
        from backend.chat.chat_delivery_state import build_delivery_state_outbox_job

        cutoff = _utc_now() - timedelta(seconds=max(30, int(lookback_sec)))
        repaired = 0
        try:
            with _aux_write_session() as session:
                recent_messages = list(
                    session.execute(
                        select(ChatMessage)
                        .where(ChatMessage.created_at >= cutoff)
                        .where(ChatMessage.kind == "text")
                        .order_by(ChatMessage.created_at.desc())
                        .limit(max(1, min(200, int(limit))))
                    ).scalars()
                )
                if not recent_messages:
                    return 0
                message_ids = [str(item.id) for item in recent_messages if item.id]
                existing_keys = {
                    str(key)
                    for key in session.execute(
                        select(ChatEventOutbox.dedupe_key).where(
                            ChatEventOutbox.dedupe_key.in_([f"delivery_state:{mid}" for mid in message_ids])
                        )
                    ).scalars()
                    if key
                }
                jobs: list[dict[str, Any]] = []
                for message in recent_messages:
                    dedupe_key = f"delivery_state:{message.id}"
                    if dedupe_key in existing_keys:
                        continue
                    member_ids = list(
                        session.execute(
                            select(ChatMember.user_id).where(
                                ChatMember.conversation_id == message.conversation_id,
                                ChatMember.left_at.is_(None),
                            )
                        ).scalars()
                    )
                    jobs.append(
                        build_delivery_state_outbox_job(
                            conversation_id=str(message.conversation_id),
                            message_id=str(message.id),
                            sender_user_id=int(message.sender_user_id),
                            member_user_ids=[int(uid) for uid in member_ids],
                            conversation_seq=int(getattr(message, "conversation_seq", 0) or 0),
                            seen_at=message.created_at or _utc_now(),
                        )
                    )
            if jobs:
                repaired = int(self.enqueue_events(jobs) or 0)
                if repaired:
                    note_outbox_repaired(repaired)
        except Exception:
            logger.exception("chat.event_outbox.repair_missing_delivery_state failed")
            return 0
        return repaired

    def recover_stale_jobs(self) -> int:
        cutoff = _utc_now() - timedelta(seconds=self.processing_timeout_sec)
        recovered = 0
        with _aux_write_session() as session:
            stale_jobs = list(
                session.execute(
                    select(ChatEventOutbox).where(
                        ChatEventOutbox.status == EVENT_OUTBOX_STATUS_PROCESSING,
                        ChatEventOutbox.updated_at <= cutoff,
                    )
                ).scalars()
            )
            now = _utc_now()
            for job in stale_jobs:
                job.status = EVENT_OUTBOX_STATUS_QUEUED
                job.next_attempt_at = now
                job.updated_at = now
                job.last_error = "Recovered stale processing job"
                recovered += 1
        return recovered

    def claim_jobs(self, limit: int | None = None) -> list[ChatEventOutboxJob]:
        claim_limit = max(1, int(limit or self.batch_size))
        now = _utc_now()
        with _aux_write_session() as session:
            query = (
                select(ChatEventOutbox)
                .where(
                    ChatEventOutbox.status == EVENT_OUTBOX_STATUS_QUEUED,
                    ChatEventOutbox.next_attempt_at <= now,
                )
                .order_by(ChatEventOutbox.next_attempt_at.asc(), ChatEventOutbox.id.asc())
                .limit(claim_limit)
            )
            bind = session.get_bind()
            dialect_name = str(getattr(getattr(bind, "dialect", None), "name", "") or "").lower()
            if dialect_name == "postgresql":
                query = query.with_for_update(skip_locked=True)
            rows = list(session.execute(query).scalars())
            for row in rows:
                row.status = EVENT_OUTBOX_STATUS_PROCESSING
                row.attempt_count = int(row.attempt_count or 0) + 1
                row.updated_at = now
            session.flush()
            return [self._serialize_job(row) for row in rows]

    def _update_job(
        self,
        *,
        job_id: int,
        status: str,
        next_attempt_at: datetime | None = None,
        last_error: str | None = None,
    ) -> None:
        with _aux_write_session() as session:
            row = session.get(ChatEventOutbox, int(job_id))
            if row is None:
                return
            row.status = _normalize_text(status, EVENT_OUTBOX_STATUS_FAILED)
            row.updated_at = _utc_now()
            row.next_attempt_at = next_attempt_at or row.updated_at
            row.last_error = _normalize_text(last_error) or None

    def mark_delivered(self, *, job_id: int, last_error: str | None = None) -> None:
        self._update_job(
            job_id=int(job_id),
            status=EVENT_OUTBOX_STATUS_DELIVERED,
            next_attempt_at=_utc_now(),
            last_error=last_error,
        )

    def mark_retry(self, *, job_id: int, last_error: str) -> None:
        with _aux_write_session() as session:
            row = session.get(ChatEventOutbox, int(job_id))
            if row is None:
                return
            next_attempt_at = _utc_now() + timedelta(seconds=self._retry_delay_sec(int(row.attempt_count or 0)))
            row.status = EVENT_OUTBOX_STATUS_QUEUED
            row.next_attempt_at = next_attempt_at
            row.updated_at = _utc_now()
            row.last_error = _normalize_text(last_error) or None

    def mark_failed(self, *, job_id: int, last_error: str) -> None:
        self._update_job(
            job_id=int(job_id),
            status=EVENT_OUTBOX_STATUS_FAILED,
            next_attempt_at=_utc_now(),
            last_error=last_error,
        )

    def claim_delivery_state_job_for_message(self, *, message_id: str) -> ChatEventOutboxJob | None:
        """Claim a queued delivery-state job for immediate post-ACK processing."""
        from backend.chat.chat_delivery_state import CHAT_MESSAGE_DELIVERY_STATE_EVENT

        normalized_message_id = _normalize_text(message_id)
        if not normalized_message_id:
            return None
        now = _utc_now()
        with _aux_write_session() as session:
            query = (
                select(ChatEventOutbox)
                .where(
                    ChatEventOutbox.status == EVENT_OUTBOX_STATUS_QUEUED,
                    ChatEventOutbox.event_type == CHAT_MESSAGE_DELIVERY_STATE_EVENT,
                    ChatEventOutbox.message_id == normalized_message_id,
                )
                .order_by(ChatEventOutbox.id.asc())
                .limit(1)
            )
            bind = session.get_bind()
            dialect_name = str(getattr(getattr(bind, "dialect", None), "name", "") or "").lower()
            if dialect_name == "postgresql":
                query = query.with_for_update(skip_locked=True)
            row = session.execute(query).scalar_one_or_none()
            if row is None:
                return None
            row.status = EVENT_OUTBOX_STATUS_PROCESSING
            row.attempt_count = int(row.attempt_count or 0) + 1
            row.updated_at = now
            session.flush()
            return self._serialize_job(row)

    def process_delivery_state_job_sync(self, job: ChatEventOutboxJob) -> None:
        """Apply unread/sender-seen side effects idempotently (no WS publish)."""
        from datetime import datetime as _dt

        from backend.chat.chat_delivery_state import (
            CHAT_MESSAGE_DELIVERY_STATE_EVENT,
            apply_message_delivery_state_after_commit,
        )

        if _normalize_text(job.event_type) != CHAT_MESSAGE_DELIVERY_STATE_EVENT:
            raise ValueError(f"unsupported delivery event_type={job.event_type}")
        payload = dict(job.payload or {})
        seen_raw = payload.get("seen_at")
        if isinstance(seen_raw, str) and seen_raw:
            try:
                seen_at = _dt.fromisoformat(seen_raw.replace("Z", "+00:00"))
            except Exception:
                seen_at = _utc_now()
        else:
            seen_at = _utc_now()
        with _aux_write_session() as session:
            apply_message_delivery_state_after_commit(
                session=session,
                conversation_id=job.conversation_id,
                message_id=job.message_id,
                sender_user_id=int(payload.get("sender_user_id") or job.target_user_id or 0),
                member_user_ids=list(payload.get("member_user_ids") or []),
                conversation_seq=int(payload.get("conversation_seq") or 0),
                seen_at=seen_at,
            )

    async def process_job(self, job: ChatEventOutboxJob) -> str:
        started_at = time.perf_counter()
        outcome = EVENT_OUTBOX_STATUS_FAILED
        note: str | None = None
        try:
            from backend.chat.chat_delivery_state import CHAT_MESSAGE_DELIVERY_STATE_EVENT

            if _normalize_text(job.event_type) == CHAT_MESSAGE_DELIVERY_STATE_EVENT:
                await asyncio.to_thread(self.process_delivery_state_job_sync, job)
            else:
                await publish_event_job(
                    {
                        "event_type": job.event_type,
                        "target_scope": job.target_scope,
                        "target_user_id": int(job.target_user_id),
                        "conversation_id": job.conversation_id,
                        "payload": job.payload,
                        "message_id": job.message_id,
                    }
                )
            # mark_* uses sync SQLAlchemy — never run on the asyncio event loop.
            await asyncio.to_thread(self.mark_delivered, job_id=job.id)
            outcome = EVENT_OUTBOX_STATUS_DELIVERED
            return outcome
        except Exception as exc:
            note = _normalize_text(exc) or "event delivery failed"
            if int(job.attempt_count) >= self.max_attempts:
                await asyncio.to_thread(self.mark_failed, job_id=job.id, last_error=note)
                outcome = EVENT_OUTBOX_STATUS_FAILED
            else:
                await asyncio.to_thread(self.mark_retry, job_id=job.id, last_error=note)
                outcome = EVENT_OUTBOX_STATUS_QUEUED
            return outcome
        finally:
            logger.info(
                "chat.event_outbox.job id=%s event_type=%s scope=%s target_user_id=%s conversation_id=%s message_id=%s attempt_count=%s status=%s duration_ms=%.1f error=%s",
                int(job.id),
                job.event_type,
                job.target_scope,
                int(job.target_user_id),
                job.conversation_id or "-",
                job.message_id or "-",
                int(job.attempt_count),
                outcome,
                (time.perf_counter() - started_at) * 1000.0,
                note or "-",
            )

    async def poll_once(self) -> dict[str, int]:
        try:
            from backend.chat.latency_profile import event_outbox_poll_enabled

            poll_enabled = bool(event_outbox_poll_enabled())
        except Exception:
            poll_enabled = True
        if not self.enabled or not poll_enabled:
            return {
                "enabled": int(bool(self.enabled)),
                "claimed": 0,
                "delivered": 0,
                "queued": 0,
                "failed": 0,
                "recovered": 0,
                "poll_disabled": int(not poll_enabled),
            }
        # Never overlap poll_once: claim/recover must stay single-flight on the loop.
        lock = self._ensure_poll_lock()
        if lock.locked():
            return {
                "enabled": 1,
                "claimed": 0,
                "delivered": 0,
                "queued": 0,
                "failed": 0,
                "recovered": 0,
                "skipped_busy": 1,
            }
        async with lock:
            recovered = await asyncio.to_thread(self.recover_stale_jobs)
            repaired = await asyncio.to_thread(self.repair_missing_delivery_state_outbox)
            recovered = int(recovered or 0) + int(repaired or 0)
            jobs = await asyncio.to_thread(self.claim_jobs)
            batch_started_at = time.perf_counter()
            delivered = 0
            queued = 0
            failed = 0
            semaphore = asyncio.Semaphore(self.max_concurrency)

            async def _process_bounded(job: ChatEventOutboxJob) -> str:
                async with semaphore:
                    return await self.process_job(job)

            outcomes = await asyncio.gather(
                *[_process_bounded(job) for job in jobs],
                return_exceptions=True,
            )
            for outcome in outcomes:
                if isinstance(outcome, Exception):
                    logger.error(
                        "chat.event_outbox.job task failed unexpectedly",
                        exc_info=(type(outcome), outcome, outcome.__traceback__),
                    )
                    failed += 1
                    continue
                if outcome == EVENT_OUTBOX_STATUS_DELIVERED:
                    delivered += 1
                elif outcome == EVENT_OUTBOX_STATUS_QUEUED:
                    queued += 1
                else:
                    failed += 1
            batch_duration_ms = (time.perf_counter() - batch_started_at) * 1000.0
            if jobs:
                self._last_avg_job_ms = batch_duration_ms / max(1, len(jobs))
            now = time.time()
            if (now - self._last_heartbeat_at) >= float(self.heartbeat_sec):
                self._last_heartbeat_at = now
                backlog = await asyncio.to_thread(self.get_backlog_snapshot)
                logger.info(
                    "chat.event_outbox.heartbeat enabled=%s claimed=%s delivered=%s queued=%s failed=%s recovered=%s backlog_queued=%s backlog_failed=%s avg_job_ms=%.1f batch_ms=%.1f concurrency=%s",
                    int(self.enabled),
                    len(jobs),
                    delivered,
                    queued,
                    failed,
                    recovered,
                    int(backlog.get("queued") or 0),
                    int(backlog.get("failed") or 0),
                    batch_duration_ms / max(1, len(jobs)),
                    batch_duration_ms,
                    int(self.max_concurrency),
                )
            return {
                "enabled": 1,
                "claimed": len(jobs),
                "delivered": delivered,
                "queued": queued,
                "failed": failed,
                "recovered": recovered,
            }

    def get_backlog_snapshot(self) -> dict[str, int | float]:
        now = _utc_now()
        queued = 0
        processing = 0
        terminal_failed = 0
        oldest_queued_age_sec = 0.0
        with _aux_write_session() as session:
            status_rows = session.execute(
                select(ChatEventOutbox.status, func.count())
                .group_by(ChatEventOutbox.status)
            ).all()
            oldest_row = session.execute(
                select(
                    func.min(ChatEventOutbox.created_at),
                    func.min(ChatEventOutbox.next_attempt_at),
                ).where(ChatEventOutbox.status == EVENT_OUTBOX_STATUS_QUEUED)
            ).one()
        for status, count in status_rows:
            normalized_status = _normalize_text(status)
            count_value = int(count or 0)
            if normalized_status == EVENT_OUTBOX_STATUS_QUEUED:
                queued = count_value
            elif normalized_status == EVENT_OUTBOX_STATUS_PROCESSING:
                processing = count_value
            elif normalized_status == EVENT_OUTBOX_STATUS_FAILED:
                terminal_failed = count_value
        created_at, next_attempt_at = oldest_row
        if queued > 0:
            created = _coerce_utc(created_at) or now
            next_attempt = _coerce_utc(next_attempt_at) or created
            oldest_queued_age_sec = max(0.0, (now - min(created, next_attempt)).total_seconds())
        return {
            "queued": queued,
            "processing": processing,
            "failed": terminal_failed,
            "oldest_queued_age_sec": round(oldest_queued_age_sec, 1),
            "dispatcher_active": int(self.dispatcher_active),
            "avg_job_ms": round(float(self._last_avg_job_ms or 0.0), 1),
        }


chat_event_outbox_service = ChatEventOutboxService()
