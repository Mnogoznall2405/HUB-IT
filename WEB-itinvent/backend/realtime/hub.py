"""Post-commit realtime invalidations for HUB notifications.

The durable notification row remains the source of truth. WebSocket events only
wake connected clients so they can reconcile through the existing REST poll.
"""
from __future__ import annotations

import asyncio
import logging
import os
from concurrent.futures import Future
from threading import Lock
from typing import Any
from uuid import uuid4

from backend.chat.postgres_realtime import ChatRealtimePostgresBus
from backend.chat.realtime import (
    ChatRealtimeManager,
    _chat_postgres_database_url,
    resolve_chat_realtime_transport,
)


logger = logging.getLogger("backend.realtime.hub")

HUB_REALTIME_PROTOCOL_VERSION = 1
HUB_NOTIFICATION_CREATED_EVENT = "hub.notification.created"
HUB_TASK_CREATED_EVENT = "tasks.task.created"
HUB_TASK_UPDATED_EVENT = "tasks.task.updated"
HUB_TASK_DELETED_EVENT = "tasks.task.deleted"
HUB_MAIL_MESSAGE_RECEIVED_EVENT = "mail.message.received"
HUB_MAIL_UNREAD_CHANGED_EVENT = "mail.unread.changed"
HUB_MAIL_MESSAGE_STATE_CHANGED_EVENT = "mail.message.state_changed"
HUB_DOCFLOW_TASK_CHANGED_EVENT = "docflow.task.changed"
HUB_1C_SYNC_COMPLETED_EVENT = "integration.1c.sync.completed"
HUB_1C_SYNC_FAILED_EVENT = "integration.1c.sync.failed"
HUB_DASHBOARD_INVALIDATE_EVENT = "dashboard.invalidate"
_MAX_PENDING_PUBLISHES = max(
    32,
    min(8192, int(str(os.getenv("HUB_REALTIME_MAX_PENDING_PUBLISHES", "1024") or "1024"))),
)


def hub_user_room_id(user_id: int) -> str:
    normalized_user_id = int(user_id or 0)
    return f"hub:user:{normalized_user_id}" if normalized_user_id > 0 else ""


def hub_task_presence_room_id(task_id: object) -> str:
    normalized_task_id = str(task_id or "").strip()[:128]
    return f"hub:task-presence:{normalized_task_id}" if normalized_task_id else ""


