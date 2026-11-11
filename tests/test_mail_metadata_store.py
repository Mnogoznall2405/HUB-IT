from __future__ import annotations

import importlib
import json
import sqlite3
import sys
from pathlib import Path
from threading import RLock


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

metadata_module = importlib.import_module("backend.services.mail_metadata_store")
mail_module = importlib.import_module("backend.services.mail_service")


def _build_store(temp_dir: str):
    db_path = Path(temp_dir) / "mail_metadata.sqlite3"

    def connect():
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        return conn

    with connect() as conn:
        conn.execute(
            """
            CREATE TABLE mail_messages_log (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                username TEXT NOT NULL,
                direction TEXT NOT NULL,
                folder_hint TEXT NOT NULL,
                subject TEXT NOT NULL,
                recipients_json TEXT NOT NULL,
                sent_at TEXT NOT NULL,
                status TEXT NOT NULL,
                exchange_item_id TEXT NULL,
                error_text TEXT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE mail_restore_hints (
                user_id INTEGER NOT NULL,
                trash_exchange_id TEXT NOT NULL,
                restore_folder TEXT NOT NULL DEFAULT 'inbox',
                source_exchange_id TEXT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, trash_exchange_id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE mail_draft_context (
                draft_exchange_id TEXT NOT NULL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                compose_mode TEXT NOT NULL DEFAULT 'draft',
                reply_to_message_id TEXT NULL,
                forward_message_id TEXT NULL,
                compose_mailbox_id TEXT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE mail_folder_favorites (
                user_id INTEGER NOT NULL,
                folder_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, folder_id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE mail_visible_custom_folders (
                user_id INTEGER NOT NULL,
                folder_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, folder_id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE mail_user_preferences (
                user_id INTEGER NOT NULL PRIMARY KEY,
                prefs_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.commit()

    store = metadata_module.MailMetadataStore(
        lock=RLock(),
        connect=connect,
        log_table="mail_messages_log",
        log_retention_days_getter=lambda: 7,
        restore_hints_table="mail_restore_hints",
        draft_context_table="mail_draft_context",
        folder_favorites_table="mail_folder_favorites",
        visible_custom_folders_table="mail_visible_custom_folders",
        user_preferences_table="mail_user_preferences",
        standard_folders={"inbox", "sent", "drafts", "trash", "junk", "archive"},
        default_preferences={
            "reading_pane": "right",
            "density": "comfortable",
            "mark_read_on_select": False,
            "show_preview_snippets": True,
            "show_favorites_first": True,
            "folder_pane_width": 220,
            "message_list_width": 360,
            "bottom_list_percent": 42,
        },
    )
    return store, connect


def test_metadata_store_scopes_restore_hints_by_mailbox_and_keeps_legacy_fallback(temp_dir):
    store, _connect = _build_store(temp_dir)

    store.set_restore_hint(
        user_id=7,
        mailbox_id="mailbox-a",
        trash_exchange_id="trash-1",
        restore_folder="archive",
        source_exchange_id="source-1",
    )

    scoped = store.get_restore_hint(user_id=7, mailbox_id="mailbox-a", trash_exchange_id="trash-1")
    assert scoped is not None
    assert scoped["restore_folder"] == "archive"
    assert scoped["source_exchange_id"] == "source-1"
    assert store.get_restore_hint(user_id=7, mailbox_id="mailbox-b", trash_exchange_id="trash-1") is None

    store.set_restore_hint(
        user_id=7,
        trash_exchange_id="legacy-trash",
        restore_folder="inbox",
        source_exchange_id="legacy-source",
    )
    legacy = store.get_restore_hint(user_id=7, mailbox_id="mailbox-a", trash_exchange_id="legacy-trash")
    assert legacy is not None
    assert legacy["source_exchange_id"] == "legacy-source"

    store.delete_restore_hint(user_id=7, mailbox_id="mailbox-a", trash_exchange_id="trash-1")
    assert store.get_restore_hint(user_id=7, mailbox_id="mailbox-a", trash_exchange_id="trash-1") is None


def test_metadata_store_scopes_draft_context_by_mailbox_and_keeps_legacy_fallback(temp_dir):
    store, _connect = _build_store(temp_dir)

    store.save_draft_context(
        user_id=8,
        mailbox_id="mailbox-a",
        draft_exchange_id="draft-1",
        compose_mode="reply",
        reply_to_message_id="msg-1",
    )

    scoped = store.get_draft_context(user_id=8, mailbox_id="mailbox-a", draft_exchange_id="draft-1")
    assert scoped is not None
    assert scoped["compose_mode"] == "reply"
    assert scoped["reply_to_message_id"] == "msg-1"
    assert scoped.get("mailbox_id") is None
    assert store.get_draft_context(user_id=8, mailbox_id="mailbox-b", draft_exchange_id="draft-1") is None

    store.save_draft_context(
        user_id=8,
        mailbox_id="mailbox-a",
        draft_exchange_id="draft-compose-mb",
        compose_mode="draft",
        compose_mailbox_id="stored-mb-1",
    )
    with_mb = store.get_draft_context(user_id=8, mailbox_id="mailbox-a", draft_exchange_id="draft-compose-mb")
    assert with_mb is not None
    assert with_mb["mailbox_id"] == "stored-mb-1"

    store.save_draft_context(
        user_id=8,
        draft_exchange_id="legacy-draft",
        compose_mode="forward",
        forward_message_id="msg-2",
    )
    legacy = store.get_draft_context(user_id=8, mailbox_id="mailbox-a", draft_exchange_id="legacy-draft")
    assert legacy is not None
    assert legacy["compose_mode"] == "forward"
    assert legacy["forward_message_id"] == "msg-2"
    assert legacy.get("mailbox_id") is None

    store.delete_draft_context(mailbox_id="mailbox-a", draft_exchange_id="draft-1")
    assert store.get_draft_context(user_id=8, mailbox_id="mailbox-a", draft_exchange_id="draft-1") is None


def test_metadata_store_scopes_folder_metadata_and_ignores_standard_custom_folders(temp_dir):
    store, _connect = _build_store(temp_dir)

    assert store.set_folder_favorite(
        user_id=9,
        mailbox_id="mailbox-a",
        folder_id="inbox",
        favorite=True,
    ) == {"ok": True, "folder_id": "inbox", "favorite": True}
    store.set_folder_favorite(user_id=9, mailbox_id="mailbox-b", folder_id="sent", favorite=True)
    assert store.list_favorite_folder_ids(user_id=9, mailbox_id="mailbox-a") == {"inbox"}
    assert store.list_favorite_folder_ids(user_id=9, mailbox_id="mailbox-b") == {"sent"}

    store.set_custom_folder_visible(
        user_id=9,
        mailbox_id="mailbox-a",
        folder_id="custom-folder",
        visible=True,
    )
    store.set_custom_folder_visible(
        user_id=9,
        mailbox_id="mailbox-a",
        folder_id="inbox",
        visible=True,
    )
    assert store.list_visible_custom_folder_ids(user_id=9, mailbox_id="mailbox-a") == {"custom-folder"}
    store.set_custom_folder_visible(
        user_id=9,
        mailbox_id="mailbox-a",
        folder_id="custom-folder",
        visible=False,
    )
    assert store.list_visible_custom_folder_ids(user_id=9, mailbox_id="mailbox-a") == set()


def test_metadata_store_preferences_validate_shape_and_merge_defaults(temp_dir):
    store, _connect = _build_store(temp_dir)

    initial = store.get_preferences_row(user_id=10)
    assert initial["prefs"]["reading_pane"] == "right"
    assert initial["updated_at"] is None

    updated = store.update_preferences(
        user_id=10,
        payload={
            "reading_pane": "bottom",
            "density": "bad",
            "mark_read_on_select": True,
            "show_preview_snippets": False,
            "folder_pane_width": 999,
            "message_list_width": 100,
            "bottom_list_percent": 90,
        },
    )
    assert updated["preferences"]["reading_pane"] == "bottom"
    assert updated["preferences"]["density"] == "comfortable"
    assert updated["preferences"]["mark_read_on_select"] is True
    assert updated["preferences"]["show_preview_snippets"] is False
    assert updated["preferences"]["folder_pane_width"] == 360
    assert updated["preferences"]["message_list_width"] == 280
    assert updated["preferences"]["bottom_list_percent"] == 75
    assert updated["updated_at"]


def test_metadata_store_logs_messages_and_applies_retention(temp_dir):
    store, connect = _build_store(temp_dir)

    with connect() as conn:
        conn.execute(
            """
            INSERT INTO mail_messages_log
            (id, user_id, username, direction, folder_hint, subject, recipients_json, sent_at, status, exchange_item_id, error_text)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            ("old-message", 11, "user", "outgoing", "sent", "Old", "[]", "2020-01-01T00:00:00+00:00", "sent", None, None),
        )
        conn.commit()

    store.log_message(
        message_id="new-message",
        user_id=11,
        username="user",
        direction="outgoing",
        folder_hint="sent",
        subject="Subject",
        recipients=["a@example.test", "b@example.test"],
        status="sent",
        exchange_item_id="exchange-1",
    )

    with connect() as conn:
        rows = conn.execute("SELECT * FROM mail_messages_log ORDER BY id").fetchall()

    assert [row["id"] for row in rows] == ["new-message"]
    assert json.loads(rows[0]["recipients_json"]) == ["a@example.test", "b@example.test"]
    assert rows[0]["exchange_item_id"] == "exchange-1"


