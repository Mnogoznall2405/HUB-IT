"""Web Push helpers for chat notifications."""
from __future__ import annotations

import base64
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any, Optional

from sqlalchemy import select

from backend.chat.db import chat_session
from backend.chat.models import ChatPushSubscription
from backend.config import config
from cryptography.hazmat.primitives import serialization

try:
    from pywebpush import WebPushException, webpush
except Exception:  # pragma: no cover - optional dependency at runtime
    WebPushException = Exception
    webpush = None


logger = logging.getLogger(__name__)

DEFAULT_PUSH_TTL_SEC = 90
CHAT_PUSH_TTL_SEC = 12 * 60 * 60


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def _encode_base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _decode_base64url(value: str) -> bytes:
    normalized = _normalize_text(value)
    if not normalized:
        return b""
    padding = "=" * ((4 - len(normalized) % 4) % 4)
    return base64.urlsafe_b64decode(f"{normalized}{padding}")


@lru_cache(maxsize=8)
def _resolve_vapid_private_key(value: Optional[str]) -> Optional[str]:
    normalized = _normalize_text(value)
    if not normalized:
        return None

    try:
        raw_private_key = _decode_base64url(normalized)
        if len(raw_private_key) == 32:
            return normalized
    except Exception:
        raw_private_key = b""

    pem_candidate = normalized.replace("\\n", "\n")
    for loader in (
        lambda: serialization.load_pem_private_key(pem_candidate.encode("utf-8"), password=None),
        lambda: serialization.load_der_private_key(raw_private_key or pem_candidate.encode("utf-8"), password=None),
    ):
        try:
            private_key = loader()
            private_value = private_key.private_numbers().private_value
            return _encode_base64url(private_value.to_bytes(32, "big"))
        except Exception:
            continue

    return normalized


@dataclass
class ChatPushSendResult:
    sent: int = 0
    disabled: int = 0
    failed: int = 0


