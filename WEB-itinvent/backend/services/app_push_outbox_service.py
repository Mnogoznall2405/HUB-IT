"""Durable delivery queue for non-chat application push notifications."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from backend.appdb.db import app_session, is_app_database_configured
from backend.appdb.models import AppPushOutbox
from backend.chat.push_service import chat_push_service


logger = logging.getLogger("backend.app.push_outbox")

STATUS_QUEUED = "queued"
STATUS_PROCESSING = "processing"
STATUS_SENT = "sent"
STATUS_NO_SUBSCRIPTIONS = "no_subscriptions"
STATUS_FAILED = "failed"
STATUS_EXPIRED = "expired"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _coerce_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _normalize_text(value: Any, default: str = "", *, max_length: int | None = None) -> str:
    normalized = str(value or "").strip() or default
    if max_length is not None:
        return normalized[:max_length]
    return normalized


def _env_flag(name: str, default: str = "1") -> bool:
    return _normalize_text(os.getenv(name, default), default).casefold() in {"1", "true", "yes", "on"}


def _clamp_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(_normalize_text(os.getenv(name, str(default)), str(default)))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


@dataclass(frozen=True)
class AppPushEnqueueResult:
    accepted: bool
    created: bool
    job_id: int
    status: str
    # Compatibility with direct push results used by existing callers.
    sent: int = 0
    disabled: int = 0
    failed: int = 0


@dataclass(frozen=True)
class AppPushOutboxJob:
    id: int
    recipient_user_id: int
    channel: str
    title: str
    body: str
    route: str
    tag: str
    icon: str
    badge: str
    data: dict[str, Any]
    ttl_seconds: int
    app_badge_count: int | None
    attempt_count: int
    expires_at: datetime


class AppPushOutboxService:
    """Persist, retry and observe task/mail/system push delivery."""

    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._stop_event: asyncio.Event | None = None
        self._last_heartbeat_at = 0.0

    @property
    def enabled(self) -> bool:
        return _env_flag("APP_PUSH_OUTBOX_ENABLED", "1")

    @property
    def poll_interval_sec(self) -> int:
        return _clamp_env_int("APP_PUSH_OUTBOX_POLL_INTERVAL_SEC", 2, 1, 30)

    @property
    def batch_size(self) -> int:
        return _clamp_env_int("APP_PUSH_OUTBOX_BATCH_SIZE", 25, 1, 200)

    @property
    def max_concurrency(self) -> int:
        return _clamp_env_int("APP_PUSH_OUTBOX_MAX_CONCURRENCY", 4, 1, 32)

    @property
    def max_attempts(self) -> int:
        return _clamp_env_int("APP_PUSH_OUTBOX_MAX_ATTEMPTS", 8, 1, 20)

    @property
    def retry_base_sec(self) -> int:
        return _clamp_env_int("APP_PUSH_OUTBOX_RETRY_BASE_SEC", 5, 1, 600)

    @property
    def processing_timeout_sec(self) -> int:
        return _clamp_env_int("APP_PUSH_OUTBOX_PROCESSING_TIMEOUT_SEC", 300, 30, 3600)

    @property
    def heartbeat_sec(self) -> int:
        return _clamp_env_int("APP_PUSH_OUTBOX_HEARTBEAT_SEC", 60, 10, 3600)

    @staticmethod
    def _payload_json(data: dict[str, Any] | None) -> str:
        payload = data if isinstance(data, dict) else {}
        return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)

    @staticmethod
    def _dedupe_key(
        *,
        recipient_user_id: int,
        channel: str,
        tag: str,
        route: str,
        title: str,
        body: str,
        data_json: str,
        explicit_key: str | None,
    ) -> str:
        explicit = _normalize_text(explicit_key)
        if explicit:
            source = f"explicit:{recipient_user_id}:{channel}:{explicit}"
        elif tag:
            source = f"tag:{recipient_user_id}:{channel}:{tag}"
        else:
            source = f"payload:{recipient_user_id}:{channel}:{route}:{title}:{body}:{data_json}"
        return hashlib.sha256(source.encode("utf-8")).hexdigest()

    def enqueue_notification(
        self,
        *,
        recipient_user_id: int,
        title: str,
        body: str,
        channel: str = "system",
        route: str = "/",
        tag: str = "",
        icon: str = "/pwa-192.png",
        badge: str = "/hubit-badge.svg",
        data: dict[str, Any] | None = None,
        ttl: int = 86400,
        app_badge_count: int | None = None,
        dedupe_key: str | None = None,
    ) -> AppPushEnqueueResult:
        if not self.enabled or not is_app_database_configured():
            if self.enabled:
                logger.warning(
                    "app.push_outbox unavailable: APP_DATABASE_URL is not configured; using direct delivery"
                )
            direct = chat_push_service.send_notification(
                recipient_user_id=int(recipient_user_id),
                title=title,
                body=body,
                channel=channel,
                route=route,
                tag=tag,
                icon=icon,
                badge=badge,
                data=data,
                ttl=ttl,
                app_badge_count=app_badge_count,
            )
            return AppPushEnqueueResult(
                accepted=int(getattr(direct, "sent", 0) or 0) > 0,
                created=False,
                job_id=0,
                status=STATUS_SENT if int(getattr(direct, "sent", 0) or 0) > 0 else STATUS_FAILED,
                sent=int(getattr(direct, "sent", 0) or 0),
                disabled=int(getattr(direct, "disabled", 0) or 0),
                failed=int(getattr(direct, "failed", 0) or 0),
            )
        normalized_user_id = int(recipient_user_id)
        if normalized_user_id <= 0:
            raise ValueError("recipient_user_id must be positive")
        normalized_channel = _normalize_text(channel, "system", max_length=32)
        normalized_title = _normalize_text(title, "Новое уведомление", max_length=255)
        normalized_body = _normalize_text(
            body,
            "Откройте приложение, чтобы посмотреть подробности.",
        )
        normalized_route = _normalize_text(route, "/", max_length=1024)
        normalized_tag = _normalize_text(tag, max_length=255)
        normalized_icon = _normalize_text(icon, "/pwa-192.png", max_length=255)
        normalized_badge = _normalize_text(badge, "/hubit-badge.svg", max_length=255)
        normalized_ttl = max(60, min(int(ttl or 86400), 28 * 24 * 60 * 60))
        normalized_badge_count = None if app_badge_count is None else max(0, int(app_badge_count))
        data_json = self._payload_json(data)
        resolved_dedupe_key = self._dedupe_key(
            recipient_user_id=normalized_user_id,
            channel=normalized_channel,
            tag=normalized_tag,
            route=normalized_route,
            title=normalized_title,
            body=normalized_body,
            data_json=data_json,
            explicit_key=dedupe_key,
        )
        now = _utc_now()
        row = AppPushOutbox(
            dedupe_key=resolved_dedupe_key,
            recipient_user_id=normalized_user_id,
            channel=normalized_channel,
            title=normalized_title,
            body=normalized_body,
            route=normalized_route,
            tag=normalized_tag,
            icon=normalized_icon,
            badge=normalized_badge,
            data_json=data_json,
            ttl_seconds=normalized_ttl,
            app_badge_count=normalized_badge_count,
            status=STATUS_QUEUED,
            attempt_count=0,
            next_attempt_at=now,
            expires_at=now + timedelta(seconds=normalized_ttl),
            created_at=now,
            updated_at=now,
        )
        try:
            with app_session() as session:
                session.add(row)
                session.flush()
                job_id = int(row.id)
            logger.info(
                "app.push_outbox.enqueue id=%s user_id=%s channel=%s tag=%s created=1",
                job_id,
                normalized_user_id,
                normalized_channel,
                normalized_tag or "-",
            )
            return AppPushEnqueueResult(True, True, job_id, STATUS_QUEUED)
        except IntegrityError:
            with app_session() as session:
                existing = session.execute(
                    select(AppPushOutbox).where(AppPushOutbox.dedupe_key == resolved_dedupe_key)
                ).scalar_one()
                result = AppPushEnqueueResult(
                    accepted=True,
                    created=False,
                    job_id=int(existing.id),
                    status=_normalize_text(existing.status, STATUS_QUEUED),
                )
            logger.info(
                "app.push_outbox.enqueue id=%s user_id=%s channel=%s tag=%s created=0",
                result.job_id,
                normalized_user_id,
                normalized_channel,
                normalized_tag or "-",
            )
            return result

    async def start(self) -> None:
        if not self.enabled:
            logger.info("app.push_outbox.worker disabled (APP_PUSH_OUTBOX_ENABLED=0)")
            return
        if not is_app_database_configured():
            logger.warning("app.push_outbox.worker not started: APP_DATABASE_URL is not configured")
            return
        if self._task and not self._task.done():
            return
        self._stop_event = asyncio.Event()
        self._task = asyncio.create_task(self._run_loop(), name="app-push-outbox-worker")

    async def stop(self) -> None:
        if self._stop_event is not None:
            self._stop_event.set()
        if self._task is not None:
            if not self._task.done():
                self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            except Exception:
                logger.exception("app.push_outbox.worker failed before shutdown")
        self._task = None
        self._stop_event = None

    async def _run_loop(self) -> None:
        while True:
            try:
                await self.poll_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("app.push_outbox.poll iteration failed")
            try:
                assert self._stop_event is not None
                await asyncio.wait_for(self._stop_event.wait(), timeout=self.poll_interval_sec)
                return
            except asyncio.TimeoutError:
                continue

    def _retry_delay_sec(self, attempt_count: int) -> int:
        exponent = max(0, int(attempt_count) - 1)
        return min(30 * 60, self.retry_base_sec * (2**exponent))

    @staticmethod
    def _serialize_job(row: AppPushOutbox) -> AppPushOutboxJob:
        try:
            data = json.loads(row.data_json or "{}")
        except (TypeError, ValueError, json.JSONDecodeError):
            data = {}
        return AppPushOutboxJob(
            id=int(row.id),
            recipient_user_id=int(row.recipient_user_id),
            channel=_normalize_text(row.channel, "system"),
            title=_normalize_text(row.title, "Новое уведомление"),
            body=_normalize_text(row.body, "Откройте приложение, чтобы посмотреть подробности."),
            route=_normalize_text(row.route, "/"),
            tag=_normalize_text(row.tag),
            icon=_normalize_text(row.icon, "/pwa-192.png"),
            badge=_normalize_text(row.badge, "/hubit-badge.svg"),
            data=data if isinstance(data, dict) else {},
            ttl_seconds=max(60, int(row.ttl_seconds or 86400)),
            app_badge_count=None if row.app_badge_count is None else int(row.app_badge_count),
            attempt_count=int(row.attempt_count or 0),
            expires_at=_coerce_utc(row.expires_at) or _utc_now(),
        )

    def recover_stale_jobs(self) -> int:
        cutoff = _utc_now() - timedelta(seconds=self.processing_timeout_sec)
        with app_session() as session:
            rows = list(
                session.execute(
                    select(AppPushOutbox).where(
                        AppPushOutbox.status == STATUS_PROCESSING,
                        AppPushOutbox.updated_at <= cutoff,
                    )
                ).scalars()
            )
            now = _utc_now()
            for row in rows:
                row.status = STATUS_QUEUED
                row.next_attempt_at = now
                row.updated_at = now
                row.last_error = "Recovered stale processing job"
            return len(rows)

    def claim_jobs(self, limit: int | None = None) -> list[AppPushOutboxJob]:
        now = _utc_now()
        with app_session() as session:
            query = (
                select(AppPushOutbox)
                .where(
                    AppPushOutbox.status == STATUS_QUEUED,
                    AppPushOutbox.next_attempt_at <= now,
                )
                .order_by(AppPushOutbox.next_attempt_at.asc(), AppPushOutbox.id.asc())
                .limit(max(1, int(limit or self.batch_size)))
            )
            bind = session.get_bind()
            dialect = _normalize_text(getattr(getattr(bind, "dialect", None), "name", "")).lower()
            if dialect == "postgresql":
                query = query.with_for_update(skip_locked=True)
            rows = list(session.execute(query).scalars())
            for row in rows:
                row.status = STATUS_PROCESSING
                row.attempt_count = int(row.attempt_count or 0) + 1
                row.updated_at = now
            session.flush()
            return [self._serialize_job(row) for row in rows]

    def _update_job(self, job_id: int, *, status: str, error: str | None = None, retry_delay: int = 0) -> None:
        with app_session() as session:
            row = session.get(AppPushOutbox, int(job_id))
            if row is None:
                return
            now = _utc_now()
            row.status = status
            row.updated_at = now
            row.next_attempt_at = now + timedelta(seconds=max(0, int(retry_delay)))
            row.last_error = _normalize_text(error, max_length=2000) or None
            if status == STATUS_SENT:
                row.delivered_at = now

    def process_job(self, job: AppPushOutboxJob) -> str:
        started_at = time.perf_counter()
        outcome = STATUS_FAILED
        note: str | None = None
        try:
            if job.expires_at <= _utc_now():
                note = "Notification TTL expired before delivery"
                self._update_job(job.id, status=STATUS_EXPIRED, error=note)
                outcome = STATUS_EXPIRED
                return outcome
            result = chat_push_service.send_notification(
                recipient_user_id=job.recipient_user_id,
                title=job.title,
                body=job.body,
                channel=job.channel,
                route=job.route,
                tag=job.tag,
                icon=job.icon,
                badge=job.badge,
                data=job.data,
                ttl=min(job.ttl_seconds, max(1, int((job.expires_at - _utc_now()).total_seconds()))),
                app_badge_count=job.app_badge_count,
            )
            sent = int(getattr(result, "sent", 0) or 0)
            failed = int(getattr(result, "failed", 0) or 0)
            disabled = int(getattr(result, "disabled", 0) or 0)
            if sent > 0:
                note = f"partial_delivery failed={failed} disabled={disabled}" if failed > 0 else None
                self._update_job(job.id, status=STATUS_SENT, error=note)
                outcome = STATUS_SENT
            elif failed > 0:
                note = f"delivery_failed failed={failed} disabled={disabled}"
                if job.attempt_count >= self.max_attempts:
                    self._update_job(job.id, status=STATUS_FAILED, error=note)
                    outcome = STATUS_FAILED
                else:
                    self._update_job(
                        job.id,
                        status=STATUS_QUEUED,
                        error=note,
                        retry_delay=self._retry_delay_sec(job.attempt_count),
                    )
                    outcome = STATUS_QUEUED
            else:
                note = "No active push subscriptions"
                self._update_job(job.id, status=STATUS_NO_SUBSCRIPTIONS, error=note)
                outcome = STATUS_NO_SUBSCRIPTIONS
            return outcome
        except Exception as exc:
            note = _normalize_text(exc, "push delivery failed", max_length=2000)
            if job.attempt_count >= self.max_attempts:
                self._update_job(job.id, status=STATUS_FAILED, error=note)
                outcome = STATUS_FAILED
            else:
                self._update_job(
                    job.id,
                    status=STATUS_QUEUED,
                    error=note,
                    retry_delay=self._retry_delay_sec(job.attempt_count),
                )
                outcome = STATUS_QUEUED
            return outcome
        finally:
            logger.info(
                "app.push_outbox.job id=%s user_id=%s channel=%s attempt=%s status=%s duration_ms=%.1f error=%s",
                job.id,
                job.recipient_user_id,
                job.channel,
                job.attempt_count,
                outcome,
                (time.perf_counter() - started_at) * 1000.0,
                note or "-",
            )

    def get_backlog_snapshot(self) -> dict[str, int | float | bool]:
        empty: dict[str, int | float | bool] = {
            "enabled": bool(self.enabled),
            "queued": 0,
            "ready": 0,
            "processing": 0,
            "failed": 0,
            "oldest_queued_age_sec": 0.0,
        }
        if not is_app_database_configured():
            return empty
        now = _utc_now()
        with app_session() as session:
            rows = session.execute(
                select(AppPushOutbox.status, func.count(AppPushOutbox.id)).group_by(AppPushOutbox.status)
            ).all()
            ready = session.execute(
                select(func.count(AppPushOutbox.id)).where(
                    AppPushOutbox.status == STATUS_QUEUED,
                    AppPushOutbox.next_attempt_at <= now,
                )
            ).scalar_one()
            oldest = session.execute(
                select(func.min(AppPushOutbox.created_at)).where(AppPushOutbox.status == STATUS_QUEUED)
            ).scalar_one_or_none()
        counts = {_normalize_text(status): int(count or 0) for status, count in rows}
        oldest_utc = _coerce_utc(oldest)
        return {
            "enabled": bool(self.enabled),
            "queued": counts.get(STATUS_QUEUED, 0),
            "ready": int(ready or 0),
            "processing": counts.get(STATUS_PROCESSING, 0),
            "failed": counts.get(STATUS_FAILED, 0),
            "oldest_queued_age_sec": round(max(0.0, (now - oldest_utc).total_seconds()), 1) if oldest_utc else 0.0,
        }

    async def _process_job_async(self, job: AppPushOutboxJob, semaphore: asyncio.Semaphore) -> str:
        async with semaphore:
            return await asyncio.to_thread(self.process_job, job)

    async def _emit_heartbeat_if_due(self) -> None:
        now = time.monotonic()
        if now - self._last_heartbeat_at < self.heartbeat_sec:
            return
        snapshot = await asyncio.to_thread(self.get_backlog_snapshot)
        self._last_heartbeat_at = now
        logger.info(
            "app.push_outbox.heartbeat queued=%s ready=%s processing=%s failed=%s oldest_queued_age_sec=%s",
            snapshot["queued"],
            snapshot["ready"],
            snapshot["processing"],
            snapshot["failed"],
            snapshot["oldest_queued_age_sec"],
        )

    async def poll_once(self) -> dict[str, int]:
        started_at = time.perf_counter()
        recovered = await asyncio.to_thread(self.recover_stale_jobs)
        jobs = await asyncio.to_thread(self.claim_jobs, self.batch_size)
        result = {
            "claimed": len(jobs),
            "sent": 0,
            "no_subscriptions": 0,
            "requeued": 0,
            "failed": 0,
            "expired": 0,
            "recovered": int(recovered),
        }
        if jobs:
            semaphore = asyncio.Semaphore(self.max_concurrency)
            outcomes = await asyncio.gather(*(self._process_job_async(job, semaphore) for job in jobs))
            for outcome in outcomes:
                if outcome == STATUS_SENT:
                    result["sent"] += 1
                elif outcome == STATUS_NO_SUBSCRIPTIONS:
                    result["no_subscriptions"] += 1
                elif outcome == STATUS_FAILED:
                    result["failed"] += 1
                elif outcome == STATUS_EXPIRED:
                    result["expired"] += 1
                else:
                    result["requeued"] += 1
        await self._emit_heartbeat_if_due()
        logger.info(
            "app.push_outbox.poll claimed=%s sent=%s no_subscriptions=%s requeued=%s failed=%s expired=%s recovered=%s duration_ms=%.1f",
            result["claimed"],
            result["sent"],
            result["no_subscriptions"],
            result["requeued"],
            result["failed"],
            result["expired"],
            result["recovered"],
            (time.perf_counter() - started_at) * 1000.0,
        )
        return result


app_push_outbox_service = AppPushOutboxService()
