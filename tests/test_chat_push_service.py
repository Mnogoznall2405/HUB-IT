from __future__ import annotations

import sys
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from datetime import datetime, timezone

import pytest

from backend.chat.push_service import (
    CHAT_PUSH_TTL_SEC,
    ChatPushSendResult,
    ChatPushService,
    _decode_base64url,
    _resolve_vapid_private_key,
)
from backend.services.native_push_service import NativePushSendResult


@pytest.fixture(autouse=True)
def clear_chat_push_delivery_cache():
    import backend.chat.push_service as push_service_module

    push_service_module._recent_chat_push_deliveries.clear()
    yield
    push_service_module._recent_chat_push_deliveries.clear()


def test_resolve_vapid_private_key_accepts_base64url_scalar_key():
    raw_key = "A-_SUy7huoS8jcSJ-Kq8uq-kP4-MSTIxAftNgPJFIZU"
    resolved = _resolve_vapid_private_key(raw_key)

    assert resolved == raw_key


def test_resolve_vapid_private_key_converts_inline_pem_to_base64url_scalar():
    raw_key = "A-_SUy7huoS8jcSJ-Kq8uq-kP4-MSTIxAftNgPJFIZU"
    private_key = ec.derive_private_key(
        int.from_bytes(_decode_base64url(raw_key), "big"),
        ec.SECP256R1(),
    )
    pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")

    resolved = _resolve_vapid_private_key(pem)

    assert resolved == raw_key


def test_send_notification_builds_generic_payload_without_type_error(monkeypatch):
    service = ChatPushService()
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        service,
        "_get_active_subscriptions",
        lambda **_: [object()],
    )

    def fake_send_payload_to_subscriptions(**kwargs):
        captured.update(kwargs)
        return ChatPushSendResult(sent=1)

    monkeypatch.setattr(
        service,
        "_send_payload_to_subscriptions",
        fake_send_payload_to_subscriptions,
    )

    result = service.send_notification(
        recipient_user_id=7,
        title="Mail subject",
        body="Mail body",
        channel="mail",
        route="/mail?folder=inbox&message=abc",
        data={"message_id": "abc"},
    )

    assert result.sent == 1
    assert captured["ttl"] == 90
    assert captured["headers"] == {"Urgency": "high"}
    payload = captured["payload"]
    assert payload["channel"] == "mail"
    assert payload["tag"] == "mail:7"
    assert payload["data"]["route"] == "/mail?folder=inbox&message=abc"
    assert payload["data"]["message_id"] == "abc"
    assert payload["silent"] is False
    assert payload["require_interaction"] is False
    assert payload["vibrate"] == [220, 100, 220]
    assert payload["actions"][0]["action"] == "open-mail"
    assert payload["actions"][1]["action"] == "dismiss"
    assert isinstance(payload["timestamp"], int)
    assert "app_badge_count" in payload
    assert isinstance(payload["app_badge_count"], int)


def test_send_notification_omits_app_badge_count_for_task_channels_by_default(monkeypatch):
    service = ChatPushService()
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        service,
        "_get_active_subscriptions",
        lambda **_: [object()],
    )
    monkeypatch.setattr(
        service,
        "_compute_app_badge_count",
        lambda **_: (_ for _ in ()).throw(AssertionError("task push must not resolve badge count by default")),
    )
    monkeypatch.setattr(
        service,
        "_send_payload_to_subscriptions",
        lambda **kwargs: captured.update(kwargs) or ChatPushSendResult(sent=1),
    )

    service.send_notification(
        recipient_user_id=7,
        title="Task update",
        body="Body",
        channel="tasks",
        route="/tasks",
    )

    payload = captured["payload"]
    assert "app_badge_count" not in payload


def test_send_notification_omits_app_badge_count_for_chat_channel(monkeypatch):
    service = ChatPushService()
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        service,
        "_get_active_subscriptions",
        lambda **_: [object()],
    )
    monkeypatch.setattr(
        service,
        "_compute_app_badge_count",
        lambda **_: (_ for _ in ()).throw(AssertionError("chat push must not resolve badge count")),
    )
    monkeypatch.setattr(
        service,
        "_send_payload_to_subscriptions",
        lambda **kwargs: captured.update(kwargs) or ChatPushSendResult(sent=1),
    )

    service.send_chat_message_notification(
        recipient_user_id=7,
        conversation_id="conv-1",
        message_id="msg-1",
        title="Chat title",
        body="Chat body",
    )

    payload = captured["payload"]
    assert payload["channel"] == "chat"
    assert "app_badge_count" not in payload


def test_send_notification_respects_explicit_app_badge_count_override(monkeypatch):
    service = ChatPushService()
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        service,
        "_get_active_subscriptions",
        lambda **_: [object()],
    )
    monkeypatch.setattr(
        service,
        "_compute_app_badge_count",
        lambda **_: (_ for _ in ()).throw(AssertionError("explicit override must skip compute")),
    )
    monkeypatch.setattr(
        service,
        "_send_payload_to_subscriptions",
        lambda **kwargs: captured.update(kwargs) or ChatPushSendResult(sent=1),
    )

    service.send_notification(
        recipient_user_id=7,
        title="Mail subject",
        body="Mail body",
        channel="mail",
        route="/mail",
        app_badge_count=3,
    )

    assert captured["payload"]["app_badge_count"] == 3


def test_compute_app_badge_count_sums_hub_and_mail_unread(monkeypatch):
    service = ChatPushService()

    monkeypatch.setattr(
        "backend.services.hub_service.hub_service.get_unread_counts",
        lambda *, user_id: {"notifications_unread_total": 4},
    )
    monkeypatch.setattr(
        "backend.services.mail_service.mail_service.get_unread_count",
        lambda *, user_id: 6,
    )

    assert service._compute_app_badge_count(recipient_user_id=9) == 10


