from __future__ import annotations

import sys
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

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
    DEFAULT_PUSH_TTL_SEC,
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
    assert captured["ttl"] == DEFAULT_PUSH_TTL_SEC
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
    native_captured: dict[str, object] = {}

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
    monkeypatch.setattr(
        "backend.services.native_push_service.native_push_service.send_notification",
        lambda **kwargs: native_captured.update(kwargs) or NativePushSendResult(),
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
    assert native_captured["app_badge_count"] == 3


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


def test_send_chat_message_notification_routes_task_chat_to_task_discussion(monkeypatch):
    import backend.chat.push_service as push_service_module

    service = ChatPushService()
    captured: dict[str, object] = {}

    class _Session:
        @staticmethod
        def get(_model, _conversation_id):
            return SimpleNamespace(kind="task", task_id="task-77")

    @contextmanager
    def fake_chat_session():
        yield _Session()

    monkeypatch.setattr(push_service_module, "chat_session", fake_chat_session)
    monkeypatch.setattr(service, "_get_active_subscriptions", lambda **_: [object()])
    monkeypatch.setattr(
        service,
        "_send_payload_to_subscriptions",
        lambda **kwargs: captured.update(kwargs) or ChatPushSendResult(sent=1),
    )

    result = service.send_chat_message_notification(
        recipient_user_id=7,
        conversation_id="conv-task-77",
        message_id="msg-task-77",
        title="Task discussion",
        body="New message",
    )

    assert result.sent == 1
    payload = captured["payload"]
    expected_route = "/tasks?task=task-77&task_detail_view=discussion&message=msg-task-77"
    assert payload["data"]["route"] == expected_route
    assert payload["data"]["conversation_kind"] == "task"
    assert payload["data"]["task_id"] == "task-77"
    assert payload["actions"][0]["route"] == expected_route


def test_send_chat_message_notification_respects_specific_chat_preference(monkeypatch):
    service = ChatPushService()
    preference_calls: list[dict[str, object]] = []
    subscription_calls: list[int] = []

    def _is_enabled(**kwargs):
        preference_calls.append(kwargs)
        return False

    monkeypatch.setattr(
        "backend.chat.push_service.notification_preferences_service.is_enabled",
        _is_enabled,
    )
    monkeypatch.setattr(
        service,
        "_get_active_subscriptions",
        lambda **_: subscription_calls.append(1) or [object()],
    )

    result = service.send_chat_message_notification(
        recipient_user_id=7,
        conversation_id="conv-group",
        message_id="msg-group-disabled",
        title="Group title",
        body="Group body",
        preference_channel="chat_group",
    )

    assert result.sent == 0
    assert preference_calls == [{"user_id": 7, "channel": "chat_group"}]
    assert subscription_calls == []


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


def test_send_chat_message_notification_uses_all_distinct_subscriptions(monkeypatch):
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
    assert [item.id for item in subscriptions] == [2, 1]


def test_send_chat_message_notification_fans_out_to_web_and_native_subscriptions(monkeypatch):
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
        lambda **_: ChatPushSendResult(sent=1),
    )
    monkeypatch.setattr(
        "backend.services.native_push_service.native_push_service.send_notification",
        lambda **kwargs: native_calls.append(kwargs) or NativePushSendResult(tokens=2, sent=2),
    )

    result = service.send_chat_message_notification(
        recipient_user_id=7,
        conversation_id="conv-1",
        message_id="msg-native-fanout",
        title="Chat title",
        body="Chat body",
    )

    assert result.sent == 3
    assert len(native_calls) == 1
    assert native_calls[0]["recipient_user_id"] == 7
    assert native_calls[0]["route"] == "/chat?conversation=conv-1&message=msg-native-fanout"


def test_send_chat_message_notification_routes_ai_to_native_ai_channel(monkeypatch):
    service = ChatPushService()
    captured: dict[str, object] = {}
    native_calls: list[dict[str, object]] = []

    monkeypatch.setattr(
        service,
        "_get_active_subscriptions",
        lambda **_: [object()],
    )
    monkeypatch.setattr(
        service,
        "_send_payload_to_subscriptions",
        lambda **kwargs: captured.update(kwargs) or ChatPushSendResult(sent=1),
    )
    monkeypatch.setattr(
        "backend.services.native_push_service.native_push_service.send_notification",
        lambda **kwargs: native_calls.append(kwargs) or NativePushSendResult(tokens=1, sent=1),
    )

    result = service.send_chat_message_notification(
        recipient_user_id=7,
        conversation_id="conv-ai-1",
        message_id="msg-ai-1",
        title="AI title",
        body="AI body",
        preference_channel="chat_ai",
        conversation_kind="ai",
    )

    assert result.sent == 2
    assert len(native_calls) == 1
    assert native_calls[0]["native_channel"] == "hubit_chat_ai"
    assert native_calls[0]["channel"] == "chat"
    payload = captured["payload"]
    assert payload["channel"] == "chat"
    assert payload["data"]["conversation_kind"] == "ai"


