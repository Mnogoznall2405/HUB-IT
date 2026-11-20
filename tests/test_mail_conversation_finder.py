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
        self.last_only_fields = None

    def all(self):
        return FakeQuery(self)

    def get(self, *, id: str):
        for item in self.items:
            if item.id == id:
                return item
        raise KeyError(id)


class FakeQuery:
    def __init__(self, folder: FakeFolder):
        self.folder = folder

    def only(self, *fields):
        self.folder.last_only_fields = fields
        return self

    def get(self, *, id: str):
        return self.folder.get(id=id)


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
    assert inbox.last_only_fields == ("conversation_id",)


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


def test_direct_message_from_other_folder_is_not_returned_for_current_scope():
    inbox = FakeFolder(key="inbox")
    archive = FakeFolder(key="archive", items=[_item("target", "archived-conv", 1)])
    finder = _build_finder(folders={"inbox": inbox, "archive": archive})
    with pytest.raises(MailConversationFinderError, match="Conversation not found"):
        finder.find(account=object(), conversation_id="archive:target", folder="inbox")
    assert archive.last_only_fields is None


def test_direct_fallback_keeps_actual_folder_when_all_folder_scan_budget_is_spent():
    inbox = FakeFolder(key="inbox", items=[_item("a", "other", 1), _item("b", "other", 2)])
    archive = FakeFolder(key="archive", items=[_item("target", "archived-conv", 3)])
    finder = _build_finder(folders={"inbox": inbox, "archive": archive}, search_window_limit=2)
    key, items, last_folder = finder.find(account=object(), conversation_id="archive:target", folder="inbox", folder_scope="all")
    assert key == "archived-conv"
    assert [(item.id, folder_key) for item, folder_key in items] == [("target", "archive")]
    assert last_folder == "archive"


def test_complete_lookup_finds_every_matching_item_beyond_preview_budget():
    inbox = FakeFolder(key="inbox", items=[_item("first", "target", 1), _item("other", "other", 2), _item("last", "target", 3)])
    finder = _build_finder(folders={"inbox": inbox}, search_window_limit=1)
    _, partial, _ = finder.find(account=object(), conversation_id="target")
    _, complete, _ = finder.find(account=object(), conversation_id="target", require_complete=True)
    assert [item.id for item, _ in partial] == ["first"]
    assert [item.id for item, _ in complete] == ["first", "last"]


def test_complete_lookup_preserves_folder_scope_across_multiple_batches():
    inbox = FakeFolder(key="inbox", items=[_item("a", "target", 1), _item("b", "target", 2), _item("c", "target", 3)])
    archive = FakeFolder(key="archive", items=[_item("d", "target", 4)])
    finder = _build_finder(folders={"inbox": inbox, "archive": archive}, search_window_limit=1)
    _, current, _ = finder.find(account=object(), conversation_id="target", require_complete=True)
    _, all_items, _ = finder.find(account=object(), conversation_id="target", folder_scope="all", require_complete=True)
    assert [item.id for item, _ in current] == ["a", "b", "c"]
    assert [item.id for item, _ in all_items] == ["a", "b", "c", "d"]


def test_complete_lookup_fails_when_hierarchy_branch_is_unavailable():
    """A failed scope traversal must error instead of returning a partial
    conversation that would be cached as complete (MAIL-05)."""
    inbox = FakeFolder(key="inbox", items=[_item("a", "target", 1)])
    hierarchy_error = RuntimeError("archive enumeration failed")

    def _targets(_account, folder="inbox", folder_scope="current"):
        if folder_scope == "all":
            return [(inbox, "inbox"), (hierarchy_error, "hierarchy:archive")]
        return [(inbox, folder)]

    finder = MailConversationFinder(
        search_target_folders=_targets,
        folder_queryset=lambda folder_obj, _folder_key: folder_obj.items,
        item_conversation_key=lambda item: item.conversation_key,
        decode_message_id=lambda message_id: tuple(message_id.split(":", 1)),
        resolve_folder=lambda _account, folder_key: (inbox, folder_key),
        search_batch_size=2,
        search_window_limit=lambda: 20,
    )

    with pytest.raises(MailConversationFinderError, match="scope is unavailable"):
        finder.find(
            account=object(),
            conversation_id="target",
            folder="inbox",
            folder_scope="all",
            require_complete=True,
        )

    # A best-effort locate scan skips the failed branch instead of crashing.
    key, items, _ = finder.find(account=object(), conversation_id="target", folder_scope="all")
    assert key == "target"
    assert [item.id for item, _ in items] == ["a"]