def test_send_notification_skips_mail_when_channel_disabled(monkeypatch):
    service = ChatPushService()
    send_calls: list[dict[str, object]] = []

    monkeypatch.setattr(
        service,
        "_get_active_subscriptions",
        lambda **_: [object()],
    )
    monkeypatch.setattr(
        service,
        "_send_payload_to_subscriptions",
        lambda **kwargs: send_calls.append(kwargs) or ChatPushSendResult(sent=1),
    )
    monkeypatch.setattr(
        "backend.chat.push_service.notification_preferences_service.is_enabled",
        lambda **_: False,
    )

    result = service.send_notification(
        recipient_user_id=7,
        title="Mail subject",
        body="Mail body",
        channel="mail",
        route="/mail?folder=inbox&message=abc",
        data={"message_id": "abc"},
    )

    assert result.sent == 0
    assert send_calls == []


def test_send_chat_message_notification_uses_android_friendly_ttl_and_high_urgency(monkeypatch):
    service = ChatPushService()
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        service,
        "_get_active_subscriptions",
        lambda **_: [object()],
    )

    def fake_send_payload_to_subscriptions(**kwargs):
        captured.update(kwargs)
        return ChatPushSendResult(sent=1)

    monkeypatch.setattr(
        service,
        "_send_payload_to_subscriptions",
        fake_send_payload_to_subscriptions,
    )

    result = service.send_chat_message_notification(
        recipient_user_id=7,
        conversation_id="conv-1",
        message_id="msg-1",
        title="Chat title",
        body="Chat body",
    )

    assert result.sent == 1
    assert captured["ttl"] == CHAT_PUSH_TTL_SEC
    assert captured["headers"] == {"Urgency": "high"}
    payload = captured["payload"]
    assert payload["channel"] == "chat"
    assert payload["tag"] == "chat:msg:msg-1"
    assert payload["data"]["route"] == "/chat?conversation=conv-1&message=msg-1"
    assert payload["renotify"] is False
    assert payload["require_interaction"] is False
    assert payload["silent"] is False
    assert payload["vibrate"] == [260, 120, 260, 120, 360]
    assert payload["actions"][0]["action"] == "open-chat"
    assert payload["actions"][0]["route"] == "/chat?conversation=conv-1&message=msg-1"
    assert payload["actions"][1]["action"] == "dismiss"
    assert isinstance(payload["timestamp"], int)


def test_send_chat_message_notification_skips_duplicate_delivery_within_idempotency_window(monkeypatch):
    service = ChatPushService()
    send_calls: list[dict[str, object]] = []

    monkeypatch.setattr(
        service,
        "_get_active_subscriptions",
        lambda **_: [object()],
    )
    monkeypatch.setattr(
        service,
        "_send_payload_to_subscriptions",
        lambda **kwargs: send_calls.append(kwargs) or ChatPushSendResult(sent=1),
    )

    first = service.send_chat_message_notification(
        recipient_user_id=7,
        conversation_id="conv-1",
        message_id="msg-dup",
        title="Chat title",
        body="Chat body",
    )
    second = service.send_chat_message_notification(
        recipient_user_id=7,
        conversation_id="conv-1",
        message_id="msg-dup",
        title="Chat title",
        body="Chat body",
    )

    assert first.sent == 1
    assert second.sent == 1
    assert len(send_calls) == 1


def test_send_chat_message_notification_uses_single_best_subscription(monkeypatch):
    service = ChatPushService()
    captured: dict[str, object] = {}

    class _Subscription:
        def __init__(self, sub_id: int, *, install_mode: str, last_seen_at: datetime):
            self.id = sub_id
            self.install_mode = install_mode
            self.last_seen_at = last_seen_at
            self.updated_at = last_seen_at
            self.created_at = last_seen_at

    newer = _Subscription(2, install_mode="browser", last_seen_at=datetime(2026, 6, 19, tzinfo=timezone.utc))
    older = _Subscription(1, install_mode="standalone", last_seen_at=datetime(2026, 6, 18, tzinfo=timezone.utc))

    monkeypatch.setattr(
        service,
        "_get_active_subscriptions",
        lambda **_: [newer, older],
    )
    monkeypatch.setattr(
        service,
        "_send_payload_to_subscriptions",
        lambda **kwargs: captured.update(kwargs) or ChatPushSendResult(sent=1),
    )

    service.send_chat_message_notification(
        recipient_user_id=7,
        conversation_id="conv-1",
        message_id="msg-1",
        title="Chat title",
        body="Chat body",
    )

    subscriptions = captured["subscriptions"]
    assert len(subscriptions) == 1
    assert subscriptions[0].id == 1


def test_send_chat_message_notification_skips_native_when_web_subscriptions_exist(monkeypatch):
    service = ChatPushService()
    native_calls: list[dict[str, object]] = []

    monkeypatch.setattr(
        service,
        "_get_active_subscriptions",
        lambda **_: [object()],
    )
    monkeypatch.setattr(
        service,
        "_send_payload_to_subscriptions",
        lambda **_: ChatPushSendResult(failed=1),
    )
    monkeypatch.setattr(
        "backend.services.native_push_service.native_push_service.send_notification",
        lambda **kwargs: native_calls.append(kwargs) or NativePushSendResult(tokens=1, sent=1),
    )

    result = service.send_chat_message_notification(
        recipient_user_id=7,
        conversation_id="conv-1",
        message_id="msg-native-skip",
        title="Chat title",
        body="Chat body",
    )

    assert result.sent == 0
    assert native_calls == []