def test_send_chat_message_notification_keeps_default_native_channel_for_human_chat(monkeypatch):
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
        lambda **_: ChatPushSendResult(sent=1),
    )
    monkeypatch.setattr(
        "backend.services.native_push_service.native_push_service.send_notification",
        lambda **kwargs: native_calls.append(kwargs) or NativePushSendResult(tokens=1, sent=1),
    )

    service.send_chat_message_notification(
        recipient_user_id=7,
        conversation_id="conv-1",
        message_id="msg-human-1",
        title="Chat title",
        body="Chat body",
        preference_channel="chat_direct",
        conversation_kind="direct",
    )

    assert len(native_calls) == 1
    assert native_calls[0]["native_channel"] == "hubit_chat"


def test_send_chat_message_notification_respects_chat_ai_preference(monkeypatch):
    service = ChatPushService()
    preference_calls: list[dict[str, object]] = []

    monkeypatch.setattr(
        "backend.chat.push_service.notification_preferences_service.is_enabled",
        lambda **kwargs: preference_calls.append(kwargs) or False,
    )
    monkeypatch.setattr(
        service,
        "_get_active_subscriptions",
        lambda **_: (_ for _ in ()).throw(AssertionError("disabled chat_ai must skip delivery")),
    )

    result = service.send_chat_message_notification(
        recipient_user_id=7,
        conversation_id="conv-ai-1",
        message_id="msg-ai-disabled",
        title="AI title",
        body="AI body",
        preference_channel="chat_ai",
        conversation_kind="ai",
    )

    assert result.sent == 0
    assert preference_calls == [{"user_id": 7, "channel": "chat_ai"}]


def test_send_notification_skips_non_system_push_during_quiet_hours(monkeypatch):
    import backend.chat.push_service as push_service_module

    service = ChatPushService()
    monkeypatch.setattr(
        push_service_module.notification_preferences_service,
        "is_quiet_hours_active",
        lambda **kwargs: kwargs["channel"] == "chat",
    )
    monkeypatch.setattr(
        service,
        "_get_active_subscriptions",
        lambda **_: (_ for _ in ()).throw(AssertionError("delivery lookup must be skipped")),
    )

    result = service.send_notification(
        recipient_user_id=7,
        title="Chat",
        body="Message",
        channel="chat",
        route="/chat",
    )

    assert result.sent == 0
    assert result.failed == 0


import backend.chat.push_service as push_module
from backend.chat.push_service import assert_public_push_endpoint
from fastapi import HTTPException


def _global_addrinfo(ip: str = "140.82.121.4"):
    return lambda *_a, **_k: [(0, 0, 0, "", (ip, 443))]


class _ScalarResult:
    def __init__(self, value=None):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _UpsertSession:
    def __init__(self):
        self.added = []

    def execute(self, _query):
        return _ScalarResult(None)

    def add(self, obj):
        self.added.append(obj)

    def flush(self):
        pass


@contextmanager
def _fake_chat_session(session):
    yield session


def test_push_endpoint_rejects_non_https():
    with pytest.raises(HTTPException) as exc:
        assert_public_push_endpoint("http://push.example/register")
    assert exc.value.status_code == 400


@pytest.mark.parametrize(
    "endpoint",
    [
        "https://user:pass@push.example/",
        "https://push.example:444/send",
        "https://push.example:badport/",
        "https:///missing-host",
        "not-a-url",
    ],
)
def test_push_endpoint_rejects_invalid_urls_without_dns(monkeypatch, endpoint):
    monkeypatch.setattr(
        push_module.socket,
        "getaddrinfo",
        lambda *_a, **_k: pytest.fail("DNS must not run for rejected endpoints"),
    )
    with pytest.raises(HTTPException) as exc:
        assert_public_push_endpoint(endpoint)
    assert exc.value.status_code == 400


@pytest.mark.parametrize(
    "ip",
    ["127.0.0.1", "10.0.0.8", "192.168.1.10", "169.254.169.254", "::1", "::ffff:127.0.0.1"],
)
def test_push_endpoint_rejects_non_global_ips(monkeypatch, ip):
    monkeypatch.setattr(push_module.socket, "getaddrinfo", _global_addrinfo(ip))
    with pytest.raises(HTTPException) as exc:
        assert_public_push_endpoint("https://push.example/send")
    assert exc.value.status_code == 400


def test_push_endpoint_rejects_mixed_resolution(monkeypatch):
    monkeypatch.setattr(
        push_module.socket,
        "getaddrinfo",
        lambda *_a, **_k: [
            (0, 0, 0, "", ("140.82.121.4", 443)),
            (0, 0, 0, "", ("10.0.0.5", 443)),
        ],
    )
    with pytest.raises(HTTPException) as exc:
        assert_public_push_endpoint("https://push.example/send")
    assert exc.value.status_code == 400


