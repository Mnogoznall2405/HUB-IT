"""Background notifications for newly assigned personal 1C DO tasks."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import time
import urllib.parse
from typing import Any

from sqlalchemy import select

from backend.chat.db import chat_session
from backend.chat.models import ChatPushSubscription
from backend.services.app_push_service import app_push_service
from backend.services.authorization_service import PERM_DOCFLOW_READ, authorization_service
from backend.services.docflow_service import DocflowServiceError, docflow_service
from backend.services.hub_service import hub_service
from backend.services.mail_runtime_snapshot_service import mail_runtime_snapshot_service
from backend.services.notification_preferences_service import notification_preferences_service
from backend.services.session_service import session_service
from backend.services.user_service import user_service
from backend.realtime.hub import HUB_DOCFLOW_TASK_CHANGED_EVENT, hub_realtime_publisher


logger = logging.getLogger(__name__)


def _env_int(name: str, default: int, *, minimum: int, maximum: int) -> int:
    try:
        return max(minimum, min(maximum, int(str(os.getenv(name, default) or default))))
    except (TypeError, ValueError):
        return default


class DocflowNotificationService:
    def __init__(
        self,
        *,
        docflow=None,
        hub=None,
        push=None,
        preferences=None,
        checkpoint=None,
    ) -> None:
        self._docflow = docflow or docflow_service
        self._hub = hub or hub_service
        self._push = push or app_push_service
        self._preferences = preferences or notification_preferences_service
        self._checkpoint = checkpoint or mail_runtime_snapshot_service
        self._known_refs: dict[int, set[str]] = {}
        self._task: asyncio.Task | None = None
        self._stop_event: asyncio.Event | None = None
        self._poll_lock = asyncio.Lock()
        self._last_poll_duration_ms = 0.0
        self._last_error_count = 0
        self._candidate_cursor = 0

    @property
    def poll_interval_sec(self) -> int:
        return _env_int("DOCFLOW_NOTIFICATION_POLL_INTERVAL_SEC", 90, minimum=30, maximum=900)

    @property
    def startup_delay_sec(self) -> int:
        return _env_int("DOCFLOW_NOTIFICATION_STARTUP_DELAY_SEC", 30, minimum=0, maximum=600)

    @property
    def batch_size(self) -> int:
        return _env_int("DOCFLOW_NOTIFICATION_BATCH_SIZE", 50, minimum=1, maximum=200)

    @property
    def max_concurrency(self) -> int:
        return _env_int("DOCFLOW_NOTIFICATION_MAX_CONCURRENCY", 4, minimum=1, maximum=8)

    @property
    def user_timeout_sec(self) -> int:
        return _env_int("DOCFLOW_NOTIFICATION_USER_TIMEOUT_SEC", 100, minimum=10, maximum=180)

    def get_runtime_status(self) -> dict[str, Any]:
        return {
            "task_running": bool(self._task and not self._task.done()),
            "poll_interval_sec": self.poll_interval_sec,
            "candidate_limit": self.batch_size,
            "snapshot_count": len(self._known_refs),
            "last_poll_duration_ms": round(self._last_poll_duration_ms, 1),
            "last_error_count": self._last_error_count,
        }

    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop_event = asyncio.Event()
        self._task = asyncio.create_task(self._run_loop(), name="docflow-notification-poller")

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
        if self.startup_delay_sec:
            try:
                assert self._stop_event is not None
                await asyncio.wait_for(self._stop_event.wait(), timeout=self.startup_delay_sec)
                return
            except asyncio.TimeoutError:
                pass
        while True:
            try:
                await self.poll_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("1C DO notification poll iteration failed", exc_info=True)
            try:
                assert self._stop_event is not None
                await asyncio.wait_for(self._stop_event.wait(), timeout=self.poll_interval_sec)
                return
            except asyncio.TimeoutError:
                continue

    @staticmethod
    def _active_push_user_ids() -> set[int]:
        try:
            with chat_session() as session:
                return {
                    int(user_id)
                    for user_id in session.execute(
                        select(ChatPushSubscription.user_id).where(ChatPushSubscription.is_active.is_(True))
                    ).scalars()
                    if int(user_id or 0) > 0
                }
        except Exception:
            return set()

    async def _candidate_user_ids(self) -> list[int]:
        configured_ids, active_sessions, active_push_ids, users = await asyncio.gather(
            self._docflow.warmup_user_ids(limit=self.batch_size * 4),
            asyncio.to_thread(session_service.list_sessions, active_only=True),
            asyncio.to_thread(self._active_push_user_ids),
            asyncio.to_thread(user_service.list_users),
        )
        active_ids = {
            int(item.get("user_id") or 0)
            for item in active_sessions
            if int(item.get("user_id") or 0) > 0
        } | {int(value) for value in active_push_ids if int(value) > 0}
        configured = {int(value) for value in configured_ids if int(value) > 0}
        user_by_id = {int(item.get("id") or 0): item for item in users if int(item.get("id") or 0) > 0}
        eligible: list[int] = []
        for user_id in sorted(configured & active_ids):
            user = user_by_id.get(user_id) or {}
            if not bool(user.get("is_active", True)):
                continue
            if not authorization_service.has_permission(
                user.get("role"),
                PERM_DOCFLOW_READ,
                use_custom_permissions=bool(user.get("use_custom_permissions", False)),
                custom_permissions=user.get("custom_permissions"),
            ):
                continue
            if not self._preferences.is_enabled(user_id=user_id, channel="docflow"):
                continue
            eligible.append(user_id)
        if not eligible:
            self._candidate_cursor = 0
            return []
        start = self._candidate_cursor % len(eligible)
        rotated = eligible[start:] + eligible[:start]
        candidates = rotated[: self.batch_size]
        self._candidate_cursor = (start + len(candidates)) % len(eligible)
        return candidates

    async def _fetch_tasks(self, user_id: int, semaphore: asyncio.Semaphore) -> tuple[int, dict | None, Exception | None]:
        async with semaphore:
            try:
                result = await asyncio.wait_for(
                    self._docflow.list_tasks(
                        user_id=int(user_id),
                        scope="inbox",
                        search="",
                        limit=100,
                        correlation_id=f"docflow-notify-{int(user_id)}",
                    ),
                    timeout=self.user_timeout_sec,
                )
                return int(user_id), dict(result), None
            except (DocflowServiceError, asyncio.TimeoutError) as exc:
                logger.debug("1C DO notification poll skipped for user_id=%s error=%s", user_id, exc)
                return int(user_id), None, exc
            except Exception as exc:
                logger.warning("1C DO notification poll failed for user_id=%s", user_id, exc_info=True)
                return int(user_id), None, exc

    @staticmethod
    def _notification_body(task: dict[str, Any]) -> str:
        title = str(task.get("title") or task.get("subject") or "Задание 1С ДО").strip()
        author = str(task.get("author") or "").strip()
        return " · ".join(value for value in (title, author) if value)[:500]

    async def _emit(self, *, user_id: int, tasks: list[dict[str, Any]]) -> int:
        notifications = []
        for task in tasks:
            task_ref = str(task.get("ref") or "").strip()
            if not task_ref:
                continue
            notifications.append({
                "recipient_user_id": int(user_id),
                "event_type": "docflow.assigned",
                "title": "Новое задание в 1С ДО",
                "body": self._notification_body(task),
                "entity_type": "docflow",
                "entity_id": task_ref,
            })
        if not notifications:
            return 0
        await asyncio.to_thread(self._hub.create_notifications_batch, notifications)
        event_refs = sorted(str(item["entity_id"]) for item in notifications)
        event_hash = hashlib.sha256("\n".join(event_refs).encode("utf-8")).hexdigest()[:24]
        hub_realtime_publisher.publish_user_event(
            recipient_user_id=int(user_id),
            event_type=HUB_DOCFLOW_TASK_CHANGED_EVENT,
            event_id=f"docflow-assigned:{user_id}:{event_hash}",
            payload={
                "operation": "tasks.assigned",
                "task_refs": event_refs,
                "count": len(event_refs),
            },
        )
        for notification in notifications:
            task_ref = str(notification["entity_id"])
            try:
                await asyncio.to_thread(
                    self._push.enqueue_notification,
                    recipient_user_id=int(user_id),
                    title=str(notification["title"]),
                    body=str(notification["body"]),
                    channel="docflow",
                    route=f"/docflow?task={urllib.parse.quote(task_ref, safe='')}",
                    tag=f"docflow:{hashlib.sha256(task_ref.encode('utf-8')).hexdigest()[:32]}",
                    data={"task_ref": task_ref, "entity_type": "docflow"},
                    ttl=7 * 24 * 60 * 60,
                )
            except Exception:
                # The in-app notification is already durable. Do not create a
                # duplicate next cycle when only the push transport failed.
                logger.warning("1C DO push enqueue failed for user_id=%s task_ref=%s", user_id, task_ref, exc_info=True)
        return len(notifications)

    async def _load_known_refs(self, user_id: int) -> set[str] | None:
        snapshot = await asyncio.to_thread(
            self._checkpoint.read,
            user_id=int(user_id),
            mailbox_id="aggregate",
            snapshot_type="docflow_notification_checkpoint",
            context_key="inbox",
        )
        payload = snapshot.get("payload") if isinstance(snapshot, dict) else None
        if not isinstance(payload, dict) or not isinstance(payload.get("refs"), list):
            return None
        return {
            str(value).strip()
            for value in payload["refs"]
            if str(value).strip()
        }

    async def _persist_known_refs(self, user_id: int, refs: set[str]) -> None:
        await asyncio.to_thread(
            self._checkpoint.write_success,
            user_id=int(user_id),
            mailbox_id="aggregate",
            snapshot_type="docflow_notification_checkpoint",
            context_key="inbox",
            payload={"refs": sorted(refs)[-1_000:]},
            ttl_seconds=30 * 24 * 60 * 60,
        )

    async def poll_once(self, *, candidate_user_ids: list[int] | None = None) -> dict[str, int]:
        started_at = time.perf_counter()
        errors = 0
        emitted = 0
        async with self._poll_lock:
            candidates = candidate_user_ids if candidate_user_ids is not None else await self._candidate_user_ids()
            normalized_candidates = [int(value) for value in candidates if int(value) > 0][: self.batch_size]
            semaphore = asyncio.Semaphore(self.max_concurrency)
            results = await asyncio.gather(*(
                self._fetch_tasks(user_id, semaphore)
                for user_id in normalized_candidates
            ))
            for user_id, result, error in results:
                if error is not None or result is None:
                    errors += 1
                    continue
                current_items = [item for item in (result.get("items") or []) if isinstance(item, dict)]
                current_by_ref = {
                    str(item.get("ref") or "").strip(): item
                    for item in current_items
                    if str(item.get("ref") or "").strip()
                }
                known = self._known_refs.get(user_id)
                if known is None:
                    known = await self._load_known_refs(user_id)
                if known is None:
                    self._known_refs[user_id] = set(current_by_ref)
                    await self._persist_known_refs(user_id, self._known_refs[user_id])
                    continue
                new_refs = [ref for ref in current_by_ref if ref not in known]
                if new_refs:
                    emitted += await self._emit(
                        user_id=user_id,
                        tasks=[current_by_ref[ref] for ref in new_refs],
                    )
                known.update(current_by_ref)
                if len(known) > 1_000:
                    self._known_refs[user_id] = set(list(current_by_ref)[:100] + list(known)[-900:])
                else:
                    self._known_refs[user_id] = known
                await self._persist_known_refs(user_id, self._known_refs[user_id])
        self._last_error_count = errors
        self._last_poll_duration_ms = (time.perf_counter() - started_at) * 1000.0
        return {
            "candidates": len(normalized_candidates),
            "notifications": emitted,
            "errors": errors,
        }


docflow_notification_service = DocflowNotificationService()