def test_mail_service_metadata_wrappers_delegate_to_store(monkeypatch):
    service = mail_module.MailService.__new__(mail_module.MailService)
    calls = []

    class _Store:
        def set_restore_hint(self, **kwargs):
            calls.append(("set_restore_hint", kwargs))

        def get_restore_hint(self, **kwargs):
            calls.append(("get_restore_hint", kwargs))
            return {"restore_folder": "inbox"}

        def delete_restore_hint(self, **kwargs):
            calls.append(("delete_restore_hint", kwargs))

        def save_draft_context(self, **kwargs):
            calls.append(("save_draft_context", kwargs))

        def get_draft_context(self, **kwargs):
            calls.append(("get_draft_context", kwargs))
            return {"compose_mode": "reply"}

        def delete_draft_context(self, **kwargs):
            calls.append(("delete_draft_context", kwargs))

    service._metadata_store = _Store()

    service._set_restore_hint(user_id=1, mailbox_id="m1", trash_exchange_id="t1", restore_folder="inbox")
    assert service._get_restore_hint(user_id=1, mailbox_id="m1", trash_exchange_id="t1") == {"restore_folder": "inbox"}
    service._delete_restore_hint(user_id=1, mailbox_id="m1", trash_exchange_id="t1")
    service._save_draft_context(user_id=1, mailbox_id="m1", draft_exchange_id="d1", compose_mode="reply")
    assert service._get_draft_context(user_id=1, mailbox_id="m1", draft_exchange_id="d1") == {"compose_mode": "reply"}
    service._delete_draft_context(mailbox_id="m1", draft_exchange_id="d1")

    assert [item[0] for item in calls] == [
        "set_restore_hint",
        "get_restore_hint",
        "delete_restore_hint",
        "save_draft_context",
        "get_draft_context",
        "delete_draft_context",
    ]
