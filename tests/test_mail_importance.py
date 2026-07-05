from __future__ import annotations

import pytest

from backend.services.mail_message_actions import MailMessageActionError, MailMessageActions


class _FakeImportance:
    HIGH = "HIGH"
    NORMAL = "NORMAL"
    LOW = "LOW"


class _FakeItem:
    def __init__(self, importance="NORMAL"):
        self.importance = importance
        self.saved_fields = None

    def save(self, update_fields=None):
        self.saved_fields = update_fields


class _FakeFolder:
    def __init__(self, item):
        self.item = item

    def get(self, *, id):
        return self.item


def test_set_importance_updates_exchange_item(monkeypatch):
    item = _FakeItem(importance=_FakeImportance.NORMAL)
    folder = _FakeFolder(item)
    actions = MailMessageActions(
        resolve_folder=lambda account, folder_key: (folder, folder_key),
        encode_message_id=lambda folder_key, exchange_id, mailbox_id: "encoded",
    )

    monkeypatch.setitem(
        __import__("sys").modules,
        "exchangelib",
        type("exchangelib", (), {"Importance": _FakeImportance})(),
    )

    ok = actions.set_importance(
        account=object(),
        folder_key="inbox",
        exchange_id="abc",
        importance="high",
    )

    assert ok is True
    assert item.importance == _FakeImportance.HIGH
    assert item.saved_fields == ["importance"]


def test_set_importance_rejects_unknown_value():
    actions = MailMessageActions(
        resolve_folder=lambda account, folder_key: (_FakeFolder(_FakeItem()), folder_key),
        encode_message_id=lambda folder_key, exchange_id, mailbox_id: "encoded",
    )

    with pytest.raises(MailMessageActionError, match="Unsupported importance"):
        actions.set_importance(
            account=object(),
            folder_key="inbox",
            exchange_id="abc",
            importance="urgent",
        )