class RestrictedQuery:
    """Queryset fake with a conversation_id restriction and a raw-sweep log."""

    def __init__(self, folder: FakeFolder, log: dict):
        self.folder = folder
        self.log = log
        self.fail_filter = False

    def filter(self, **kwargs):
        if self.fail_filter:
            raise RuntimeError("restriction rejected")
        conv = kwargs.get("conversation_id")
        key = getattr(conv, "id", conv)
        self.log.setdefault("restricted", []).append((self.folder.key, key))
        return [item for item in self.folder.items if item.conversation_key == key]

    def __getitem__(self, item):
        self.log.setdefault("raw", []).append((self.folder.key, item))
        return self.folder.items[item]

    def only(self, *fields):
        return self


def test_conversation_finder_prefers_server_side_conversation_filter():
    inbox = FakeFolder(key="inbox", items=[_item("a", "target", 1), _item("b", "other", 2)])
    archive = FakeFolder(key="archive", items=[_item("c", "target", 3)])
    finder = _build_finder(folders={"inbox": inbox, "archive": archive})
    log = {}
    finder.folder_queryset = lambda folder_obj, _key: RestrictedQuery(folder_obj, log)

    key, items, _ = finder.find(account=object(), conversation_id="target", folder_scope="all")

    assert key == "target"
    assert {item.id for item, _ in items} == {"a", "c"}
    assert log.get("restricted"), "server-side conversation filter was not used"
    assert not log.get("raw"), "restricted hits must not fall back to the raw sweep"


def test_conversation_finder_scans_raw_when_restriction_is_rejected():
    inbox = FakeFolder(key="inbox", items=[_item("a", "target", 1), _item("b", "other", 2)])
    finder = _build_finder(folders={"inbox": inbox})
    log = {}
    query = RestrictedQuery(inbox, log)
    query.fail_filter = True
    finder.folder_queryset = lambda folder_obj, _key: query

    key, items, _ = finder.find(account=object(), conversation_id="target")

    assert key == "target"
    assert [item.id for item, _ in items] == ["a"]
    assert log.get("raw"), "rejected restriction must fall back to the raw sweep"


def test_conversation_finder_scans_raw_when_restriction_returns_empty_everywhere():
    inbox = FakeFolder(key="inbox", items=[_item("a", "target", 1)])
    finder = _build_finder(folders={"inbox": inbox})
    log = {}
    finder.folder_queryset = lambda folder_obj, _key: RestrictedQuery(folder_obj, log)

    # The fake restriction matches by conversation_key, so a key absent from
    # the folder answers empty and triggers the subject-keyed fallback sweep.
    with pytest.raises(MailConversationFinderError, match="Conversation not found"):
        finder.find(account=object(), conversation_id="missing")

    assert log.get("raw"), "all-empty restriction must be verified by a raw sweep"


def test_complete_message_reference_lookup_reads_each_folder_only_once():
    inbox = FakeFolder(key="inbox", items=[_item("earliest", "thread", 1)])
    archive = FakeFolder(key="archive", items=[_item("anchor", "thread", 2)])
    finder = _build_finder(folders={"inbox": inbox, "archive": archive})
    visited = []

    def queryset(folder, key):
        visited.append(key)
        return folder.items

    finder.folder_queryset = queryset
    key, items, _ = finder.find(
        account=object(), conversation_id="archive:anchor", folder_scope="all", require_complete=True,
    )

    assert key == "thread"
    assert [item.id for item, _ in items] == ["earliest", "anchor"]
    assert visited == ["inbox", "archive"]
