from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import select


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

appdb = importlib.import_module("backend.appdb.db")
models = importlib.import_module("backend.appdb.models")
native_push = importlib.import_module("backend.services.native_push_service")


def _isolated_service(tmp_path, monkeypatch):
    database_url = f"sqlite:///{(tmp_path / 'native_push.sqlite3').as_posix()}"
    appdb.ensure_app_schema_initialized(database_url)
    monkeypatch.setattr(native_push, "ensure_app_schema_initialized", lambda: database_url)
    monkeypatch.setattr(native_push, "is_app_database_configured", lambda: True)
    monkeypatch.setattr(native_push, "app_session", lambda: appdb.app_session(database_url))
    return native_push.NativePushService(), database_url


def _tokens(database_url):
    with appdb.app_session(database_url) as session:
        return list(
            session.execute(
                select(models.AppNativePushToken).order_by(models.AppNativePushToken.device_id)
            ).scalars()
        )


def test_native_push_keeps_two_devices_for_the_same_user(tmp_path, monkeypatch):
    service, database_url = _isolated_service(tmp_path, monkeypatch)

    service.upsert_token(user_id=38, token="fcm-phone-a", device_id="phone-a")
    service.upsert_token(user_id=38, token="fcm-phone-b", device_id="phone-b")

    rows = _tokens(database_url)
    assert [(row.device_id, row.is_active) for row in rows] == [
        ("phone-a", True),
        ("phone-b", True),
    ]


def test_native_push_rotation_revokes_only_the_previous_token_on_that_device(tmp_path, monkeypatch):
    service, database_url = _isolated_service(tmp_path, monkeypatch)

    service.upsert_token(user_id=38, token="fcm-phone-a-old", device_id="phone-a")
    service.upsert_token(user_id=38, token="fcm-phone-b", device_id="phone-b")
    service.upsert_token(user_id=38, token="fcm-phone-a-new", device_id="phone-a")

    rows = _tokens(database_url)
    by_token = {row.token_text: row for row in rows}
    assert by_token["fcm-phone-a-old"].is_active is False
    assert by_token["fcm-phone-a-new"].is_active is True
    assert by_token["fcm-phone-b"].is_active is True


def test_native_chat_push_uses_private_chat_channel_and_reply_category(monkeypatch):
    service = native_push.NativePushService()
    captured = {}

    class _Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self):
            return b"{}"

    def _urlopen(request, timeout):
        captured["timeout"] = timeout
        captured["payload"] = json.loads(request.data.decode("utf-8"))
        return _Response()

    monkeypatch.setattr(service, "_get_access_token", lambda _: "access-token")
    monkeypatch.setattr(native_push.urllib.request, "urlopen", _urlopen)

    service._send_fcm_message(
        service_account={},
        project_id="hubit-test",
        token="fcm-token",
        title="Новый ответ",
        body="Текст сообщения",
        data={
            "channel": "chat",
            "route": "/chat?conversation=conv-1&message=msg-1",
            "conversation_id": "conv-1",
            "message_id": "msg-1",
        },
        tag="chat:msg:msg-1",
    )

    message = captured["payload"]["message"]
    assert captured["timeout"] == 10
    assert "notification" not in message
    assert "notification" not in message["android"]
    assert message["data"]["channelId"] == "hubit_chat"
    assert message["data"]["categoryId"] == "hubit_chat_message"
    assert message["data"]["title"] == "Новый ответ"
    assert message["data"]["message"] == "Текст сообщения"
    assert message["data"]["tag"] == "chat:msg:msg-1"
    assert message["data"]["ttlSeconds"] == "86400"
    assert message["data"]["collapseKey"] == "hubit-chat"
    assert message["android"]["ttl"] == "86400s"
    assert message["android"]["collapse_key"] == "hubit-chat"
    assert message["android"]["restricted_package_name"] == "ru.zsgp.hubit.mobile"


