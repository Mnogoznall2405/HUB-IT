from __future__ import annotations

from backend.services.mail_message_actions import MailMessageActions
from backend.services.mail_reference_codec import MAIL_FLAG_CATEGORY


class _FakeItem:
    def __init__(self, categories=None):
        self.categories = list(categories or [])
        self.saved_fields = None

    def save(self, update_fields=None):
        self.saved_fields = update_fields


class _FakeFolder:
    def __init__(self, item):
        self.item = item

    def get(self, *, id):
        return self.item


def _actions(item):
    return MailMessageActions(
        resolve_folder=lambda account, folder_key: (_FakeFolder(item), folder_key),
        encode_message_id=lambda folder_key, exchange_id, mailbox_id: "encoded",
    )


def test_set_flag_appends_marker_category():
    item = _FakeItem(categories=["Важное"])
    ok = _actions(item).set_flag(
        account=object(),
        folder_key="inbox",
        exchange_id="abc",
        flagged=True,
    )

    assert ok is True
    assert item.categories == ["Важное", MAIL_FLAG_CATEGORY]
    assert item.saved_fields == ["categories"]


def test_set_flag_removes_marker_and_keeps_other_categories():
    item = _FakeItem(categories=[MAIL_FLAG_CATEGORY, "Важное"])
    ok = _actions(item).set_flag(
        account=object(),
        folder_key="inbox",
        exchange_id="abc",
        flagged=False,
    )

    assert ok is True
    assert item.categories == ["Важное"]
    assert item.saved_fields == ["categories"]


def test_set_flag_is_idempotent_without_save():
    item = _FakeItem(categories=[MAIL_FLAG_CATEGORY])
    ok = _actions(item).set_flag(
        account=object(),
        folder_key="inbox",
        exchange_id="abc",
        flagged=True,
    )

    assert ok is True
    assert item.saved_fields is None
