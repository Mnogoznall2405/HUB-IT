from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.mail_message_actions import MailMessageActionError, MailMessageActions
from backend.services.mail_reference_codec import ITEM_SCOPED_FOLDER


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
        self.last_only_fields = None

    def all(self):
        return FakeQuery(self)

    def get(self, *, id: str):
        if id not in self.items:
            raise KeyError(id)
        return self.items[id]


class FakeQuery:
    def __init__(self, folder: FakeFolder):
        self.folder = folder

    def only(self, *fields):
        self.folder.last_only_fields = fields
        return self

    def get(self, *, id: str):
        return self.folder.get(id=id)


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


def test_message_actions_set_read_state_loads_is_read_only():
    item = FakeItem(item_id="msg-1", is_read=False)
    folder = FakeFolder(key="inbox", items={"msg-1": item})
    actions = _build_actions({"inbox": folder})

    assert actions.set_read_state(account=object(), folder_key="inbox", exchange_id="msg-1", is_read=True) is True
    assert folder.last_only_fields == ("is_read",)
    assert item.is_read is True


def test_message_actions_set_importance_loads_importance_only(monkeypatch):
    importance = types.SimpleNamespace(HIGH="high", NORMAL="normal", LOW="low")
    monkeypatch.setitem(sys.modules, "exchangelib", types.SimpleNamespace(Importance=importance))
    item = FakeItem(item_id="msg-1")
    item.importance = "normal"
    folder = FakeFolder(key="inbox", items={"msg-1": item})
    actions = _build_actions({"inbox": folder})

    assert actions.set_importance(
        account=object(),
        folder_key="inbox",
        exchange_id="msg-1",
        importance="high",
    ) is True
    assert folder.last_only_fields == ("importance",)
    assert item.importance == "high"
    assert item.saved_fields == [["importance"]]


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
    assert folders["inbox"].last_only_fields == ("subject",)


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


class FakeUnreadQuery:
    def __init__(self, items):
        self.items = list(items)
        self.only_fields = None

    def only(self, *fields):
        self.only_fields = fields
        return self

    def __iter__(self):
        return iter(self.items)


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


def test_message_actions_mark_all_read_uses_is_read_only_queryset():
    first = FakeItem(item_id="first", is_read=False)
    query = FakeUnreadQuery([first])
    folder = FakeFolder(key="inbox", items={"first": first})
    folder.filter = lambda **kwargs: query
    actions = _build_actions({})

    result = actions.mark_all_read(folder_targets=[(folder, "inbox")])

    assert query.only_fields == ("is_read",)
    assert result.changed == 1
    assert first.is_read is True


def test_message_actions_delete_message_deletes_existing_item():
    item = FakeItem(item_id="msg-1")
    folder = FakeFolder(key="trash", items={"msg-1": item})
    actions = _build_actions({"trash": folder})

    actions.delete_message(account=object(), folder_key="trash", exchange_id="msg-1")

    assert item.deleted is True
    assert folder.last_only_fields == ("subject",)


def test_message_actions_missing_message_raises_action_error():
    actions = _build_actions({"inbox": FakeFolder(key="inbox")})

    with pytest.raises(MailMessageActionError, match="Message not found: missing"):
        actions.set_read_state(account=object(), folder_key="inbox", exchange_id="missing", is_read=True)


def test_message_actions_item_scoped_folder_fetches_by_exchange_id():
    item = FakeItem(item_id="msg-custom", is_read=False)
    fetched = []

    actions = MailMessageActions(
        resolve_folder=lambda _account, folder_key: (_ for _ in ()).throw(AssertionError(folder_key)),
        encode_message_id=lambda folder_key, exchange_id, mailbox_id: f"{mailbox_id}:{folder_key}:{exchange_id}",
        fetch_item_by_id=lambda _account, exchange_id: fetched.append(exchange_id) or item,
        folder_key_from_item=lambda _account, _item: "custom-folder",
    )

    assert actions.set_read_state(
        account=object(),
        folder_key=ITEM_SCOPED_FOLDER,
        exchange_id="msg-custom",
        is_read=True,
    ) is True
    assert fetched == ["msg-custom"]
    assert item.is_read is True
