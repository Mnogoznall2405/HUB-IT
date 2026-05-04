from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

mailbox_model = importlib.import_module("backend.services.mail_mailbox_model")


def test_mailbox_model_builds_legacy_seed_from_effective_values():
    seed = mailbox_model.build_legacy_mailbox_seed(
        {
            "id": 7,
            "email": "User@Example.test",
            "mailbox_login": "login@example.test",
            "mailbox_password_enc": "enc",
        },
        mailbox_email="user@example.test",
        auth_mode="primary_session",
        now_iso="2026-05-04T00:00:00+00:00",
        default_label="Default mailbox",
    )

    assert seed == {
        "id": "legacy-7",
        "user_id": 7,
        "label": "User@Example.test",
        "mailbox_email": "user@example.test",
        "mailbox_login": "login@example.test",
        "mailbox_password_enc": "enc",
        "auth_mode": "primary_session",
        "is_primary": True,
        "is_active": True,
        "sort_order": 0,
        "last_selected_at": None,
        "created_at": "2026-05-04T00:00:00+00:00",
        "updated_at": "2026-05-04T00:00:00+00:00",
    }


def test_mailbox_model_selects_explicit_and_recent_active_rows():
    rows = [
        {"id": "old", "is_active": True, "is_primary": True, "sort_order": 0, "last_selected_at": "2026-05-03T00:00:00+00:00"},
        {"id": "new", "is_active": True, "is_primary": False, "sort_order": 1, "last_selected_at": "2026-05-04T00:00:00+00:00"},
        {"id": "inactive", "is_active": False, "is_primary": False, "sort_order": 2, "last_selected_at": "2026-05-05T00:00:00+00:00"},
    ]

    assert mailbox_model.select_mailbox_row(rows)["id"] == "new"
    assert mailbox_model.select_mailbox_row(rows, mailbox_id="old")["id"] == "old"
    with pytest.raises(mailbox_model.MailboxSelectionError, match="inactive") as exc:
        mailbox_model.select_mailbox_row(rows, mailbox_id="inactive")
    assert exc.value.status_code == 409
    assert mailbox_model.select_mailbox_row(rows, mailbox_id="inactive", allow_inactive=True)["id"] == "inactive"


def test_mailbox_model_primary_duplicate_sort_and_entry_payload():
    rows = [
        {"id": "first", "mailbox_email": "first@example.test", "is_primary": False, "sort_order": 2},
        {"id": "primary", "mailbox_email": "primary@example.test", "is_primary": True, "sort_order": 4},
    ]

    assert mailbox_model.primary_mailbox_row(rows)["id"] == "primary"
    assert mailbox_model.next_mailbox_sort_order(rows) == 5
    assert mailbox_model.has_duplicate_mailbox_email(rows, mailbox_email="PRIMARY@example.test")
    assert not mailbox_model.has_duplicate_mailbox_email(
        rows,
        mailbox_email="primary@example.test",
        exclude_mailbox_id="primary",
    )

    payload = mailbox_model.serialize_mailbox_entry(
        user={"mail_updated_at": "2026-05-04T00:00:00+00:00"},
        mailbox_row={"mailbox_login": "login@example.test", "auth_mode": "stored_credentials", "last_selected_at": "", "sort_order": 4},
        profile={
            "mailbox_id": "primary",
            "label": "Primary",
            "email": "primary@example.test",
            "login": "login@example.test",
            "mail_auth_mode": "manual",
            "is_primary": True,
            "is_active": True,
            "mail_requires_password": False,
            "mail_requires_relogin": False,
            "mail_is_configured": True,
        },
        signature_html="<p>sig</p>",
        unread_count=-1,
        selected=True,
    )

    assert payload["id"] == "primary"
    assert payload["unread_count"] == 0
    assert payload["is_selected"] is True
    assert payload["mail_signature_html"] == "<p>sig</p>"
