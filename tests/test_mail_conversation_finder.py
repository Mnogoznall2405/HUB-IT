from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.mail_conversation_finder import MailConversationFinder, MailConversationFinderError


class FakeFolder:
    def __init__(self, *, key: str, items=None):
        self.key = key
        self.items = list(items or [])

    def get(self, *, id: str):
        for item in self.items:
            if item.id == id:
                return item
        raise KeyError(id)


def _item(item_id: str, conversation_key: str, minute: int):
    return SimpleNamespace(
        id=item_id,
        conversation_key=conversation_key,
        datetime_received=datetime(2026, 5, 4, 12, minute, tzinfo=timezone.utc),
    )


def _build_finder(*, folders: dict[str, FakeFolder], search_window_limit=20):
    def _search_target_folders(_account, folder="inbox", folder_scope="current"):
        if folder_scope == "all":
            return [(folder, folder.key) for folder in folders.values()]
        return [(folders[folder], folder)]

    return MailConversationFinder(
        search_target_folders=_search_target_folders,
        folder_queryset=lambda folder_obj, _folder_key: folder_obj.items,
        item_conversation_key=lambda item: item.conversation_key,
        decode_message_id=lambda message_id: tuple(message_id.split(":", 1)),
        resolve_folder=lambda _account, folder_key: (folders[folder_key], folder_key),
        search_batch_size=2,
        search_window_limit=lambda: search_window_limit,
    )


def test_conversation_finder_finds_and_sorts_items_across_targets():
    inbox = FakeFolder(key="inbox", items=[_item("late", "conv-1", 2), _item("other", "conv-2", 3)])
    archive = FakeFolder(key="archive", items=[_item("early", "conv-1", 1)])
    finder = _build_finder(folders={"inbox": inbox, "archive": archive})

    key, items, last_folder = finder.find(
        account=object(),
        conversation_id="conv-1",
        folder="inbox",
        folder_scope="all",
    )

    assert key == "conv-1"
    assert [item.id for item, _folder_key in items] == ["early", "late"]
    assert last_folder == "archive"


def test_conversation_finder_uses_direct_message_id_fallback():
    inbox = FakeFolder(key="inbox", items=[_item("msg-1", "derived-conv", 1)])
    finder = _build_finder(folders={"inbox": inbox})

    key, items, last_folder = finder.find(
        account=object(),
        conversation_id="inbox:msg-1",
        folder="inbox",
    )

    assert key == "derived-conv"
    assert [(item.id, folder_key) for item, folder_key in items] == [("msg-1", "inbox")]
    assert last_folder == "inbox"


def test_conversation_finder_respects_search_window_limit_then_fallbacks_to_direct_item():
    items = [_item(f"msg-{index}", "other", index) for index in range(4)]
    items.append(_item("target", "conv-late", 5))
    inbox = FakeFolder(key="inbox", items=items)
    finder = _build_finder(folders={"inbox": inbox}, search_window_limit=2)

    key, found, _last_folder = finder.find(
        account=object(),
        conversation_id="inbox:target",
        folder="inbox",
    )

    assert key == "conv-late"
    assert [(item.id, folder_key) for item, folder_key in found] == [("target", "inbox")]


def test_conversation_finder_rejects_missing_conversation():
    finder = _build_finder(folders={"inbox": FakeFolder(key="inbox")})

    with pytest.raises(MailConversationFinderError, match="Conversation not found"):
        finder.find(account=object(), conversation_id="missing", folder="inbox")
