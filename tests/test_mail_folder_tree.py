from __future__ import annotations

from types import SimpleNamespace

from backend.services.mail_folder_tree import MailFolderTreeBuilder


STANDARD_META = {
    "inbox": {"label": "Inbox", "icon_key": "inbox"},
    "sent": {"label": "Sent", "icon_key": "send"},
}


def _safe_attr(target, attr_name: str):
    return getattr(target, attr_name, None)


def _encode_folder_id(scope: str, exchange_id: str) -> str:
    return f"{scope}:{exchange_id}"


def _scope_for_alias(alias: str) -> str:
    return "archive" if alias.startswith("archive") else "mailbox"


def _custom_root(account, scope: str):
    return getattr(account, "archive_msg_folder_root" if scope == "archive" else "msg_folder_root", None)


def _builder() -> MailFolderTreeBuilder:
    return MailFolderTreeBuilder(
        standard_folders_meta=STANDARD_META,
        safe_folder_attr=_safe_attr,
        encode_folder_id=_encode_folder_id,
        folder_scope_for_alias=_scope_for_alias,
        custom_folder_root=_custom_root,
        is_mail_folder_visible_in_tree=lambda folder: getattr(folder, "folder_class", "IPF.Note") == "IPF.Note",
    )


def test_mail_folder_tree_uses_summary_for_standard_counts_and_marks_stale_customs():
    inbox = SimpleNamespace(id="inbox-id", name="Inbox", parent=None, total_count=99, unread_count=99)
    sent = SimpleNamespace(id="sent-id", name="Sent", parent=None, total_count=88, unread_count=88)
    account = SimpleNamespace(msg_folder_root=SimpleNamespace(id="root-id"), archive_msg_folder_root=None)

    result = _builder().build_tree(
        account=account,
        standard_folders={"inbox": inbox, "sent": sent},
        walked_folders=[(inbox, "inbox", "mailbox"), (sent, "sent", "mailbox")],
        favorite_ids={"inbox"},
        persisted_custom_folder_ids={"mailbox:missing"},
        summary={"inbox": {"total": 5, "unread": 2}, "sent": {"total": 3, "unread": 0}},
    )

    inbox_node = next(item for item in result.payload["items"] if item["id"] == "inbox")
    assert inbox_node["total"] == 5
    assert inbox_node["unread"] == 2
    assert inbox_node["is_favorite"] is True
    assert result.payload["favorites"] == ["inbox"]
    assert result.stale_folder_ids == {"mailbox:missing"}


def test_mail_folder_tree_keeps_visible_custom_child_after_parent():
    inbox = SimpleNamespace(id="inbox-id", name="Inbox", parent=None, total_count=1, unread_count=0)
    parent = SimpleNamespace(id="parent-id", name="Parent", parent=SimpleNamespace(id="root-id"), total_count=2, unread_count=1)
    child = SimpleNamespace(id="child-id", name="Child", parent=SimpleNamespace(id="parent-id"), total_count=3, unread_count=1)
    account = SimpleNamespace(msg_folder_root=SimpleNamespace(id="root-id"), archive_msg_folder_root=None)

    result = _builder().build_tree(
        account=account,
        standard_folders={"inbox": inbox},
        walked_folders=[
            (inbox, "inbox", "mailbox"),
            (child, "mailbox:child-id", "mailbox"),
            (parent, "mailbox:parent-id", "mailbox"),
        ],
        favorite_ids=set(),
        persisted_custom_folder_ids=set(),
        summary={},
    )

    ids = {item["id"] for item in result.payload["items"]}
    assert "mailbox:parent-id" in ids
    assert "mailbox:child-id" in ids
    child_node = next(item for item in result.payload["items"] if item["id"] == "mailbox:child-id")
    assert child_node["parent_id"] == "mailbox:parent-id"


def test_mail_folder_tree_filters_non_mail_custom_folders():
    inbox = SimpleNamespace(id="inbox-id", name="Inbox", parent=None, total_count=1, unread_count=0)
    hidden = SimpleNamespace(
        id="contacts-id",
        name="Contacts",
        parent=SimpleNamespace(id="root-id"),
        folder_class="IPF.Contact",
        total_count=1,
        unread_count=0,
    )
    account = SimpleNamespace(msg_folder_root=SimpleNamespace(id="root-id"), archive_msg_folder_root=None)

    result = _builder().build_tree(
        account=account,
        standard_folders={"inbox": inbox},
        walked_folders=[(inbox, "inbox", "mailbox"), (hidden, "mailbox:contacts-id", "mailbox")],
        favorite_ids=set(),
        persisted_custom_folder_ids=set(),
        summary={},
    )

    assert "mailbox:contacts-id" not in {item["id"] for item in result.payload["items"]}
