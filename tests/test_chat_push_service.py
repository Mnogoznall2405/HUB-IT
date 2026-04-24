from __future__ import annotations

import sys
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.chat.push_service import (
    CHAT_PUSH_TTL_SEC,
    ChatPushSendResult,
    ChatPushService,
    _decode_base64url,
    _resolve_vapid_private_key,
)


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
    assert payload["tag"] == "chat:msg-1"
    assert payload["data"]["route"] == "/chat?conversation=conv-1"
    assert payload["renotify"] is True
    assert payload["require_interaction"] is True
    assert payload["silent"] is False
    assert payload["vibrate"] == [260, 120, 260, 120, 360]
    assert payload["actions"][0]["action"] == "open-chat"
    assert payload["actions"][0]["route"] == "/chat?conversation=conv-1"
    assert payload["actions"][1]["action"] == "dismiss"
    assert isinstance(payload["timestamp"], int)