def test_native_task_push_uses_tasks_channel_without_chat_actions(monkeypatch):
    service = native_push.NativePushService()
    captured = {}

    class _Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self):
            return b"{}"

    def _urlopen(request, timeout):
        captured["payload"] = json.loads(request.data.decode("utf-8"))
        return _Response()

    monkeypatch.setattr(service, "_get_access_token", lambda _: "access-token")
    monkeypatch.setattr(native_push.urllib.request, "urlopen", _urlopen)

    service._send_fcm_message(
        service_account={},
        project_id="hubit-test",
        token="fcm-token",
        title="Задача",
        body="Изменён статус",
        data={
            "channel": "tasks",
            "route": "/tasks?task=42",
            "entity_type": "task",
            "entity_id": "42",
        },
        tag="hub:notification-7",
    )

    message = captured["payload"]["message"]
    assert message["android"]["notification"]["channel_id"] == "hubit_tasks"
    assert message["data"]["channelId"] == "hubit_tasks"
    assert "categoryId" not in message["data"]
    assert message["android"]["ttl"] == "604800s"
    assert message["android"]["collapse_key"] == "hubit-tasks"
    assert message["android"]["notification"]["tag"] == "tasks:42"
    assert message["data"]["tag"] == "tasks:42"


def test_native_docflow_push_reuses_the_work_tasks_android_channel(monkeypatch):
    service = native_push.NativePushService()
    captured = {}

    class _Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self):
            return b"{}"

    monkeypatch.setattr(service, "_get_access_token", lambda _: "access-token")
    monkeypatch.setattr(
        native_push.urllib.request,
        "urlopen",
        lambda request, timeout: captured.update(
            payload=json.loads(request.data.decode("utf-8"))
        ) or _Response(),
    )

    service._send_fcm_message(
        service_account={},
        project_id="hubit-test",
        token="fcm-token",
        title="Новое задание в 1С ДО",
        body="Согласовать договор",
        data={"channel": "docflow", "task_ref": "task-1"},
        tag="docflow:task-1",
    )

    message = captured["payload"]["message"]
    assert message["android"]["notification"]["channel_id"] == "hubit_tasks"
    assert message["data"]["channelId"] == "hubit_tasks"
    assert message["android"]["ttl"] == "604800s"


def test_native_mail_push_forwards_launcher_notification_count(monkeypatch):
    service = native_push.NativePushService()
    captured = {}

    class _Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self):
            return b"{}"

    def _urlopen(request, timeout):
        captured["payload"] = json.loads(request.data.decode("utf-8"))
        return _Response()

    monkeypatch.setattr(service, "_get_access_token", lambda _: "access-token")
    monkeypatch.setattr(native_push.urllib.request, "urlopen", _urlopen)

    service._send_fcm_message(
        service_account={},
        project_id="hubit-test",
        token="fcm-token",
        title="Новое письмо",
        body="Письмо",
        data={"channel": "mail", "message_id": "mail-9"},
        tag="mail:mail-9",
        notification_count=12,
    )

    notification = captured["payload"]["message"]["android"]["notification"]
    assert notification["tag"] == "mail:mail-9"
    assert notification["notification_count"] == 12
    assert captured["payload"]["message"]["data"]["categoryId"] == "hubit_mail_message"


def test_native_push_binds_payload_to_recipient_user(monkeypatch):
    service = native_push.NativePushService()
    captured = {}
    monkeypatch.setattr(
        native_push.NativePushService,
        "configured",
        property(lambda _self: True),
    )
    monkeypatch.setattr(
        service,
        "_active_tokens",
        lambda *, user_id: [SimpleNamespace(id=1, token_text="fcm-token")],
    )
    monkeypatch.setattr(service, "_service_account", lambda: {"project_id": "hubit-test"})
    monkeypatch.setattr(service, "_project_id", lambda _account: "hubit-test")
    monkeypatch.setattr(service, "_mark_sent", lambda _token_id: None)
    monkeypatch.setattr(
        service,
        "_send_fcm_message",
        lambda **kwargs: captured.update(kwargs),
    )

    result = service.send_notification(
        recipient_user_id=38,
        title="HUB-IT",
        body="Message",
        channel="chat",
        route="/chat",
    )

    assert result.sent == 1
    assert captured["data"]["recipient_user_id"] == "38"
