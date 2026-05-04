from __future__ import annotations

import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.mail_message_actions import MailMessageActionError, MailMessageActions


class FakeItem:
    def __init__(self, *, item_id: str, is_read: bool = False):
        self.id = item_id
        self.is_read = is_read
        self.saved_fields: list[list[str]] = []
        self.deleted = False

    def save(self, update_fields=None):
        self.saved_fields.append(list(update_fields or []))

    def move(self, target_folder):
        moved_id = f"{target_folder.key}-moved"
        return FakeItem(item_id=moved_id, is_read=self.is_read)

    def delete(self):
        self.deleted = True


class FakeFolder:
    def __init__(self, *, key: str, items: dict[str, FakeItem] | None = None):
        self.key = key
        self.items = dict(items or {})

    def get(self, *, id: str):
        if id not in self.items:
            raise KeyError(id)
        return self.items[id]


def _build_actions(folders: dict[str, FakeFolder]) -> MailMessageActions:
    return MailMessageActions(
        resolve_folder=lambda _account, folder_key: (folders[folder_key], folder_key),
        encode_message_id=lambda folder_key, exchange_id, mailbox_id: f"{mailbox_id}:{folder_key}:{exchange_id}",
    )


def test_message_actions_set_read_state_updates_only_when_changed():
    item = FakeItem(item_id="msg-1", is_read=False)
    actions = _build_actions({"inbox": FakeFolder(key="inbox", items={"msg-1": item})})

    assert actions.set_read_state(account=object(), folder_key="inbox", exchange_id="msg-1", is_read=True) is True
    assert item.is_read is True
    assert item.saved_fields == [["is_read"]]

    assert actions.set_read_state(account=object(), folder_key="inbox", exchange_id="msg-1", is_read=True) is True
    assert item.saved_fields == [["is_read"]]


def test_message_actions_move_message_returns_new_encoded_reference():
    item = FakeItem(item_id="msg-1", is_read=True)
    folders = {
        "inbox": FakeFolder(key="inbox", items={"msg-1": item}),
        "trash": FakeFolder(key="trash"),
    }
    actions = _build_actions(folders)

    result = actions.move_message(
        account=object(),
        folder_key="inbox",
        exchange_id="msg-1",
        target_folder="trash",
        mailbox_id="mailbox-1",
    )

    assert result.message_id == "mailbox-1:trash:trash-moved"
    assert result.folder == "trash"
    assert result.source_folder == "inbox"
    assert result.source_exchange_id == "msg-1"
    assert result.target_exchange_id == "trash-moved"


def test_message_actions_bulk_read_state_counts_changed_and_failed():
    good = FakeItem(item_id="good", is_read=False)
    already = FakeItem(item_id="already", is_read=True)
    bad = FakeItem(item_id="bad", is_read=False)

    def _fail_save(update_fields=None):
        raise RuntimeError("save failed")

    bad.save = _fail_save
    actions = _build_actions({})

    result = actions.set_items_read_state(items=[good, already, bad], is_read=True)

    assert result.changed == 1
    assert result.failed == 1
    assert good.is_read is True
    assert already.saved_fields == []


def test_message_actions_mark_all_read_reads_unread_items_from_targets():
    first = FakeItem(item_id="first", is_read=False)
    second = FakeItem(item_id="second", is_read=False)
    folder = FakeFolder(key="inbox", items={"first": first, "second": second})
    folder.filter = lambda **kwargs: [first, second]
    actions = _build_actions({})

    result = actions.mark_all_read(folder_targets=[(folder, "inbox")])

    assert result.changed == 2
    assert result.failed == 0
    assert first.is_read is True
    assert second.is_read is True


def test_message_actions_delete_message_deletes_existing_item():
    item = FakeItem(item_id="msg-1")
    actions = _build_actions({"trash": FakeFolder(key="trash", items={"msg-1": item})})

    actions.delete_message(account=object(), folder_key="trash", exchange_id="msg-1")

    assert item.deleted is True


def test_message_actions_missing_message_raises_action_error():
    actions = _build_actions({"inbox": FakeFolder(key="inbox")})

    with pytest.raises(MailMessageActionError, match="Message not found: missing"):
        actions.set_read_state(account=object(), folder_key="inbox", exchange_id="missing", is_read=True)
