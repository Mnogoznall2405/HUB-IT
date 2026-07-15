from __future__ import annotations

import sys
import threading
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.appdb.db import initialize_app_schema
from backend.services.mail_runtime_snapshot_service import MailRuntimeSnapshotService


def test_mail_snapshot_is_shared_and_error_preserves_confirmed_value(tmp_path):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'mail-snapshot.db').as_posix()}"
    initialize_app_schema(database_url)
    writer = MailRuntimeSnapshotService(database_url)
    reader = MailRuntimeSnapshotService(database_url)

    writer.write_success(
        user_id=42,
        mailbox_id=None,
        snapshot_type="unread",
        payload={"unread_count": 7},
        ttl_seconds=90,
    )
    first = reader.read(user_id=42, mailbox_id=None, snapshot_type="unread")
    writer.record_error(
        user_id=42,
        mailbox_id=None,
        snapshot_type="unread",
        error="exchange timeout",
    )
    after_error = reader.read(user_id=42, mailbox_id=None, snapshot_type="unread")

    assert first["state"] == "ok"
    assert first["payload"] == {"unread_count": 7}
    assert after_error["state"] == "error"
    assert after_error["payload"] == {"unread_count": 7}
    assert after_error["last_error"] == "exchange timeout"


def test_mail_snapshot_concurrent_first_write_is_an_atomic_upsert(tmp_path, monkeypatch):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'mail-snapshot-race.db').as_posix()}"
    initialize_app_schema(database_url)
    service = MailRuntimeSnapshotService(database_url)
    original_find = service._find
    both_read_missing = threading.Barrier(2)

    def synchronized_find(session, **scope):
        row = original_find(session, **scope)
        if row is None:
            both_read_missing.wait(timeout=3)
        return row

    monkeypatch.setattr(service, "_find", synchronized_find)
    errors: list[BaseException] = []

    def write(value: int) -> None:
        try:
            service.write_success(
                user_id=44,
                mailbox_id=None,
                snapshot_type="bootstrap",
                context_key="inbox|current|20",
                payload={"version": value},
            )
        except BaseException as exc:  # pragma: no cover - assertion reports the concrete DB failure
            errors.append(exc)

    threads = [threading.Thread(target=write, args=(value,)) for value in (1, 2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=5)

    assert all(not thread.is_alive() for thread in threads)
    assert errors == []
    result = service.read(
        user_id=44,
        mailbox_id=None,
        snapshot_type="bootstrap",
        context_key="inbox|current|20",
    )
    assert result["state"] == "ok"
    assert result["payload"] in ({"version": 1}, {"version": 2})


def test_mail_snapshot_read_state_write_through_updates_counts_feed_and_bootstrap(tmp_path):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'mail-read-state.db').as_posix()}"
    initialize_app_schema(database_url)
    service = MailRuntimeSnapshotService(database_url)
    service.write_success(
        user_id=51,
        mailbox_id=None,
        snapshot_type="unread",
        payload={"unread_count": 1},
    )
    service.write_success(
        user_id=51,
        mailbox_id=None,
        snapshot_type="notification_feed",
        payload={
            "total_unread": 1,
            "items": [{"id": "msg-1", "conversation_id": "conv-1", "is_read": False}],
        },
    )
    service.write_success(
        user_id=51,
        mailbox_id=None,
        snapshot_type="bootstrap",
        context_key="inbox|current|20",
        payload={
            "unread_count": 1,
            "folder_summary": {"inbox": {"total": 1, "unread": 1}},
            "messages": {"items": [{"id": "msg-1", "is_read": False}]},
        },
    )

    service.apply_read_state(
        user_id=51,
        mailbox_id=None,
        unread_delta=-1,
        is_read=True,
        message_id="msg-1",
        conversation_id="conv-1",
        folder="inbox",
    )

    unread = service.read(user_id=51, mailbox_id=None, snapshot_type="unread")
    feed = service.read(user_id=51, mailbox_id=None, snapshot_type="notification_feed")
    bootstrap = service.read(
        user_id=51,
        mailbox_id=None,
        snapshot_type="bootstrap",
        context_key="inbox|current|20",
    )
    assert unread["payload"]["unread_count"] == 0
    assert feed["payload"]["total_unread"] == 0
    assert feed["payload"]["items"][0]["is_read"] is True
    assert bootstrap["payload"]["unread_count"] == 0
    assert bootstrap["payload"]["folder_summary"]["inbox"]["unread"] == 0
    assert bootstrap["payload"]["messages"]["items"][0]["is_read"] is True


def test_mail_notification_cycle_persists_count_and_feed_together(tmp_path):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'mail-notification-cycle.db').as_posix()}"
    initialize_app_schema(database_url)
    service = MailRuntimeSnapshotService(database_url)
    feed = {
        "total_unread": 2,
        "items": [{"id": "msg-1", "is_read": False}],
    }

    service.write_notification_cycle(user_id=52, feed=feed)

    unread = service.read(user_id=52, mailbox_id=None, snapshot_type="unread")
    notification_feed = service.read(user_id=52, mailbox_id=None, snapshot_type="notification_feed")
    assert unread["payload"] == {"unread_count": 2}
    assert notification_feed["payload"] == feed


def test_mail_preferences_write_through_updates_bootstrap_without_refreshing_its_age(tmp_path):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'mail-preferences-snapshot.db').as_posix()}"
    initialize_app_schema(database_url)
    service = MailRuntimeSnapshotService(database_url)
    service.write_success(
        user_id=53,
        mailbox_id="mailbox-1",
        snapshot_type="bootstrap",
        context_key="inbox|current|20",
        payload={
            "preferences": {"preferences": {"folder_pane_width": 220}},
            "messages": {"items": []},
        },
    )
    before = service.read(
        user_id=53,
        mailbox_id="mailbox-1",
        snapshot_type="bootstrap",
        context_key="inbox|current|20",
    )

    service.apply_preferences(
        user_id=53,
        preferences={"preferences": {"folder_pane_width": 260}},
    )

    after = service.read(
        user_id=53,
        mailbox_id="mailbox-1",
        snapshot_type="bootstrap",
        context_key="inbox|current|20",
    )
    assert after["payload"]["preferences"]["preferences"]["folder_pane_width"] == 260
    assert after["as_of"] == before["as_of"]
