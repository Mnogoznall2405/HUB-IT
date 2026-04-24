"""Background worker for deferred chat web-push delivery."""
from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, select

from backend.chat.db import chat_session
from backend.chat.models import ChatPushOutbox
from backend.chat.push_service import chat_push_service


logger = logging.getLogger("backend.chat.push_outbox")

OUTBOX_STATUS_QUEUED = "queued"
OUTBOX_STATUS_PROCESSING = "processing"
OUTBOX_STATUS_SENT = "sent"
OUTBOX_STATUS_NO_SUBSCRIPTIONS = "no_subscriptions"
OUTBOX_STATUS_FAILED = "failed"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _coerce_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _normalize_text(value: object, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


def _clamp_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = _normalize_text(os.getenv(name), str(default))
    try:
        return max(minimum, min(maximum, int(raw)))
    except Exception:
        return max(minimum, min(maximum, int(default)))


def _env_flag(name: str, default: str = "1") -> bool:
    return _normalize_text(os.getenv(name), default).lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class ChatPushOutboxJob:
    id: int
    message_id: str
    conversation_id: str
    recipient_user_id: int
    channel: str
    title: str
    body: str
    attempt_count: int
    status: str
    next_attempt_at: datetime
    updated_at: datetime


class ChatPushOutboxService:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._stop_event: asyncio.Event | None = None
        self._last_heartbeat_at: float = 0.0

    @property
    def enabled(self) -> bool:
        return _env_flag("CHAT_PUSH_OUTBOX_ENABLED", "1")

    @property
    def poll_interval_sec(self) -> int:
        return _clamp_env_int("CHAT_PUSH_OUTBOX_POLL_INTERVAL_SEC", 2, 1, 30)

    @property
    def batch_size(self) -> int:
        return _clamp_env_int("CHAT_PUSH_OUTBOX_BATCH_SIZE", 25, 1, 200)

    @property
    def max_concurrency(self) -> int:
        return _clamp_env_int("CHAT_PUSH_OUTBOX_MAX_CONCURRENCY", 4, 1, 32)

    @property
    def max_attempts(self) -> int:
        return _clamp_env_int("CHAT_PUSH_OUTBOX_MAX_ATTEMPTS", 8, 1, 20)

    @property
    def retry_base_sec(self) -> int:
        return _clamp_env_int("CHAT_PUSH_OUTBOX_RETRY_BASE_SEC", 15, 5, 600)

    @property
    def processing_timeout_sec(self) -> int:
        return _clamp_env_int("CHAT_PUSH_OUTBOX_PROCESSING_TIMEOUT_SEC", 300, 30, 3600)

    @property
    def heartbeat_sec(self) -> int:
        return _clamp_env_int("CHAT_PUSH_OUTBOX_HEARTBEAT_SEC", 60, 10, 3600)

    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop_event = asyncio.Event()
        self._task = asyncio.create_task(self._run_loop(), name="chat-push-outbox-worker")

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
                logger.exception("chat.push_outbox.poll iteration failed")
            try:
                assert self._stop_event is not None
                await asyncio.wait_for(self._stop_event.wait(), timeout=self.poll_interval_sec)
                return
            except asyncio.TimeoutError:
                continue

    def _retry_delay_sec(self, attempt_count: int) -> int:
        exponent = max(0, int(attempt_count) - 1)
        return min(30 * 60, int(self.retry_base_sec) * (2 ** exponent))

    def _serialize_job(self, job: ChatPushOutbox) -> ChatPushOutboxJob:
        return ChatPushOutboxJob(
            id=int(job.id),
            message_id=_normalize_text(job.message_id),
            conversation_id=_normalize_text(job.conversation_id),
            recipient_user_id=int(job.recipient_user_id),
            channel=_normalize_text(job.channel, "chat"),
            title=_normalize_text(job.title, "Новое сообщение в чате"),
            body=_normalize_text(job.body, "Откройте чат, чтобы посмотреть сообщение."),
            attempt_count=int(job.attempt_count or 0),
            status=_normalize_text(job.status, OUTBOX_STATUS_QUEUED),
            next_attempt_at=_coerce_utc(job.next_attempt_at) or _utc_now(),
            updated_at=_coerce_utc(job.updated_at) or _utc_now(),
        )

    def recover_stale_jobs(self) -> int:
        cutoff = _utc_now() - timedelta(seconds=self.processing_timeout_sec)
        recovered = 0
        with chat_session() as session:
            stale_jobs = list(
                session.execute(
                    select(ChatPushOutbox).where(
                        ChatPushOutbox.status == OUTBOX_STATUS_PROCESSING,
                        ChatPushOutbox.updated_at <= cutoff,
                    )
                ).scalars()
            )
            now = _utc_now()
            for job in stale_jobs:
                job.status = OUTBOX_STATUS_QUEUED
                job.next_attempt_at = now
                job.updated_at = now
                job.last_error = "Recovered stale processing job"
                recovered += 1
        return recovered

    def claim_jobs(self, limit: int | None = None) -> list[ChatPushOutboxJob]:
        claim_limit = max(1, int(limit or self.batch_size))
        now = _utc_now()
        with chat_session() as session:
            query = (
                select(ChatPushOutbox)
                .where(
                    ChatPushOutbox.status == OUTBOX_STATUS_QUEUED,
                    ChatPushOutbox.next_attempt_at <= now,
                )
                .order_by(ChatPushOutbox.next_attempt_at.asc(), ChatPushOutbox.id.asc())
                .limit(claim_limit)
            )
            bind = session.get_bind()
            dialect_name = str(getattr(getattr(bind, "dialect", None), "name", "") or "").lower()
            if dialect_name == "postgresql":
                query = query.with_for_update(skip_locked=True)
            jobs = list(session.execute(query).scalars())
            for job in jobs:
                job.status = OUTBOX_STATUS_PROCESSING
                job.attempt_count = int(job.attempt_count or 0) + 1
                job.updated_at = now
            session.flush()
            return [self._serialize_job(job) for job in jobs]

    def _update_job(
        self,
        *,
        job_id: int,
        status: str,
        next_attempt_at: datetime | None = None,
        last_error: str | None = None,
    ) -> None:
        with chat_session() as session:
            job = session.get(ChatPushOutbox, int(job_id))
            if job is None:
                return
            job.status = _normalize_text(status, OUTBOX_STATUS_FAILED)
            job.updated_at = _utc_now()
            job.next_attempt_at = next_attempt_at or job.updated_at
            job.last_error = _normalize_text(last_error) or None

    def mark_sent(self, *, job_id: int, last_error: str | None = None) -> None:
        self._update_job(
            job_id=int(job_id),
            status=OUTBOX_STATUS_SENT,
            next_attempt_at=_utc_now(),
            last_error=last_error,
        )

    def mark_no_subscriptions(self, *, job_id: int, last_error: str | None = None) -> None:
        self._update_job(
            job_id=int(job_id),
            status=OUTBOX_STATUS_NO_SUBSCRIPTIONS,
            next_attempt_at=_utc_now(),
            last_error=last_error,
        )

    def mark_retry(self, *, job_id: int, last_error: str) -> None:
        with chat_session() as session:
            job = session.get(ChatPushOutbox, int(job_id))
            if job is None:
                return
            delay_sec = self._retry_delay_sec(int(job.attempt_count or 0))
            next_attempt_at = _utc_now() + timedelta(seconds=delay_sec)
            job.status = OUTBOX_STATUS_QUEUED
            job.next_attempt_at = next_attempt_at
            job.updated_at = _utc_now()
            job.last_error = _normalize_text(last_error) or None

    def mark_failed(self, *, job_id: int, last_error: str) -> None:
        self._update_job(
            job_id=int(job_id),
            status=OUTBOX_STATUS_FAILED,
            next_attempt_at=_utc_now(),
            last_error=last_error,
        )

    def process_job(self, job: ChatPushOutboxJob) -> str:
        started_at = time.perf_counter()
        outcome = OUTBOX_STATUS_FAILED
        note: str | None = None
        try:
            result = chat_push_service.send_chat_message_notification(
                recipient_user_id=int(job.recipient_user_id),
                conversation_id=job.conversation_id,
                message_id=job.message_id,
                title=job.title,
                body=job.body,
            )
            if int(result.sent or 0) > 0:
                note = None
                if int(result.failed or 0) > 0:
                    note = f"partial_delivery failed={int(result.failed or 0)} disabled={int(result.disabled or 0)}"
                self.mark_sent(job_id=job.id, last_error=note)
                outcome = OUTBOX_STATUS_SENT
            elif int(result.failed or 0) > 0:
                note = f"delivery_failed failed={int(result.failed or 0)} disabled={int(result.disabled or 0)}"
                if int(job.attempt_count) >= self.max_attempts:
                    self.mark_failed(job_id=job.id, last_error=note)
                    outcome = OUTBOX_STATUS_FAILED
                else:
                    self.mark_retry(job_id=job.id, last_error=note)
                    outcome = OUTBOX_STATUS_QUEUED
            else:
                note = "No active push subscriptions"
                if int(result.disabled or 0) > 0:
                    note = "All push subscriptions disabled or expired"
                self.mark_no_subscriptions(job_id=job.id, last_error=note)
                outcome = OUTBOX_STATUS_NO_SUBSCRIPTIONS
            return outcome
        except Exception as exc:
            note = _normalize_text(exc) or "push delivery failed"
            if int(job.attempt_count) >= self.max_attempts:
                self.mark_failed(job_id=job.id, last_error=note)
                outcome = OUTBOX_STATUS_FAILED
            else:
                self.mark_retry(job_id=job.id, last_error=note)
                outcome = OUTBOX_STATUS_QUEUED
            return outcome
        finally:
            logger.info(
                "chat.push_outbox.job id=%s recipient_user_id=%s conversation_id=%s message_id=%s attempt_count=%s status=%s duration_ms=%.1f error=%s",
                int(job.id),
                int(job.recipient_user_id),
                job.conversation_id,
                job.message_id,
                int(job.attempt_count),
                outcome,
                (time.perf_counter() - started_at) * 1000.0,
                note or "-",
            )

    def get_backlog_snapshot(self) -> dict[str, int | float]:
        now = _utc_now()
        queued = 0
        processing = 0
        terminal_failed = 0
        oldest_queued_age_sec = 0.0
        with chat_session() as session:
            jobs = list(session.execute(select(ChatPushOutbox)).scalars())
            for job in jobs:
                status = _normalize_text(job.status)
                if status == OUTBOX_STATUS_QUEUED:
                    queued += 1
                    next_attempt_at = _coerce_utc(job.next_attempt_at)
                    if next_attempt_at is not None:
                        age_sec = max(0.0, (now - next_attempt_at).total_seconds())
                        oldest_queued_age_sec = max(oldest_queued_age_sec, age_sec)
                elif status == OUTBOX_STATUS_PROCESSING:
                    processing += 1
                elif status == OUTBOX_STATUS_FAILED:
                    terminal_failed += 1
        return {
            "queued": queued,
            "processing": processing,
            "failed": terminal_failed,
            "oldest_queued_age_sec": round(oldest_queued_age_sec, 1),
        }

    async def _process_job_async(self, job: ChatPushOutboxJob, semaphore: asyncio.Semaphore) -> str:
        async with semaphore:
            return await asyncio.to_thread(self.process_job, job)

    async def _emit_heartbeat_if_due(self) -> None:
        now_monotonic = time.monotonic()
        if (now_monotonic - self._last_heartbeat_at) < float(self.heartbeat_sec):
            return
        snapshot = await asyncio.to_thread(self.get_backlog_snapshot)
        self._last_heartbeat_at = now_monotonic
        logger.info(
            "chat.push_outbox.heartbeat queued=%s processing=%s failed=%s oldest_queued_age_sec=%s push_enabled=%s",
            int(snapshot["queued"]),
            int(snapshot["processing"]),
            int(snapshot["failed"]),
            snapshot["oldest_queued_age_sec"],
            int(bool(chat_push_service.enabled)),
        )

    async def poll_once(self) -> dict[str, int]:
        if not self.enabled:
            await self._emit_heartbeat_if_due()
            return {
                "claimed": 0,
                "sent": 0,
                "no_subscriptions": 0,
                "requeued": 0,
                "failed": 0,
                "recovered": 0,
            }

        started_at = time.perf_counter()
        recovered = await asyncio.to_thread(self.recover_stale_jobs)
        if not chat_push_service.enabled:
            await self._emit_heartbeat_if_due()
            logger.info(
                "chat.push_outbox.poll claimed=0 sent=0 no_subscriptions=0 requeued=0 failed=0 recovered=%s duration_ms=%.1f push_enabled=0",
                int(recovered),
                (time.perf_counter() - started_at) * 1000.0,
            )
            return {
                "claimed": 0,
                "sent": 0,
                "no_subscriptions": 0,
                "requeued": 0,
                "failed": 0,
                "recovered": int(recovered),
            }

        jobs = await asyncio.to_thread(self.claim_jobs, self.batch_size)
        result = {
            "claimed": len(jobs),
            "sent": 0,
            "no_subscriptions": 0,
            "requeued": 0,
            "failed": 0,
            "recovered": int(recovered),
        }
        if jobs:
            semaphore = asyncio.Semaphore(self.max_concurrency)
            outcomes = await asyncio.gather(
                *(self._process_job_async(job, semaphore) for job in jobs),
            )
            for outcome in outcomes:
                if outcome == OUTBOX_STATUS_SENT:
                    result["sent"] += 1
                elif outcome == OUTBOX_STATUS_NO_SUBSCRIPTIONS:
                    result["no_subscriptions"] += 1
                elif outcome == OUTBOX_STATUS_FAILED:
                    result["failed"] += 1
                else:
                    result["requeued"] += 1
        await self._emit_heartbeat_if_due()
        logger.info(
            "chat.push_outbox.poll claimed=%s sent=%s no_subscriptions=%s requeued=%s failed=%s recovered=%s duration_ms=%.1f push_enabled=%s",
            result["claimed"],
            result["sent"],
            result["no_subscriptions"],
            result["requeued"],
            result["failed"],
            result["recovered"],
            (time.perf_counter() - started_at) * 1000.0,
            int(bool(chat_push_service.enabled)),
        )
        return result


chat_push_outbox_service = ChatPushOutboxService()