class ChatPushService:
    """Store chat push subscriptions and send chat message pushes."""

    def _build_subscription_device_key(
        self,
        subscription: ChatPushSubscription | None = None,
        *,
        user_agent: Optional[str] = None,
        platform: Optional[str] = None,
        browser_family: Optional[str] = None,
    ) -> tuple[str, str, str] | None:
        normalized_user_agent = _normalize_text(
            user_agent if user_agent is not None else getattr(subscription, "user_agent", None)
        )
        normalized_platform = _normalize_text(
            platform if platform is not None else getattr(subscription, "platform", None)
        )
        normalized_browser_family = _normalize_text(
            browser_family if browser_family is not None else getattr(subscription, "browser_family", None)
        )
        if not normalized_user_agent or not normalized_platform or not normalized_browser_family:
            return None
        return (
            normalized_browser_family,
            normalized_platform,
            normalized_user_agent,
        )

    def _mark_subscription_superseded(
        self,
        subscription: ChatPushSubscription,
        *,
        now: datetime,
        reason: str,
    ) -> None:
        subscription.is_active = False
        subscription.updated_at = now
        subscription.last_error_at = None
        subscription.last_error_text = reason

    def _dedupe_active_subscriptions_in_session(
        self,
        session,
        *,
        user_id: int,
        now: Optional[datetime] = None,
    ) -> list[ChatPushSubscription]:
        normalized_user_id = int(user_id)
        dedupe_now = now or _utc_now()
        subscriptions = list(
            session.execute(
                select(ChatPushSubscription).where(
                    ChatPushSubscription.user_id == normalized_user_id,
                    ChatPushSubscription.is_active.is_(True),
                )
            ).scalars()
        )
        if len(subscriptions) <= 1:
            return subscriptions

        ordered_subscriptions = sorted(
            subscriptions,
            key=lambda item: (
                getattr(item, "updated_at", None) or getattr(item, "created_at", None) or datetime.min.replace(tzinfo=timezone.utc),
                getattr(item, "last_seen_at", None) or datetime.min.replace(tzinfo=timezone.utc),
                getattr(item, "created_at", None) or datetime.min.replace(tzinfo=timezone.utc),
                int(getattr(item, "id", 0) or 0),
            ),
            reverse=True,
        )

        kept: list[ChatPushSubscription] = []
        seen_device_keys: set[tuple[str, str, str]] = set()
        for subscription in ordered_subscriptions:
            device_key = self._build_subscription_device_key(subscription)
            if device_key and device_key in seen_device_keys:
                self._mark_subscription_superseded(
                    subscription,
                    now=dedupe_now,
                    reason="Superseded by a newer push subscription on the same device",
                )
                continue
            kept.append(subscription)
            if device_key:
                seen_device_keys.add(device_key)
        return kept

    @property
    def dependency_available(self) -> bool:
        return webpush is not None

    @property
    def enabled(self) -> bool:
        return bool(config.web_push.enabled and self.dependency_available)

    def get_runtime_status(self) -> dict:
        return {
            "enabled": bool(self.enabled),
            "configured": bool(config.web_push.enabled),
            "dependency_available": bool(self.dependency_available),
            "public_key_present": bool(_normalize_text(config.web_push.public_key)),
            "private_key_present": bool(_normalize_text(config.web_push.private_key)),
            "subject_present": bool(_normalize_text(config.web_push.subject)),
        }

    def get_public_config(self) -> dict:
        return {
            "enabled": bool(self.enabled),
            "vapid_public_key": _normalize_text(config.web_push.public_key) or None,
            "requires_installed_pwa": True,
            "icon_url": "/pwa-192.png",
            "badge_url": "/hubit-badge.svg",
        }

    def upsert_subscription(
        self,
        *,
        current_user_id: int,
        endpoint: str,
        p256dh_key: str,
        auth_key: str,
        expiration_time: Optional[int] = None,
        user_agent: Optional[str] = None,
        platform: Optional[str] = None,
        browser_family: Optional[str] = None,
        install_mode: Optional[str] = None,
    ) -> dict:
        normalized_endpoint = _normalize_text(endpoint)
        normalized_p256dh = _normalize_text(p256dh_key)
        normalized_auth = _normalize_text(auth_key)
        normalized_user_agent = _normalize_text(user_agent) or None
        normalized_platform = _normalize_text(platform) or None
        normalized_browser_family = _normalize_text(browser_family) or None
        normalized_install_mode = _normalize_text(install_mode) or None
        if not normalized_endpoint or not normalized_p256dh or not normalized_auth:
            raise ValueError("Push subscription is incomplete")

        now = _utc_now()
        with chat_session() as session:
            subscription = session.execute(
                select(ChatPushSubscription).where(ChatPushSubscription.endpoint == normalized_endpoint)
            ).scalar_one_or_none()
            if subscription is None:
                subscription = ChatPushSubscription(
                    user_id=int(current_user_id),
                    endpoint=normalized_endpoint,
                )
                session.add(subscription)

            subscription.user_id = int(current_user_id)
            subscription.endpoint = normalized_endpoint
            subscription.p256dh_key = normalized_p256dh
            subscription.auth_key = normalized_auth
            subscription.expiration_time = int(expiration_time) if expiration_time is not None else None
            subscription.user_agent = normalized_user_agent
            subscription.platform = normalized_platform
            subscription.browser_family = normalized_browser_family
            subscription.install_mode = normalized_install_mode
            subscription.is_active = True
            subscription.failure_count = 0
            subscription.updated_at = now
            subscription.last_seen_at = now
            subscription.last_error_at = None
            subscription.last_error_text = None

            current_device_key = self._build_subscription_device_key(
                user_agent=normalized_user_agent,
                platform=normalized_platform,
                browser_family=normalized_browser_family,
            )
            if current_device_key:
                stale_candidates = list(
                    session.execute(
                        select(ChatPushSubscription).where(
                            ChatPushSubscription.user_id == int(current_user_id),
                            ChatPushSubscription.is_active.is_(True),
                            ChatPushSubscription.endpoint != normalized_endpoint,
                        )
                    ).scalars()
                )
                for candidate in stale_candidates:
                    if self._build_subscription_device_key(candidate) == current_device_key:
                        self._mark_subscription_superseded(
                            candidate,
                            now=now,
                            reason="Superseded by newer subscription on the same device",
                        )

            self._dedupe_active_subscriptions_in_session(
                session,
                user_id=int(current_user_id),
                now=now,
            )
            session.flush()

        return {
            "ok": True,
            "subscribed": True,
            "push_enabled": bool(self.enabled),
        }

    def delete_subscription(
        self,
        *,
        current_user_id: int,
        endpoint: str,
    ) -> dict:
        normalized_endpoint = _normalize_text(endpoint)
        if not normalized_endpoint:
            raise ValueError("Subscription endpoint is required")

        removed = False
        with chat_session() as session:
            subscription = session.execute(
                select(ChatPushSubscription).where(
                    ChatPushSubscription.endpoint == normalized_endpoint,
                    ChatPushSubscription.user_id == int(current_user_id),
                )
            ).scalar_one_or_none()
            if subscription is not None:
                session.delete(subscription)
                removed = True

        return {
            "ok": True,
            "subscribed": False,
            "push_enabled": bool(self.enabled),
            "removed": bool(removed),
        }

    def _get_active_subscriptions(self, *, recipient_user_id: int) -> list[ChatPushSubscription]:
        with chat_session() as session:
            return self._dedupe_active_subscriptions_in_session(
                session,
                user_id=int(recipient_user_id),
            )

    def _build_notification_options(
        self,
        *,
        channel: str,
        route: str,
        data: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        normalized_channel = _normalize_text(channel) or "system"
        normalized_route = _normalize_text(route) or "/"
        options: dict[str, Any] = {
            "renotify": False,
            "require_interaction": False,
            "silent": False,
            "timestamp": int(_utc_now().timestamp() * 1000),
            "vibrate": [160, 80, 160],
            "actions": [
                {
                    "action": "open",
                    "title": "Открыть",
                    "route": normalized_route,
                },
                {
                    "action": "dismiss",
                    "title": "Закрыть",
                },
            ],
        }

        if normalized_channel == "chat":
            conversation_id = _normalize_text((data or {}).get("conversation_id"))
            message_id = _normalize_text((data or {}).get("message_id"))
            chat_route = normalized_route
            if not chat_route or chat_route == "/":
                if conversation_id and message_id:
                    chat_route = f"/chat?conversation={conversation_id}&message={message_id}"
                elif conversation_id:
                    chat_route = f"/chat?conversation={conversation_id}"
            options.update({
                "renotify": True,
                "require_interaction": True,
                "vibrate": [260, 120, 260, 120, 360],
                "actions": [
                    {
                        "action": "open-chat",
                        "title": "Открыть чат",
                        "route": chat_route,
                    },
                    {
                        "action": "dismiss",
                        "title": "Позже",
                    },
                ],
            })
        elif normalized_channel == "mail":
            options.update({
                "vibrate": [220, 100, 220],
                "actions": [
                    {
                        "action": "open-mail",
                        "title": "Открыть письмо",
                        "route": normalized_route,
                    },
                    {
                        "action": "dismiss",
                        "title": "Закрыть",
                    },
                ],
            })
        elif normalized_channel in {"hub", "tasks", "announcements"}:
            options.update({
                "vibrate": [180, 90, 180],
            })

        return options

    def _send_payload_to_subscriptions(
        self,
        *,
        subscriptions: list[ChatPushSubscription],
        payload: dict[str, Any],
        ttl: int = DEFAULT_PUSH_TTL_SEC,
        headers: Optional[dict[str, Any]] = None,
    ) -> ChatPushSendResult:
        result = ChatPushSendResult()
        if not self.enabled or not subscriptions:
            return result

        serialized_payload = json.dumps(payload or {}, ensure_ascii=False)
        now = _utc_now()
        vapid_private_key = _resolve_vapid_private_key(config.web_push.private_key)

        with chat_session() as session:
            for subscription in subscriptions:
                managed = session.get(ChatPushSubscription, subscription.id) or subscription
                try:
                    webpush(
                        subscription_info={
                            "endpoint": managed.endpoint,
                            "keys": {
                                "p256dh": managed.p256dh_key,
                                "auth": managed.auth_key,
                            },
                        },
                        data=serialized_payload,
                        vapid_private_key=vapid_private_key,
                        vapid_claims={"sub": _normalize_text(config.web_push.subject)},
                        ttl=max(30, int(ttl or DEFAULT_PUSH_TTL_SEC)),
                        headers=headers or None,
                    )
                    managed.failure_count = 0
                    managed.last_push_at = now
                    managed.last_seen_at = now
                    managed.updated_at = now
                    managed.last_error_at = None
                    managed.last_error_text = None
                    result.sent += 1
                except WebPushException as exc:  # pragma: no branch - status driven
                    status_code = int(getattr(getattr(exc, "response", None), "status_code", 0) or 0)
                    managed.failure_count = int(managed.failure_count or 0) + 1
                    managed.updated_at = now
                    managed.last_error_at = now
                    managed.last_error_text = _normalize_text(exc)
                    if status_code in {404, 410}:
                        managed.is_active = False
                        result.disabled += 1
                    else:
                        result.failed += 1
                except Exception as exc:  # pragma: no cover - best-effort fallback
                    managed.failure_count = int(managed.failure_count or 0) + 1
                    managed.updated_at = now
                    managed.last_error_at = now
                    managed.last_error_text = _normalize_text(exc)
                    result.failed += 1
        return result

    def send_notification(
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
        data: Optional[dict[str, Any]] = None,
        ttl: int = 90,
    ) -> ChatPushSendResult:
        subscriptions = self._get_active_subscriptions(recipient_user_id=int(recipient_user_id))
        if not subscriptions:
            logger.info(
                "APP_PUSH_SEND user_id=%s channel=%s subscriptions=0 sent=0 disabled=0 failed=0 tag=%s route=%s",
                int(recipient_user_id),
                _normalize_text(channel) or "system",
                _normalize_text(tag),
                _normalize_text(route) or "/",
            )
            print(
                "APP_PUSH_SEND",
                {
                    "user_id": int(recipient_user_id),
                    "channel": _normalize_text(channel) or "system",
                    "subscriptions": 0,
                    "sent": 0,
                    "disabled": 0,
                    "failed": 0,
                    "tag": _normalize_text(tag),
                    "route": _normalize_text(route) or "/",
                },
                flush=True,
            )
            return ChatPushSendResult()
        normalized_channel = _normalize_text(channel) or "system"
        headers: dict[str, Any] = {}
        if normalized_channel in {"chat", "mail"}:
            headers["Urgency"] = "high"
        normalized_route = _normalize_text(route) or "/"
        payload_data = {
            "route": normalized_route,
            **({} if not isinstance(data, dict) else data),
        }
        normalized_tag = _normalize_text(tag) or f"{normalized_channel}:{int(recipient_user_id)}"
        payload = {
            "title": _normalize_text(title) or "Новое уведомление",
            "body": _normalize_text(body) or "Откройте приложение, чтобы посмотреть подробности.",
            "tag": normalized_tag,
            "channel": normalized_channel,
            "icon": _normalize_text(icon) or "/pwa-192.png",
            "badge": _normalize_text(badge) or "/hubit-badge.svg",
            "data": payload_data,
            **self._build_notification_options(
                channel=normalized_channel,
                route=normalized_route,
                data=payload_data,
            ),
        }
        result = self._send_payload_to_subscriptions(
            subscriptions=subscriptions,
            payload=payload,
            ttl=ttl,
            headers=headers or None,
        )
        logger.info(
            "APP_PUSH_SEND user_id=%s channel=%s subscriptions=%s sent=%s disabled=%s failed=%s tag=%s route=%s",
            int(recipient_user_id),
            normalized_channel,
            len(subscriptions),
            int(result.sent),
            int(result.disabled),
            int(result.failed),
            _normalize_text(payload.get("tag")),
            _normalize_text(payload.get("data", {}).get("route")) or "/",
        )
        print(
            "APP_PUSH_SEND",
            {
                "user_id": int(recipient_user_id),
                "channel": normalized_channel,
                "subscriptions": len(subscriptions),
                "sent": int(result.sent),
                "disabled": int(result.disabled),
                "failed": int(result.failed),
                "tag": _normalize_text(payload.get("tag")),
                "route": _normalize_text(payload.get("data", {}).get("route")) or "/",
            },
            flush=True,
        )
        return result

    def send_chat_message_notification(
        self,
        *,
        recipient_user_id: int,
        conversation_id: str,
        message_id: str,
        title: str,
        body: str,
    ) -> ChatPushSendResult:
        normalized_conversation_id = _normalize_text(conversation_id)
        normalized_message_id = _normalize_text(message_id)
        if not normalized_conversation_id or not normalized_message_id:
            return ChatPushSendResult()
        return self.send_notification(
            recipient_user_id=int(recipient_user_id),
            title=title,
            body=body,
            channel="chat",
            route=f"/chat?conversation={normalized_conversation_id}&message={normalized_message_id}",
            tag=f"chat:{normalized_message_id}",
            data={
                "conversation_id": normalized_conversation_id,
                "message_id": normalized_message_id,
            },
            ttl=CHAT_PUSH_TTL_SEC,
        )
        result = ChatPushSendResult()
        if not self.enabled:
            return result

        normalized_conversation_id = _normalize_text(conversation_id)
        normalized_message_id = _normalize_text(message_id)
        if not normalized_conversation_id or not normalized_message_id:
            return result

        with chat_session() as session:
            subscriptions = list(
                session.execute(
                    select(ChatPushSubscription).where(
                        ChatPushSubscription.user_id == int(recipient_user_id),
                        ChatPushSubscription.is_active.is_(True),
                    )
                ).scalars()
            )
            if not subscriptions:
                return result

            payload = json.dumps({
                "title": _normalize_text(title) or "Новое сообщение",
                "body": _normalize_text(body) or "Откройте чат, чтобы посмотреть сообщение.",
                "tag": f"chat:{normalized_message_id}",
                "icon": "/pwa-192.png",
                "badge": "/pwa-192.png",
                "data": {
                    "route": f"/chat?conversation={normalized_conversation_id}&message={normalized_message_id}",
                    "conversation_id": normalized_conversation_id,
                    "message_id": normalized_message_id,
                },
            })
            now = _utc_now()
            vapid_private_key = _resolve_vapid_private_key(config.web_push.private_key)

            for subscription in subscriptions:
                try:
                    webpush(
                        subscription_info={
                            "endpoint": subscription.endpoint,
                            "keys": {
                                "p256dh": subscription.p256dh_key,
                                "auth": subscription.auth_key,
                            },
                        },
                        data=payload,
                        vapid_private_key=vapid_private_key,
                        vapid_claims={"sub": _normalize_text(config.web_push.subject)},
                        ttl=60,
                    )
                    subscription.failure_count = 0
                    subscription.last_push_at = now
                    subscription.last_seen_at = now
                    subscription.updated_at = now
                    subscription.last_error_at = None
                    subscription.last_error_text = None
                    result.sent += 1
                except WebPushException as exc:  # pragma: no branch - status driven
                    status_code = int(getattr(getattr(exc, "response", None), "status_code", 0) or 0)
                    subscription.failure_count = int(subscription.failure_count or 0) + 1
                    subscription.updated_at = now
                    subscription.last_error_at = now
                    subscription.last_error_text = _normalize_text(exc)
                    if status_code in {404, 410}:
                        subscription.is_active = False
                        result.disabled += 1
                    else:
                        result.failed += 1
                except Exception as exc:  # pragma: no cover - best-effort fallback
                    subscription.failure_count = int(subscription.failure_count or 0) + 1
                    subscription.updated_at = now
                    subscription.last_error_at = now
                    subscription.last_error_text = _normalize_text(exc)
                    result.failed += 1

        return result


chat_push_service = ChatPushService()
