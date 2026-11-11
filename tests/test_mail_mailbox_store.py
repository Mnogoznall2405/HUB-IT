from __future__ import annotations

import importlib
import sqlite3
import sys
from pathlib import Path
from threading import RLock

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

mailbox_store = importlib.import_module("backend.services.mail_mailbox_store")


def _create_store():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE user_mailboxes (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            label TEXT,
            mailbox_email TEXT,
            mailbox_login TEXT,
            mailbox_password_enc TEXT,
            auth_mode TEXT,
            is_primary INTEGER,
            is_active INTEGER,
            sort_order INTEGER,
            last_selected_at TEXT,
            created_at TEXT,
            updated_at TEXT
        )
        """
    )
    return mailbox_store.MailMailboxStore(
        lock=RLock(),
        connect=lambda: conn,
        table="user_mailboxes",
        now_iso=lambda: "2026-05-04T00:00:00+00:00",
    )


def test_mailbox_store_inserts_seed_lists_and_touches_selected():
    store = _create_store()

    assert store.has_any(user_id=7) is False
    store.insert_legacy_seed(
        user_id=7,
        seed={
            "id": "legacy-7",
            "label": "Primary",
            "mailbox_email": "USER@EXAMPLE.TEST",
            "mailbox_login": "login@example.test",
            "mailbox_password_enc": "enc",
            "auth_mode": "stored_credentials",
            "sort_order": 0,
        },
    )
    store.touch_selected(user_id=7, mailbox_id="legacy-7")

    rows = store.list_rows(user_id=7)

    assert store.has_any(user_id=7) is True
    assert rows[0]["id"] == "legacy-7"
    assert rows[0]["mailbox_email"] == "user@example.test"
    assert rows[0]["last_selected_at"] == "2026-05-04T00:00:00+00:00"


def test_mailbox_store_clears_primary_updates_and_deletes():
    store = _create_store()
    store.insert_row(
        user_id=7,
        mailbox_id="first",
        label="First",
        mailbox_email="first@example.test",
        is_primary=True,
        sort_order=1,
        selected=True,
    )
    store.insert_row(
        user_id=7,
        mailbox_id="second",
        label="Second",
        mailbox_email="second@example.test",
        is_primary=True,
        sort_order=2,
        selected=True,
        clear_existing_primary=True,
    )

    rows = store.list_rows(user_id=7, include_inactive=True)
    assert [(row["id"], bool(row["is_primary"])) for row in rows] == [("second", True), ("first", False)]

    store.update_row(
        user_id=7,
        mailbox_id="first",
        label="First Updated",
        mailbox_email="first-new@example.test",
        mailbox_login="first-new@example.test",
        mailbox_password_enc="enc2",
        auth_mode="stored_credentials",
        is_primary=True,
        is_active=True,
        selected=True,
        clear_existing_primary=True,
    )

    rows = store.list_rows(user_id=7, include_inactive=True)
    assert [(row["id"], bool(row["is_primary"])) for row in rows] == [("first", True), ("second", False)]
    assert rows[0]["label"] == "First Updated"
    assert rows[0]["mailbox_login"] == "first-new@example.test"

    store.delete_row(user_id=7, mailbox_id="second")

    assert [row["id"] for row in store.list_rows(user_id=7, include_inactive=True)] == ["first"]
