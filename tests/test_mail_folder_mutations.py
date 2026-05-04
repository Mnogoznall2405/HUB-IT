from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.mail_folder_mutations import MailFolderMutationError, MailFolderMutations


class FakeFolder:
    next_id = "created-id"

    def __init__(self, *, parent, name: str):
        self.parent = parent
        self.name = name
        self.id = FakeFolder.next_id
        self.child_folder_count = 0
        self.total_count = 0
        self.unread_count = 0

    def save(self, update_fields=None):
        if getattr(self.parent, "fail_create", False):
            raise RuntimeError("create failed")
        self.saved_update_fields = update_fields


def _encode_folder_id(scope: str, exchange_id: str) -> str:
    return f"{scope}:{exchange_id}"


def _decode_folder_id(folder_id: str) -> tuple[str, str]:
    scope, exchange_id = folder_id.split(":", 1)
    return scope, exchange_id


def _serialize_node(_account, folder_obj, *, folder_key, scope, parent_id, favorite_ids, counts=None):
    return {
        "id": folder_key,
        "scope": scope,
        "name": folder_obj.name,
        "parent_id": parent_id,
        "is_favorite": folder_key in favorite_ids,
    }


def _build_mutations(*, folders: dict[str, object], existing_child=None):
    roots = {
        "mailbox": SimpleNamespace(id="root-id", name="Root"),
        "archive": SimpleNamespace(id="archive-root-id", name="Archive Root"),
    }
    account = SimpleNamespace(msg_folder_root=roots["mailbox"], archive_msg_folder_root=roots["archive"])

    def _standard_folders(_account):
        return {"inbox": SimpleNamespace(id="inbox-id", name="Inbox")}

    def _resolve_folder(_account, folder_id: str):
        if folder_id == "inbox":
            return _standard_folders(_account)["inbox"], "inbox"
        return folders[folder_id], folder_id

    mutations = MailFolderMutations(
        standard_folder_keys={"inbox"},
        safe_folder_attr=lambda target, attr: getattr(target, attr, None),
        standard_folders=_standard_folders,
        resolve_folder=_resolve_folder,
        folder_scope_for_alias=lambda alias: "mailbox",
        decode_folder_id=_decode_folder_id,
        encode_folder_id=_encode_folder_id,
        custom_folder_root=lambda _account, scope: roots.get(scope),
        find_existing_child_folder=lambda _parent, _name: existing_child,
        serialize_folder_node=_serialize_node,
        folder_cls_factory=lambda: FakeFolder,
    )
    return account, mutations


def test_mail_folder_mutations_create_folder_returns_payload_and_folder_id():
    account, mutations = _build_mutations(folders={})

    result = mutations.create_folder(
        account=account,
        name="Reports",
        scope="mailbox",
        favorite_ids={"mailbox:created-id"},
    )

    assert result.folder_id == "mailbox:created-id"
    assert result.payload == {
        "id": "mailbox:created-id",
        "scope": "mailbox",
        "name": "Reports",
        "parent_id": None,
        "is_favorite": True,
    }


def test_mail_folder_mutations_create_folder_reuses_existing_child_after_save_error():
    parent = SimpleNamespace(id="parent-id", name="Parent", fail_create=True)
    existing = SimpleNamespace(id="existing-id", name="Existing", parent=parent)
    account, mutations = _build_mutations(
        folders={"mailbox:parent-id": parent},
        existing_child=existing,
    )

    result = mutations.create_folder(
        account=account,
        name="Existing",
        parent_folder_id="mailbox:parent-id",
        favorite_ids=set(),
    )

    assert result.folder_id == "mailbox:existing-id"
    assert result.payload["parent_id"] == "mailbox:parent-id"


def test_mail_folder_mutations_rename_and_delete_reject_standard_folders():
    account, mutations = _build_mutations(folders={})

    with pytest.raises(MailFolderMutationError, match="Standard folders cannot be renamed"):
        mutations.rename_folder(account=account, folder_id="inbox", name="Inbox 2", favorite_ids=set())

    with pytest.raises(MailFolderMutationError, match="Standard folders cannot be deleted"):
        mutations.delete_folder(account=account, folder_id="inbox")


def test_mail_folder_mutations_rename_and_delete_custom_folder():
    folder = SimpleNamespace(
        id="custom-id",
        name="Old",
        parent=SimpleNamespace(id="root-id"),
        save=lambda update_fields=None: None,
    )
    deleted = {"called": False}

    def _delete():
        deleted["called"] = True

    folder.delete = _delete
    account, mutations = _build_mutations(folders={"mailbox:custom-id": folder})

    result = mutations.rename_folder(
        account=account,
        folder_id="mailbox:custom-id",
        name="New",
        favorite_ids={"mailbox:custom-id"},
    )
    deleted_key = mutations.delete_folder(account=account, folder_id="mailbox:custom-id")

    assert result.payload["name"] == "New"
    assert result.payload["is_favorite"] is True
    assert deleted_key == "mailbox:custom-id"
    assert deleted["called"] is True
