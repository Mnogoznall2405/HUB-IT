from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass
from typing import Optional

from backend.services.app_push_service import app_push_service
from backend.services.authorization_service import PERM_MAIL_ACCESS, authorization_service
from backend.services.mail_service import MailServiceError, mail_service
from backend.services.notification_preferences_service import notification_preferences_service
from backend.services.request_auth_context_service import pop_request_session_id, push_request_session_id
from backend.services.session_auth_context_service import session_auth_context_service
from backend.services.session_service import session_service
from backend.services.user_service import user_service


logger = logging.getLogger(__name__)


@dataclass
class MailNotificationSnapshot:
    unread_count: int = 0
    last_message_id: str = ""
    last_received_at: str = ""


class MailNotificationService:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._stop_event: asyncio.Event | None = None
        self._snapshots: dict[int, MailNotificationSnapshot] = {}

    @property
    def poll_interval_sec(self) -> int:
        raw = str(os.getenv("MAIL_NOTIFICATION_POLL_INTERVAL_SEC", "90")).strip()
        try:
            return max(30, min(300, int(raw)))
        except Exception:
            return 90

    @property
    def batch_size(self) -> int:
        raw = str(os.getenv("MAIL_NOTIFICATION_BATCH_SIZE", "50")).strip()
        try:
            return max(1, min(200, int(raw)))
        except Exception:
            return 50

    @property
    def max_concurrency(self) -> int:
        raw = str(os.getenv("MAIL_NOTIFICATION_MAX_CONCURRENCY", "8")).strip()
        try:
            return max(1, min(32, int(raw)))
        except Exception:
            return 8

    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop_event = asyncio.Event()
        self._task = asyncio.create_task(self._run_loop(), name="mail-notification-poller")

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
                logger.warning("Mail notification poll iteration failed", exc_info=True)
            try:
                assert self._stop_event is not None
                await asyncio.wait_for(self._stop_event.wait(), timeout=self.poll_interval_sec)
                return
            except asyncio.TimeoutError:
                continue

    def _iter_candidate_users(self) -> list[dict]:
        active_sessions = session_service.list_sessions(active_only=True)
        active_session_ids = {
            str(item.get("session_id") or "").strip()
            for item in active_sessions
            if str(item.get("session_id") or "").strip()
        }
        active_user_ids = {
            int(item.get("user_id", 0) or 0)
            for item in active_sessions
            if int(item.get("user_id", 0) or 0) > 0
        }
        users = []
        for user in user_service.list_users():
            user_id = int(user.get("id", 0) or 0)
            if user_id <= 0 or user_id not in active_user_ids:
                continue
            if not bool(user.get("is_active", True)):
                continue
            if not authorization_service.has_permission(
                user.get("role"),
                PERM_MAIL_ACCESS,
                use_custom_permissions=bool(user.get("use_custom_permissions", False)),
                custom_permissions=user.get("custom_permissions"),
            ):
                continue
            if not notification_preferences_service.is_enabled(user_id=user_id, channel="mail"):
                continue
            try:
                mailbox_items = mail_service.list_user_mailboxes(user_id=user_id, include_inactive=False)
            except Exception:
                mailbox_items = []
            if not any(bool(item.get("mail_is_configured")) for item in mailbox_items):
                continue
            auth_source = str(user.get("auth_source") or "local").strip().lower()
            session_context = None
            if auth_source == "ldap":
                session_context = session_auth_context_service.get_latest_active_context_for_user(
                    user_id,
                    active_session_ids=active_session_ids,
                )
                if not session_context:
                    continue
            users.append({"user": user, "session_context": session_context})
            if len(users) >= self.batch_size:
                break
        return users

    def _build_snapshot(self, *, feed: dict) -> MailNotificationSnapshot:
        items = feed.get("items") or []
        first_item = items[0] if items else {}
        return MailNotificationSnapshot(
            unread_count=int(feed.get("total_unread", 0) or 0),
            last_message_id=str(first_item.get("id") or "").strip(),
            last_received_at=str(first_item.get("received_at") or "").strip(),
        )

    def _should_emit(self, *, previous: Optional[MailNotificationSnapshot], current: MailNotificationSnapshot) -> bool:
        if previous is None:
            return False
        if current.unread_count <= previous.unread_count:
            return False
        if current.last_message_id and current.last_message_id != previous.last_message_id:
            return True
        return bool(current.last_received_at and current.last_received_at > previous.last_received_at)

    def _list_notification_feed_sync(self, *, user_id: int, session_id: str | None) -> dict:
        token = push_request_session_id(session_id)
        try:
            return mail_service.list_notification_feed(user_id=user_id, limit=5)
        finally:
            pop_request_session_id(token)

    def _send_notification_sync(self, **kwargs) -> None:
        app_push_service.send_notification(**kwargs)

    async def _fetch_candidate_feed(self, payload: dict, semaphore: asyncio.Semaphore) -> dict:
        user = payload["user"]
        user_id = int(user.get("id", 0) or 0)
        session_context = payload.get("session_context") or {}
        session_id = str(session_context.get("session_id") or "").strip() or None
        async with semaphore:
            try:
                feed = await asyncio.to_thread(
                    self._list_notification_feed_sync,
                    user_id=user_id,
                    session_id=session_id,
                )
                return {"payload": payload, "user_id": user_id, "feed": feed, "error": None}
            except MailServiceError as exc:
                logger.debug("Mail notification poll skipped for user_id=%s error=%s", user_id, exc)
                return {"payload": payload, "user_id": user_id, "feed": None, "error": exc}
            except Exception as exc:
                logger.warning("Mail notification poll failed for user_id=%s", user_id, exc_info=True)
                return {"payload": payload, "user_id": user_id, "feed": None, "error": exc}

    async def poll_once(self) -> None:
        started_at = time.perf_counter()
        candidate_count = 0
        fetched_count = 0
        notified_count = 0
        error_count = 0
        try:
            try:
                candidates = await asyncio.to_thread(self._iter_candidate_users)
            except Exception:
                error_count += 1
                raise
            candidate_count = len(candidates)
            if not candidates:
                return

            semaphore = asyncio.Semaphore(self.max_concurrency)
            results = await asyncio.gather(
                *(self._fetch_candidate_feed(payload, semaphore) for payload in candidates),
            )

            for result in results:
                user_id = int(result.get("user_id", 0) or 0)
                if result.get("error") is not None:
                    error_count += 1
                    continue
                feed = result.get("feed") or {}
                fetched_count += 1
                current = self._build_snapshot(feed=feed)
                previous = self._snapshots.get(user_id)
                self._snapshots[user_id] = current
                if not self._should_emit(previous=previous, current=current):
                    continue

                items = feed.get("items") or []
                top_item = items[0] if items else {}
                message_id = str(top_item.get("id") or "").strip()
                if not message_id:
                    continue
                sender = str(top_item.get("sender") or "").strip()
                subject = str(top_item.get("subject") or "").strip() or "РќРѕРІРѕРµ РїРёСЃСЊРјРѕ"
                body_preview = str(top_item.get("body_preview") or "").strip()
                mailbox_id = str(top_item.get("mailbox_id") or "").strip()
                mailbox_label = str(top_item.get("mailbox_label") or "").strip()
                mailbox_email = str(top_item.get("mailbox_email") or "").strip()
                folder = str(top_item.get("folder") or "inbox").strip() or "inbox"
                mailbox_hint = mailbox_label or mailbox_email
                body = f"{sender}: {body_preview or subject}" if sender else (body_preview or subject)
                if mailbox_hint:
                    body = f"[{mailbox_hint}] {body}"
                route = f"/mail?folder={folder}&message={message_id}"
                if mailbox_id:
                    route += f"&mailbox_id={mailbox_id}"
                try:
                    await asyncio.to_thread(
                        self._send_notification_sync,
                        recipient_user_id=user_id,
                        title=subject,
                        body=body,
                        channel="mail",
                        route=route,
                        tag=f"mail:{message_id}",
                        data={
                            "message_id": message_id,
                            "folder": folder,
                            "sender": sender,
                            "mailbox_id": mailbox_id or None,
                            "mailbox_label": mailbox_label or None,
                            "mailbox_email": mailbox_email or None,
                        },
                        ttl=120,
                    )
                    notified_count += 1
                except Exception:
                    error_count += 1
                    logger.warning("Failed to send mail push for user_id=%s", user_id, exc_info=True)
        finally:
            logger.info(
                "Mail notification poll iteration candidate_count=%s fetched_count=%s notified_count=%s error_count=%s duration_ms=%.1f",
                candidate_count,
                fetched_count,
                notified_count,
                error_count,
                (time.perf_counter() - started_at) * 1000.0,
            )


mail_notification_service = MailNotificationService()