class HubRealtimePublisher:
    """Thread-safe bridge from synchronous HUB commits to the asyncio relay."""

    def __init__(self) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._realtime_manager: ChatRealtimeManager | None = None
        self._owned_realtime_manager: ChatRealtimeManager | None = None
        self._postgres_bus: ChatRealtimePostgresBus | None = None
        self._lock = Lock()
        self._pending = 0
        self._dropped = 0
        self._started = False
        self._node_id = f"hub-api-{uuid4()}"
        self._mode = "disabled"

    @property
    def started(self) -> bool:
        return bool(self._started and self._loop is not None and not self._loop.is_closed())

    @property
    def pending(self) -> int:
        with self._lock:
            return int(self._pending)

    @property
    def dropped(self) -> int:
        with self._lock:
            return int(self._dropped)

    @property
    def mode(self) -> str:
        return str(self._mode or "disabled")

    async def start(self, *, realtime_manager: ChatRealtimeManager | None = None) -> None:
        if self.started:
            if realtime_manager is not None:
                self._realtime_manager = realtime_manager
            return
        self._loop = asyncio.get_running_loop()
        self._realtime_manager = realtime_manager
        self._owned_realtime_manager = None
        self._postgres_bus = None
        self._mode = "manager" if realtime_manager is not None else "disabled"

        if realtime_manager is None:
            transport = resolve_chat_realtime_transport()
            if transport == "postgres":
                bus = ChatRealtimePostgresBus(
                    manager=None,
                    database_url=_chat_postgres_database_url(),
                    node_id=self._node_id,
                    subscriber_enabled=False,
                )
                await bus.start()
                if bus.configured and bus.started:
                    self._postgres_bus = bus
                    self._mode = "postgres-publisher"
            elif transport == "redis":
                manager = ChatRealtimeManager()
                await manager.start()
                self._realtime_manager = manager
                self._owned_realtime_manager = manager
                self._mode = "redis-manager"
            else:
                logger.warning(
                    "hub.realtime split publisher is unavailable with local transport; REST polling remains active"
                )
        self._started = True

    async def stop(self) -> None:
        self._started = False
        bus = self._postgres_bus
        owned_manager = self._owned_realtime_manager
        self._postgres_bus = None
        self._realtime_manager = None
        self._owned_realtime_manager = None
        if bus is not None:
            await bus.stop()
        if owned_manager is not None:
            await owned_manager.stop()
        self._mode = "disabled"
        self._loop = None

    def publish_notification(self, notification: dict[str, Any]) -> bool:
        recipient_user_id = int((notification or {}).get("recipient_user_id") or 0)
        event_id = str((notification or {}).get("id") or "").strip()
        return self.publish_user_event(
            recipient_user_id=recipient_user_id,
            event_type=HUB_NOTIFICATION_CREATED_EVENT,
            event_id=event_id,
            payload={"notification": dict(notification)},
        )

    def publish_user_event(
        self,
        *,
        recipient_user_id: int,
        event_type: str,
        payload: dict[str, Any] | None = None,
        event_id: str = "",
    ) -> bool:
        normalized_recipient_user_id = int(recipient_user_id or 0)
        normalized_event_type = str(event_type or "").strip()
        normalized_event_id = str(event_id or "").strip() or str(uuid4())
        loop = self._loop
        if (
            normalized_recipient_user_id <= 0
            or not normalized_event_type
            or not self.started
            or loop is None
        ):
            return False
        with self._lock:
            if self._pending >= _MAX_PENDING_PUBLISHES:
                self._dropped += 1
                logger.warning(
                    "hub.realtime publish queue full recipient_user_id=%s event_id=%s",
                    normalized_recipient_user_id,
                    normalized_event_id,
                )
                return False
            self._pending += 1

        event_payload = {
            "protocol": HUB_REALTIME_PROTOCOL_VERSION,
            "event_id": normalized_event_id,
            **dict(payload or {}),
        }

        def _schedule() -> None:
            try:
                task = loop.create_task(
                    self._publish(
                        recipient_user_id=normalized_recipient_user_id,
                        event_type=normalized_event_type,
                        payload=event_payload,
                    ),
                    name=f"hub-realtime:{normalized_event_type}:{normalized_event_id}",
                )
            except Exception:
                self._publish_done(None)
                logger.warning(
                    "hub.realtime could not schedule event_id=%s",
                    normalized_event_id,
                    exc_info=True,
                )
                return
            task.add_done_callback(self._publish_done)

        try:
            loop.call_soon_threadsafe(_schedule)
        except RuntimeError:
            self._publish_done(None)
            return False
        return True

    async def _publish(
        self,
        *,
        recipient_user_id: int,
        event_type: str,
        payload: dict[str, Any],
    ) -> None:
        room_id = hub_user_room_id(recipient_user_id)
        manager = self._realtime_manager
        if manager is not None:
            await manager.publish_conversation_room_event(
                conversation_id=room_id,
                event_type=event_type,
                payload=payload,
            )
            return
        bus = self._postgres_bus
        if bus is None:
            return
        await bus.publish(
            {
                "origin_node_id": self._node_id,
                "distribution": "conversation_room",
                "target_user_ids": [],
                "watched_user_id": 0,
                "exclude_user_id": 0,
                "exclude_connection_id": "",
                "event_type": event_type,
                "payload": payload,
                "conversation_id": room_id,
                "request_id": None,
            },
            durable=True,
        )

    def _publish_done(self, future: asyncio.Future | Future | None) -> None:
        with self._lock:
            self._pending = max(0, self._pending - 1)
        if future is None or future.cancelled():
            return
        try:
            error = future.exception()
        except Exception:
            return
        if error is not None:
            logger.warning(
                "hub.realtime notification publish failed error=%s",
                error.__class__.__name__,
            )


hub_realtime_publisher = HubRealtimePublisher()