def test_push_endpoint_unresolvable_is_422(monkeypatch):
    def _raise(*_a, **_k):
        raise OSError("no DNS")

    monkeypatch.setattr(push_module.socket, "getaddrinfo", _raise)
    with pytest.raises(HTTPException) as exc:
        assert_public_push_endpoint("https://push.example/send")
    assert exc.value.status_code == 422


def test_push_endpoint_accepts_global_https(monkeypatch):
    monkeypatch.setattr(push_module.socket, "getaddrinfo", _global_addrinfo())
    endpoint = "https://push.example/sub/abc"
    assert assert_public_push_endpoint(endpoint) == endpoint


def test_upsert_rejects_private_endpoint_before_storage(monkeypatch):
    service = ChatPushService()
    session_used = []

    @contextmanager
    def guarded_session():
        session_used.append(True)
        yield _UpsertSession()

    monkeypatch.setattr(push_module.socket, "getaddrinfo", _global_addrinfo("169.254.169.254"))
    monkeypatch.setattr(push_module, "chat_session", guarded_session)

    with pytest.raises(HTTPException) as exc:
        service.upsert_subscription(
            current_user_id=7,
            endpoint="https://169.254.169.254/latest/meta-data",
            p256dh_key="p256",
            auth_key="auth",
        )
    assert exc.value.status_code == 400
    assert session_used == []


def test_upsert_accepts_public_endpoint(monkeypatch):
    service = ChatPushService()
    session = _UpsertSession()
    monkeypatch.setattr(push_module.socket, "getaddrinfo", _global_addrinfo())
    monkeypatch.setattr(push_module, "chat_session", lambda: _fake_chat_session(session))
    monkeypatch.setattr(service, "_dedupe_active_subscriptions_in_session", lambda *_a, **_k: [])

    result = service.upsert_subscription(
        current_user_id=7,
        endpoint="https://push.example/sub/abc",
        p256dh_key="p256",
        auth_key="auth",
    )

    assert result["ok"] is True
    assert len(session.added) == 1


def _managed_subscription(endpoint):
    return SimpleNamespace(
        id=11,
        endpoint=endpoint,
        p256dh_key="p256",
        auth_key="auth",
        failure_count=0,
        is_active=True,
        updated_at=None,
        last_error_at=None,
        last_error_text=None,
        last_push_at=None,
        last_seen_at=None,
    )


def test_send_deactivates_stored_private_endpoint_without_webpush(monkeypatch):
    service = ChatPushService()
    managed = _managed_subscription("https://internal.example/send")
    monkeypatch.setattr(type(service), "enabled", property(lambda _s: True))
    monkeypatch.setattr(push_module.socket, "getaddrinfo", _global_addrinfo("10.0.0.9"))
    calls = []
    monkeypatch.setattr(push_module, "webpush", lambda **kwargs: calls.append(kwargs))

    class _Session:
        def get(self, _model, _key):
            return managed

    monkeypatch.setattr(push_module, "chat_session", lambda: _fake_chat_session(_Session()))

    result = service._send_payload_to_subscriptions(subscriptions=[managed], payload={"x": 1})

    assert calls == []
    assert result.disabled == 1
    assert result.sent == 0
    assert managed.is_active is False
    assert managed.failure_count == 1


def test_send_keeps_subscription_on_transient_dns_failure(monkeypatch):
    service = ChatPushService()
    managed = _managed_subscription("https://push.example/send")
    monkeypatch.setattr(type(service), "enabled", property(lambda _s: True))

    def _raise(*_a, **_k):
        raise OSError("no DNS")

    monkeypatch.setattr(push_module.socket, "getaddrinfo", _raise)
    calls = []
    monkeypatch.setattr(push_module, "webpush", lambda **kwargs: calls.append(kwargs))

    class _Session:
        def get(self, _model, _key):
            return managed

    monkeypatch.setattr(push_module, "chat_session", lambda: _fake_chat_session(_Session()))

    result = service._send_payload_to_subscriptions(subscriptions=[managed], payload={"x": 1})

    assert calls == []
    assert result.failed == 1
    assert result.disabled == 0
    assert managed.is_active is True


def test_send_uses_redirect_free_requests_session(monkeypatch):
    service = ChatPushService()
    managed = _managed_subscription("https://push.example/send")
    monkeypatch.setattr(type(service), "enabled", property(lambda _s: True))
    monkeypatch.setattr(push_module.socket, "getaddrinfo", _global_addrinfo())
    calls = []
    monkeypatch.setattr(push_module, "webpush", lambda **kwargs: calls.append(kwargs))

    class _Session:
        def get(self, _model, _key):
            return managed

    monkeypatch.setattr(push_module, "chat_session", lambda: _fake_chat_session(_Session()))

    result = service._send_payload_to_subscriptions(subscriptions=[managed], payload={"x": 1})

    assert result.sent == 1
    session = calls[0]["requests_session"]
    assert session is not None
    assert session.max_redirects == 0
