from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

push_module = importlib.import_module("backend.chat.push_service")


def _subscription(subscription_id: int, *, platform: str, browser: str):
    return SimpleNamespace(
        id=subscription_id,
        install_mode="standalone",
        platform=platform,
        browser_family=browser,
        user_agent=f"{browser}-{platform}",
        last_seen_at=None,
        updated_at=None,
        created_at=None,
    )


def test_chat_push_keeps_distinct_android_and_ios_devices():
    service = push_module.ChatPushService()
    android = _subscription(1, platform="Linux armv8l", browser="chrome")
    iphone = _subscription(2, platform="iPhone", browser="safari")

    selected = service._select_chat_push_subscriptions([android, iphone])

    assert selected == [android, iphone]


def test_subscription_dedupe_keeps_two_identical_android_installations():
    service = push_module.ChatPushService()
    first = _subscription(1, platform="Linux armv81", browser="chrome")
    second = _subscription(2, platform="Linux armv81", browser="chrome")
    first.is_active = True
    second.is_active = True
    first.user_id = 38
    second.user_id = 38

    class _Result:
        def scalars(self):
            return [first, second]

    class _Session:
        def execute(self, _query):
            return _Result()

    selected = service._dedupe_active_subscriptions_in_session(_Session(), user_id=38)

    assert selected == [first, second]
    assert first.is_active is True
    assert second.is_active is True


def test_task_push_uses_high_urgency_and_mobile_safe_ttl(monkeypatch):
    service = push_module.ChatPushService()
    subscription = _subscription(1, platform="Linux armv8l", browser="chrome")
    captured = {}

    monkeypatch.setattr(service, "_get_active_subscriptions", lambda **_kwargs: [subscription])

    def _send(**kwargs):
        captured.update(kwargs)
        return push_module.ChatPushSendResult(sent=1)

    monkeypatch.setattr(service, "_send_payload_to_subscriptions", _send)
    native_service = importlib.import_module("backend.services.native_push_service").native_push_service
    monkeypatch.setattr(
        native_service,
        "send_notification",
        lambda **_kwargs: SimpleNamespace(tokens=0, sent=0, disabled=0, failed=0),
    )

    result = service.send_notification(
        recipient_user_id=8,
        title="Task",
        body="Assigned",
        channel="tasks",
        route="/tasks",
    )

    assert result.sent == 1
    assert captured["headers"] == {"Urgency": "high"}
    assert captured["ttl"] >= 12 * 60 * 60
