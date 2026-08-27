from __future__ import annotations

from typing import Any

from backend.chat.push_service import chat_push_service


class AppPushService:
    """Generic app-wide push facade backed by the existing chat push storage."""

    def get_public_config(self) -> dict[str, Any]:
        return chat_push_service.get_public_config()

    def upsert_subscription(self, **payload: Any) -> dict[str, Any]:
        return chat_push_service.upsert_subscription(**payload)

    def delete_subscription(self, **payload: Any) -> dict[str, Any]:
        return chat_push_service.delete_subscription(**payload)

    def send_notification(self, **payload: Any):
        return chat_push_service.send_notification(**payload)

    def enqueue_notification(self, **payload: Any):
        # Lazy import keeps the delivery worker free to call the low-level
        # sender without creating an app_push_service import cycle.
        from backend.services.app_push_outbox_service import app_push_outbox_service

        return app_push_outbox_service.enqueue_notification(**payload)


app_push_service = AppPushService()
