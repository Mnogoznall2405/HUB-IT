from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select

from backend.chat.db import chat_session
from backend.chat.models import ChatEventOutbox
from backend.chat.realtime_side_effects import publish_event_job


logger = logging.getLogger("backend.chat.event_outbox")

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
        with chat_session() as session:
            for item in normalized_jobs:
                if not item["event_type"] or int(item["target_user_id"]) <= 0:
                    continue
                dedupe_key = item["dedupe_key"]
                if dedupe_key:
                    existing = session.execute(
                        select(ChatEventOutbox).where(ChatEventOutbox.dedupe_key == dedupe_key)
                    ).scalar_one_or_none()
                    if existing is not None:
                        continue
                session.add(
                    ChatEventOutbox(
                        event_type=item["event_type"],
                        target_scope=item["target_scope"],
                        target_user_id=int(item["target_user_id"]),
                        conversation_id=item["conversation_id"],
                        message_id=item["message_id"],
                        payload_json=json.dumps(item["payload"], ensure_ascii=False),
                        dedupe_key=dedupe_key,
                        status=EVENT_OUTBOX_STATUS_QUEUED,
                        attempt_count=0,
                        next_attempt_at=now,
                        last_error=None,
                        created_at=now,
                        updated_at=now,
                    )
                )
                inserted += 1
        return inserted

    def recover_stale_jobs(self) -> int:
        cutoff = _utc_now() - timedelta(seconds=self.processing_timeout_sec)
        recovered = 0
        with chat_session() as session:
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
        with chat_session() as session:
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
        with chat_session() as session:
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
        with chat_session() as session:
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

    async def process_job(self, job: ChatEventOutboxJob) -> str:
        started_at = time.perf_counter()
        outcome = EVENT_OUTBOX_STATUS_FAILED
        note: str | None = None
        try:
            await publish_event_job(
                {
                    "event_type": job.event_type,
                    "target_scope": job.target_scope,
                    "target_user_id": int(job.target_user_id),
                    "conversation_id": job.conversation_id,
                    "message_id": job.message_id,
                    "payload": job.payload,
                }
            )
            self.mark_delivered(job_id=job.id)
            outcome = EVENT_OUTBOX_STATUS_DELIVERED
            return outcome
        except Exception as exc:
            note = _normalize_text(exc) or "event delivery failed"
            if int(job.attempt_count) >= self.max_attempts:
                self.mark_failed(job_id=job.id, last_error=note)
                outcome = EVENT_OUTBOX_STATUS_FAILED
            else:
                self.mark_retry(job_id=job.id, last_error=note)
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
        if not self.enabled:
            return {
                "enabled": 0,
                "claimed": 0,
                "delivered": 0,
                "queued": 0,
                "failed": 0,
                "recovered": 0,
            }
        recovered = self.recover_stale_jobs()
        jobs = self.claim_jobs()
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
            backlog = self.get_backlog_snapshot()
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
        with chat_session() as session:
            rows = list(
                session.execute(
                    select(ChatEventOutbox.status, ChatEventOutbox.created_at, ChatEventOutbox.next_attempt_at)
                ).all()
            )
        for status, created_at, next_attempt_at in rows:
            normalized_status = _normalize_text(status)
            if normalized_status == EVENT_OUTBOX_STATUS_QUEUED:
                queued += 1
                created = _coerce_utc(created_at) or now
                next_attempt = _coerce_utc(next_attempt_at) or created
                age_sec = max(0.0, (now - min(created, next_attempt)).total_seconds())
                oldest_queued_age_sec = max(oldest_queued_age_sec, age_sec)
            elif normalized_status == EVENT_OUTBOX_STATUS_PROCESSING:
                processing += 1
            elif normalized_status == EVENT_OUTBOX_STATUS_FAILED:
                terminal_failed += 1
        return {
            "queued": queued,
            "processing": processing,
            "failed": terminal_failed,
            "oldest_queued_age_sec": round(oldest_queued_age_sec, 1),
            "dispatcher_active": int(self.dispatcher_active),
            "avg_job_ms": round(float(self._last_avg_job_ms or 0.0), 1),
        }


chat_event_outbox_service = ChatEventOutboxService()
